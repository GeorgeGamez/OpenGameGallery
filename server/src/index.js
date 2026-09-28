import { DurableObject } from "cloudflare:workers";

const CODE_LENGTH = 4;
const CODE_ALPHABET = "0123456789";
const MAX_CREATE_ATTEMPTS = 40;

function cors(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status = 200, request = null) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  for (const [k, v] of Object.entries(cors(request || new Request("https://invalid.local")))) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

function text(message, status = 200, request = null) {
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  for (const [k, v] of Object.entries(cors(request || new Request("https://invalid.local")))) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(message, { status, headers });
}

function normalizeCode(value) { return String(value || "").trim().toUpperCase(); }
function validCode(code) { return code.length === CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c)); }
function generateCode() { return [...crypto.getRandomValues(new Uint8Array(CODE_LENGTH))].map(b => CODE_ALPHABET[b % 10]).join(""); }
function roomId(env, code) { return env.GAME_ROOM.idFromName(`room:${code}`); }
function cloneJson(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return null; } }
function publicParticipant(p) { return { clientId:p.clientId, profileId:p.profileId, name:p.name, avatar:p.avatar, role:p.role, spectator:p.spectator, connected:p.connected }; }
function publicParticipants(room) { return room.participants.map(publicParticipant); }
function publicRoom(room) { return { version:room.version, createdAt:room.createdAt, hostClientId:room.hostClientId, config:room.config, participants:publicParticipants(room), started:room.started, stateAvailable:room.state !== null, revision:room.revision }; }
function send(ws, data) { try { ws.send(JSON.stringify(data)); } catch {} }

async function createRoom(env, request, bodyOverride = null) {
  let body = bodyOverride;
  if (!body) {
    try { body = await request.json(); }
    catch { return json({ error:"Request body must be valid JSON." }, 400, request); }
  }

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const stub = env.GAME_ROOM.get(roomId(env, code));
    const response = await stub.fetch("https://room.internal/create", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        code,
        hostName:String(body?.hostName || "Host").slice(0,30),
        hostAvatar:String(body?.hostAvatar || "♟").slice(0,8),
        config:body?.config && typeof body.config === "object" ? body.config : {},
      }),
    });
    if (response.status === 201) return json(await response.json(), 201, request);
    if (response.status !== 409) return text(await response.text() || "Could not create room.", 500, request);
  }
  return json({ error:"Could not find an unused four-digit room code. Try again." }, 503, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status:204, headers:cors(request) });

    if (url.pathname === "/") return text("Game Library multiplayer server is running.\n\nEndpoints:\nPOST /api/rooms\nGET /api/rooms/:code\nGET /ws/:code\n", 200, request);

    // Normal creation uses POST. The /new fallback is deliberately a GET so
    // a browser can still create a room if an intervening proxy blocks POST.
    if (url.pathname === "/api/rooms" && request.method === "POST") return createRoom(env, request);
    if (url.pathname === "/api/rooms/new" && request.method === "GET") {
      const hostName = url.searchParams.get("hostName") || "Host";
      const hostAvatar = url.searchParams.get("hostAvatar") || "♟";
      return createRoom(env, request, { hostName, hostAvatar });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([0-9A-Z]{4})$/i);
    if (roomMatch && request.method === "GET") {
      const code = normalizeCode(roomMatch[1]);
      if (!validCode(code)) return json({ error:"Invalid room code." }, 400, request);
      const stub = env.GAME_ROOM.get(roomId(env, code));
      const response = await stub.fetch("https://room.internal/info");
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors(request))) headers.set(k, v);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
    }

    const wsMatch = url.pathname.match(/^\/ws\/([0-9A-Z]{4})$/i);
    if (wsMatch && request.method === "GET") {
      const code = normalizeCode(wsMatch[1]);
      if (!validCode(code)) return text("Invalid room code.", 400, request);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return text("WebSocket upgrade required.", 426, request);
      return env.GAME_ROOM.get(roomId(env, code)).fetch(request);
    }

    return text("Not found.", 404, request);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.stateCache = null;
    for (const ws of this.ctx.getWebSockets()) {
      if (!ws.deserializeAttachment()) { try { ws.close(1011, "Missing connection state"); } catch {} }
    }
  }

  async getState() { if (this.stateCache) return this.stateCache; this.stateCache = await this.ctx.storage.get("roomState") || null; return this.stateCache; }
  async saveState(state) { this.stateCache = state; await this.ctx.storage.put("roomState", state); }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") return this.createRoom(request);
    if (url.pathname === "/info" && request.method === "GET") return this.info();
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") return this.connect(request);
    return new Response("Not found", { status:404 });
  }

  async createRoom(request) {
    if (await this.getState()) return new Response("Room already exists", { status:409 });
    let body; try { body = await request.json(); } catch { return new Response("Invalid JSON", { status:400 }); }
    const hostToken = crypto.randomUUID();
    const room = {
      version:1, createdAt:new Date().toISOString(), code:normalizeCode(body?.code),
      hostToken, hostClientId:null,
      config:cloneJson(body?.config) || {}, participants:[], started:false, state:null, revision:0,
    };
    await this.saveState(room);
    return new Response(JSON.stringify({ code:room.code, hostToken, room:publicRoom(room) }), { status:201, headers:{"Content-Type":"application/json"} });
  }

  async info() {
    const room = await this.getState();
    if (!room) return new Response(JSON.stringify({error:"Room not found."}), { status:404, headers:{"Content-Type":"application/json"} });
    return new Response(JSON.stringify({room:publicRoom(room)}), { status:200, headers:{"Content-Type":"application/json"} });
  }

  async connect(request) {
    const room = await this.getState();
    if (!room) return new Response("Room not found", { status:404 });
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const requestedRole = url.searchParams.get("role") || "player";
    const requestedClientId = url.searchParams.get("clientId") || "";
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const clientId = requestedClientId || crypto.randomUUID();
    const isHost = token !== "" && token === room.hostToken;
    server.serializeAttachment({ clientId, isHost, role:isHost ? "host" : requestedRole });

    const existing = room.participants.find(p => p.clientId === clientId);
    if (existing) {
      existing.connected = true;
      existing.role = isHost ? "host" : existing.role === "host" ? "host" : requestedRole;
      existing.isHost = isHost;
      existing.lastSeen = new Date().toISOString();
    } else {
      room.participants.push({ clientId, profileId:null, name:isHost ? "Host" : "Player", avatar:isHost ? "🎮" : "🎲", role:isHost ? "host" : requestedRole, isHost, playerToken:crypto.randomUUID(), spectator:false, connected:true, lastSeen:new Date().toISOString() });
    }
    if (isHost) room.hostClientId = clientId;
    await this.saveState(room);
    send(server, { type:"room:hello", room:publicRoom(room), self:publicParticipant(room.participants.find(p=>p.clientId===clientId)), gameState:room.started ? room.state : null });
    this.broadcast({ type:"room:participants", participants:publicParticipants(room) }, server);
    return new Response(null, { status:101, webSocket:client });
  }

  async webSocketMessage(ws, message) {
    let data; try { data = JSON.parse(typeof message === "string" ? message : ""); } catch { send(ws,{type:"error",code:"INVALID_JSON",message:"Message must be JSON."}); return; }
    const attachment=ws.deserializeAttachment(); if(!attachment?.clientId){try{ws.close(1011,"Missing connection state")}catch{};return}
    const room=await this.getState(); if(!room){send(ws,{type:"error",code:"ROOM_NOT_FOUND",message:"Room no longer exists."});return}
    const participant=room.participants.find(p=>p.clientId===attachment.clientId); if(!participant){send(ws,{type:"error",code:"NOT_REGISTERED",message:"Connection is not registered."});return}
    participant.connected=true; participant.lastSeen=new Date().toISOString();

    switch(String(data?.type||"")) {
      case "player:identify":
        if(typeof data.name==="string"&&data.name.trim()) participant.name=data.name.trim().slice(0,30);
        if(typeof data.avatar==="string"&&data.avatar) participant.avatar=data.avatar.slice(0,8);
        if(typeof data.profileId==="string") participant.profileId=data.profileId.slice(0,100);
        participant.spectator=Boolean(data.spectator);
        await this.saveState(room);
        send(ws,{type:"player:identified",player:publicParticipant(participant)});
        this.broadcast({type:"room:participants",participants:publicParticipants(room)});
        break;
      case "room:config":
        if(!attachment.isHost){send(ws,{type:"error",code:"HOST_ONLY",message:"Only the host may change room configuration."});break}
        room.config=cloneJson(data.config)||{}; room.revision++; await this.saveState(room);
        this.broadcast({type:"room:config",config:room.config,revision:room.revision}); break;
      case "game:start":
        if(!attachment.isHost){send(ws,{type:"error",code:"HOST_ONLY",message:"Only the host may start the game."});break}
        if(!room.config?.players || room.config.players.length!==2){send(ws,{type:"error",code:"BAD_CONFIG",message:"A two-player game configuration is required."});break}
        room.started=true; room.state=null; room.revision++; await this.saveState(room);
        this.broadcast({type:"game:start",config:room.config,revision:room.revision}); break;
      case "game:move":
        if(!room.started){send(ws,{type:"error",code:"GAME_NOT_STARTED",message:"The game has not started."});break}
        if(!this.senderMayMove(room,participant,data)){send(ws,{type:"NOT_YOUR_TURN",message:"This connection is not assigned to that seat."});break}
        this.broadcast({type:"game:move",sender:publicParticipant(participant),payload:safePayload(data)},ws); break;
      case "game:state":
        if(!attachment.isHost){send(ws,{type:"error",code:"HOST_ONLY",message:"Only the host may publish the game state."});break}
        if(!room.started){send(ws,{type:"error",code:"GAME_NOT_STARTED",message:"The game has not started."});break}
        room.state=cloneJson(data.state); room.revision++; await this.saveState(room);
        this.broadcast({type:"game:state",state:room.state,revision:room.revision},ws); break;
      default: send(ws,{type:"error",code:"UNKNOWN_MESSAGE",message:`Unknown message type: ${String(data?.type||"")||"(missing)"}`});
    }
    await this.saveState(room);
  }

  senderMayMove(room, participant, data) {
    const seat=String(data?.seat||"");
    const p=(room.config?.players||[]).find(x=>x.seat===seat);
    return !!p && p.type==="human" && p.clientId===participant.clientId;
  }

  async webSocketClose(ws) {
    const a=ws.deserializeAttachment(); if(!a?.clientId)return;
    const room=await this.getState(); if(!room)return;
    const p=room.participants.find(x=>x.clientId===a.clientId); if(!p)return;
    p.connected=false;p.lastSeen=new Date().toISOString();if(room.hostClientId===a.clientId)room.hostClientId=null;
    await this.saveState(room);this.broadcast({type:"room:participants",participants:publicParticipants(room)});
  }

  broadcast(message,except=null){const payload=JSON.stringify(message);for(const ws of this.ctx.getWebSockets()){if(ws===except)continue;try{ws.send(payload)}catch{}}}
}

function safePayload(data){
  const payload={move:data?.move||null,seat:data?.seat||null};
  return cloneJson(payload)||{move:null,seat:null};
}
