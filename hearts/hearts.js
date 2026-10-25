(function () {
"use strict";
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let launchConfig = {};
try {
  const raw = params.get("onlineConfig") || sessionStorage.getItem("gameLibraryOnlineConfig") || "";
  if (raw) launchConfig = JSON.parse(raw);
} catch {}
if (launchConfig.options && typeof launchConfig.options === "object") launchConfig = { ...launchConfig, ...launchConfig.options };
const profiles = (() => { try { return JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]"); } catch { return []; } })();
const SUITS = ["♣", "♦", "♥", "♠"], SUIT_ORDER = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };
const rankLabel = (r) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[r] || String(r));
const cardText = (c) => `${rankLabel(c.rank)}${c.suit}`;
const points = (c) => c.suit === "♥" ? 1 : c.suit === "♠" && c.rank === 12 ? 13 : 0;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function buildDeck() { const d = []; for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) d.push({ id: `${suit}-${rank}`, suit, rank }); return shuffle(d); }
function sortHand(h) { h.sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank); }
function cardHtml(c, selected = false) {
  const color = (c.suit === "♥" || c.suit === "♦") ? "red" : "black", r = rankLabel(c.rank);
  return `<div class="card ${color} ${selected ? "selected" : ""}" data-card="${c.id}" role="button" tabindex="0" aria-label="${r} ${c.suit}"><span class="corner"><span>${r}</span><span class="corner-suit">${c.suit}</span></span><span class="face"><span class="center-rank">${r}</span><span class="center-suit">${c.suit}</span></span><span class="bottom"><span>${r}</span><span class="corner-suit">${c.suit}</span></span></div>`;
}
class HeartsGame {
  constructor(config = {}) { this.config = config; this.players = []; this.totalScores = []; this.roundNumber = 1; this.resetPlayers(config.players || []); this.startRound(); }
  resetPlayers(source) {
    const fallback = [
      { type: "human", name: profiles[0]?.name || "Player 1", avatar: profiles[0]?.avatar || "♟", profileId: profiles[0]?.id || "" },
      { type: "computer", name: "Computer 1", avatar: "🤖", difficulty: "normal" },
      { type: "computer", name: "Computer 2", avatar: "🤖", difficulty: "normal" },
      { type: "computer", name: "Computer 3", avatar: "🤖", difficulty: "normal" }
    ];
    const list = Array.isArray(source) && source.length ? source : fallback;
    this.players = list.slice(0, 4).map((p, i) => ({ ...p, type: p.type === "computer" ? "computer" : "human", name: p.name || `Player ${i + 1}`, avatar: p.avatar || (p.type === "computer" ? "🤖" : "🃏"), seat: i }));
    while (this.players.length < 4) { const i = this.players.length; this.players.push({ type: "computer", name: `Computer ${i + 1}`, avatar: "🤖", difficulty: "normal", seat: i }); }
    this.totalScores = this.players.map(() => 0); this.roundNumber = 1;
  }
  startRound() {
    this.hands = this.players.map(() => []); this.trick = []; this.trickNumber = 0; this.heartsBroken = false;
    this.roundPoints = this.players.map(() => 0); this.history = []; this.selected = new Set(); this.over = false; this.matchOver = false; this.roundWinner = -1;
    this.passing = ["left", "right", "across", "hold"][(this.roundNumber - 1) % 4]; this.phase = this.passing === "hold" ? "play" : "pass";
    const deck = buildDeck(); let n = 0; while (deck.length) this.hands[n++ % 4].push(deck.pop()); this.hands.forEach(sortHand);
    this.turn = this.hands.findIndex((h) => h.some((c) => c.suit === "♣" && c.rank === 2)); this.leadPlayer = this.turn;
    this.passChoices = {}; this.awaitingPassHandoff = false; this.passReceived = false; this.moveHistory = [];
    if (this.phase === "pass") this.turn = 0;
    this.log(`Round ${this.roundNumber} begins. ${this.passing === "hold" ? "No passing this round." : `Pass ${this.passing}.`}`);
  }
  legalCards(player) {
    const hand = this.hands[player] || []; if (this.phase !== "play") return [];
    if (!this.trick.length && this.trickNumber === 0) { const two = hand.find((c) => c.suit === "♣" && c.rank === 2); if (two) return [two]; }
    const lead = this.trick.length ? this.trick[0].card.suit : null;
    let legal = lead ? hand.filter((c) => c.suit === lead) : hand; if (lead && !legal.length) legal = hand;
    if (!this.trick.length && !this.heartsBroken && legal.some((c) => c.suit !== "♥")) legal = legal.filter((c) => c.suit !== "♥");
    if (this.trickNumber === 0 && this.trick.length) { const safe = legal.filter((c) => points(c) === 0); if (safe.length) legal = safe; }
    return legal;
  }
  winningPlayIndex(trick = this.trick) { if (!trick.length) return -1; const suit = trick[0].card.suit; let best = 0; for (let i = 1; i < trick.length; i++) if (trick[i].card.suit === suit && trick[i].card.rank > trick[best].card.rank) best = i; return best; }
  nextHumanToPass() { for (let i = 0; i < this.players.length; i++) if (this.players[i].type === "human" && !this.passChoices[i]) return i; return -1; }
  passCards(player, ids) {
    if (this.phase !== "pass" || this.passChoices[player] || !Array.isArray(ids)) return false;
    const hand = this.hands[player];
    if (!Array.isArray(hand) || ids.length !== 3 || new Set(ids).size !== 3 || ids.some((id) => !hand.some((c) => c.id === id))) return false;
    this.passChoices[player] = ids.slice();
    if (Object.keys(this.passChoices).length === 4) {
      const offset = { left: 1, right: 3, across: 2 }[this.passing];
      const outgoing = this.hands.map((h, i) => h.filter((c) => !this.passChoices[i].includes(c.id)));
      const passed = this.hands.map((h, i) => h.filter((c) => this.passChoices[i].includes(c.id)));
      this.hands = outgoing.map((h, i) => [...h, ...passed[(i - offset + 4) % 4]]); this.hands.forEach(sortHand);
      this.awaitingPassHandoff = false; this.phase = "play"; this.turn = this.hands.findIndex((h) => h.some((c) => c.suit === "♣" && c.rank === 2));
      this.log("Cards passed. The player with 2♣ leads.");
    }
    return true;
  }
  play(player, id) {
    if (this.phase !== "play" || this.over || player !== this.turn) return false;
    const card = this.legalCards(player).find((c) => c.id === id); if (!card) return false;
    this.hands[player] = this.hands[player].filter((c) => c.id !== id); this.trick.push({ player, card }); this.selected.clear(); this.log(`${this.players[player].name} played ${cardText(card)}.`);
    if (card.suit === "♥") this.heartsBroken = true;
    if (this.trick.length === 4) {
      const winner = this.trick[this.winningPlayIndex()].player; const pts = this.trick.reduce((n, p) => n + points(p.card), 0);
      this.roundPoints[winner] += pts; this.log(`${this.players[winner].name} took the trick${pts ? ` (${pts} points)` : ""}.`);
      this.trickNumber++; this.trick = []; this.turn = winner; if (this.hands.every((h) => h.length === 0)) this.finishRound();
    } else this.turn = (player + 1) % 4;
    return true;
  }
  finishRound() {
    const moon = this.roundPoints.findIndex((n) => n === 26);
    if (moon >= 0) { this.roundPoints = this.roundPoints.map((n, i) => i === moon ? 0 : 26); this.log(`${this.players[moon].name} shot the moon!`); }
    this.roundPoints.forEach((n, i) => this.totalScores[i] += n); this.over = true; const max = Math.max(...this.totalScores);
    if (max >= 100) { this.matchOver = true; const min = Math.min(...this.totalScores); this.roundWinner = this.totalScores.indexOf(min); this.log(`Game over. ${this.players[this.roundWinner].name} wins with ${min} points.`); }
    else this.log("Round complete.");
  }
  log(s) { this.history.unshift(s); }
}

const ONLINE_SERVER_URL = params.get("onlineServer") || params.get("server") || "";
const ONLINE_CODE = params.get("onlineCode") || params.get("onlineJoinedCode") || params.get("code") || "";
const ONLINE_HOST_TOKEN = params.get("onlineHostToken") || params.get("hostToken") || "";
const ONLINE_CLIENT_ID = params.get("onlineClientId") || params.get("clientId") || (() => { try { return sessionStorage.getItem("gameLibraryOnlineClientId") || ""; } catch { return ""; } })() || `client_${Math.random().toString(36).slice(2, 12)}`;
const ONLINE_MODE = Boolean(ONLINE_SERVER_URL && ONLINE_CODE);
const IS_ONLINE_HOST = Boolean(ONLINE_MODE && ONLINE_HOST_TOKEN);
const HOST_STATE_KEY = `openGameGalleryHeartsHostState:${ONLINE_CODE}`;
try { sessionStorage.setItem("gameLibraryOnlineClientId", ONLINE_CLIENT_ID); } catch {}
let game = new HeartsGame(launchConfig);
let aiTimer = null, onlineSocket = null, onlineConnected = false, onlineParticipants = [], onlineMatchId = "", pendingOnlineAction = false, messageText = "";
let privacyBlackout = false, blackoutUntil = 0, blackoutTimer = null;

function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
function validCard(card) { return Boolean(card && SUITS.includes(card.suit) && Number.isInteger(card.rank) && card.rank >= 1 && card.rank <= 13 && !String(card.id || "").startsWith("hidden-")); }
function seatIsLocalHuman(seat) {
  const player = game.players[seat]; if (!player || player.type !== "human") return false;
  return !ONLINE_MODE || player.controllerClientId === ONLINE_CLIENT_ID;
}
function localHumanSeats() { return game.players.map((_, seat) => seatIsLocalHuman(seat) ? seat : -1).filter((seat) => seat >= 0); }
function localHumanCount() { return localHumanSeats().length; }
function nextLocalPassSeat() {
  if (!ONLINE_MODE) return game.nextHumanToPass();
  return localHumanSeats().find((seat) => !game.passChoices?.[seat]) ?? -1;
}
function activePlayerIndex() { return game.phase === "pass" ? nextLocalPassSeat() : game.turn; }
function displayHandSeat() {
  if (game.phase === "pass") {
    const next = nextLocalPassSeat(); if (next >= 0) return next;
    return localHumanSeats()[0] ?? -1;
  }
  if (!ONLINE_MODE) return game.players[game.turn]?.type === "human" ? game.turn : -1;
  if (seatIsLocalHuman(game.turn)) return game.turn;
  return localHumanSeats()[0] ?? -1;
}
function seatHasPrivateHand(seat) { return seat >= 0 && Array.isArray(game.hands?.[seat]) && game.hands[seat].every(validCard); }
function activeHumanTurn() {
  if (game.over || pendingOnlineAction) return false;
  if (game.phase === "pass") { const seat = nextLocalPassSeat(); return seat >= 0 && seatIsLocalHuman(seat) && !game.passChoices?.[seat] && seatHasPrivateHand(seat); }
  return game.phase === "play" && seatIsLocalHuman(game.turn) && seatHasPrivateHand(game.turn);
}
function setOnlineStatus(message, error = false) {
  const el = $("modeText"); if (!el) return;
  el.classList.toggle("error", Boolean(error)); el.textContent = message;
}
function assignOnlineSeats() {
  if (!ONLINE_MODE || !IS_ONLINE_HOST || !Array.isArray(game.players)) return;
  const participants = onlineParticipants.filter((p) => p && p.clientId && p.spectator !== true);
  const participantIds = new Set(participants.map((p) => p.clientId));
  const idOf = (v) => String(v || "");
  const ownsProfile = (participant, profileId) => Boolean(profileId) && (idOf(participant.profileId) === idOf(profileId) || (participant.party || []).some((member) => idOf(member.id) === idOf(profileId)));
  for (const player of game.players) {
    if (player.type !== "human") { delete player.controllerClientId; continue; }
    if (!player.controllerClientId) continue;
    if (!participantIds.has(player.controllerClientId)) { player.controllerClientId = ""; continue; }
    const participant = participants.find((p) => p.clientId === player.controllerClientId);
    if (participant?.role === "host" && player.controllerClientId !== ONLINE_CLIENT_ID) player.controllerClientId = ONLINE_CLIENT_ID;
  }
  for (const player of game.players) {
    if (player.type !== "human" || player.controllerClientId) continue;
    const participant = participants.find((p) => ownsProfile(p, player.profileId) || ownsProfile(p, idOf(player.id).replace(/^local:/, "")));
    if (participant) player.controllerClientId = participant.clientId;
  }
  const host = participants.find((p) => p.clientId === ONLINE_CLIENT_ID) || participants.find((p) => p.role === "host");
  if (host) {
    for (const player of game.players) {
      if (player.type !== "human" || player.controllerClientId) continue;
      if (ownsProfile(host, player.profileId) || ownsProfile(host, idOf(player.id).replace(/^local:/, ""))) player.controllerClientId = host.clientId;
    }
    if (!game.players.some((p) => p.type === "human" && p.controllerClientId === host.clientId)) {
      const free = game.players.find((p) => p.type === "human" && !p.controllerClientId); if (free) free.controllerClientId = host.clientId;
    }
  }
  const used = new Set(game.players.filter((p) => p.type === "human" && p.controllerClientId).map((p) => p.controllerClientId));
  for (const player of game.players) {
    if (player.type !== "human" || player.controllerClientId) continue;
    const participant = participants.find((p) => !used.has(p.clientId)); if (!participant) continue;
    player.controllerClientId = participant.clientId; used.add(participant.clientId);
  }
  launchConfig.players = cloneJson(game.players);
}
function publicGameState() {
  const snapshot = cloneJson(game);
  snapshot.hands = snapshot.hands.map((hand, seat) => hand.map((_, index) => ({ id: `hidden-${seat}-${index}`, suit: "?", rank: 0 })));
  snapshot.selected = {};
  // Publish only whether a seat submitted its pass, never which cards it selected.
  snapshot.passChoices = Object.fromEntries(Object.keys(snapshot.passChoices || {}).map((seat) => [seat, true]));
  snapshot.awaitingPassHandoff = false;
  return { game: snapshot };
}
function publishPrivateHands() {
  if (!ONLINE_MODE || !IS_ONLINE_HOST || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
  const byClient = new Map();
  for (let seat = 0; seat < game.players.length; seat++) {
    const player = game.players[seat]; if (player.type !== "human" || !player.controllerClientId) continue;
    if (!onlineParticipants.some((p) => p.clientId === player.controllerClientId && p.spectator !== true && p.connected !== false)) continue;
    if (!byClient.has(player.controllerClientId)) byClient.set(player.controllerClientId, []);
    byClient.get(player.controllerClientId).push({ seat, cards: cloneJson(game.hands[seat]) });
  }
  for (const [targetClientId, hands] of byClient) {
    onlineSocket.send(JSON.stringify({ type: "game:private", targetClientId, payload: { heartsMessage: "privateHands", targetClientId, hands, matchId: onlineMatchId } }));
  }
}
function publishOnlineState() {
  if (!ONLINE_MODE || !IS_ONLINE_HOST || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
  try {
    sessionStorage.setItem(HOST_STATE_KEY, JSON.stringify({ matchId: onlineMatchId, game: cloneJson(game) }));
    onlineSocket.send(JSON.stringify({ type: "game:state", state: publicGameState() }));
    publishPrivateHands();
    setOnlineStatus(`Connected · ${onlineParticipants.length} participant${onlineParticipants.length === 1 ? "" : "s"} · game synchronized`);
  } catch (error) { setOnlineStatus(`Could not synchronize game: ${error.message || error}`, true); }
}
function applySnapshot(state) {
  const incoming = state?.game; if (!incoming || !Array.isArray(incoming.hands) || !Array.isArray(incoming.players)) return false;
  try {
    const oldSelected = game.selected instanceof Set ? new Set(game.selected) : new Set();
    const previousPhase = game.phase;
    const previousTurn = game.turn;
    const previousRound = game.roundNumber;
    const previousPassSeat = ONLINE_MODE && previousPhase === "pass" ? nextLocalPassSeat() : -1;
    const samePassRound = previousPhase === "pass" && incoming.phase === "pass" && previousRound === incoming.roundNumber;
    const restored = new HeartsGame(launchConfig); Object.assign(restored, incoming);
    restored.selected = samePassRound ? oldSelected : new Set();
    restored.passChoices = incoming.passChoices && typeof incoming.passChoices === "object" ? incoming.passChoices : {};
    restored.config = launchConfig;
    game = restored; pendingOnlineAction = false; messageText = "";
    if (game.phase !== "pass") game.selected.clear();
    if (ONLINE_MODE && previousPhase === "play" && game.phase === "play" && previousTurn !== game.turn) {
      maybeStartHandoff(previousTurn, game.turn);
    } else if (ONLINE_MODE && previousPhase === "pass" && game.phase === "pass" && previousPassSeat >= 0 && incoming.passChoices?.[previousPassSeat]) {
      maybeStartHandoff(previousPassSeat, nextLocalPassSeat());
    }
    render(); return true;
  } catch (error) { console.warn("Could not apply online Hearts state:", error); return false; }
}
function applyPrivateHands(payload) {
  if (!payload || !Array.isArray(payload.hands) || payload.matchId !== onlineMatchId) return;
  let changed = false;
  for (const entry of payload.hands) {
    if (Number.isInteger(entry.seat) && entry.seat >= 0 && entry.seat < game.hands.length && Array.isArray(entry.cards) && seatIsLocalHuman(entry.seat)) {
      game.hands[entry.seat] = cloneJson(entry.cards); changed = true;
    }
  }
  if (changed) render();
}
function restoreCachedHostState() {
  if (!IS_ONLINE_HOST || !onlineMatchId) return false;
  try {
    const cached = JSON.parse(sessionStorage.getItem(HOST_STATE_KEY) || "null");
    if (!cached || cached.matchId !== onlineMatchId || !cached.game || !Array.isArray(cached.game.hands)) return false;
    const restored = new HeartsGame(launchConfig); Object.assign(restored, cached.game); restored.selected = new Set();
    restored.passChoices = cached.game.passChoices || {}; game = restored; return true;
  } catch { return false; }
}
function sendOnlineAction(action) {
  if (!ONLINE_MODE || IS_ONLINE_HOST) return false;
  if (!onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) { messageText = "Online connection is unavailable. Your action was not sent."; render(); return false; }
  if (pendingOnlineAction) return false;
  pendingOnlineAction = true; messageText = "Action sent · waiting for the host…";
  onlineSocket.send(JSON.stringify({ type: "game:move", payload: { ...action, matchId: onlineMatchId } })); render(); return true;
}
function onlineWsUrl() {
  const base = ONLINE_SERVER_URL.replace(/^http/i, "ws").replace(/\/$/, "");
  const query = new URLSearchParams({ role: "player", clientId: ONLINE_CLIENT_ID }); if (ONLINE_HOST_TOKEN) query.set("token", ONLINE_HOST_TOKEN);
  return `${base}/ws/${encodeURIComponent(ONLINE_CODE)}?${query.toString()}`;
}
function connectOnlineGame() {
  if (!ONLINE_MODE) return;
  setOnlineStatus("Connecting to online room…");
  try { onlineSocket = new WebSocket(onlineWsUrl()); } catch (error) { setOnlineStatus(`Could not connect: ${error.message || error}`, true); return; }
  onlineSocket.addEventListener("open", () => {
    onlineConnected = true; setOnlineStatus("Connected · registering player…");
    const ownSeat = game.players.find((p) => p.controllerClientId === ONLINE_CLIENT_ID);
    const profile = profiles.find((p) => p.id === (ownSeat?.profileId || "")) || profiles[0] || {};
    let party = []; try { party = JSON.parse(sessionStorage.getItem("gameLibraryParty") || "[]").map((id) => profiles.find((p) => p.id === id)).filter(Boolean); } catch {}
    onlineSocket.send(JSON.stringify({ type: "player:identify", profileId: profile.id || "", name: profile.name || "Player", avatar: profile.avatar || "🃏", party: party.map((p) => ({ id: p.id, name: p.name || "Player", avatar: p.avatar || "🃏" })) }));
  });
  onlineSocket.addEventListener("message", (event) => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "player:identified") { setOnlineStatus(`Connected · registered as ${message.player?.name || "Player"}`); return; }
    if (message.type === "room:hello") {
      onlineParticipants = message.room?.participants || []; onlineMatchId = message.room?.matchId || onlineMatchId;
      const roomConfig = message.room?.config;
      if (roomConfig && Object.keys(roomConfig).length) { launchConfig = { ...launchConfig, ...roomConfig }; if (Array.isArray(roomConfig.players) && roomConfig.players.length) launchConfig.players = roomConfig.players; }
      game = new HeartsGame(launchConfig);
      if (IS_ONLINE_HOST) restoreCachedHostState();
      if (IS_ONLINE_HOST) assignOnlineSeats();
      if (!IS_ONLINE_HOST && message.state?.game) applySnapshot(message.state);
      render();
      if (IS_ONLINE_HOST) {
        setTimeout(() => { assignOnlineSeats(); runAI(); publishOnlineState(); render(); }, 120);
      } else if (message.room?.started && !message.state?.game) setOnlineStatus("Connected · waiting for host to synchronize the deal…");
      return;
    }
    if (message.type === "room:participants") {
      onlineParticipants = Array.isArray(message.participants) ? message.participants : [];
      if (IS_ONLINE_HOST) { assignOnlineSeats(); runAI(); publishOnlineState(); }
      setOnlineStatus(`Connected · ${onlineParticipants.length} participant${onlineParticipants.length === 1 ? "" : "s"}`); render(); return;
    }
    if (message.type === "room:config") {
      if (!IS_ONLINE_HOST || !game.over) return;
      launchConfig = message.config || launchConfig; game = new HeartsGame(launchConfig); assignOnlineSeats(); runAI(); publishOnlineState(); render(); return;
    }
    if (message.type === "game:start") {
      onlineMatchId = message.matchId || onlineMatchId; launchConfig = message.config || launchConfig;
      if (IS_ONLINE_HOST) { game = new HeartsGame(launchConfig); assignOnlineSeats(); runAI(); publishOnlineState(); render(); }
      else if (message.state?.game) applySnapshot(message.state);
      else { pendingOnlineAction = false; setOnlineStatus("Connected · waiting for host to synchronize the deal…"); }
      return;
    }
    if (message.type === "game:state") { if (!IS_ONLINE_HOST) applySnapshot(message.state); return; }
    if (message.type === "game:private") {
      const payload = message.payload;
      if (!IS_ONLINE_HOST && payload?.heartsMessage === "privateHands" && payload.targetClientId === ONLINE_CLIENT_ID && payload.matchId === onlineMatchId) applyPrivateHands(payload);
      return;
    }
    if (message.type === "game:move") {
      if (!IS_ONLINE_HOST || message.sender?.clientId === ONLINE_CLIENT_ID) return;
      const action = message.payload;
      if (!action || (action.matchId && onlineMatchId && action.matchId !== onlineMatchId)) { publishOnlineState(); return; }
      const seat = Number(action.seat), player = game.players[seat];
      if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !player || player.type !== "human" || player.controllerClientId !== message.sender?.clientId) { publishOnlineState(); return; }
      let accepted = false;
      if (action.kind === "pass" && game.phase === "pass" && Array.isArray(action.cardIds) && !game.passChoices?.[seat]) {
        accepted = game.passCards(seat, action.cardIds);
      } else if (action.kind === "play" && game.phase === "play" && seat === game.turn && typeof action.cardId === "string") {
        accepted = game.play(seat, action.cardId);
      }
      if (accepted) { messageText = ""; pendingOnlineAction = false; runAI(); publishOnlineState(); render(); }
      else { publishOnlineState(); }
      return;
    }
    if (message.type === "game:back") { location.href = "../index.html"; return; }
    if (message.type === "error") setOnlineStatus(`Server error: ${message.message || message.code || "Unknown error"}`, true);
  });
  onlineSocket.addEventListener("close", () => { onlineConnected = false; setOnlineStatus("Disconnected from online room", true); render(); });
  onlineSocket.addEventListener("error", () => { onlineConnected = false; setOnlineStatus("Online connection error", true); render(); });
}

function beginPrivacyBlackout() {
  if (localHumanCount() < 2) return;
  privacyBlackout = true; blackoutUntil = Date.now() + 2000; if (blackoutTimer) clearTimeout(blackoutTimer);
  blackoutTimer = setTimeout(() => { blackoutTimer = null; render(); runAI(); }, 2000); $("turnBlackout").classList.remove("hidden");
}
function refreshPrivacyBlackout() {
  if (privacyBlackout && Date.now() >= blackoutUntil) {
    const ready = game.phase === "pass" ? nextLocalPassSeat() >= 0 : game.phase === "play" ? (ONLINE_MODE ? localHumanSeats().length > 0 : game.players[game.turn]?.type === "human") : false;
    if (ready || game.over) { privacyBlackout = false; game.awaitingPassHandoff = false; }
  }
  $("turnBlackout").classList.toggle("hidden", !privacyBlackout);
}
function renderPlayers() {
  const active = activePlayerIndex();
  $("playerList").innerHTML = game.players.map((p, i) => {
    const label = p.type === "computer" ? "Computer" : !ONLINE_MODE ? "Local player" : p.controllerClientId === ONLINE_CLIENT_ID ? "You" : onlineParticipants.some((x) => x.clientId === p.controllerClientId && x.connected) ? "Online player · connected" : "Online player";
    return `<div class="player-row ${active === i && !game.over ? "current" : ""}"><div class="avatar">${escapeHtml(p.avatar)}</div><div><div class="player-name">${escapeHtml(p.name)}</div><div class="player-sub">${label}</div></div><div class="score">${game.totalScores[i]} pts</div></div>`;
  }).join("");
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function render() {
  refreshPrivacyBlackout(); renderPlayers();
  const actionSeat = activePlayerIndex(), shownSeat = displayHandSeat(), active = actionSeat >= 0 ? game.players[actionSeat] : null, shown = shownSeat >= 0 ? game.players[shownSeat] : null;
  const handoff = !ONLINE_MODE && game.phase === "pass" && game.awaitingPassHandoff;
  $("roundInfo").textContent = `Round ${game.roundNumber} · ${game.passing === "hold" ? "Keep your cards" : `Pass ${game.passing}`}`;
  $("tableLabel").textContent = game.phase === "pass" ? "Card passing" : "Current trick";
  if (game.phase === "pass") {
    if (ONLINE_MODE) {
      const mySeat = nextLocalPassSeat();
      $("trickCaption").textContent = mySeat >= 0 ? `${game.players[mySeat].name}: choose three cards to pass.` : `You've passed. Waiting for the other players.`;
      $("trickMeta").textContent = "All players choose privately; the cards move when every player has confirmed.";
    } else {
      $("trickCaption").textContent = handoff && active ? `Pass the device to ${active.name}, then reveal their hand.` : active ? `${active.name}: select three cards to pass, then confirm.` : "Finishing computer passes…";
      $("trickMeta").textContent = "Cards are passed simultaneously and move after all four players confirm.";
    }
  } else if (game.over) {
    $("trickCaption").textContent = game.matchOver ? `${game.players[game.roundWinner].name} wins the game!` : "Round complete.";
    $("trickMeta").textContent = game.matchOver ? "Start a new game to play again." : "Choose Next Round to continue.";
  } else {
    $("trickCaption").textContent = game.trick.length ? `${game.players[game.turn].name} to play · ${game.trick.length}/4 cards in trick` : `${game.players[game.turn].name} to lead`;
    $("trickMeta").textContent = game.heartsBroken ? "Hearts have been broken." : "Hearts have not been broken.";
  }
  $("tableCards").innerHTML = game.trick.map((p) => `<div class="played-card"><div>${escapeHtml(game.players[p.player].name)}</div>${cardHtml(p.card, false)}</div>`).join("");
  const canAct = !privacyBlackout && activeHumanTurn() && !handoff;
  const hand = shownSeat >= 0 && seatHasPrivateHand(shownSeat) && (!handoff) ? game.hands[shownSeat] || [] : [];
  $("handTitle").textContent = handoff ? "Hand hidden for privacy" : shown ? (game.phase === "pass" ? `${shown.name}'s hand — choose 3 to pass` : `${shown.name}'s hand`) : game.over ? "Round complete" : "Your hand";
  if (handoff) $("hand").innerHTML = '<div class="note">The next player’s cards are hidden. Pass the device to the next player.</div>';
  else if (hand.length) $("hand").innerHTML = hand.map((c) => cardHtml(c, game.selected instanceof Set && game.selected.has(c.id))).join("");
  else if (ONLINE_MODE && shownSeat >= 0) $("hand").innerHTML = '<div class="note">Synchronizing your private hand…</div>';
  else if (game.phase === "play" && !game.over && game.players[game.turn]?.type === "computer") $("hand").innerHTML = '<div class="note">Computer hand hidden while it thinks.</div>';
  else if (game.over) $("hand").innerHTML = '<div class="note">Round complete.</div>';
  else $("hand").innerHTML = '<div class="note">Waiting for the next player…</div>';
  if (game.phase === "pass") {
    if (ONLINE_MODE) $("handHint").textContent = nextLocalPassSeat() >= 0 ? `${game.selected.size}/3 cards selected` : "Waiting for other players to pass…";
    else $("handHint").textContent = handoff ? `Ready for ${active?.name || "the next player"}.` : `${game.selected.size}/3 cards selected`;
  } else $("handHint").textContent = canAct ? "Select a legal card to play." : ONLINE_MODE && pendingOnlineAction ? "Waiting for the host to confirm your move…" : "";
  $("confirmBtn").classList.toggle("hidden", game.phase !== "pass");
  $("confirmBtn").disabled = !canAct || game.phase !== "pass" || game.selected.size !== 3;
  $("confirmBtn").textContent = ONLINE_MODE ? "Confirm Pass" : handoff ? `Show ${active?.name || "Next Player"}'s Hand` : "Confirm Pass";
  $("nextRoundBtn").disabled = !game.over || game.matchOver || (ONLINE_MODE && !IS_ONLINE_HOST);
  $("newGameBtn").disabled = ONLINE_MODE && !IS_ONLINE_HOST;
  $("shootMoonBtn").classList.add("hidden");
  if (game.over) $("status").textContent = game.matchOver ? "Game finished." : "Round finished.";
  else if (game.phase === "pass") {
    if (ONLINE_MODE) $("status").textContent = nextLocalPassSeat() >= 0 ? `${game.players[nextLocalPassSeat()].name}, choose three cards to pass.` : "You have passed. Waiting for the other players…";
    else $("status").textContent = handoff ? `Pass the device to ${active?.name || "the next player"}.` : active ? `${active.name}, choose three cards to pass.` : "Waiting for computer passes.";
  } else if (ONLINE_MODE && !seatIsLocalHuman(game.turn)) $("status").textContent = `${game.players[game.turn].name}'s turn. Your hand is hidden from other players.`;
  else if (pendingOnlineAction) $("status").textContent = "Move sent · waiting for the host…";
  else $("status").textContent = `${game.players[game.turn].name}'s turn.`;
  $("scoreboard").innerHTML = `<table class="score-table"><thead><tr><th>Player</th><th>Round</th><th>Total</th></tr></thead><tbody>${game.players.map((p, i) => `<tr><td>${escapeHtml(p.name)}</td><td>${game.roundPoints[i]}</td><td>${game.totalScores[i]}</td></tr>`).join("")}</tbody></table>`;
  $("history").innerHTML = game.history.map((s) => `<div>${escapeHtml(s)}</div>`).join("");
}
function maybeStartHandoff(fromSeat, toSeat) {
  if (fromSeat >= 0 && toSeat >= 0 && fromSeat !== toSeat && seatIsLocalHuman(fromSeat) && seatIsLocalHuman(toSeat)) beginPrivacyBlackout();
}
function runAI() {
  clearTimeout(aiTimer); if (game.over || (ONLINE_MODE && !IS_ONLINE_HOST)) return;
  if (game.phase === "pass") {
    let changed = false;
    for (let i = 0; i < 4; i++) if (game.players[i].type === "computer" && !game.passChoices[i]) changed = game.passCards(i, window.HeartsAI.choosePass(game.hands[i])) || changed;
    if (changed && ONLINE_MODE && IS_ONLINE_HOST && game.phase === "pass") publishOnlineState();
    if (game.phase === "play") { if (ONLINE_MODE && IS_ONLINE_HOST) publishOnlineState(); render(); runAI(); }
    return;
  }
  if (game.players[game.turn]?.type !== "computer") return;
  aiTimer = setTimeout(() => {
    if (game.over || game.players[game.turn]?.type !== "computer") return;
    const previousSeat = game.turn, id = window.HeartsAI.choosePlay(game, game.turn); if (id) game.play(previousSeat, id);
    render(); if (ONLINE_MODE && IS_ONLINE_HOST) publishOnlineState(); runAI();
  }, 450);
}
function handleCardClick(el) {
  if (!el || game.over || privacyBlackout || pendingOnlineAction) return;
  const id = el.dataset.card;
  if (game.phase === "pass") {
    const seat = nextLocalPassSeat(); if (seat < 0 || !activeHumanTurn() || !seatHasPrivateHand(seat)) return;
    if (!game.hands[seat]?.some((c) => c.id === id)) return;
    if (game.selected.has(id)) game.selected.delete(id); else if (game.selected.size < 3) game.selected.add(id);
    render(); return;
  }
  const seat = game.turn; if (!activeHumanTurn() || !seatHasPrivateHand(seat)) return;
  const legal = game.legalCards(seat);
  if (!legal.some((c) => c.id === id)) { $("status").textContent = "That card is not legal. Follow suit if possible."; return; }
  if (ONLINE_MODE && !IS_ONLINE_HOST) { sendOnlineAction({ kind: "play", seat, cardId: id }); return; }
  const previousSeat = seat;
  if (game.play(seat, id)) {
    maybeStartHandoff(previousSeat, game.turn);
    render(); if (ONLINE_MODE && IS_ONLINE_HOST) publishOnlineState(); runAI();
  }
}
$("hand").addEventListener("click", (e) => handleCardClick(e.target.closest(".card")));
$("hand").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { const el = e.target.closest(".card"); if (el) { e.preventDefault(); handleCardClick(el); } } });
$("confirmBtn").addEventListener("click", () => {
  if (game.phase !== "pass" || privacyBlackout || pendingOnlineAction || game.selected.size !== 3) return;
  const seat = nextLocalPassSeat(); if (seat < 0 || !activeHumanTurn()) return;
  const ids = [...game.selected];
  if (ONLINE_MODE && !IS_ONLINE_HOST) {
    if (sendOnlineAction({ kind: "pass", seat, cardIds: ids })) { game.selected.clear(); render(); }
    return;
  }
  const accepted = game.passCards(seat, ids); if (!accepted) return;
  game.selected.clear();
  if (ONLINE_MODE) {
    maybeStartHandoff(seat, nextLocalPassSeat());
  } else if (game.phase === "pass" && game.nextHumanToPass() >= 0) {
    game.awaitingPassHandoff = true; beginPrivacyBlackout();
  }
  runAI();
  if (ONLINE_MODE && IS_ONLINE_HOST) publishOnlineState();
  render();
});
$("nextRoundBtn").addEventListener("click", () => {
  if (!game.over || game.matchOver || privacyBlackout || (ONLINE_MODE && !IS_ONLINE_HOST)) return;
  if (blackoutTimer) clearTimeout(blackoutTimer); privacyBlackout = false; game.roundNumber++; game.startRound();
  if (!ONLINE_MODE && localHumanCount() > 1) beginPrivacyBlackout();
  runAI(); if (ONLINE_MODE && IS_ONLINE_HOST) publishOnlineState(); render();
});
$("newGameBtn").addEventListener("click", () => {
  if (privacyBlackout || (ONLINE_MODE && !IS_ONLINE_HOST)) return;
  clearTimeout(aiTimer); if (blackoutTimer) clearTimeout(blackoutTimer); privacyBlackout = false; pendingOnlineAction = false; game = new HeartsGame(launchConfig);
  if (ONLINE_MODE && IS_ONLINE_HOST) assignOnlineSeats();
  if (!ONLINE_MODE && localHumanCount() > 1) beginPrivacyBlackout();
  runAI(); if (ONLINE_MODE && IS_ONLINE_HOST) publishOnlineState(); render();
});
$("backBtn").addEventListener("click", () => {
  if (ONLINE_MODE && IS_ONLINE_HOST && onlineSocket && onlineSocket.readyState === WebSocket.OPEN) onlineSocket.send(JSON.stringify({ type: "game:back" }));
  location.href = "../index.html";
});

if (ONLINE_MODE) {
  $("modeText").classList.remove("hidden");
  connectOnlineGame();
} else {
  setOnlineStatus("Local game · online mode not enabled");
  if (localHumanCount() > 1) beginPrivacyBlackout();
  render(); runAI();
}

// A tiny diagnostic hook is useful during development without altering game rules.
window.__heartsOnlineDebug = () => ({ online: ONLINE_MODE, host: IS_ONLINE_HOST, connected: onlineConnected, matchId: onlineMatchId, phase: game.phase, turn: game.turn, over: game.over, matchOver: game.matchOver, passChoices: cloneJson(game.passChoices), players: game.players.map((p) => ({ name: p.name, type: p.type, controllerClientId: p.controllerClientId })), privateHandCounts: game.hands.map((h) => h.length) });
})();
