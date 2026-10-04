"use strict";
const params = new URLSearchParams(location.search),
  ONLINE_MODE = params.get("online") === "1",
  ONLINE_SERVER = params.get("onlineServer") || "",
  ONLINE_CODE = params.get("onlineCode") || "",
  ONLINE_CLIENT_ID =
    params.get("onlineClientId") ||
    sessionStorage.getItem("gameLibraryOnlineClientId") ||
    "client_" + Math.random().toString(36).slice(2, 12),
  ONLINE_HOST_TOKEN =
    params.get("hostToken") ||
    sessionStorage.getItem("gameLibraryOnlineHostToken") ||
    "";
let onlineConfig = null;
try {
  const raw =
    params.get("onlineConfig") ||
    sessionStorage.getItem("gameLibraryOnlineConfig") ||
    "";
  if (raw) onlineConfig = JSON.parse(raw);
} catch {}
let selectedVariantId = params.get("variant") || "eins",
  onlineSocket = null,
  onlineConnected = false,
  onlineParticipants = [],
  onlineMatchId = "",
  onlineResultSent = false,
  localScoreRecorded = false;
const profiles = (() => {
    try {
      return JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
    } catch {
      return [];
    }
  })(),
  $ = (id) => document.getElementById(id),
  copy = (o) => JSON.parse(JSON.stringify(o));
const COLORS = ["red", "yellow", "green", "blue"],
  DARK = ["pink", "teal", "orange", "purple"];
function card(id, light, dark) {
  return { id, light, dark };
}
function face(color, label, type = "number", value = Number(label) || 0) {
  return { color, label, type, value };
}
function buildDeck(variant) {
  const d = [];
  let n = 0;
  if (variant === "flip") {
    for (const color of COLORS) {
      const darkColor = DARK[COLORS.indexOf(color)];
      for (let v = 1; v <= 9; v++)
        for (let k = 0; k < 2; k++)
          d.push(
            card(
              "f" + n++,
              face(color, String(v), "number", v),
              face(darkColor, String(v), "number", v),
            ),
          );
      d.push(
        card("f" + n++, face(color, "0"), face(darkColor, "1", "number", 1)),
      );
      for (let k = 0; k < 2; k++) {
        d.push(
          card(
            "f" + n++,
            face(color, "Draw One", "drawOne", 1),
            face(darkColor, "Draw Five", "drawFive", 5),
          ),
        );
        d.push(
          card(
            "f" + n++,
            face(color, "Reverse", "reverse"),
            face(darkColor, "Reverse", "reverse"),
          ),
        );
        d.push(
          card(
            "f" + n++,
            face(color, "Skip", "skip"),
            face(darkColor, "Skip Everyone", "skipEveryone"),
          ),
        );
      }
      d.push(
        card(
          "f" + n++,
          face(color, "Flip", "flip"),
          face(darkColor, "Flip", "flip"),
        ),
      );
    }
    for (let k = 0; k < 4; k++) {
      d.push(
        card(
          "f" + n++,
          face(null, "Wild", "wild"),
          face(null, "Wild Draw Color", "drawColor", 4),
        ),
      );
      d.push(
        card(
          "f" + n++,
          face(null, "Wild Draw Four", "drawFour", 4),
          face(null, "Wild", "wild"),
        ),
      );
    }
    return shuffle(d);
  }
  for (const color of COLORS) {
    d.push(card("c" + n++, face(color, "0")));
    for (let v = 1; v <= 9; v++)
      for (let k = 0; k < 2; k++)
        d.push(card("c" + n++, face(color, String(v), "number", v)));
    for (let k = 0; k < 2; k++) {
      d.push(card("c" + n++, face(color, "Skip", "skip")));
      d.push(card("c" + n++, face(color, "Reverse", "reverse")));
      d.push(card("c" + n++, face(color, "Draw Two", "drawTwo", 2)));
    }
  }
  for (let k = 0; k < 4; k++) {
    d.push(card("c" + n++, face(null, "Wild", "wild")));
    d.push(card("c" + n++, face(null, "Wild Draw Four", "drawFour", 4)));
  }
  return shuffle(d);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function faceOf(c, side) {
  return c?.[side] || c?.light;
}
function displayFace(c, side) {
  const f = faceOf(c, side);
  return f ? f.label : "?";
}
function cardHtml(c, side, selected = false, mini = false, back = false) {
  if (back) return '<div class="card back">EINS</div>';
  const f = faceOf(c, side),
    color = f?.color || "black";
  return `<div class="card ${color} ${selected ? "selected" : ""} ${mini ? "mini" : ""}" data-card="${c.id}"><span class="corner">${esc(f.label)}</span><span class="face">${esc(f.label)}</span><span class="bottom">${esc(f.label)}</span></div>`;
}
class EinsGame {
  constructor(config = {}) {
    this.variant = config.variant || selectedVariantId;
    this.options = {
      stacking: config.options?.stacking ?? false,
      drawUntilPlayable: config.options?.drawUntilPlayable ?? false,
    };
    this.players = [];
    this.hands = [];
    this.drawPile = [];
    this.discard = [];
    this.turn = 0;
    this.direction = 1;
    this.side = "light";
    this.pendingDraw = 0;
    this.pendingType = "";
    this.activeColor = null;
    this.phase = "play";
    this.drawnCardId = null;
    this.over = false;
    this.winner = -1;
    this.moveHistory = [];
    this.history = [];
    this.reset(config.players || []);
  }
  reset(ps = []) {
    this.players = (
      ps.length
        ? ps
        : [
            {
              name: profiles[0]?.name || "Player 1",
              avatar: profiles[0]?.avatar || "♟",
              type: "human",
              profileId: profiles[0]?.id || "",
            },
            {
              name: "Computer",
              avatar: "🤖",
              type: "computer",
              difficulty: "normal",
            },
          ]
    ).map((p, i) => ({ ...p, seat: i }));
    this.drawPile = buildDeck(this.variant);
    this.hands = this.players.map(() => []);
    this.discard = [];
    this.turn = 0;
    this.direction = 1;
    this.side = "light";
    this.pendingDraw = 0;
    this.pendingType = "";
    this.activeColor = null;
    this.phase = "play";
    this.drawnCardId = null;
    this.over = false;
    this.winner = -1;
    this.moveHistory = [];
    this.history = [];
    const count = this.players.length <= 3 ? 7 : 7;
    for (let n = 0; n < count; n++)
      for (let i = 0; i < this.players.length; i++)
        this.hands[i].push(this.drawPile.pop());
    let first = this.drawPile.pop();
    while (faceOf(first, this.side).type !== "number" && this.drawPile.length)
      (this.drawPile.unshift(first), (first = this.drawPile.pop()));
    this.discard = [first];
    this.activeColor = faceOf(first, this.side).color;
  }
  snapshot() {
    return {
      variant: this.variant,
      options: this.options,
      players: this.players,
      hands: this.hands,
      drawPile: this.drawPile,
      discard: this.discard,
      turn: this.turn,
      direction: this.direction,
      side: this.side,
      pendingDraw: this.pendingDraw,
      pendingType: this.pendingType,
      activeColor: this.activeColor,
      phase: this.phase,
      drawnCardId: this.drawnCardId,
      over: this.over,
      winner: this.winner,
      moveHistory: this.moveHistory,
    };
  }
  restore(s) {
    Object.assign(this, copy(s));
    this.history = [];
  }
  save() {
    this.history.push(this.snapshot());
  }
  undo() {
    if (!this.history.length) return false;
    const h = this.history.pop(),
      rest = this.history;
    this.restore(h);
    this.history = rest;
    return true;
  }
  current() {
    return this.players[this.turn];
  }
  top() {
    return this.discard.at(-1);
  }
  canPlay(c, player = this.turn) {
    if (this.over || player !== this.turn || !c) return false;
    const f = faceOf(c, this.side),
      top = faceOf(this.top(), this.side);
    if (this.pendingDraw > 0) {
      return (
        this.options.stacking &&
        ["drawTwo", "drawFour", "drawOne", "drawFive", "drawColor"].includes(
          f.type,
        )
      );
    }
    return (
      f.type === "wild" ||
      f.type === "drawFour" ||
      f.type === "drawColor" ||
      f.color === this.activeColor ||
      f.label === top.label
    );
  }
  advance(n = 1) {
    this.turn = (this.turn + this.direction * n) % this.players.length;
    if (this.turn < 0) this.turn += this.players.length;
  }
  refill() {
    if (this.drawPile.length) return;
    const top = this.discard.pop();
    this.drawPile = shuffle(this.discard.splice(0));
    this.discard = [top];
  }
  drawCards(player, count) {
    for (let i = 0; i < count; i++) {
      this.refill();
      if (!this.drawPile.length) break;
      this.hands[player].push(this.drawPile.pop());
    }
  }
  draw() {
    if (this.over || this.phase !== "play") return false;
    this.save();
    const player = this.turn;
    if (this.pendingDraw > 0) {
      const n = this.pendingDraw;
      this.drawCards(player, n);
      this.moveHistory.unshift(
        `${this.current().name} drew ${n} penalty cards.`,
      );
      this.pendingDraw = 0;
      this.pendingType = "";
      this.advance();
      this.drawnCardId = null;
      return true;
    }
    if (this.options.drawUntilPlayable) {
      let safety = 0,
        last = null;
      while (
        !this.hands[player].some((c) => this.canPlay(c, player)) &&
        this.drawPile.length &&
        safety++ < 250
      ) {
        this.drawCards(player, 1);
        last = this.hands[player].at(-1);
      }
      const playable = this.hands[player].filter((c) =>
        this.canPlay(c, player),
      );
      if (playable.length) {
        this.drawnCardId = last?.id || playable.at(-1).id;
        this.moveHistory.unshift(
          `${this.current().name} drew until a playable card was found.`,
        );
        return true;
      }
      this.moveHistory.unshift(`${this.current().name} drew but cannot play.`);
      this.advance();
      this.drawnCardId = null;
      return true;
    }
    this.drawCards(player, 1);
    const last = this.hands[player].at(-1);
    this.drawnCardId = last?.id || null;
    if (!last) {
      this.advance();
      return true;
    }
    if (!this.canPlay(last, player)) {
      this.moveHistory.unshift(
        `${this.current().name} drew a card and passed.`,
      );
      this.advance();
      this.drawnCardId = null;
    } else
      this.moveHistory.unshift(
        `${this.current().name} drew a card and may play it or pass.`,
      );
    return true;
  }
  pass() {
    if (this.over || this.drawnCardId === null) return false;
    this.save();
    this.moveHistory.unshift(`${this.current().name} passed after drawing.`);
    this.drawnCardId = null;
    this.advance();
    return true;
  }
  play(id, color = null) {
    if (this.over) return false;
    const player = this.turn,
      hand = this.hands[player],
      c = hand.find((x) => x.id === id);
    if (!c || !this.canPlay(c, player)) return false;
    if (this.drawnCardId && id !== this.drawnCardId) return false;
    const f = faceOf(c, this.side);
    if (["wild", "drawFour", "drawColor"].includes(f.type) && !color)
      return false;
    this.save();
    this.hands[player] = hand.filter((x) => x.id !== id);
    this.discard.push(c);
    this.drawnCardId = null;
    this.activeColor = color || f.color || this.activeColor;
    this.moveHistory.unshift(
      `${this.current().name} played ${f.label}${color ? ` (${color})` : ""}.`,
    );
    const finish = () => {
      if (!this.hands[player].length) {
        this.over = true;
        this.winner = player;
        this.moveHistory.unshift(`${this.players[player].name} wins!`);
        return true;
      }
      return false;
    };
    if (f.type === "flip") {
      this.side = this.side === "light" ? "dark" : "light";
      this.activeColor = faceOf(c, this.side).color;
      this.moveHistory.unshift(`Everyone flipped to the ${this.side} side.`);
    }
    if (
      ["drawTwo", "drawFour", "drawOne", "drawFive", "drawColor"].includes(
        f.type,
      )
    ) {
      this.pendingDraw += f.type === "drawColor" ? 4 : f.value || 0;
      this.pendingType = f.type;
      this.advance();
      finish();
      return true;
    }
    if (f.type === "skip" || f.type === "skipEveryone") {
      this.advance(f.type === "skipEveryone" ? this.players.length : 2);
      finish();
      return true;
    }
    if (f.type === "reverse") {
      this.direction *= -1;
      if (this.players.length === 2) this.advance(2);
      else this.advance();
      finish();
      return true;
    }
    this.advance();
    finish();
    return true;
  }
  action(a) {
    if (a.type === "draw") return this.draw();
    if (a.type === "pass") return this.pass();
    if (a.type === "play") return this.play(a.id, a.color || null);
    return false;
  }
  aiTurn() {
    if (this.over) return false;
    const player = this.turn,
      hand = this.hands[player];
    let c = window.EinsAI.chooseCard(this, player);
    if (!c) {
      if (!this.draw()) return false;
      if (this.turn !== player || this.over) return true;
      c =
        hand.find((x) => x.id === this.drawnCardId) ||
        window.EinsAI.chooseCard(this, player);
      if (!c) {
        this.pass();
        return true;
      }
    }
    const f = faceOf(c, this.side);
    let color = null;
    if (["wild", "drawFour", "drawColor"].includes(f.type))
      color = window.EinsAI.chooseColor(
        hand.filter((x) => x.id !== c.id),
        this.side,
      );
    return this.play(c.id, color);
  }
}
let game = new EinsGame(onlineConfig || {}),
  selected = null,
  aiTimer = null,
  aiPending = false,
  pendingWild = null;
function localPartyProfiles() {
  try {
    const ids = JSON.parse(sessionStorage.getItem("gameLibraryParty") || "[]"),
      a = ids.map((id) => profiles.find((p) => p.id === id)).filter(Boolean);
    if (a.length) return a;
  } catch {}
  return profiles;
}
function isControlled(p) {
  if (!p || p.type !== "human") return false;
  if (!ONLINE_MODE) return true;
  const controller = String(
    p.controllerClientId || p.participantClientId || "",
  );
  if (controller && controller === String(ONLINE_CLIENT_ID)) return true;
  const me = onlineParticipants.find(
    (x) => String(x.clientId || "") === String(ONLINE_CLIENT_ID),
  );
  const ids = new Set();
  if (me?.profileId) ids.add(String(me.profileId));
  if (Array.isArray(me?.party))
    for (const member of me.party) if (member?.id) ids.add(String(member.id));
  return Boolean(p.profileId && ids.has(String(p.profileId)));
}
function controlledTurn() {
  return isControlled(game.current());
}
function action(a, remote = false) {
  const ok = game.action(a);
  if (!ok) return false;
  selected = null;
  pendingWild = null;
  if (ONLINE_MODE && !remote && onlineSocket?.readyState === WebSocket.OPEN)
    onlineSocket.send(JSON.stringify({ type: "game:move", payload: a }));
  recordWin();
  return true;
}
function recordWin() {
  if (ONLINE_MODE || localScoreRecorded || !game.over) return;
  const p = game.players[game.winner];
  if (!p?.profileId) return;
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem("gameLibraryLocalScores") || "{}");
  } catch {}
  s[p.profileId] = (Number(s[p.profileId]) || 0) + 1;
  localStorage.setItem("gameLibraryLocalScores", JSON.stringify(s));
  localScoreRecorded = true;
}
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function render() {
  if (game.over) {
    recordWin();
    publishOnlineResult();
  }
  if (!pendingWild) {
    $("colorChoices").hidden = true;
    $("colorChoices").innerHTML = "";
  }
  const flip = game.variant === "flip";
  $("variantName").textContent = flip ? "Eins Flip" : "Eins";
  $("status").textContent = game.over
    ? `${game.players[game.winner]?.name} wins!`
    : game.pendingDraw
      ? `${game.current().name} must draw ${game.pendingDraw} card(s)${game.options.stacking ? " or stack another matching draw card" : ""}.`
      : game.current().name +
        "'s turn" +
        (game.drawnCardId ? " — play the drawn card or pass." : ".");
  $("playerList").innerHTML = game.players
    .map(
      (p, i) =>
        `<div class="player-row ${i === game.turn && !game.over ? "current" : ""}"><span class="avatar">${p.avatar || "🃏"}</span><div><div class="player-name">${esc(p.name || `Player ${i + 1}`)}</div><div class="player-sub">${p.type === "computer" ? "Computer" : p.playerType || "Player"} · ${game.hands[i]?.length || 0} cards</div></div></div>`,
    )
    .join("");
  const top = game.top();
  $("piles").innerHTML =
    `<div class="pile"><div class="zone-label">Draw pile · ${game.drawPile.length}</div><button id="drawBtn" class="card back">DRAW</button></div><div class="pile"><div class="zone-label">Discard · ${game.side} side</div>${top ? cardHtml(top, game.side, false, false) : ""}<div class="muted">Active color: ${game.activeColor || "wild"}</div></div>`;
  $("drawBtn").onclick = () => {
    if (!controlledTurn()) return;
    if (action({ type: "draw" })) render();
  };
  const canSee = controlledTurn() && !game.over,
    hand = canSee ? game.hands[game.turn] : [];
  $("handTitle").textContent = canSee
    ? `${game.current().name}'s hand`
    : "Current player's hand is hidden";
  $("handHint").textContent = canSee
    ? `${hand.length} cards · click a card to play it`
    : "Only the player whose turn it is can see their hand.";
  $("hand").innerHTML = hand
    .map((c) => cardHtml(c, game.side, c.id === selected))
    .join("");
  $("hand")
    .querySelectorAll("[data-card]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          if (!canSee) return;
          const c = hand.find((x) => x.id === el.dataset.card);
          if (!c) return;
          if (!game.canPlay(c, game.turn)) return;
          if (
            ["wild", "drawFour", "drawColor"].includes(
              faceOf(c, game.side).type,
            )
          ) {
            pendingWild = c.id;
            renderColors();
            return;
          }
          if (action({ type: "play", id: c.id })) render();
        }),
    );
  const actions = $("mainActions");
  actions.innerHTML = "";
  const add = (label, fn, disabled = false, cls = "") => {
    const b = document.createElement("button");
    b.textContent = label;
    b.disabled = disabled;
    b.className = cls;
    b.onclick = () => {
      if (fn()) render();
    };
    actions.appendChild(b);
  };
  if (canSee && game.drawnCardId)
    add("Pass / keep drawn card", () => action({ type: "pass" }));
  if (canSee && game.pendingDraw && game.options.stacking)
    add("Draw penalty", () => action({ type: "draw" }));
  $("meldArea").innerHTML = "";
  $("history").innerHTML =
    game.moveHistory
      .slice(0, 60)
      .map((x) => `<div>${esc(x)}</div>`)
      .join("") || '<div class="muted">No moves yet.</div>';
  $("rules").textContent = flip
    ? "Eins Flip uses Light and Dark sides. Playing a Flip card turns every hand, the draw pile, and the discard pile over. Draw One/Five and Wild Draw Two/Draw Color penalties can stack when stacking is enabled."
    : "Eins follows classic UNO-style play: match the top card by color or label, use action and wild cards, and empty your hand to win. Stacking and draw-until-playable are setup options.";
  scheduleAI();
  if (ONLINE_MODE && ONLINE_HOST_TOKEN && onlineConnected) publishState();
}
function renderColors() {
  const box = $("colorChoices");
  box.hidden = !pendingWild;
  if (!pendingWild) return;
  const f = faceOf(
    game.hands[game.turn].find((c) => c.id === pendingWild),
    game.side,
  );
  const choices =
    f.type === "drawColor" ? DARK : game.side === "dark" ? DARK : COLORS;
  box.innerHTML = choices
    .map(
      (c) =>
        `<button class="${c}-choice" data-color="${c}">${c[0].toUpperCase() + c.slice(1)}</button>`,
    )
    .join("");
  box.querySelectorAll("[data-color]").forEach(
    (b) =>
      (b.onclick = () => {
        if (action({ type: "play", id: pendingWild, color: b.dataset.color }))
          render();
      }),
  );
}
function scheduleAI() {
  clearTimeout(aiTimer);
  if (
    aiPending ||
    game.over ||
    game.current()?.type !== "computer" ||
    (ONLINE_MODE && (!ONLINE_HOST_TOKEN || !onlineConnected))
  )
    return;
  aiPending = true;
  aiTimer = setTimeout(() => {
    aiPending = false;
    game.aiTurn();
    render();
  }, 450);
}
function wsUrl() {
  return `${ONLINE_SERVER.replace(/\/$/, "")
    .replace(/^http:/, "ws:")
    .replace(
      /^https:/,
      "wss:",
    )}/ws/${encodeURIComponent(ONLINE_CODE)}?clientId=${encodeURIComponent(ONLINE_CLIENT_ID)}&role=${ONLINE_HOST_TOKEN ? "host" : "player"}`;
}
function publishState() {
  if (onlineSocket?.readyState === WebSocket.OPEN && ONLINE_HOST_TOKEN)
    onlineSocket.send(
      JSON.stringify({
        type: "game:state",
        state: { game: game.snapshot(), variant: selectedVariantId },
      }),
    );
}
function publishOnlineResult() {
  if (
    !ONLINE_MODE ||
    !ONLINE_HOST_TOKEN ||
    onlineResultSent ||
    !game.over ||
    onlineSocket?.readyState !== WebSocket.OPEN
  )
    return;
  const winner = game.players[game.winner],
    winnerClientId =
      winner?.controllerClientId || winner?.participantClientId || "";
  if (!winnerClientId) return;
  onlineResultSent = true;
  onlineSocket.send(
    JSON.stringify({
      type: "game:result",
      winnerClientId,
      matchId: onlineMatchId,
    }),
  );
}
function connectOnline() {
  if (!ONLINE_MODE || !ONLINE_SERVER || !ONLINE_CODE) return;
  try {
    onlineSocket = new WebSocket(wsUrl());
  } catch {
    $("onlineBar").textContent = "Could not connect";
    return;
  }
  onlineSocket.onopen = () => {
    onlineConnected = true;
    const p = localPartyProfiles()[0] || {};
    onlineSocket.send(
      JSON.stringify({
        type: "player:identify",
        profileId: p.id || "",
        name: p.name || "Player 1",
        avatar: p.avatar || "♟",
        party: localPartyProfiles().map((x) => ({
          id: x.id,
          name: x.name || "Player",
          avatar: x.avatar || "♟",
        })),
        spectator: Boolean(
          (onlineConfig?.spectators || []).includes(ONLINE_CLIENT_ID),
        ),
      }),
    );
    $("onlineBar").textContent = "Connected";
    render();
    if (ONLINE_HOST_TOKEN) setTimeout(publishState, 100);
  };
  onlineSocket.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === "room:participants") {
      onlineParticipants = m.participants || [];
      return;
    }
    if (m.type === "room:config") {
      onlineConfig = m.config || onlineConfig;
      return;
    }
    if (m.type === "game:start") {
      onlineMatchId = m.matchId || "";
      onlineResultSent = false;
      localScoreRecorded = false;
      onlineConfig = m.config || onlineConfig;
      selectedVariantId = onlineConfig?.variant || selectedVariantId;
      game = new EinsGame(onlineConfig || {});
      selected = null;
      pendingWild = null;
      render();
      if (ONLINE_HOST_TOKEN) setTimeout(publishState, 80);
      return;
    }
    if (m.type === "game:state" && m.state?.game) {
      game.restore(m.state.game);
      selected = null;
      pendingWild = null;
      render();
      return;
    }
    if (m.type === "game:move" && m.sender?.clientId !== ONLINE_CLIENT_ID) {
      if (action(m.payload, true)) render();
      return;
    }
    if (m.type === "game:back") location.href = "../index.html";
  };
  onlineSocket.onclose = () => ($("onlineBar").textContent = "Disconnected");
  onlineSocket.onerror = () =>
    ($("onlineBar").textContent = "Connection error");
}
function back() {
  if (ONLINE_MODE && onlineSocket?.readyState === WebSocket.OPEN) {
    onlineSocket.send(JSON.stringify({ type: "game:back" }));
    setTimeout(() => (location.href = "../index.html"), 250);
  } else location.href = "../index.html";
}
$("newGameBtn").onclick = back;
$("clearBtn").onclick = () => {
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  game = new EinsGame(onlineConfig || {});
  selected = null;
  pendingWild = null;
  localScoreRecorded = false;
  render();
};
$("undoBtn").onclick = () => {
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  if (game.undo()) {
    selected = null;
    pendingWild = null;
    localScoreRecorded = false;
    render();
  }
};
$("onlineBar").textContent = ONLINE_MODE ? "Connecting…" : "Offline/local game";
render();
connectOnline();
