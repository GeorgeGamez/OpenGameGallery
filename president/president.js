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
    return ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "Joker" })[rank] || String(rank);
  }
  function buildDeck(includeJokers = false) {
    const deck = [];
    for (let rank = 3; rank <= 15; rank++) {
      for (const suit of SUITS) deck.push({ id: `${rank}-${suit}`, rank, suit });
    }
    if (includeJokers) {
      deck.push({ id: "joker-red", rank: 16, suit: null, joker: true, jokerColor: "red" });
      deck.push({ id: "joker-black", rank: 16, suit: null, joker: true, jokerColor: "black" });
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  function sortHand(hand) {
    hand.sort((a, b) => a.rank - b.rank || (SUIT_ORDER[a.suit] ?? 4) - (SUIT_ORDER[b.suit] ?? 4));
  }
  function suitCard(card) { return card.joker ? "Joker" : `${rankLabel(card.rank)}${card.suit}`; }
  function placeName(index, total) {
    if (index === 0) return "President";
    if (index === total - 1) return "Scum";
    if (total === 3) return "Person";
    if (index === 1) return "Vice President";
    if (total === 4 && index === 2) return "High Scum";
    if (total >= 5 && index === total - 2) return "High Scum";
    return "Person";
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
        for (let i = this.players.length; i < 3; i++) this.players.push({ type: "computer", name: `Computer ${i + 1}`, avatar: "🤖", difficulty: "normal", seat: i });
      }
      this.roundNumber = 1;
      this.previousFinishOrder = [];
      this.phase = "playing";
      this.exchangeTasks = [];
      this.exchangeTaskIndex = 0;
      this.exchangeSubmissions = {};
      this.dealHands();
      this.startPlayPhase();
      this.moveHistory = [];
      this.finishOrder = [];
      this.over = false;
      this.winner = -1;
      this.history = [];
    }

    dealHands() {
      this.hands = this.players.map(() => []);
      // Variation changes affect the next deal, not cards already dealt into the current round.
      this.roundUsesJokers = this.config.jokers === true;
      const deck = buildDeck(this.roundUsesJokers);
      let cursor = 0;
      while (deck.length) this.hands[cursor++ % this.players.length].push(deck.pop());
      this.hands.forEach(sortHand);
    }

    startPlayPhase() {
      this.phase = "playing";
      this.currentPlay = null;
      this.lastPlayer = -1;
      this.passes = new Set();
      this.openingPending = true;
      this.exchangeTasks = [];
      this.exchangeTaskIndex = 0;
      this.exchangeSubmissions = {};
      this.turn = this.hands.findIndex(hand => hand.some(card => card.id === OPENING_CARD_ID));
      if (this.turn < 0) this.turn = 0;
    }

    startNextRound() {
      if (!this.over || !this.finishOrder.length) return false;
      this.previousFinishOrder = this.finishOrder.slice();
      this.roundNumber += 1;
      this.dealHands();
      this.currentPlay = null;
      this.lastPlayer = -1;
      this.passes = new Set();
      this.openingPending = true;
      this.moveHistory = [];
      this.finishOrder = [];
      this.over = false;
      this.winner = -1;
      this.history = [];
      this.phase = "exchange";
      this.exchangeTasks = [];
      this.exchangeTaskIndex = 0;
      this.exchangeSubmissions = {};

      const ranking = this.previousFinishOrder;
      const total = this.players.length;
      const president = ranking[0];
      const scum = ranking[total - 1];
      const majorCount = total >= 4 ? 2 : 1;
      this.exchangeTasks.push({ player: president, count: majorCount, kind: "low", partner: scum, pairId: "president-scum", title: "President" });
      this.exchangeTasks.push({ player: scum, count: majorCount, kind: "high", partner: president, pairId: "president-scum", title: "Scum" });
      if (total >= 4) {
        const vicePresident = ranking[1];
        const highScum = ranking[total - 2];
        this.exchangeTasks.push({ player: vicePresident, count: 1, kind: "low", partner: highScum, pairId: "vice-highscum", title: "Vice President" });
        this.exchangeTasks.push({ player: highScum, count: 1, kind: "high", partner: vicePresident, pairId: "vice-highscum", title: "High Scum" });
      }
      if (!this.exchangeTasks.length) this.startPlayPhase();
      return true;
    }

    currentExchangeTask() {
      return this.phase === "exchange" ? this.exchangeTasks[this.exchangeTaskIndex] || null : null;
    }

    submitExchange(cardIds) {
      const task = this.currentExchangeTask();
      if (!task || this.over || !Array.isArray(cardIds)) return false;
      const ids = [...new Set(cardIds.map(String))];
      if (ids.length !== task.count || ids.length !== cardIds.length) return false;
      const hand = this.hands[task.player] || [];
      const cards = ids.map(id => hand.find(card => card.id === id));
      if (cards.some(card => !card)) return false;
      this.exchangeSubmissions[this.exchangeTaskIndex] = cards.map(card => ({ ...card }));

      const completedTaskIndex = this.exchangeTaskIndex;
      const pairTaskIndexes = this.exchangeTasks.map((candidate, index) => candidate.pairId === task.pairId ? index : -1).filter(index => index >= 0);
      if (pairTaskIndexes.every(index => this.exchangeSubmissions[index])) {
        const firstIndex = pairTaskIndexes[0], secondIndex = pairTaskIndexes[1];
        const firstTask = this.exchangeTasks[firstIndex], secondTask = this.exchangeTasks[secondIndex];
        const firstCards = this.exchangeSubmissions[firstIndex];
        const secondCards = this.exchangeSubmissions[secondIndex];
        const firstIds = new Set(firstCards.map(card => card.id));
        const secondIds = new Set(secondCards.map(card => card.id));
        this.hands[firstTask.player] = this.hands[firstTask.player].filter(card => !firstIds.has(card.id));
        this.hands[secondTask.player] = this.hands[secondTask.player].filter(card => !secondIds.has(card.id));
        this.hands[firstTask.player].push(...secondCards.map(card => ({ ...card })));
        this.hands[secondTask.player].push(...firstCards.map(card => ({ ...card })));
        sortHand(this.hands[firstTask.player]);
        sortHand(this.hands[secondTask.player]);
        this.moveHistory.push({ player: firstTask.player, name: this.players[firstTask.player].name, type: "exchange", cards: firstCards.map(suitCard), target: this.players[secondTask.player].name });
        this.moveHistory.push({ player: secondTask.player, name: this.players[secondTask.player].name, type: "exchange", cards: secondCards.map(suitCard), target: this.players[firstTask.player].name });
      }
      this.exchangeTaskIndex = completedTaskIndex + 1;
      if (this.exchangeTaskIndex >= this.exchangeTasks.length) this.startPlayPhase();
      return true;
    }

    current() { return this.players[this.turn]; }
    alivePlayers() { return this.players.map((p, i) => i).filter(i => this.hands[i]?.length > 0); }
    canPass(playerIndex = this.turn) { return Boolean(this.currentPlay && playerIndex !== this.currentPlay.player && !this.passes.has(playerIndex) && this.hands[playerIndex]?.length); }

    snapshot() {
      return {
        players: this.players, hands: this.hands, turn: this.turn, currentPlay: this.currentPlay,
        lastPlayer: this.lastPlayer, passes: [...this.passes], openingPending: this.openingPending,
        moveHistory: this.moveHistory, finishOrder: this.finishOrder, over: this.over, winner: this.winner,
        phase: this.phase, exchangeTasks: this.exchangeTasks, exchangeTaskIndex: this.exchangeTaskIndex,
        exchangeSubmissions: this.exchangeSubmissions, roundNumber: this.roundNumber, previousFinishOrder: this.previousFinishOrder,
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
      const clearsOnEight = this.config.eightClearsPile === true && cards[0].rank === 8;
      this.currentPlay = { player: playerIndex, cards: cards.map(card => ({ ...card })), rank: cards[0].rank };
      this.lastPlayer = playerIndex;
      this.moveHistory.push({ player: playerIndex, name: this.players[playerIndex].name, type: "play", cards: cards.map(suitCard), rank: cards[0].rank });
      this.openingPending = false;
      sortHand(this.hands[playerIndex]);
      if (this.hands[playerIndex].length === 0 && !this.finishOrder.includes(playerIndex)) this.finishOrder.push(playerIndex);
      this.finishIfDone();
      if (!this.over) {
        if (clearsOnEight) {
          this.moveHistory.push({ player: playerIndex, name: this.players[playerIndex].name, type: "clear", cards: cards.map(suitCard) });
          this.clearTrick();
        } else this.advanceAfterPlay();
      }
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
    if (card.joker) {
      return `<span class="corner"><span>JOKER</span><span class="corner-suit">★</span></span><span class="face"><span class="center-rank">🃏</span><span class="center-suit">JOKER</span></span><span class="bottom"><span>JOKER</span><span class="corner-suit">★</span></span>`;
    }
    const r = rankLabel(card.rank);
    return `<span class="corner"><span>${r}</span><span class="corner-suit">${card.suit}</span></span><span class="face"><span class="center-rank">${r}</span><span class="center-suit">${card.suit}</span></span><span class="bottom"><span>${r}</span><span class="corner-suit">${card.suit}</span></span>`;
  }
  function cardHtml(card, isSelected = false, mini = false, table = false) {
    const red = card.joker ? card.jokerColor === "red" : ["♥", "♦"].includes(card.suit);
    return `<div class="card ${red ? "red" : "black"} ${card.joker ? "joker" : ""} ${isSelected ? "selected" : ""} ${mini ? "mini" : ""} ${table ? "table-card" : ""}" data-card-id="${esc(card.id)}">${cardInner(card)}</div>`;
  }
  function activePlayerIndex() {
    const task = game.currentExchangeTask();
    return game.phase === "exchange" && task ? task.player : game.turn;
  }
  function activePlayer() { return game.players[activePlayerIndex()]; }
  function isHumanTurn() {
    if (game.over) return false;
    if (game.phase === "exchange") return activePlayer()?.type === "human";
    return game.current()?.type === "human";
  }
  function setStatus(text) { $("status").textContent = text; }

  function renderPlayers() {
    $("playerList").innerHTML = game.players.map((player, index) => {
      let place = game.finishOrder.indexOf(index);
      if (game.phase === "exchange") place = game.previousFinishOrder.indexOf(index);
      const placeText = place >= 0 ? placeName(place, game.players.length) : "";
      const type = player.type === "computer" ? `Computer · ${player.difficulty || "normal"}` : "Local player";
      return `<div class="player-row ${index === activePlayerIndex() && !game.over ? "current" : ""}"><span class="avatar">${esc(player.avatar || "🃏")}</span><div><div class="player-name">${esc(player.name)}</div><div class="player-sub">${type} · ${game.hands[index].length} card${game.hands[index].length === 1 ? "" : "s"}</div></div>${placeText ? `<span class="place">${esc(placeText)}</span>` : ""}</div>`;
    }).join("");
  }

  function render() {
    if (!game) return;
    renderPlayers();
    const task = game.currentExchangeTask();
    const currentPlayer = activePlayer();
    const currentPlayerName = currentPlayer?.name || "Player";
    $("gameName").textContent = `President · Round ${game.roundNumber}`;
    $("variantName").textContent = `Classic President · 3 is low, 2 is high${game.roundUsesJokers ? ", Jokers are highest" : ""}`;
    if (game.phase === "exchange") {
      $("trickCaption").textContent = `Card exchange before Round ${game.roundNumber}`;
      $("tableCards").innerHTML = '<div class="muted">Cards are exchanged by the previous round’s finishing positions.</div>';
      $("trickMeta").innerHTML = `<span class="pill">${game.exchangeTaskIndex + 1} of ${game.exchangeTasks.length} exchanges</span>`;
    } else {
      $("trickCaption").textContent = game.over ? "Round complete" : game.currentPlay ? `${game.players[game.currentPlay.player].name} played ${game.currentPlay.cards.length} card${game.currentPlay.cards.length === 1 ? "" : "s"} · rank ${rankLabel(game.currentPlay.rank)}` : game.openingPending ? "The player with 3♣ starts; the opening play must include 3♣." : `${game.players[game.turn].name} leads the next trick.`;
      $("tableCards").innerHTML = game.currentPlay ? game.currentPlay.cards.map(card => cardHtml(card, false, true, true)).join("") : '<div class="muted">No active play · lead any rank</div>';
      $("trickMeta").innerHTML = game.currentPlay ? `<span class="pill">${game.currentPlay.cards.length} card${game.currentPlay.cards.length === 1 ? "" : "s"}</span><span class="pill">${game.passes.size} passed</span>` : "";
    }

    const humanTurn = isHumanTurn();
    const activeIndex = activePlayerIndex();
    const hand = humanTurn ? game.hands[activeIndex] : [];
    $("handTitle").textContent = game.phase === "exchange"
      ? (humanTurn ? `${currentPlayerName}'s hand · card exchange` : `${currentPlayerName}'s exchange`)
      : humanTurn ? `${currentPlayerName}'s hand` : game.over ? "Round complete" : `${currentPlayerName}'s turn`;
    $("hand").innerHTML = hand.length ? hand.map(card => cardHtml(card, selected.has(card.id))).join("") : game.over && game.phase !== "exchange" ? '<div class="muted">All hands have been ranked.</div>' : '<div class="muted">Computer hand hidden while it thinks.</div>';
    $("hand").querySelectorAll("[data-card-id]").forEach(element => {
      element.onclick = () => {
        if (!isHumanTurn()) return;
        const id = element.dataset.cardId;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        render();
      };
    });
    const selectionLegal = game.phase === "exchange"
      ? Boolean(humanTurn && task && selected.size === task.count && [...selected].every(id => game.hands[activeIndex].some(card => card.id === id)))
      : Boolean(humanTurn && selected.size > 0 && game.isValidSelection([...selected]));
    $("playBtn").textContent = game.phase === "exchange" ? "Confirm Card Swap" : "Play Selected Cards";
    $("playBtn").disabled = !selectionLegal;
    $("passBtn").disabled = game.phase === "exchange" || !humanTurn || !game.canPass();
    $("clearBtn").disabled = !humanTurn || selected.size === 0;
    $("undoBtn").disabled = game.history.length === 0 || game.phase === "exchange";
    $("nextRoundBtn").disabled = !game.over;
    $("newGameBtn").textContent = "New Game";

    if (game.phase === "exchange" && task) {
      const label = task.kind === "low" ? "low" : "high";
      if (currentPlayer?.type === "computer") {
        setStatus(`${currentPlayerName} (${task.title}) is choosing ${task.count} ${label} card${task.count === 1 ? "" : "s"} to exchange with ${game.players[task.partner].name}…`);
      } else {
        setStatus(`${currentPlayerName} (${task.title}): choose ${task.count} ${label} card${task.count === 1 ? "" : "s"} to give to ${game.players[task.partner].name}, then confirm. Previous standings determine who exchanges; AI players choose automatically.`);
      }
    } else if (game.over) {
      const rankings = game.finishOrder.map((playerIndex, place) => `${placeName(place, game.players.length)}: ${game.players[playerIndex].name}`).join(" · ");
      setStatus(`Round ${game.roundNumber} complete. ${game.players[game.winner]?.name || "A player"} is President. ${rankings} Click Next Round to deal again and exchange cards based on these standings.`);
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
      const content = move.type === "pass" ? "passed"
        : move.type === "clear" ? `cleared the pile with ${move.cards.join(" ")}`
        : move.type === "exchange" ? `exchanged ${move.cards.join(" ")} with ${esc(move.target)}`
        : `played ${move.cards.join(" ")}`;
      return `<div><strong>${esc(move.name)}</strong> ${content}</div>`;
    }).join("") || '<div class="muted">Moves will appear here.</div>';
    if (game.phase === "exchange" && humanTurn && task) {
      const chosen = [...selected].map(id => game.hands[activeIndex].find(card => card.id === id)).filter(Boolean);
      $("handHint").textContent = selectionLegal
        ? `Ready to exchange: ${chosen.map(suitCard).join(" ")}`
        : `Select exactly ${task.count} ${task.kind} card${task.count === 1 ? "" : "s"}.`;
    } else if (humanTurn && selected.size) {
      const chosen = [...selected].map(id => game.hands[activeIndex].find(card => card.id === id)).filter(Boolean);
      $("handHint").textContent = selectionLegal ? `Ready to play: ${chosen.map(suitCard).join(" ")}` : "Choose one to four cards of the same rank that legally beat the current play.";
    } else {
      $("handHint").textContent = humanTurn ? `${game.hands[activeIndex].length} cards · select a matching set, then press Play Selected Cards.` : game.over ? "Start the next round or start a new game." : "The current player's hand is hidden.";
    }
    scheduleAI();
  }

  function apply(action) {
    if (!action || game.over) return false;
    let ok = false;
    if (game.phase === "exchange" && action.type === "exchange") ok = game.submitExchange(action.cardIds);
    else if (game.phase !== "exchange" && !isHumanTurn()) return false;
    else if (action.type === "play") ok = game.play(action.cardIds);
    else if (action.type === "pass") ok = game.pass();
    if (ok) { selected.clear(); render(); }
    return ok;
  }

  function scheduleAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    if (game.over) return;
    const task = game.currentExchangeTask();
    const activeIndex = game.phase === "exchange" && task ? task.player : game.turn;
    if (game.players[activeIndex]?.type !== "computer") return;
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (game.over) return;
      if (game.phase === "exchange") {
        const currentTask = game.currentExchangeTask();
        if (!currentTask || game.players[currentTask.player]?.type !== "computer") return;
        const action = window.PresidentAI?.chooseExchange(game, currentTask);
        if (!action || action.type !== "exchange" || !game.submitExchange(action.cardIds)) {
          setStatus("Computer could not complete the card exchange. Please start a new game.");
          return;
        }
      } else {
        if (game.current()?.type !== "computer") return;
        const action = window.PresidentAI?.chooseAction(game, game.turn);
        if (!action) { setStatus("Computer could not find a move; start a new game or undo."); return; }
        const ok = action.type === "play" ? game.play(action.cardIds) : action.type === "pass" ? game.pass() : false;
        if (!ok) { setStatus("Computer produced an invalid move. Please undo or start a new game."); return; }
      }
      selected.clear();
      render();
    }, 500);
  }

  $("playBtn").onclick = () => apply({ type: game.phase === "exchange" ? "exchange" : "play", cardIds: [...selected] });
  $("passBtn").onclick = () => apply({ type: "pass" });
  $("clearBtn").onclick = () => { selected.clear(); render(); };
  $("newGameBtn").onclick = () => {
    if (aiTimer !== null) clearTimeout(aiTimer);
    game = new PresidentGame({ ...launchConfig, eightClearsPile: $("eightClearToggle").checked });
    selected.clear(); render();
  };
  $("nextRoundBtn").onclick = () => {
    if (aiTimer !== null) clearTimeout(aiTimer);
    if (game.startNextRound()) { selected.clear(); render(); }
  };
  $("eightClearToggle").checked = game.config.eightClearsPile === true;
  $("eightClearToggle").addEventListener("change", event => {
    game.config.eightClearsPile = event.target.checked;
    selected.clear();
    render();
  });
  $("jokerToggle").checked = game.config.jokers === true;
  $("jokerToggle").addEventListener("change", event => {
    game.config.jokers = event.target.checked;
    selected.clear();
    render();
  });
  $("undoBtn").onclick = () => { if (aiTimer !== null) clearTimeout(aiTimer); if (game.undo()) { selected.clear(); render(); } };
  $("backBtn").onclick = () => { location.href = "../index.html"; };

  render();
})();
