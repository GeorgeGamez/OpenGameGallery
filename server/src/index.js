import { DurableObject } from "cloudflare:workers";

const CODE_LENGTH = 4;
const CODE_ALPHABET = "0123456789";
const MAX_CREATE_ATTEMPTS = 20;
const ALLOWED_METHODS = "GET,POST,OPTIONS";

function corsHeaders(_request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, init = {}, request = null) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");

  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

function textResponse(message, status = 200, request = null) {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8"
  });

  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(message, { status, headers });
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidCode(code) {
  return code.length === CODE_LENGTH &&
    [...code].every(character => CODE_ALPHABET.includes(character));
}

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes]
    .map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join("");
}

function roomId(env, code) {
  return env.GAME_ROOM.idFromName(`room:${code}`);
}

async function createRoom(env, request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 }, request);
  }

  const requestedConfig = body?.config && typeof body.config === "object"
    ? body.config
    : {};

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const stub = env.GAME_ROOM.get(roomId(env, code));
    const response = await stub.fetch("https://room.internal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        config: requestedConfig,
        hostName: body?.hostName || "Host",
        hostAvatar: body?.hostAvatar || "🎮"
      })
    });

    if (response.status === 201) {
      const created = await response.json();
      return json(created, { status: 201 }, request);
    }

    if (response.status !== 409) {
      const errorText = await response.text();
      return textResponse(errorText || "Could not create room.", 500, request);
    }
  }

  return json(
    { error: "Could not find an unused four-digit room code. Try again." },
    { status: 503 },
    request
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    if (url.pathname === "/") {
      return textResponse(
        "Game Library multiplayer server is running.\n\nEndpoints:\nPOST /api/rooms\nGET /api/rooms/:code\nGET /ws/:code\n",
        200,
        request
      );
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return createRoom(env, request);
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([0-9A-Z]{4})$/i);
    if (roomMatch && request.method === "GET") {
      const code = normalizeCode(roomMatch[1]);
      if (!isValidCode(code)) {
        return json({ error: "Invalid room code." }, { status: 400 }, request);
      }

      try {
        const stub = env.GAME_ROOM.get(roomId(env, code));
        const response = await stub.fetch("https://room.internal/info");

        // The Durable Object response is internal. Re-apply browser-facing
        // CORS headers here so GitHub Pages can read it cross-origin.
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaders(request))) {
          headers.set(key, value);
        }
        headers.set("Cache-Control", "no-store");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch (error) {
        console.error("Room lookup failed:", error);
        return json(
          { error: "Could not look up the room." },
          { status: 502 },
          request
        );
      }
    }

    const websocketMatch = url.pathname.match(/^\/ws\/([0-9A-Z]{4})$/i);
    if (websocketMatch && request.method === "GET") {
      const code = normalizeCode(websocketMatch[1]);

      if (!isValidCode(code)) {
        return textResponse("Invalid room code.", 400, request);
      }

      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return textResponse("WebSocket upgrade required.", 426, request);
      }

      const stub = env.GAME_ROOM.get(roomId(env, code));
      return stub.fetch(request);
    }

    return textResponse("Not found.", 404, request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    this.stateCache = null;

    // Restore the lightweight connection index after hibernation.
    for (const ws of this.ctx.getWebSockets()) {
      if (!ws.deserializeAttachment()) {
        ws.close(1011, "Missing connection state");
      }
    }
  }

  async getState() {
    if (this.stateCache) return this.stateCache;

    const state = await this.ctx.storage.get("roomState");
    this.stateCache = state || null;
    return this.stateCache;
  }

  async saveState(state) {
    this.stateCache = state;
    await this.ctx.storage.put("roomState", state);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      return this.createRoom(request);
    }

    if (url.pathname === "/info" && request.method === "GET") {
      return this.roomInfoResponse();
    }

    if (url.pathname === "/websocket" || request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.acceptConnection(request);
    }

    return new Response("Not found", { status: 404 });
  }

  async createRoom(request) {
    const existing = await this.getState();
    if (existing) {
      return new Response("Room already exists", { status: 409 });
    }

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
      config: sanitizeConfig(body?.config),
      participants: [],
      started: false,
      state: null,
      revision: 0
    };

    await this.saveState(room);

    return new Response(JSON.stringify({
      code: room.code,
      hostToken,
      room: publicRoom(room)
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  }

  async roomInfoResponse() {
    const room = await this.getState();

    if (!room) {
      return new Response(JSON.stringify({ error: "Room not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ room: publicRoom(room) }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  async acceptConnection(request) {
    const room = await this.getState();
    if (!room) {
      return new Response("Room not found", { status: 404 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const role = url.searchParams.get("role") || "player";
    const reconnectId = url.searchParams.get("clientId") || "";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    const clientId = reconnectId || crypto.randomUUID();
    const isHost = token && token === room.hostToken;

    server.serializeAttachment({
      clientId,
      isHost: Boolean(isHost),
      role: isHost ? "host" : role
    });

    await this.handleConnect(server, {
      clientId,
      role: isHost ? "host" : role,
      isHost: Boolean(isHost),
      url
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async handleConnect(ws, connection) {
    const room = await this.getState();
    if (!room) return;

    const attachment = connection;
    const existing = room.participants.find(p => p.clientId === attachment.clientId);

    if (existing) {
      existing.connected = true;
      existing.role = attachment.role;
      existing.isHost = attachment.isHost;
      existing.lastSeen = new Date().toISOString();
    } else {
      room.participants.push({
        clientId: attachment.clientId,
        profileId: null,
        name: attachment.isHost ? "Host" : "Player",
        avatar: attachment.isHost ? "🎮" : "🎲",
        role: attachment.role,
        playerToken: crypto.randomUUID(),
        spectator: false,
        connected: true,
        lastSeen: new Date().toISOString()
      });
    }

    if (attachment.isHost) {
      room.hostClientId = attachment.clientId;
    }

    await this.saveState(room);

    sendJson(ws, {
      type: "room:hello",
      room: publicRoom(room),
      self: room.participants.find(p => p.clientId === attachment.clientId)
    });

    this.broadcast({
      type: "room:participants",
      participants: publicParticipants(room)
    }, ws);
  }

  async webSocketMessage(ws, message) {
    let data;

    try {
      data = JSON.parse(typeof message === "string" ? message : "");
    } catch {
      sendJson(ws, { type: "error", code: "INVALID_JSON", message: "Message must be JSON." });
      return;
    }

    const attachment = ws.deserializeAttachment();
    if (!attachment?.clientId) {
      ws.close(1011, "Missing connection state");
      return;
    }

    const room = await this.getState();
    if (!room) {
      sendJson(ws, { type: "error", code: "ROOM_NOT_FOUND", message: "Room no longer exists." });
      return;
    }

    const participant = room.participants.find(p => p.clientId === attachment.clientId);
    if (!participant) {
      sendJson(ws, { type: "error", code: "NOT_REGISTERED", message: "Connection is not registered." });
      return;
    }

    participant.lastSeen = new Date().toISOString();
    participant.connected = true;

    const type = String(data?.type || "");

    switch (type) {
      case "ping":
        sendJson(ws, { type: "pong", time: Date.now() });
        break;

      case "player:identify":
        await this.handleIdentify(ws, room, participant, data);
        break;

      case "room:config":
        if (!attachment.isHost) {
          sendJson(ws, { type: "error", code: "HOST_ONLY", message: "Only the host may change room configuration." });
          break;
        }
        room.config = sanitizeConfig(data.config);
        room.revision += 1;
        await this.saveState(room);
        this.broadcast({ type: "room:config", config: room.config, revision: room.revision });
        break;

      case "player:spectator":
        await this.handleSpectator(room, participant, data);
        break;

      case "game:start":
        if (!attachment.isHost) {
          sendJson(ws, { type: "error", code: "HOST_ONLY", message: "Only the host may start the game." });
          break;
        }
        room.started = true;
        room.revision += 1;
        await this.saveState(room);

        const startMessage = {
          type: "game:start",
          config: room.config,
          revision: room.revision
        };

        // Confirm the start directly to the host, then broadcast it to
        // every other connected client. This avoids depending on the host
        // receiving its own broadcast before navigating away.
        sendJson(ws, startMessage);
        this.broadcast(startMessage, ws);
        break;

      case "game:move":
        if (!room.started) {
          sendJson(ws, { type: "error", code: "GAME_NOT_STARTED", message: "The game has not started." });
          break;
        }
        await this.relayGameEvent(room, participant, "game:move", data);
        break;

      case "game:state":
        if (!attachment.isHost) {
          sendJson(ws, { type: "error", code: "HOST_ONLY", message: "Only the host may publish the authoritative game state." });
          break;
        }
        room.state = data.state ?? null;
        room.revision += 1;
        await this.saveState(room);
        this.broadcast({
          type: "game:state",
          state: room.state,
          revision: room.revision
        }, ws);
        break;

      case "game:event":
        await this.relayGameEvent(room, participant, "game:event", data);
        break;

      default:
        sendJson(ws, {
          type: "error",
          code: "UNKNOWN_MESSAGE",
          message: `Unknown message type: ${type || "(missing)"}`
        });
        break;
    }

    await this.saveState(room);
  }

  async handleIdentify(ws, room, participant, data) {
    if (typeof data.name === "string" && data.name.trim()) {
      participant.name = data.name.trim().slice(0, 30);
    }

    if (typeof data.avatar === "string") {
      participant.avatar = data.avatar.slice(0, 8);
    }

    if (typeof data.profileId === "string") {
      participant.profileId = data.profileId.slice(0, 100);
    }

    if (data.spectator === true || data.spectator === false) {
      participant.spectator = Boolean(data.spectator);
    }

    sendJson(ws, {
      type: "player:identified",
      player: publicParticipant(participant)
    });

    this.broadcast({
      type: "room:participants",
      participants: publicParticipants(room)
    });
  }

  async handleSpectator(room, participant, data) {
    participant.spectator = Boolean(data.spectator);

    this.broadcast({
      type: "player:spectator",
      clientId: participant.clientId,
      spectator: participant.spectator,
      participants: publicParticipants(room)
    });
  }

  async relayGameEvent(room, participant, type, data) {
    const event = {
      type,
      sender: publicParticipant(participant),
      payload: sanitizeGamePayload(data)
    };

    this.broadcast(event);
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();
    if (!attachment?.clientId) return;

    const room = await this.getState();
    if (!room) return;

    const participant = room.participants.find(p => p.clientId === attachment.clientId);
    if (!participant) return;

    participant.connected = false;
    participant.lastSeen = new Date().toISOString();

    if (room.hostClientId === attachment.clientId) {
      room.hostClientId = null;
    }

    await this.saveState(room);

    this.broadcast({
      type: "room:participants",
      participants: publicParticipants(room)
    });
  }

  broadcast(message, except = null) {
    const payload = JSON.stringify(message);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;

      try {
        ws.send(payload);
      } catch {
        // The runtime will surface closed sockets through WebSocket events.
      }
    }
  }
}

function sanitizeConfig(config) {
  if (!config || typeof config !== "object") return {};

  // Keep the transport generic, but place a sensible upper bound on the
  // size of configuration sent by a browser.
  try {
    const jsonConfig = JSON.stringify(config);
    if (jsonConfig.length > 100_000) return {};
    return JSON.parse(jsonConfig);
  } catch {
    return {};
  }
}

function sanitizeGamePayload(data) {
  const payload = data?.payload;

  if (payload === undefined) return null;

  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > 100_000) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function publicParticipant(participant) {
  return {
    clientId: participant.clientId,
    profileId: participant.profileId,
    name: participant.name,
    avatar: participant.avatar,
    role: participant.role,
    spectator: participant.spectator,
    connected: participant.connected
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
    revision: room.revision
  };
}

function sendJson(ws, data) {
  try {
    ws.send(JSON.stringify(data));
  } catch {
    // Ignore a socket that closed between events.
  }
}
