"use strict";
const params = new URLSearchParams(location.search),
  ONLINE_MODE = params.get("online") === "1";
const ONLINE_SERVER = params.get("onlineServer") || "",
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
let selectedVariantId = params.get("variant") || "classic",
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
})();
const $ = (id) => document.getElementById(id),
  copy = (o) => JSON.parse(JSON.stringify(o));
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function buildDeck(n) {
  const d = [];
  for (let pack = 0; pack < n; pack++)
    for (const suit of ["♣", "♦", "♥", "♠"])
      for (let rank = 1; rank <= 13; rank++)
        d.push({
          id: `${pack}-${suit}-${rank}`,
          suit,
          rank,
          label: `${rank === 1 ? "A" : rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : rank}${suit}`,
        });
  return shuffle(d);
}
function rankName(n) {
  return { 1: "A", 11: "J", 12: "Q", 13: "K" }[n] || String(n);
}
function cardInner(c) {
  const rank = rankName(c.rank);
  return `<span class="corner"><span class="corner-rank">${rank}</span><span class="corner-suit">${c.suit}</span></span><span class="face"><span class="center-rank">${rank}</span><span class="center-suit">${c.suit}</span></span><span class="bottom"><span class="corner-rank">${rank}</span><span class="corner-suit">${c.suit}</span></span>`;
}
function cardHtml(c, selected = false, mini = false) {
  const red = ["♥", "♦"].includes(c.suit);
  return `<div class="card ${red ? "red" : "black"} ${selected ? "selected" : ""} ${mini ? "mini" : ""}" data-card="${c.id}">${cardInner(c)}</div>`;
}
class RummyGame {
  constructor(config = {}) {
    this.options = config.options || {};
    this.players = [];
    this.hands = [];
    this.stock = [];
    this.discard = [];
    this.melds = [];
    this.turn = 0;
    this.phase = "draw";
    this.selected = [];
    this.history = [];
    this.moveHistory = [];
    this.over = false;
    this.winner = -1;
    this.requiredMeldCardId = "";
    this.reset(config.players || []);
  }
  reset(players = []) {
    const ps = players.length
      ? players
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
        ];
    this.players = ps.map((p, i) => ({ ...p, seat: i }));
    this.hands = this.players.map(() => []);
    this.stock = buildDeck(this.players.length > 4 ? 2 : 1);
    this.discard = [];
    this.melds = [];
    this.turn = 0;
    this.phase = "draw";
    this.selected = [];
    this.history = [];
    this.moveHistory = [];
    this.over = false;
    this.winner = -1;
    this.requiredMeldCardId = "";
    const count = this.players.length === 2 ? 10 : 7;
    for (let k = 0; k < count; k++)
      for (let i = 0; i < this.players.length; i++)
        this.hands[i].push(this.stock.pop());
    this.discard.push(this.stock.pop());
  }
  snapshot() {
    return {
      players: this.players,
      hands: this.hands,
      stock: this.stock,
      discard: this.discard,
      melds: this.melds,
      turn: this.turn,
      phase: this.phase,
      selected: this.selected,
      requiredMeldCardId: this.requiredMeldCardId,
      moveHistory: this.moveHistory,
      over: this.over,
      winner: this.winner,
      options: this.options,
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
    const s = this.history.pop(),
      h = this.history;
    this.restore(s);
    this.history = h;
    return true;
  }
  current() {
    return this.players[this.turn];
  }
  drawStock() {
    if (this.over || this.phase !== "draw") return false;
    if (!this.stock.length) {
      if (this.discard.length <= 1) return false;
      const top = this.discard.pop();
      this.stock = shuffle(this.discard.splice(0));
      this.discard = [top];
    }
    if (!this.stock.length) return false;
    this.save();
    this.hands[this.turn].push(this.stock.pop());
    this.phase = "play";
    this.selected = [];
    this.moveHistory.unshift(`${this.current().name} drew from the stock.`);
    return true;
  }
  drawDiscard(index = this.discard.length - 1) {
    if (this.over || this.phase !== "draw" || !this.discard.length)
      return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.discard.length)
      return false;
    const taken = this.discard.slice(0, index + 1),
      required = taken[taken.length - 1],
      available = [...this.hands[this.turn], ...taken];
    if (!this.canMeldWithCard(required, available)) return false;
    this.save();
    this.discard.splice(0, index + 1);
    this.hands[this.turn].push(...taken);
    this.requiredMeldCardId = required.id;
    this.phase = "play";
    this.selected = [];
    this.moveHistory.unshift(
      `${this.current().name} took ${taken.length} card${taken.length === 1 ? "" : "s"} from the discard, starting with ${required.label}. They must meld that card this turn.`,
    );
    return true;
  }
  isSet(cards) {
    return (
      cards.length >= 3 &&
      cards.length <= 4 &&
      cards.every((c) => c.rank === cards[0].rank) &&
      new Set(cards.map((c) => c.suit)).size === cards.length
    );
  }
  isRun(cards) {
    if (cards.length < 3 || !cards.every((c) => c.suit === cards[0].suit))
      return false;
    const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
    return ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
  }
  canMeldWithCard(card, pool) {
    if (!card) return false;
    const sameRank = [
      ...new Map(
        pool.filter((c) => c.rank === card.rank).map((c) => [c.suit, c]),
      ).values(),
    ];
    if (sameRank.length >= 3) return true;
    const ranks = [
      ...new Set(pool.filter((c) => c.suit === card.suit).map((c) => c.rank)),
    ].sort((a, b) => a - b);
    if (!ranks.includes(card.rank)) return false;
    let run = 1;
    for (let r = card.rank - 1; r >= 1 && ranks.includes(r); r--) run++;
    for (let r = card.rank + 1; r <= 13 && ranks.includes(r); r++) run++;
    return run >= 3;
  }
  makeMeld(ids) {
    if (this.over || this.phase !== "play" || ids.length < 3) return false;
    const hand = this.hands[this.turn],
      cards = ids.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
    if (
      cards.length !== ids.length ||
      (!this.isSet(cards) && !this.isRun(cards))
    )
      return false;
    if (this.requiredMeldCardId && !ids.includes(this.requiredMeldCardId))
      return false;
    this.save();
    this.hands[this.turn] = hand.filter((c) => !ids.includes(c.id));
    this.melds.push({
      id: "meld" + Date.now() + Math.random(),
      cards: cards,
      owner: this.turn,
    });
    this.moveHistory.unshift(
      `${this.current().name} laid down a ${this.isSet(cards) ? "set" : "run"} (${cards.length} cards).`,
    );
    if (this.requiredMeldCardId && ids.includes(this.requiredMeldCardId))
      this.requiredMeldCardId = "";
    this.selected = [];
    if (!this.hands[this.turn].length) {
      this.finish(this.turn);
      return true;
    }
    return true;
  }
  canLayOff(card, meld) {
    const all = [...meld.cards, card];
    if (
      all.every((c) => c.rank === all[0].rank) &&
      new Set(all.map((c) => c.suit)).size === all.length
    )
      return true;
    if (all.every((c) => c.suit === all[0].suit)) {
      const rs = all.map((c) => c.rank).sort((a, b) => a - b);
      return rs.every((r, i) => i === 0 || r === rs[i - 1] + 1);
    }
    return false;
  }
  layOff(ids, meldId) {
    if (this.over || this.phase !== "play" || this.requiredMeldCardId)
      return false;
    const hand = this.hands[this.turn],
      meld = this.melds.find((m) => m.id === meldId);
    if (!meld || !ids.length) return false;
    const cards = ids
      .map((id) => hand.find((c) => c.id === id))
      .filter(Boolean);
    if (cards.length !== ids.length) return false;
    let trial = [...meld.cards];
    for (const c of cards) {
      const fake = { cards: trial };
      if (!this.canLayOff(c, fake)) return false;
      trial.push(c);
    }
    this.save();
    meld.cards = trial;
    this.hands[this.turn] = hand.filter((c) => !ids.includes(c.id));
    this.moveHistory.unshift(
      `${this.current().name} added ${cards.length} card(s) to a meld.`,
    );
    this.selected = [];
    if (!this.hands[this.turn].length) this.finish(this.turn);
    return true;
  }
  discardCard(id) {
    if (this.over || this.phase !== "play" || this.requiredMeldCardId)
      return false;
    const hand = this.hands[this.turn],
      card = hand.find((c) => c.id === id);
    if (!card) return false;
    this.save();
    this.hands[this.turn] = hand.filter((c) => c.id !== id);
    this.discard.push(card);
    this.moveHistory.unshift(`${this.current().name} discarded ${card.label}.`);
    this.selected = [];
    if (!this.hands[this.turn].length) {
      this.finish(this.turn);
      return true;
    }
    this.turn = (this.turn + 1) % this.players.length;
    this.phase = "draw";
    return true;
  }
  finish(i) {
    this.over = true;
    this.winner = i;
    this.phase = "over";
    this.requiredMeldCardId = "";
    this.moveHistory.unshift(`${this.players[i].name} wins the round!`);
  }
  action(a) {
    switch (a.type) {
      case "drawStock":
        return this.drawStock();
      case "drawDiscard":
        return this.drawDiscard(a.index);
      case "meld":
        return this.makeMeld(a.ids || []);
      case "layoff":
        return this.layOff(a.ids || [], a.meldId);
      case "discard":
        return this.discardCard(a.id);
      default:
        return false;
    }
  }
  aiTurn() {
    if (this.over) return false;
    if (this.phase === "draw") {
      const hand = this.hands[this.turn],
        pick = window.RummyAI.chooseDiscardTake(this.discard, hand);
      return this.action(
        pick
          ? { type: "drawDiscard", index: pick.index }
          : { type: "drawStock" },
      );
    }
    let changed = true;
    while (changed) {
      changed = false;
      const hand = this.hands[this.turn];
      let found = null;
      for (let n = Math.min(13, hand.length); n >= 3 && !found; n--) {
        const seek = (start, chosen) => {
          if (chosen.length === n) {
            if (
              (this.isSet(chosen) || this.isRun(chosen)) &&
              (!this.requiredMeldCardId ||
                chosen.some((c) => c.id === this.requiredMeldCardId))
            )
              found = [...chosen];
            return;
          }
          for (
            let i = start;
            i <= hand.length - (n - chosen.length) && !found;
            i++
          )
            seek(i + 1, [...chosen, hand[i]]);
        };
        seek(0, []);
      }
      if (found) {
        this.makeMeld(found.map((c) => c.id));
        changed = true;
      }
      if (this.over) return true;
    }
    if (this.requiredMeldCardId) return false;
    if (this.over) return true;
    const card = window.RummyAI.chooseDiscard(this.hands[this.turn]);
    return card ? this.discardCard(card.id) : false;
  }
}
let game = new RummyGame(onlineConfig || {}),
  selected = new Set(),
  aiTimer = null,
  aiPending = false;
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
function localPartyProfiles() {
  try {
    const ids = JSON.parse(sessionStorage.getItem("gameLibraryParty") || "[]");
    const a = ids
      .map((id) => profiles.find((p) => p.id === id))
      .filter(Boolean);
    if (a.length) return a;
  } catch {}
  return profiles;
}
function controlledTurn() {
  return isControlled(game.current());
}
function action(a, remote = false) {
  const ok = game.action(a);
  if (!ok) return false;
  selected.clear();
  if (ONLINE_MODE && !remote) sendMove(a);
  if (game.over) recordWin();
  return true;
}
function sendMove(a) {
  if (onlineSocket?.readyState === WebSocket.OPEN)
    onlineSocket.send(JSON.stringify({ type: "game:move", payload: a }));
}
function recordWin() {
  if (ONLINE_MODE || localScoreRecorded || !game.over) return;
  const p = game.players[game.winner];
  if (!p?.profileId) return;
  let scores = {};
  try {
    scores = JSON.parse(localStorage.getItem("gameLibraryLocalScores") || "{}");
  } catch {}
  scores[p.profileId] = (Number(scores[p.profileId]) || 0) + 1;
  localStorage.setItem("gameLibraryLocalScores", JSON.stringify(scores));
  localScoreRecorded = true;
}
function cardFace(c) {
  return c.label;
}
function render() {
  if (game.over) {
    recordWin();
    publishOnlineResult();
  }
  $("variantName").textContent = "Classic Rummy";
  $("status").textContent = game.over
    ? `${game.players[game.winner]?.name || "A player"} wins!`
    : game.phase === "draw"
      ? `${game.current().name}'s turn — draw from the stock or discard pile.`
      : game.requiredMeldCardId
        ? `${game.current().name}'s turn — you must meld the first card taken from the discard pile.`
        : `${game.current().name}'s turn — meld cards if you can, then discard one.`;
  $("playerList").innerHTML = game.players
    .map(
      (p, i) =>
        `<div class="player-row ${i === game.turn && !game.over ? "current" : ""}"><span class="avatar">${p.avatar || "🃏"}</span><div><div class="player-name">${esc(p.name || `Player ${i + 1}`)}</div><div class="player-sub">${p.type === "computer" ? "Computer" : p.playerType || "Player"} · ${game.hands[i]?.length || 0} cards</div></div></div>`,
    )
    .join("");
  const discardCards = game.discard
    .map(
      (c, i) =>
        `<div class="discard-slot ${i === game.discard.length - 1 ? "latest" : ""}" title="Take this card and all cards to its left" data-discard-index="${i}">${cardHtml(c, false, true)}</div>`,
    )
    .join("");
  $("piles").innerHTML =
    `<div class="pile"><div class="zone-label">Stock · ${game.stock.length}</div><button id="stockBtn" class="card back">DRAW<br>STOCK</button></div><div class="pile discard-pile"><div class="zone-label">Discard pile · oldest → newest</div><div class="discard-line">${discardCards || '<div class="muted">Empty</div>'}</div></div>`;
  $("stockBtn").onclick = () => {
    if (!controlledTurn()) return;
    const a = { type: "drawStock" };
    if (action(a)) render();
  };
  $("piles")
    .querySelectorAll("[data-discard-index]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          if (!controlledTurn()) return;
          const a = {
            type: "drawDiscard",
            index: Number(el.dataset.discardIndex),
          };
          if (action(a)) render();
          else {
            $("status").textContent =
              "You can only take from that point if the first card taken can be used in a new meld.";
          }
        }),
    );
  const canSee = controlledTurn() && !game.over;
  const hand = canSee ? game.hands[game.turn] : [];
  $("hand").innerHTML = hand
    .map((c) => cardHtml(c, selected.has(c.id)))
    .join("");
  $("hand")
    .querySelectorAll("[data-card]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          if (!canSee) return;
          const id = el.dataset.card;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          render();
        }),
    );
  if (game.requiredMeldCardId) {
    $("hand")
      .querySelectorAll("[data-card]")
      .forEach((el) => {
        if (el.dataset.card === game.requiredMeldCardId)
          el.classList.add("required");
      });
  }
  $("handTitle").textContent = canSee
    ? `${game.current().name}'s hand`
    : "Current player's hand is hidden";
  $("handHint").textContent = canSee
    ? `${hand.length} cards · select cards to meld or discard`
    : "Only the player whose turn it is can see their hand.";
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
  if (canSee) {
    if (game.phase === "draw") {
      add("Draw from stock", () => action({ type: "drawStock" }));
      add("Take newest discard", () => action({ type: "drawDiscard" }));
    } else {
      add(
        "Meld selected",
        () => action({ type: "meld", ids: [...selected] }),
        selected.size < 3 ||
          Boolean(
            game.requiredMeldCardId && !selected.has(game.requiredMeldCardId),
          ),
        "action-primary",
      );
      if (game.melds.length && !game.requiredMeldCardId) {
        const sel = document.createElement("select");
        sel.id = "layoffSelect";
        sel.innerHTML = game.melds
          .map(
            (m, i) =>
              `<option value="${m.id}">Meld ${i + 1} (${m.cards.length} cards)</option>`,
          )
          .join("");
        actions.appendChild(sel);
        add(
          "Lay off selected",
          () =>
            action({ type: "layoff", ids: [...selected], meldId: sel.value }),
          !selected.size,
        );
      }
      add(
        "Discard selected",
        () => action({ type: "discard", id: [...selected][0] }),
        selected.size !== 1 || Boolean(game.requiredMeldCardId),
        "action-danger",
      );
    }
  }
  $("meldArea").innerHTML = game.melds.length
    ? `<div class="zone-label" style="text-align:center;margin-top:12px">Melds on table</div><div class="melds">${game.melds.map((m, i) => `<div class="meld"><div class="meld-title">Meld ${i + 1} · ${m.cards.length} cards</div><div class="meld-cards">${m.cards.map((c) => cardHtml(c, false, true)).join("")}</div></div>`).join("")}</div>`
    : "";
  $("history").innerHTML = game.moveHistory.length
    ? game.moveHistory
        .slice(0, 60)
        .map((x) => `<div>${esc(x)}</div>`)
        .join("")
    : '<div class="muted">No moves yet.</div>';
  $("rules").textContent =
    "Classic draw-and-discard Rummy: draw one card, or take any discard card and all cards to its left. The first card you take from the discard must be included in a new meld of three or more cards. Form sets of three or more cards of the same rank or runs of three or more consecutive cards in the same suit, then discard one card. You may add cards to existing melds after satisfying the discard-meld requirement. Empty your hand to win. Aces are low.";
  scheduleAI();
  if (ONLINE_MODE && ONLINE_HOST_TOKEN && onlineConnected) publishState();
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
    const ok = game.aiTurn();
    if (ok) render();
  }, 500);
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
function setOnline(t) {
  $("onlineBar").textContent = t;
}
function connectOnline() {
  if (!ONLINE_MODE || !ONLINE_SERVER || !ONLINE_CODE) return;
  try {
    onlineSocket = new WebSocket(wsUrl());
  } catch {
    setOnline("Could not connect");
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
    setOnline("Connected");
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
      game = new RummyGame(onlineConfig || {});
      selected.clear();
      render();
      if (ONLINE_HOST_TOKEN) setTimeout(publishState, 80);
      return;
    }
    if (m.type === "game:state" && m.state?.game) {
      game.restore(m.state.game);
      selected.clear();
      render();
      return;
    }
    if (m.type === "game:move" && m.sender?.clientId !== ONLINE_CLIENT_ID) {
      if (action(m.payload, true)) render();
      return;
    }
    if (m.type === "game:back") location.href = "../index.html";
  };
  onlineSocket.onclose = () => {
    onlineConnected = false;
    setOnline("Disconnected");
  };
  onlineSocket.onerror = () => setOnline("Connection error");
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
  game = new RummyGame(onlineConfig || {});
  selected.clear();
  localScoreRecorded = false;
  render();
};
$("undoBtn").onclick = () => {
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  if (game.undo()) {
    selected.clear();
    localScoreRecorded = false;
    render();
  }
};
$("onlineBar").textContent = ONLINE_MODE ? "Connecting…" : "Offline/local game";
render();
connectOnline();
