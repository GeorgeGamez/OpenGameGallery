import { DurableObject } from "cloudflare:workers";

const CODE_LENGTH = 4;
const CODE_ALPHABET = "0123456789";
const MAX_CREATE_ATTEMPTS = 20;
const ALLOWED_METHODS = "GET,POST,OPTIONS";

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request?.headers?.get("Origin") || "*",
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, init = {}, request = null) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(corsHeaders(request)))
    headers.set(key, value);
  return new Response(JSON.stringify(data), { ...init, headers });
}

function textResponse(message, status = 200, request = null) {
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  for (const [key, value] of Object.entries(corsHeaders(request)))
    headers.set(key, value);
  return new Response(message, { status, headers });
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}
function isValidCode(code) {
  return (
    code.length === CODE_LENGTH &&
    [...code].every((c) => CODE_ALPHABET.includes(c))
  );
}
function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes]
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("");
}
function roomId(env, code) {
  return env.GAME_ROOM.idFromName(`room:${code}`);
}

async function parseCreateBody(request) {
  const url = new URL(request.url);
  let body = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return { error: "Request body must be valid JSON." };
  }
  body = body && typeof body === "object" ? body : {};
  if (url.searchParams.get("hostName"))
    body.hostName = url.searchParams.get("hostName");
  if (url.searchParams.get("hostAvatar"))
    body.hostAvatar = url.searchParams.get("hostAvatar");
  return { body };
}

async function createRoom(env, request) {
  const parsed = await parseCreateBody(request);
  if (parsed.error)
    return json({ error: parsed.error }, { status: 400 }, request);
  const body = parsed.body;
  const requestedConfig =
    body.config && typeof body.config === "object"
      ? body.config
      : { game: "chess", variant: "standard" };

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const stub = env.GAME_ROOM.get(roomId(env, code));
    const response = await stub.fetch("https://room.internal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        config: requestedConfig,
        hostName: body.hostName || "Host",
        hostAvatar: body.hostAvatar || "🎮",
      }),
    });
    if (response.status === 201)
      return json(await response.json(), { status: 201 }, request);
    if (response.status !== 409) {
      const message = await response.text();
      return json(
        { error: message || "Could not create room." },
        { status: 500 },
        request,
      );
    }
  }
  return json(
    { error: "Could not find an unused four-digit room code. Try again." },
    { status: 503 },
    request,
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (url.pathname === "/" || url.pathname === "/health") {
      return textResponse(
        "Game Library multiplayer server is running.\n\nEndpoints:\nPOST /api/rooms\nPOST /api/rooms/new\nGET /api/rooms/:code\nGET /ws/:code\n",
        200,
        request,
      );
    }

    // Keep these aliases deliberately small. They also make the frontend tolerant
    // of older dashboard/deployment configurations while the project is being set up.
    if (
      (url.pathname === "/api/rooms" ||
        url.pathname === "/api/rooms/new" ||
        url.pathname === "/api/rooms/create" ||
        url.pathname === "/api/create-room") &&
      (request.method === "POST" || request.method === "GET")
    ) {
      return createRoom(env, request);
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([0-9A-Z]{4})$/i);
    if (roomMatch && request.method === "GET") {
      const code = normalizeCode(roomMatch[1]);
      if (!isValidCode(code))
        return json({ error: "Invalid room code." }, { status: 400 }, request);
      const stub = env.GAME_ROOM.get(roomId(env, code));
      const response = await stub.fetch("https://room.internal/info");
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(request)))
        headers.set(key, value);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const websocketMatch = url.pathname.match(/^\/ws\/([0-9A-Z]{4})$/i);
    if (websocketMatch && request.method === "GET") {
      const code = normalizeCode(websocketMatch[1]);
      if (!isValidCode(code))
        return textResponse("Invalid room code.", 400, request);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return textResponse("WebSocket upgrade required.", 426, request);
      return env.GAME_ROOM.get(roomId(env, code)).fetch(request);
    }

    return textResponse("Not found.", 404, request);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.stateCache = null;
  }

  async getState() {
    if (this.stateCache) return this.stateCache;
    this.stateCache = (await this.ctx.storage.get("roomState")) || null;
    return this.stateCache;
  }

  async saveState(state) {
    this.stateCache = state;
    await this.ctx.storage.put("roomState", state);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST")
      return this.createRoom(request);
    if (url.pathname === "/info" && request.method === "GET")
      return this.roomInfoResponse();
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket")
      return this.acceptConnection(request);
    return new Response("Not found", { status: 404 });
  }

  async createRoom(request) {
    const existing = await this.getState();
    if (existing) return new Response("Room already exists", { status: 409 });
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const hostToken = crypto.randomUUID();
    const room = {
      version: 1,
      createdAt: new Date().toISOString(),
      hostToken,
      hostClientId: null,
      code: normalizeCode(body?.code),
      config: sanitizeConfig(
        body?.config || { game: "chess", variant: "standard" },
      ),
      participants: [],
      started: false,
      state: null,
      revision: 0,
    };
    await this.saveState(room);
    return new Response(
      JSON.stringify({ code: room.code, hostToken, room: publicRoom(room) }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  async roomInfoResponse() {
    const room = await this.getState();
    if (!room)
      return new Response(JSON.stringify({ error: "Room not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    return new Response(JSON.stringify({ room: publicRoom(room) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  async acceptConnection(request) {
    const room = await this.getState();
    if (!room) return new Response("Room not found", { status: 404 });
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const requestedRole = url.searchParams.get("role") || "player";
    const requestedId = url.searchParams.get("clientId") || "";
    const isHost = token !== "" && token === room.hostToken;
    const clientId = requestedId || crypto.randomUUID();
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      clientId,
      isHost,
      role: isHost ? "host" : requestedRole,
    });
    await this.handleConnect(server, {
      clientId,
      isHost,
      role: isHost ? "host" : requestedRole,
    });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async handleConnect(ws, connection) {
    const room = await this.getState();
    const existing = room.participants.find(
      (p) => p.clientId === connection.clientId,
    );
    if (existing) {
      existing.connected = true;
      existing.role = connection.role;
      existing.isHost = connection.isHost;
      existing.lastSeen = new Date().toISOString();
    } else {
      room.participants.push({
        clientId: connection.clientId,
        profileId: null,
        name: connection.isHost ? "Host" : "Player",
        avatar: connection.isHost ? "🎮" : "🎲",
        role: connection.role,
        playerToken: crypto.randomUUID(),
        spectator: false,
        connected: true,
        isHost: connection.isHost,
        lastSeen: new Date().toISOString(),
      });
    }
    if (connection.isHost) room.hostClientId = connection.clientId;
    await this.saveState(room);
    const self = room.participants.find(
      (p) => p.clientId === connection.clientId,
    );
    sendJson(ws, { type: "room:hello", room: publicRoom(room), self });
    if (room.started && room.config)
      sendJson(ws, {
        type: "game:start",
        config: room.config,
        revision: room.revision,
      });
    if (room.state !== null)
      sendJson(ws, {
        type: "game:state",
        state: room.state,
        revision: room.revision,
      });
    this.broadcast(
      { type: "room:participants", participants: publicParticipants(room) },
      ws,
    );
  }

  async webSocketMessage(ws, message) {
    let data;
    try {
      data = JSON.parse(typeof message === "string" ? message : "");
    } catch {
      sendJson(ws, {
        type: "error",
        code: "INVALID_JSON",
        message: "Message must be JSON.",
      });
      return;
    }
    const attachment = ws.deserializeAttachment();
    if (!attachment?.clientId) {
      ws.close(1011, "Missing connection state");
      return;
    }
    const room = await this.getState();
    if (!room) {
      sendJson(ws, {
        type: "error",
        code: "ROOM_NOT_FOUND",
        message: "Room no longer exists.",
      });
      return;
    }
    const participant = room.participants.find(
      (p) => p.clientId === attachment.clientId,
    );
    if (!participant) {
      sendJson(ws, {
        type: "error",
        code: "NOT_REGISTERED",
        message: "Connection is not registered.",
      });
      return;
    }
    participant.lastSeen = new Date().toISOString();
    participant.connected = true;

    switch (String(data?.type || "")) {
      case "ping":
        sendJson(ws, { type: "pong", time: Date.now() });
        break;
      case "player:identify":
        await this.handleIdentify(ws, room, participant, data);
        break;
      case "room:config":
        if (!attachment.isHost) {
          sendJson(ws, {
            type: "error",
            code: "HOST_ONLY",
            message: "Only the host may change room configuration.",
          });
          break;
        }
        room.config = sanitizeConfig(data.config);
        room.revision += 1;
        await this.saveState(room);
        this.broadcast({
          type: "room:config",
          config: room.config,
          revision: room.revision,
        });
        break;
      case "game:start":
        if (!attachment.isHost) {
          sendJson(ws, {
            type: "error",
            code: "HOST_ONLY",
            message: "Only the host may start the game.",
          });
          break;
        }
        room.config = sanitizeConfig(
          data.config || room.config || { game: "chess", variant: "standard" },
        );
        room.started = true;
        room.revision += 1;
        await this.saveState(room);
        this.broadcast({
          type: "game:start",
          config: room.config,
          revision: room.revision,
        });
        break;
      case "game:move":
        if (!room.started) {
          sendJson(ws, {
            type: "error",
            code: "GAME_NOT_STARTED",
            message: "The game has not started.",
          });
          break;
        }
        this.broadcast({
          type: "game:move",
          sender: publicParticipant(participant),
          payload: sanitizeGamePayload(data),
        });
        break;
      case "game:state":
        if (!attachment.isHost) {
          sendJson(ws, {
            type: "error",
            code: "HOST_ONLY",
            message: "Only the host may publish the authoritative game state.",
          });
          break;
        }
        room.state = data.state ?? null;
        room.revision += 1;
        await this.saveState(room);
        this.broadcast(
          { type: "game:state", state: room.state, revision: room.revision },
          ws,
        );
        break;
      default:
        sendJson(ws, {
          type: "error",
          code: "UNKNOWN_MESSAGE",
          message: `Unknown message type: ${String(data?.type || "(missing)")}`,
        });
        break;
    }
    await this.saveState(room);
  }

  async handleIdentify(ws, room, participant, data) {
    if (typeof data.name === "string" && data.name.trim())
      participant.name = data.name.trim().slice(0, 30);
    if (typeof data.avatar === "string")
      participant.avatar = data.avatar.slice(0, 8);
    if (typeof data.profileId === "string")
      participant.profileId = data.profileId.slice(0, 100);
    if (data.spectator === true || data.spectator === false)
      participant.spectator = Boolean(data.spectator);
    sendJson(ws, {
      type: "player:identified",
      player: publicParticipant(participant),
    });
    this.broadcast({
      type: "room:participants",
      participants: publicParticipants(room),
    });
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();
    if (!attachment?.clientId) return;
    const room = await this.getState();
    if (!room) return;
    const participant = room.participants.find(
      (p) => p.clientId === attachment.clientId,
    );
    if (!participant) return;
    participant.connected = false;
    participant.lastSeen = new Date().toISOString();
    if (room.hostClientId === attachment.clientId) room.hostClientId = null;
    await this.saveState(room);
    this.broadcast({
      type: "room:participants",
      participants: publicParticipants(room),
    });
  }

  broadcast(message, except = null) {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(payload);
      } catch {}
    }
  }
}

function sanitizeConfig(config) {
  if (!config || typeof config !== "object")
    return { game: "chess", variant: "standard" };
  try {
    const raw = JSON.stringify(config);
    if (raw.length > 100000) return { game: "chess", variant: "standard" };
    return JSON.parse(raw);
  } catch {
    return { game: "chess", variant: "standard" };
  }
}
function sanitizeGamePayload(data) {
  try {
    const raw = JSON.stringify(data?.payload ?? null);
    if (raw.length > 100000) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function publicParticipant(p) {
  return {
    clientId: p.clientId,
    profileId: p.profileId,
    name: p.name,
    avatar: p.avatar,
    role: p.role,
    spectator: p.spectator,
    connected: p.connected,
  };
}
function publicParticipants(room) {
  return room.participants.map(publicParticipant);
}
function publicRoom(room) {
  return {
    version: room.version,
    createdAt: room.createdAt,
    hostClientId: room.hostClientId,
    config: room.config,
    participants: publicParticipants(room),
    started: room.started,
    stateAvailable: room.state !== null,
    revision: room.revision,
  };
}
function sendJson(ws, data) {
  try {
    ws.send(JSON.stringify(data));
  } catch {}
}
