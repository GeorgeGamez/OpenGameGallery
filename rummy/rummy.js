"use strict";

const params = new URLSearchParams(location.search);
const ONLINE_MODE = params.get("online") === "1";
const ONLINE_SERVER = params.get("onlineServer") || "";
const ONLINE_CODE = params.get("onlineCode") || "";
const ONLINE_CLIENT_ID =
  params.get("onlineClientId") ||
  sessionStorage.getItem("gameLibraryOnlineClientId") ||
  `client_${Math.random().toString(36).slice(2, 12)}`;
const ONLINE_HOST_TOKEN =
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

let onlineSocket = null;
let onlineConnected = false;
let onlineParticipants = [];
let onlineMatchId = "";
let onlineResultSent = false;
let localScoreRecorded = false;

const profiles = (() => {
  try {
    return JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
  } catch {
    return [];
  }
})();

const $ = (id) => document.getElementById(id);
const copy = (value) => JSON.parse(JSON.stringify(value));

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function buildDeck(packCount) {
  const deck = [];
  for (let pack = 0; pack < packCount; pack++) {
    for (const suit of ["♣", "♦", "♥", "♠"]) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({
          id: `${pack}-${suit}-${rank}`,
          suit,
          rank,
          label: `${rankName(rank)}${suit}`,
        });
      }
    }
  }
  return shuffle(deck);
}

function rankName(rank) {
  return { 1: "A", 11: "J", 12: "Q", 13: "K" }[rank] || String(rank);
}

function cardInner(card) {
  const rank = rankName(card.rank);
  return `
    <span class="corner"><span class="corner-rank">${rank}</span><span class="corner-suit">${card.suit}</span></span>
    <span class="face"><span class="center-rank">${rank}</span><span class="center-suit">${card.suit}</span></span>
    <span class="bottom"><span class="corner-rank">${rank}</span><span class="corner-suit">${card.suit}</span></span>`;
}

function cardHtml(card, selected = false, mini = false, extraClass = "") {
  const red = ["♥", "♦"].includes(card.suit);
  return `<div class="card ${red ? "red" : "black"} ${selected ? "selected" : ""} ${mini ? "mini" : ""} ${extraClass}" data-card="${card.id}">${cardInner(card)}</div>`;
}

function sameCardId(a, b) {
  return Boolean(a && b && a.id === b.id);
}

class RummyGame {
  constructor(config = {}) {
    this.options = {
      topToBottomMeld: false,
      scoring: "firstOut",
      ...(config.options || {}),
    };
    this.players = [];
    this.hands = [];
    this.stock = [];
    this.discard = [];
    this.melds = [];
    this.turn = 0;
    this.phase = "draw";
    this.history = [];
    this.moveHistory = [];
    this.over = false;
    this.winner = -1;
    this.outPlayer = -1;
    this.roundScores = [];
    this.requiredDiscardUse = null;
    this.reset(config.players || []);
  }

  reset(players = []) {
    const defaultPlayers = [
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

    const source = players.length ? players : defaultPlayers;
    this.players = source.map((player, index) => ({ ...player, seat: index }));
    this.hands = this.players.map(() => []);
    this.stock = buildDeck(this.players.length > 4 ? 2 : 1);
    this.discard = [];
    this.melds = [];
    this.turn = 0;
    this.phase = "draw";
    this.history = [];
    this.moveHistory = [];
    this.over = false;
    this.winner = -1;
    this.outPlayer = -1;
    this.roundScores = [];
    this.requiredDiscardUse = null;

    const dealCount = this.players.length === 2 ? 10 : 7;
    for (let n = 0; n < dealCount; n++) {
      for (let player = 0; player < this.players.length; player++) {
        this.hands[player].push(this.stock.pop());
      }
    }
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
      moveHistory: this.moveHistory,
      over: this.over,
      winner: this.winner,
      outPlayer: this.outPlayer,
      roundScores: this.roundScores,
      requiredDiscardUse: this.requiredDiscardUse,
      options: this.options,
    };
  }

  restore(snapshot) {
    Object.assign(this, copy(snapshot));
    this.history = [];
  }

  save() {
    this.history.push(this.snapshot());
  }

  undo() {
    if (!this.history.length) return false;
    const currentHistory = this.history;
    const snapshot = currentHistory.pop();
    this.restore(snapshot);
    this.history = currentHistory;
    return true;
  }

  current() {
    return this.players[this.turn];
  }

  scoreValue(card) {
    if (card.rank === 1) return 15;
    if (card.rank >= 11) return 10;
    return this.options.scoring === "flatFive" ? 5 : card.rank;
  }

  isSet(cards) {
    return (
      cards.length >= 3 &&
      cards.length <= 4 &&
      cards.every((card) => card.rank === cards[0].rank) &&
      new Set(cards.map((card) => card.suit)).size === cards.length
    );
  }

  isRun(cards) {
    if (cards.length < 3 || cards.length > 13) return false;
    if (!cards.every((card) => card.suit === cards[0].suit)) return false;

    const ranks = [...new Set(cards.map((card) => card.rank))];
    if (ranks.length !== cards.length) return false;

    if (!this.options.topToBottomMeld) {
      const sorted = [...ranks].sort((a, b) => a - b);
      return sorted.every(
        (rank, index) => index === 0 || rank === sorted[index - 1] + 1,
      );
    }

    const rankSet = new Set(ranks);
    for (const start of ranks) {
      let matches = true;
      for (let offset = 0; offset < ranks.length; offset++) {
        const rank = ((start - 1 + offset) % 13) + 1;
        if (!rankSet.has(rank)) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    return false;
  }

  canMakeNewMeldWithCard(card, pool) {
    if (!card) return false;

    const sameRank = pool.filter((candidate) => candidate.rank === card.rank);
    if (new Set(sameRank.map((candidate) => candidate.suit)).size >= 3) {
      return true;
    }

    const sameSuitRanks = new Set(
      pool
        .filter((candidate) => candidate.suit === card.suit)
        .map((candidate) => candidate.rank),
    );
    if (!sameSuitRanks.has(card.rank)) return false;

    if (!this.options.topToBottomMeld) {
      const sorted = [...sameSuitRanks].sort((a, b) => a - b);
      for (let start = 0; start < sorted.length; start++) {
        let end = start;
        while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) {
          end++;
        }
        if (end - start + 1 >= 3) {
          const run = sorted.slice(start, end + 1);
          if (run.includes(card.rank)) return true;
        }
      }
      return false;
    }

    for (const start of sameSuitRanks) {
      for (let length = 3; length <= 13; length++) {
        const ranks = [];
        for (let offset = 0; offset < length; offset++) {
          ranks.push(((start - 1 + offset) % 13) + 1);
        }
        if (
          ranks.includes(card.rank) &&
          ranks.every((rank) => sameSuitRanks.has(rank))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  canAddToExistingMeld(card) {
    if (!card || !this.melds.length) return false;
    return this.melds.some((meld) => this.canLayOffCards([card], meld));
  }

  canLayOffCards(cards, meld) {
    if (!meld || !cards.length) return false;
    const combined = [...meld.cards, ...cards];
    return this.isSet(combined) || this.isRun(combined);
  }

  drawStock() {
    if (this.over || this.phase !== "draw") return false;

    if (!this.stock.length) {
      if (this.discard.length <= 1) return false;
      const top = this.discard[this.discard.length - 1];
      const reusable = this.discard.slice(0, -1);
      this.stock = shuffle(reusable);
      this.discard = [top];
    }

    if (!this.stock.length) return false;

    this.save();
    this.hands[this.turn].push(this.stock.pop());
    this.phase = "play";
    this.requiredDiscardUse = null;
    this.moveHistory.unshift(`${this.current().name} drew from the stock.`);
    return true;
  }

  evaluateDiscardPickup(index) {
    if (this.phase !== "draw" || !this.discard.length) return null;
    if (!Number.isInteger(index) || index < 0 || index >= this.discard.length)
      return null;

    // The clicked card is the first card taken. Everything newer (to its right)
    // is taken too. Cards older than the clicked card remain on the table.
    const taken = this.discard.slice(index);
    const firstTaken = taken[0];
    const lastTaken = taken[taken.length - 1];
    const available = [...this.hands[this.turn], ...taken];

    if (this.canMakeNewMeldWithCard(firstTaken, available)) {
      return { index, mode: "newMeld", requiredCardId: firstTaken.id };
    }

    if (this.canAddToExistingMeld(lastTaken)) {
      return { index, mode: "layoff", requiredCardId: lastTaken.id };
    }

    return null;
  }

  drawDiscard(index = this.discard.length - 1) {
    if (this.over || this.phase !== "draw") return false;

    const pickup = this.evaluateDiscardPickup(index);
    if (!pickup) return false;

    this.save();
    const taken = this.discard.splice(index);
    this.hands[this.turn].push(...taken);
    this.requiredDiscardUse = {
      mode: pickup.mode,
      cardId: pickup.requiredCardId,
    };
    this.phase = "play";

    const required =
      taken.find((card) => card.id === pickup.requiredCardId) || taken[0];
    const description =
      pickup.mode === "newMeld"
        ? `They must use ${required.label} in a new meld this turn.`
        : `They must add ${required.label} to an existing meld this turn.`;
    this.moveHistory.unshift(
      `${this.current().name} took ${taken.length} card${taken.length === 1 ? "" : "s"} from the discard, starting at ${taken[0].label}. ${description}`,
    );
    return true;
  }

  makeMeld(ids) {
    if (this.over || this.phase !== "play" || ids.length < 3) return false;

    const hand = this.hands[this.turn];
    const cards = ids
      .map((id) => hand.find((card) => card.id === id))
      .filter(Boolean);
    if (cards.length !== ids.length) return false;
    if (!this.isSet(cards) && !this.isRun(cards)) return false;

    if (
      this.requiredDiscardUse?.mode === "newMeld" &&
      !ids.includes(this.requiredDiscardUse.cardId)
    ) {
      return false;
    }

    this.save();
    this.hands[this.turn] = hand.filter((card) => !ids.includes(card.id));
    this.melds.push({
      id: `meld${Date.now()}${Math.random()}`,
      cards,
      owner: this.turn,
    });

    this.moveHistory.unshift(
      `${this.current().name} laid down a ${this.isSet(cards) ? "set" : "run"} (${cards.length} cards).`,
    );

    if (this.requiredDiscardUse?.mode === "newMeld") {
      this.requiredDiscardUse = null;
    }

    if (!this.hands[this.turn].length) {
      this.finish(this.turn);
    }
    return true;
  }

  layOff(ids, meldId) {
    if (this.over || this.phase !== "play") return false;

    const hand = this.hands[this.turn];
    const meld = this.melds.find((entry) => entry.id === meldId);
    if (!meld || !ids.length) return false;

    const cards = ids
      .map((id) => hand.find((card) => card.id === id))
      .filter(Boolean);
    if (cards.length !== ids.length) return false;

    if (
      this.requiredDiscardUse?.mode === "layoff" &&
      !ids.includes(this.requiredDiscardUse.cardId)
    ) {
      return false;
    }

    if (!this.canLayOffCards(cards, meld)) return false;

    this.save();
    meld.cards.push(...cards);
    this.hands[this.turn] = hand.filter((card) => !ids.includes(card.id));
    this.moveHistory.unshift(
      `${this.current().name} added ${cards.length} card(s) to a meld.`,
    );

    if (
      this.requiredDiscardUse?.mode === "layoff" &&
      ids.includes(this.requiredDiscardUse.cardId)
    ) {
      this.requiredDiscardUse = null;
    }

    if (!this.hands[this.turn].length) {
      this.finish(this.turn);
    }
    return true;
  }

  discardCard(id) {
    if (this.over || this.phase !== "play") return false;
    if (this.requiredDiscardUse) return false;

    const hand = this.hands[this.turn];
    const card = hand.find((candidate) => candidate.id === id);
    if (!card) return false;

    this.save();
    this.hands[this.turn] = hand.filter((candidate) => candidate.id !== id);
    this.discard.push(card);
    this.moveHistory.unshift(`${this.current().name} discarded ${card.label}.`);

    if (!this.hands[this.turn].length) {
      this.finish(this.turn);
      return true;
    }

    this.turn = (this.turn + 1) % this.players.length;
    this.phase = "draw";
    return true;
  }

  scoreForPlayer(index) {
    const melded = this.melds
      .filter((meld) => meld.owner === index)
      .flatMap((meld) => meld.cards);
    const meldScore = melded.reduce(
      (sum, card) => sum + this.scoreValue(card),
      0,
    );
    const handScore = this.hands[index].reduce(
      (sum, card) => sum + this.scoreValue(card),
      0,
    );
    return meldScore - handScore;
  }

  finish(outPlayer) {
    this.over = true;
    this.outPlayer = outPlayer;
    this.phase = "over";
    this.requiredDiscardUse = null;

    const mode = this.options.scoring || "firstOut";
    if (mode === "firstOut") {
      this.roundScores = this.players.map((_, index) =>
        index === outPlayer ? 1 : 0,
      );
      this.winner = outPlayer;
      this.moveHistory.unshift(
        `${this.players[outPlayer].name} wins the round by emptying their hand!`,
      );
      return;
    }

    this.roundScores = this.players.map((_, index) =>
      this.scoreForPlayer(index),
    );
    let best = -Infinity;
    let winner = outPlayer;
    for (let index = 0; index < this.roundScores.length; index++) {
      const score = this.roundScores[index];
      if (score > best || (score === best && index === outPlayer)) {
        best = score;
        winner = index;
      }
    }
    this.winner = winner;
    this.moveHistory.unshift(
      `Round scores: ${this.players
        .map((player, index) => `${player.name} ${this.roundScores[index]}`)
        .join(" · ")}. ${this.players[winner].name} wins the round.`,
    );
  }

  action(action) {
    switch (action.type) {
      case "drawStock":
        return this.drawStock();
      case "drawDiscard":
        return this.drawDiscard(action.index);
      case "meld":
        return this.makeMeld(action.ids || []);
      case "layoff":
        return this.layOff(action.ids || [], action.meldId);
      case "discard":
        return this.discardCard(action.id);
      default:
        return false;
    }
  }

  aiTurn() {
    if (this.over) return false;

    if (this.phase === "draw") {
      const hand = this.hands[this.turn];
      const pickup = window.RummyAI.chooseDiscardTake(
        this.discard,
        hand,
        this.options,
        this.melds,
        this,
      );
      return this.action(
        pickup
          ? { type: "drawDiscard", index: pickup.index }
          : { type: "drawStock" },
      );
    }

    // A pickup that must be added to an existing meld is handled first.
    if (this.requiredDiscardUse?.mode === "layoff") {
      const cardId = this.requiredDiscardUse.cardId;
      const hand = this.hands[this.turn];
      const requiredCard = hand.find((card) =>
        sameCardId(card, { id: cardId }),
      );
      if (requiredCard) {
        for (const meld of this.melds) {
          if (this.canLayOffCards([requiredCard], meld)) {
            if (this.layOff([requiredCard.id], meld.id)) break;
          }
        }
      }
      if (this.requiredDiscardUse) return false;
      if (this.over) return true;
    }

    let changed = true;
    while (changed && !this.over) {
      changed = false;
      const hand = this.hands[this.turn];
      let found = null;

      for (
        let length = Math.min(13, hand.length);
        length >= 3 && !found;
        length--
      ) {
        const seek = (start, chosen) => {
          if (found) return;
          if (chosen.length === length) {
            if (
              (this.isSet(chosen) || this.isRun(chosen)) &&
              (!this.requiredDiscardUse ||
                (this.requiredDiscardUse.mode === "newMeld" &&
                  chosen.some(
                    (card) => card.id === this.requiredDiscardUse.cardId,
                  )))
            ) {
              found = [...chosen];
            }
            return;
          }
          for (
            let i = start;
            i <= hand.length - (length - chosen.length) && !found;
            i++
          ) {
            seek(i + 1, [...chosen, hand[i]]);
          }
        };
        seek(0, []);
      }

      if (found) {
        this.makeMeld(found.map((card) => card.id));
        changed = true;
      }
    }

    if (this.requiredDiscardUse || this.over) return this.over;
    const card = window.RummyAI.chooseDiscard(this.hands[this.turn]);
    return card ? this.discardCard(card.id) : false;
  }
}

let game = new RummyGame(onlineConfig || {});
let selected = new Set();
let selectedMeldId = "";
let aiTimer = null;
let aiPending = false;

function isControlled(player) {
  if (!player || player.type !== "human") return false;
  if (!ONLINE_MODE) return true;

  const controller = String(
    player.controllerClientId || player.participantClientId || "",
  );
  if (controller && controller === String(ONLINE_CLIENT_ID)) return true;

  const me = onlineParticipants.find(
    (participant) =>
      String(participant.clientId || "") === String(ONLINE_CLIENT_ID),
  );
  const profileIds = new Set();
  if (me?.profileId) profileIds.add(String(me.profileId));
  if (Array.isArray(me?.party)) {
    for (const member of me.party) {
      if (member?.id) profileIds.add(String(member.id));
    }
  }
  return Boolean(player.profileId && profileIds.has(String(player.profileId)));
}

function localPartyProfiles() {
  try {
    const ids = JSON.parse(sessionStorage.getItem("gameLibraryParty") || "[]");
    const party = ids
      .map((id) => profiles.find((profile) => profile.id === id))
      .filter(Boolean);
    if (party.length) return party;
  } catch {}
  return profiles;
}

function controlledTurn() {
  return isControlled(game.current());
}

function action(action, remote = false) {
  const ok = game.action(action);
  if (!ok) return false;

  selected.clear();
  selectedMeldId = "";
  if (ONLINE_MODE && !remote) sendMove(action);
  if (game.over) recordWin();
  return true;
}

function sendMove(action) {
  if (onlineSocket?.readyState === WebSocket.OPEN) {
    onlineSocket.send(JSON.stringify({ type: "game:move", payload: action }));
  }
}

function recordWin() {
  if (ONLINE_MODE || localScoreRecorded || !game.over) return;
  const player = game.players[game.winner];
  if (!player?.profileId) return;

  let scores = {};
  try {
    scores = JSON.parse(localStorage.getItem("gameLibraryLocalScores") || "{}");
  } catch {}
  scores[player.profileId] = (Number(scores[player.profileId]) || 0) + 1;
  localStorage.setItem("gameLibraryLocalScores", JSON.stringify(scores));
  localScoreRecorded = true;
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function requiredText() {
  const req = game.requiredDiscardUse;
  if (!req) return "";
  const card = game.hands[game.turn].find(
    (candidate) => candidate.id === req.cardId,
  );
  const label = card?.label || "the required card";
  return req.mode === "newMeld"
    ? `You must use ${label} in a new meld before you can discard or lay off.`
    : `You must add ${label} to an existing meld before you can discard.`;
}

function render() {
  if (game.over) {
    recordWin();
    publishOnlineResult();
  }

  $("variantName").textContent = "Classic Rummy";

  let statusText;
  if (game.over) {
    statusText = `${game.players[game.winner]?.name || "A player"} wins!`;
    if (game.options.scoring !== "firstOut") {
      statusText += ` Scores: ${game.players
        .map((player, index) => `${player.name}: ${game.roundScores[index]}`)
        .join(" · ")}`;
    }
  } else if (game.phase === "draw") {
    statusText = `${game.current().name}'s turn — draw from the stock or choose a discard card.`;
  } else if (game.requiredDiscardUse) {
    statusText = `${game.current().name}'s turn — ${requiredText()}`;
  } else {
    statusText = `${game.current().name}'s turn — meld cards if you can, then discard one.`;
  }
  $("status").textContent = statusText;

  $("playerList").innerHTML = game.players
    .map(
      (player, index) => `
        <div class="player-row ${index === game.turn && !game.over ? "current" : ""}">
          <span class="avatar">${player.avatar || "🃏"}</span>
          <div>
            <div class="player-name">${esc(player.name || `Player ${index + 1}`)}</div>
            <div class="player-sub">${player.type === "computer" ? "Computer" : player.playerType || "Player"} · ${game.hands[index]?.length || 0} cards</div>
          </div>
        </div>`,
    )
    .join("");

  const discardCards = game.discard
    .map(
      (card, index) => `
        <div class="discard-slot ${index === game.discard.length - 1 ? "latest" : ""}" title="Take this card and all newer cards to its right" data-discard-index="${index}">
          ${cardHtml(card, false, true)}
        </div>`,
    )
    .join("");

  $("piles").innerHTML = `
    <div class="pile">
      <div class="zone-label">Stock · ${game.stock.length}</div>
      <button id="stockBtn" class="card back">DRAW<br>STOCK</button>
    </div>
    <div class="pile discard-pile">
      <div class="zone-label">Discard pile · oldest → newest</div>
      <div class="discard-line">${discardCards || '<div class="muted">Empty</div>'}</div>
    </div>`;

  $("stockBtn").onclick = () => {
    if (!controlledTurn()) return;
    const move = { type: "drawStock" };
    if (action(move)) render();
  };

  $("piles")
    .querySelectorAll("[data-discard-index]")
    .forEach((element) => {
      element.onclick = () => {
        if (!controlledTurn()) return;
        const move = {
          type: "drawDiscard",
          index: Number(element.dataset.discardIndex),
        };
        if (action(move)) {
          render();
        } else {
          $("status").textContent =
            "That pickup is not legal: the required first/last discard card cannot be used in a required meld or layoff.";
        }
      };
    });

  const canSeeHand = controlledTurn() && !game.over;
  const hand = canSeeHand ? game.hands[game.turn] : [];
  $("hand").innerHTML = hand
    .map((card) =>
      cardHtml(
        card,
        selected.has(card.id),
        false,
        card.id === game.requiredDiscardUse?.cardId ? "required" : "",
      ),
    )
    .join("");

  $("hand")
    .querySelectorAll("[data-card]")
    .forEach((element) => {
      element.onclick = () => {
        if (!canSeeHand) return;
        const id = element.dataset.card;
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        render();
      };
    });

  $("handTitle").textContent = canSeeHand
    ? `${game.current().name}'s hand`
    : "Current player's hand is hidden";
  $("handHint").textContent = canSeeHand
    ? game.requiredDiscardUse
      ? requiredText()
      : `${hand.length} cards · select cards to meld, lay off, or discard`
    : "Only the player whose turn it is can see their hand.";

  const actions = $("mainActions");
  actions.innerHTML = "";
  const addButton = (label, fn, disabled = false, className = "") => {
    const button = document.createElement("button");
    button.textContent = label;
    button.disabled = disabled;
    button.className = className;
    button.onclick = () => {
      if (fn()) render();
    };
    actions.appendChild(button);
  };

  if (canSeeHand) {
    if (game.phase === "draw") {
      addButton("Draw from stock", () => action({ type: "drawStock" }));
      addButton("Take newest discard", () => action({ type: "drawDiscard" }));
    } else {
      const mustMeld = game.requiredDiscardUse?.mode === "newMeld";
      const mustLayoff = game.requiredDiscardUse?.mode === "layoff";

      addButton(
        "Meld selected",
        () => action({ type: "meld", ids: [...selected] }),
        selected.size < 3 ||
          (mustMeld && !selected.has(game.requiredDiscardUse.cardId)),
        "action-primary",
      );

      if (game.melds.length) {
        addButton(
          "Lay off selected",
          () =>
            action({
              type: "layoff",
              ids: [...selected],
              meldId: selectedMeldId,
            }),
          !selected.size ||
            !selectedMeldId ||
            (mustLayoff && !selected.has(game.requiredDiscardUse.cardId)),
        );
      }

      addButton(
        "Discard selected",
        () => action({ type: "discard", id: [...selected][0] }),
        selected.size !== 1 || Boolean(game.requiredDiscardUse),
        "action-danger",
      );
    }
  }

  $("meldArea").innerHTML = game.melds.length
    ? `
      <div class="zone-label" style="text-align:center;margin-top:12px">Melds on table</div>
      <div class="melds">
        ${game.melds
          .map(
            (meld, index) => `
              <div class="meld ${selectedMeldId === meld.id ? "selected" : ""}" data-meld-id="${meld.id}" title="Click to select this meld for laying off">
                <div class="meld-title">Meld ${index + 1} · ${meld.cards.length} cards</div>
                <div class="meld-cards">${meld.cards.map((card) => cardHtml(card, false, true)).join("")}</div>
              </div>`,
          )
          .join("")}
      </div>`
    : "";

  $("meldArea")
    .querySelectorAll("[data-meld-id]")
    .forEach((element) => {
      element.onclick = () => {
        if (!canSeeHand || game.requiredDiscardUse?.mode === "newMeld") return;
        const id = element.dataset.meldId;
        selectedMeldId = selectedMeldId === id ? "" : id;
        render();
      };
    });

  $("history").innerHTML = game.moveHistory.length
    ? game.moveHistory
        .slice(0, 60)
        .map((entry) => `<div>${esc(entry)}</div>`)
        .join("")
    : '<div class="muted">No moves yet.</div>';

  $("rules").innerHTML = `
    <strong>Classic Rummy</strong><br>
    Draw one card from the stock, or choose a discard card in the line. Taking a discard card also takes every newer card to its right; older cards to its left stay on the table.<br><br>
    A pickup is legal when the first card you take can be used in a new meld, or when the newest card taken can be added to an existing meld. When the newest-card rule is used, that card must be laid off before you can discard. Meld sets (same rank) or runs (same suit).${
      game.options.topToBottomMeld
        ? " Runs may wrap through the top/bottom of the ranks, such as K-A-2."
        : " Aces normally do not wrap from K to A to 2."
    }<br><br>
    Click a table meld to select it, select cards from your hand, then click <strong>Lay off selected</strong> to add them.<br><br>
    <strong>Scoring:</strong> ${
      game.options.scoring === "firstOut"
        ? "first player to empty their hand wins."
        : game.options.scoring === "flatFive"
          ? "melded cards minus hand; number cards are 5 points, face cards 10, aces 15."
          : "melded cards minus hand; number cards use face value, face cards 10, aces 15."
    }`;

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
  ) {
    return;
  }

  aiPending = true;
  aiTimer = setTimeout(() => {
    aiPending = false;
    const ok = game.aiTurn();
    if (ok) render();
  }, 500);
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
  if (onlineSocket?.readyState === WebSocket.OPEN && ONLINE_HOST_TOKEN) {
    onlineSocket.send(
      JSON.stringify({
        type: "game:state",
        state: {
          game: game.snapshot(),
          variant: "classic",
        },
      }),
    );
  }
}

function publishOnlineResult() {
  if (
    !ONLINE_MODE ||
    !ONLINE_HOST_TOKEN ||
    onlineResultSent ||
    !game.over ||
    onlineSocket?.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  const winner = game.players[game.winner];
  const winnerClientId =
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

function setOnline(text) {
  $("onlineBar").textContent = text;
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
    const party = localPartyProfiles();
    const profile = party[0] || {};
    onlineSocket.send(
      JSON.stringify({
        type: "player:identify",
        profileId: profile.id || "",
        name: profile.name || "Player 1",
        avatar: profile.avatar || "♟",
        party: party.map((player) => ({
          id: player.id,
          name: player.name || "Player",
          avatar: player.avatar || "♟",
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

  onlineSocket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "room:participants") {
      onlineParticipants = message.participants || [];
      return;
    }

    if (message.type === "room:config") {
      onlineConfig = message.config || onlineConfig;
      return;
    }

    if (message.type === "game:start") {
      onlineMatchId = message.matchId || "";
      onlineResultSent = false;
      localScoreRecorded = false;
      onlineConfig = message.config || onlineConfig;
      game = new RummyGame(onlineConfig || {});
      selected.clear();
      selectedMeldId = "";
      render();
      if (ONLINE_HOST_TOKEN) setTimeout(publishState, 80);
      return;
    }

    if (message.type === "game:state" && message.state?.game) {
      game.restore(message.state.game);
      selected.clear();
      selectedMeldId = "";
      render();
      return;
    }

    if (
      message.type === "game:move" &&
      message.sender?.clientId !== ONLINE_CLIENT_ID
    ) {
      if (action(message.payload, true)) render();
      return;
    }

    if (message.type === "game:back") {
      location.href = "../index.html";
    }
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
  } else {
    location.href = "../index.html";
  }
}

$("newGameBtn").onclick = back;
$("clearBtn").onclick = () => {
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  game = new RummyGame(onlineConfig || {});
  selected.clear();
  selectedMeldId = "";
  localScoreRecorded = false;
  render();
};
$("undoBtn").onclick = () => {
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  if (game.undo()) {
    selected.clear();
    selectedMeldId = "";
    localScoreRecorded = false;
    render();
  }
};

$("onlineBar").textContent = ONLINE_MODE
  ? "Connecting…"
  : "Offline / local game";
render();
connectOnline();
