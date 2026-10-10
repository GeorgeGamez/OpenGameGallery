(function () {
  "use strict";

  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  let launchConfig = {};
  try {
    const raw = params.get("onlineConfig") || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("gameLibraryOnlineConfig")) || "";
    if (raw) launchConfig = JSON.parse(raw);
  } catch {}
  const profiles = (() => {
    try { return JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]"); }
    catch { return []; }
  })();
  const copy = value => JSON.parse(JSON.stringify(value));
  const SUITS = ["♣", "♦", "♥", "♠"];
  const SUIT_ORDER = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };
  const OPENING_CARD_ID = "3-♣";

  function rankLabel(rank) {
    return ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" })[rank] || String(rank);
  }
  function buildDeck() {
    const deck = [];
    for (let rank = 3; rank <= 15; rank++) {
      for (const suit of SUITS) deck.push({ id: `${rank}-${suit}`, rank, suit });
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  function sortHand(hand) {
    hand.sort((a, b) => a.rank - b.rank || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
  }
  function suitCard(card) { return `${rankLabel(card.rank)}${card.suit}`; }
  function placeName(index, total) {
    if (index === 0) return "President";
    if (index === total - 1) return "Scum";
    if (index === 1 && total >= 4) return "Vice-President";
    if (index === total - 2 && total >= 5) return "Vice-Scum";
    return `Place ${index + 1}`;
  }

  class PresidentGame {
    constructor(config = {}) { this.config = config; this.history = []; this.reset(config.players || []); }

    reset(sourcePlayers = []) {
      const fallback = [
        { type: "human", name: profiles[0]?.name || "Player 1", avatar: profiles[0]?.avatar || "♟", profileId: profiles[0]?.id || "" },
        { type: "computer", name: "Computer 1", avatar: "🤖", difficulty: "normal" },
        { type: "computer", name: "Computer 2", avatar: "🤖", difficulty: "normal" },
        { type: "computer", name: "Computer 3", avatar: "🤖", difficulty: "normal" },
      ];
      const requested = sourcePlayers.length ? sourcePlayers : fallback;
      this.players = requested.slice(0, 8).map((p, i) => ({
        ...p,
        type: p.type === "computer" ? "computer" : "human",
        name: p.name || `Player ${i + 1}`,
        avatar: p.avatar || (p.type === "computer" ? "🤖" : "🃏"),
        seat: i,
      }));
      if (this.players.length < 3) {
        for (let i = this.players.length; i < 3; i++) this.players.push({ type: "computer", name: `Computer ${i}`, avatar: "🤖", difficulty: "normal", seat: i });
      }
      this.hands = this.players.map(() => []);
      const deck = buildDeck();
      let cursor = 0;
      while (deck.length) this.hands[cursor++ % this.players.length].push(deck.pop());
      this.hands.forEach(sortHand);
      this.turn = this.hands.findIndex(hand => hand.some(card => card.id === OPENING_CARD_ID));
      if (this.turn < 0) this.turn = 0;
      this.currentPlay = null;
      this.lastPlayer = -1;
      this.passes = new Set();
      this.openingPending = true;
      this.moveHistory = [];
      this.finishOrder = [];
      this.over = false;
      this.winner = -1;
      this.history = [];
    }

    current() { return this.players[this.turn]; }
    alivePlayers() { return this.players.map((p, i) => i).filter(i => this.hands[i]?.length > 0); }
    canPass(playerIndex = this.turn) { return Boolean(this.currentPlay && playerIndex !== this.currentPlay.player && !this.passes.has(playerIndex) && this.hands[playerIndex]?.length); }

    snapshot() {
      return {
        players: this.players, hands: this.hands, turn: this.turn, currentPlay: this.currentPlay,
        lastPlayer: this.lastPlayer, passes: [...this.passes], openingPending: this.openingPending,
        moveHistory: this.moveHistory, finishOrder: this.finishOrder, over: this.over, winner: this.winner,
      };
    }
    restore(snapshot) {
      const s = copy(snapshot);
      Object.assign(this, s);
      this.passes = new Set(s.passes || []);
    }
    save() { this.history.push(this.snapshot()); }
    undo() {
      if (!this.history.length) return false;
      const previous = this.history.pop();
      this.restore(previous);
      return true;
    }

    legalPlays(playerIndex = this.turn) {
      if (this.over || !this.hands[playerIndex]?.length || this.passes.has(playerIndex)) return [];
      if (this.currentPlay && this.currentPlay.player === playerIndex) return [];
      const hand = this.hands[playerIndex];
      const byRank = new Map();
      for (const card of hand) {
        if (!byRank.has(card.rank)) byRank.set(card.rank, []);
        byRank.get(card.rank).push(card);
      }
      const result = [];
      for (const [rank, cards] of byRank) {
        if (this.currentPlay) {
          if (cards.length < this.currentPlay.cards.length || rank <= this.currentPlay.rank) continue;
          const need = this.currentPlay.cards.length;
          const combos = combinations(cards, need);
          for (const group of combos) result.push({ rank, cardIds: group.map(c => c.id) });
        } else {
          for (let size = 1; size <= Math.min(4, cards.length); size++) {
            for (const group of combinations(cards, size)) result.push({ rank, cardIds: group.map(c => c.id) });
          }
        }
      }
      return result.filter(move => {
        if (this.openingPending) return move.cardIds.includes(OPENING_CARD_ID);
        return true;
      }).sort((a, b) => a.rank - b.rank || a.cardIds.length - b.cardIds.length);
    }

    play(cardIds) {
      if (this.over || !Array.isArray(cardIds) || !cardIds.length) return false;
      const ids = [...new Set(cardIds.map(String))];
      if (ids.length !== cardIds.length) return false;
      const candidate = this.legalPlays(this.turn).find(move => move.cardIds.length === ids.length && move.cardIds.every(id => ids.includes(id)));
      if (!candidate) return false;
      const hand = this.hands[this.turn];
      const cards = ids.map(id => hand.find(card => card.id === id));
      if (cards.some(card => !card)) return false;

      this.save();
      const playerIndex = this.turn;
      this.hands[playerIndex] = hand.filter(card => !ids.includes(card.id));
      this.currentPlay = { player: playerIndex, cards: cards.map(card => ({ ...card })), rank: cards[0].rank };
      this.lastPlayer = playerIndex;
      this.moveHistory.push({ player: playerIndex, name: this.players[playerIndex].name, type: "play", cards: cards.map(suitCard), rank: cards[0].rank });
      this.openingPending = false;
      sortHand(this.hands[playerIndex]);
      if (this.hands[playerIndex].length === 0 && !this.finishOrder.includes(playerIndex)) this.finishOrder.push(playerIndex);
      this.finishIfDone();
      if (!this.over) this.advanceAfterPlay();
      return true;
    }

    pass() {
      if (this.over || !this.canPass(this.turn)) return false;
      this.save();
      const playerIndex = this.turn;
      this.passes.add(playerIndex);
      this.moveHistory.push({ player: playerIndex, name: this.players[playerIndex].name, type: "pass", cards: [] });
      if (!this.hasResponder()) this.clearTrick();
      else this.turn = this.findEligible(this.turn + 1);
      this.finishIfDone();
      return true;
    }

    hasResponder() {
      if (!this.currentPlay) return false;
      return this.alivePlayers().some(i => i !== this.currentPlay.player && !this.passes.has(i));
    }

    advanceAfterPlay() {
      if (!this.hasResponder()) { this.clearTrick(); return; }
      const next = this.findEligible(this.turn + 1);
      if (next >= 0) this.turn = next;
      else this.clearTrick();
    }

    findEligible(start) {
      for (let step = 0; step < this.players.length; step++) {
        const i = (start + step + this.players.length) % this.players.length;
        if (!this.hands[i]?.length || this.passes.has(i)) continue;
        if (this.currentPlay && i === this.currentPlay.player) continue;
        return i;
      }
      return -1;
    }

    clearTrick() {
      const previousLeader = this.lastPlayer;
      this.currentPlay = null;
      this.passes = new Set();
      if (previousLeader >= 0 && this.hands[previousLeader]?.length) {
        this.turn = previousLeader;
      } else {
        let next = -1;
        for (let step = 1; step <= this.players.length; step++) {
          const i = (Math.max(0, previousLeader) + step) % this.players.length;
          if (this.hands[i]?.length) { next = i; break; }
        }
        if (next >= 0) this.turn = next;
      }
    }

    finishIfDone() {
      const alive = this.alivePlayers();
      if (alive.length > 1) return;
      if (alive.length === 1 && !this.finishOrder.includes(alive[0])) this.finishOrder.push(alive[0]);
      for (let i = 0; i < this.players.length; i++) if (!this.finishOrder.includes(i)) this.finishOrder.push(i);
      this.over = true;
      this.winner = this.finishOrder[0] ?? -1;
    }

    isValidSelection(ids, playerIndex = this.turn) {
      const list = this.legalPlays(playerIndex);
      return list.some(move => move.cardIds.length === ids.length && move.cardIds.every(id => ids.includes(id)));
    }
  }

  function combinations(items, size) {
    const output = [];
    function walk(start, chosen) {
      if (chosen.length === size) { output.push(chosen.slice()); return; }
      for (let i = start; i <= items.length - (size - chosen.length); i++) {
        chosen.push(items[i]); walk(i + 1, chosen); chosen.pop();
      }
    }
    walk(0, []);
    return output;
  }

  // Expose the game class for deterministic rules tests and AI integration.
  if (typeof window !== "undefined") window.PresidentGame = PresidentGame;
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  let game = new PresidentGame(launchConfig);
  let selected = new Set();
  let aiTimer = null;

  function esc(value) {
    return String(value ?? "").replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }
  function cardInner(card) {
    const r = rankLabel(card.rank), red = ["♥", "♦"].includes(card.suit);
    return `<span class="corner"><span>${r}</span><span class="corner-suit">${card.suit}</span></span><span class="face"><span class="center-rank">${r}</span><span class="center-suit">${card.suit}</span></span><span class="bottom"><span>${r}</span><span class="corner-suit">${card.suit}</span></span>`;
  }
  function cardHtml(card, isSelected = false, mini = false, table = false) {
    const red = ["♥", "♦"].includes(card.suit);
    return `<div class="card ${red ? "red" : "black"} ${isSelected ? "selected" : ""} ${mini ? "mini" : ""} ${table ? "table-card" : ""}" data-card-id="${esc(card.id)}">${cardInner(card)}</div>`;
  }
  function isHumanTurn() { return !game.over && game.current()?.type === "human"; }
  function setStatus(text) { $("status").textContent = text; }

  function renderPlayers() {
    $("playerList").innerHTML = game.players.map((player, index) => {
      const place = game.finishOrder.indexOf(index);
      const placeText = place >= 0 ? placeName(place, game.players.length) : "";
      const type = player.type === "computer" ? `Computer · ${player.difficulty || "normal"}` : "Local player";
      return `<div class="player-row ${index === game.turn && !game.over ? "current" : ""}"><span class="avatar">${esc(player.avatar || "🃏")}</span><div><div class="player-name">${esc(player.name)}</div><div class="player-sub">${type} · ${game.hands[index].length} card${game.hands[index].length === 1 ? "" : "s"}</div></div>${placeText ? `<span class="place">${esc(placeText)}</span>` : ""}</div>`;
    }).join("");
  }

  function render() {
    if (!game) return;
    renderPlayers();
    $("trickCaption").textContent = game.over ? "Round complete" : game.currentPlay ? `${game.players[game.currentPlay.player].name} played ${game.currentPlay.cards.length} card${game.currentPlay.cards.length === 1 ? "" : "s"} · rank ${rankLabel(game.currentPlay.rank)}` : game.openingPending ? "The player with 3♣ starts; the opening play must include 3♣." : `${game.players[game.turn].name} leads the next trick.`;
    $("tableCards").innerHTML = game.currentPlay ? game.currentPlay.cards.map(card => cardHtml(card, false, true, true)).join("") : '<div class="muted">No active play · lead any rank</div>';
    $("trickMeta").innerHTML = game.currentPlay ? `<span class="pill">${game.currentPlay.cards.length} card${game.currentPlay.cards.length === 1 ? "" : "s"}</span><span class="pill">${game.passes.size} passed</span>` : "";

    const humanTurn = isHumanTurn();
    const hand = humanTurn ? game.hands[game.turn] : [];
    $("handTitle").textContent = humanTurn ? `${game.current().name}'s hand` : game.over ? "Round complete" : `${game.current().name}'s turn`;
    $("hand").innerHTML = hand.length ? hand.map(card => cardHtml(card, selected.has(card.id))).join("") : game.over ? '<div class="muted">All hands have been ranked.</div>' : '<div class="muted">Computer hand hidden while it thinks.</div>';
    $("hand").querySelectorAll("[data-card-id]").forEach(element => {
      element.onclick = () => {
        if (!isHumanTurn()) return;
        const id = element.dataset.cardId;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        render();
      };
    });
    const selectionLegal = humanTurn && selected.size > 0 && game.isValidSelection([...selected]);
    $("playBtn").disabled = !selectionLegal;
    $("passBtn").disabled = !humanTurn || !game.canPass();
    $("clearBtn").disabled = !humanTurn || selected.size === 0;
    $("undoBtn").disabled = game.history.length === 0;

    if (game.over) {
      const rankings = game.finishOrder.map((playerIndex, place) => `${placeName(place, game.players.length)}: ${game.players[playerIndex].name}`).join(" · ");
      setStatus(`Round complete. ${game.players[game.winner]?.name || "A player"} is President. ${rankings}`);
    } else if (game.current()?.type === "computer") {
      setStatus(`${game.current().name} is thinking…`);
    } else if (game.openingPending) {
      setStatus(`${game.current().name}'s turn. Your first play must include 3♣; you may play other 3s with it.`);
    } else if (game.currentPlay) {
      setStatus(`${game.current().name}'s turn. Beat ${game.currentPlay.cards.length} card${game.currentPlay.cards.length === 1 ? "" : "s"} of rank ${rankLabel(game.currentPlay.rank)} with the same number of higher-ranked cards, or pass.`);
    } else {
      setStatus(`${game.current().name}'s turn to lead. Play one to four cards of the same rank.`);
    }

    $("history").innerHTML = game.moveHistory.slice(-80).reverse().map(move => {
      const content = move.type === "pass" ? "passed" : `played ${move.cards.join(" ")}`;
      return `<div><strong>${esc(move.name)}</strong> ${content}</div>`;
    }).join("") || '<div class="muted">Moves will appear here.</div>';
    if (humanTurn && selected.size) {
      const chosen = [...selected].map(id => game.hands[game.turn].find(card => card.id === id)).filter(Boolean);
      $("handHint").textContent = selectionLegal ? `Ready to play: ${chosen.map(suitCard).join(" ")}` : "Choose one to four cards of the same rank that legally beat the current play.";
    } else {
      $("handHint").textContent = humanTurn ? `${game.hands[game.turn].length} cards · select a matching set, then press Play Selected Cards.` : game.over ? "Start a new game to play again." : "The current player's hand is hidden.";
    }
    scheduleAI();
  }

  function apply(action) {
    if (!action || game.over || !isHumanTurn()) return false;
    let ok = false;
    if (action.type === "play") ok = game.play(action.cardIds);
    else if (action.type === "pass") ok = game.pass();
    if (ok) { selected.clear(); render(); }
    return ok;
  }

  function scheduleAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    if (game.over || game.current()?.type !== "computer") return;
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (game.over || game.current()?.type !== "computer") return;
      const action = window.PresidentAI?.chooseAction(game, game.turn);
      if (!action) { setStatus("Computer could not find a move; start a new game or undo."); return; }
      const ok = action.type === "play" ? game.play(action.cardIds) : action.type === "pass" ? game.pass() : false;
      if (!ok) { setStatus("Computer produced an invalid move. Please undo or start a new game."); return; }
      selected.clear();
      render();
    }, 500);
  }

  $("playBtn").onclick = () => apply({ type: "play", cardIds: [...selected] });
  $("passBtn").onclick = () => apply({ type: "pass" });
  $("clearBtn").onclick = () => { selected.clear(); render(); };
  $("newGameBtn").onclick = () => { if (aiTimer !== null) clearTimeout(aiTimer); game = new PresidentGame(launchConfig); selected.clear(); render(); };
  $("undoBtn").onclick = () => { if (aiTimer !== null) clearTimeout(aiTimer); if (game.undo()) { selected.clear(); render(); } };
  $("backBtn").onclick = () => { location.href = "../index.html"; };

  render();
})();
