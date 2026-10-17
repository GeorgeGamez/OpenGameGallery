(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let launchConfig = {};
  try {
    const raw =
      params.get("onlineConfig") ||
      sessionStorage.getItem("gameLibraryOnlineConfig") ||
      "";
    if (raw) launchConfig = JSON.parse(raw);
  } catch {}
  if (launchConfig.options && typeof launchConfig.options === "object")
    launchConfig = { ...launchConfig, ...launchConfig.options };
  const profiles = (() => {
    try {
      return JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
    } catch {
      return [];
    }
  })();
  const SUITS = ["♣", "♦", "♥", "♠"],
    SUIT_ORDER = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };
  const rankLabel = (r) =>
    ({ 1: "A", 11: "J", 12: "Q", 13: "K" })[r] || String(r);
  const cardText = (c) => `${rankLabel(c.rank)}${c.suit}`;
  const points = (c) =>
    c.suit === "♥" ? 1 : c.suit === "♠" && c.rank === 12 ? 13 : 0;
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function buildDeck() {
    const d = [];
    for (const suit of SUITS)
      for (let rank = 1; rank <= 13; rank++)
        d.push({ id: `${suit}-${rank}`, suit, rank });
    return shuffle(d);
  }
  function sortHand(h) {
    h.sort(
      (a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank,
    );
  }
  function cardHtml(c, selected = false) {
    const color = c.suit === "♥" || c.suit === "♦" ? "red" : "black",
      r = rankLabel(c.rank);
    return `<div class="card ${color} ${selected ? "selected" : ""}" data-card="${c.id}" role="button" tabindex="0" aria-label="${r} ${c.suit}"><span class="corner"><span>${r}</span><span>${c.suit}</span></span><span class="face"><span class="center-rank">${r}</span><span class="center-suit">${c.suit}</span></span><span class="bottom"><span>${r}</span><span>${c.suit}</span></span></div>`;
  }
  class HeartsGame {
    constructor(config = {}) {
      this.config = config;
      this.players = [];
      this.totalScores = [];
      this.roundNumber = 1;
      this.resetPlayers(config.players || []);
      this.startRound();
    }
    resetPlayers(source) {
      const fallback = [
        {
          type: "human",
          name: profiles[0]?.name || "Player 1",
          avatar: profiles[0]?.avatar || "♟",
          profileId: profiles[0]?.id || "",
        },
        {
          type: "computer",
          name: "Computer 1",
          avatar: "🤖",
          difficulty: "normal",
        },
        {
          type: "computer",
          name: "Computer 2",
          avatar: "🤖",
          difficulty: "normal",
        },
        {
          type: "computer",
          name: "Computer 3",
          avatar: "🤖",
          difficulty: "normal",
        },
      ];
      let list = source.length ? source : fallback;
      this.players = list
        .slice(0, 4)
        .map((p, i) => ({
          ...p,
          type: p.type === "computer" ? "computer" : "human",
          name: p.name || `Player ${i + 1}`,
          avatar: p.avatar || (p.type === "computer" ? "🤖" : "🃏"),
          seat: i,
        }));
      while (this.players.length < 4) {
        let i = this.players.length;
        this.players.push({
          type: "computer",
          name: `Computer ${i + 1}`,
          avatar: "🤖",
          difficulty: "normal",
          seat: i,
        });
      }
      this.totalScores = this.players.map(() => 0);
      this.roundNumber = 1;
    }
    startRound() {
      this.hands = this.players.map(() => []);
      this.trick = [];
      this.trickNumber = 0;
      this.heartsBroken = false;
      this.roundPoints = this.players.map(() => 0);
      this.history = [];
      this.selected = new Set();
      this.over = false;
      this.matchOver = false;
      this.roundWinner = -1;
      this.passing = ["left", "right", "across", "hold"][
        (this.roundNumber - 1) % 4
      ];
      this.phase = this.passing === "hold" ? "play" : "pass";
      const deck = buildDeck();
      let n = 0;
      while (deck.length) this.hands[n++ % 4].push(deck.pop());
      this.hands.forEach(sortHand);
      this.turn = this.hands.findIndex((h) =>
        h.some((c) => c.suit === "♣" && c.rank === 2),
      );
      this.leadPlayer = this.turn;
      this.passChoices = {};
      this.awaitingPassHandoff = false;
      this.passReceived = false;
      this.moveHistory = [];
      if (this.phase === "pass") this.turn = 0;
      this.log(
        `Round ${this.roundNumber} begins. ${this.passing === "hold" ? "No passing this round." : `Pass ${this.passing}.`}`,
      );
    }
    legalCards(player) {
      const hand = this.hands[player] || [];
      if (this.phase !== "play") return [];
      if (!this.trick.length && this.trickNumber === 0) {
        const two = hand.find((c) => c.suit === "♣" && c.rank === 2);
        if (two) return [two];
      }
      const lead = this.trick.length ? this.trick[0].card.suit : null;
      let legal = lead ? hand.filter((c) => c.suit === lead) : hand;
      if (lead && !legal.length) legal = hand;
      if (
        !this.trick.length &&
        !this.heartsBroken &&
        legal.some((c) => c.suit !== "♥")
      )
        legal = legal.filter((c) => c.suit !== "♥");
      if (this.trickNumber === 0 && this.trick.length) {
        const safe = legal.filter((c) => points(c) === 0);
        if (safe.length) legal = safe;
      }
      return legal;
    }
    winningPlayIndex(trick = this.trick) {
      if (!trick.length) return -1;
      const suit = trick[0].card.suit;
      let best = 0;
      for (let i = 1; i < trick.length; i++)
        if (
          trick[i].card.suit === suit &&
          trick[i].card.rank > trick[best].card.rank
        )
          best = i;
      return best;
    }
    nextHumanToPass() {
      for (let i = 0; i < this.players.length; i++)
        if (this.players[i].type === "human" && !this.passChoices[i]) return i;
      return -1;
    }
    passCards(player, ids) {
      if (
        this.phase !== "pass" ||
        this.passChoices[player] ||
        !Array.isArray(ids)
      )
        return false;
      const hand = this.hands[player];
      if (
        ids.length !== 3 ||
        new Set(ids).size !== 3 ||
        ids.some((id) => !hand.some((c) => c.id === id))
      )
        return false;
      this.passChoices[player] = ids.slice();
      if (Object.keys(this.passChoices).length === 4) {
        const offset = { left: 1, right: 3, across: 2 }[this.passing];
        const outgoing = this.hands.map((h, i) =>
          h.filter((c) => !this.passChoices[i].includes(c.id)),
        );
        const passed = this.hands.map((h, i) =>
          h.filter((c) => this.passChoices[i].includes(c.id)),
        );
        this.hands = outgoing.map((h, i) => [
          ...h,
          ...passed[(i - offset + 4) % 4],
        ]);
        this.hands.forEach(sortHand);
        this.awaitingPassHandoff = false;
        this.phase = "play";
        this.turn = this.hands.findIndex((h) =>
          h.some((c) => c.suit === "♣" && c.rank === 2),
        );
        this.log("Cards passed. The player with 2♣ leads.");
      }
      return true;
    }
    play(player, id) {
      if (this.phase !== "play" || this.over || player !== this.turn)
        return false;
      const card = this.legalCards(player).find((c) => c.id === id);
      if (!card) return false;
      this.hands[player] = this.hands[player].filter((c) => c.id !== id);
      this.trick.push({ player, card });
      this.selected.clear();
      this.log(`${this.players[player].name} played ${cardText(card)}.`);
      if (card.suit === "♥") this.heartsBroken = true;
      if (this.trick.length === 4) {
        const winner = this.trick[this.winningPlayIndex()].player;
        const pts = this.trick.reduce((n, p) => n + points(p.card), 0);
        this.roundPoints[winner] += pts;
        this.log(
          `${this.players[winner].name} took the trick${pts ? ` (${pts} points)` : ""}.`,
        );
        this.trickNumber++;
        this.trick = [];
        this.turn = winner;
        if (this.hands.every((h) => h.length === 0)) this.finishRound();
      } else this.turn = (player + 1) % 4;
      return true;
    }
    finishRound() {
      const moon = this.roundPoints.findIndex((n) => n === 26);
      if (moon >= 0) {
        this.roundPoints = this.roundPoints.map((n, i) =>
          i === moon ? 0 : 26,
        );
        this.log(`${this.players[moon].name} shot the moon!`);
      }
      this.roundPoints.forEach((n, i) => (this.totalScores[i] += n));
      this.over = true;
      const max = Math.max(...this.totalScores);
      if (max >= 100) {
        this.matchOver = true;
        const min = Math.min(...this.totalScores);
        this.roundWinner = this.totalScores.indexOf(min);
        this.log(
          `Game over. ${this.players[this.roundWinner].name} wins with ${min} points.`,
        );
      } else this.log("Round complete.");
    }
    log(s) {
      this.history.unshift(s);
    }
  }
  let game = new HeartsGame(launchConfig);
  let aiTimer = null;
  function activePlayerIndex() {
    return game.phase === "pass" ? game.nextHumanToPass() : game.turn;
  }
  function activeHumanTurn() {
    if (game.over) return false;
    const i = activePlayerIndex();
    return i >= 0 && game.players[i]?.type === "human";
  }
  function renderPlayers() {
    const active = activePlayerIndex();
    $("playerList").innerHTML = game.players
      .map(
        (p, i) =>
          `<div class="player-row ${active === i && !game.over ? "current" : ""}"><div class="avatar">${escapeHtml(p.avatar)}</div><div><div class="player-name">${escapeHtml(p.name)}</div><div class="player-sub">${p.type === "computer" ? "Computer" : "Local player"}</div></div><div class="score">${game.totalScores[i]} pts</div></div>`,
      )
      .join("");
  }
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function render() {
    renderPlayers();
    const active = activePlayerIndex();
    const current = active >= 0 ? game.players[active] : null;
    const handoff = game.phase === "pass" && game.awaitingPassHandoff;
    $("roundInfo").textContent =
      `Round ${game.roundNumber} · ${game.passing === "hold" ? "Keep your cards" : `Pass ${game.passing}`}`;
    $("tableLabel").textContent =
      game.phase === "pass" ? "Card passing" : "Current trick";
    if (game.phase === "pass") {
      $("trickCaption").textContent =
        handoff && current
          ? `Pass the device to ${current.name}, then reveal their hand.`
          : current
            ? `${current.name}: select three cards to pass, then confirm.`
            : "Finishing computer passes…";
      $("trickMeta").textContent =
        "Cards are passed simultaneously and move after all four players confirm.";
    } else if (game.over) {
      $("trickCaption").textContent = game.matchOver
        ? `${game.players[game.roundWinner].name} wins the game!`
        : "Round complete.";
      $("trickMeta").textContent = game.matchOver
        ? "Start a new game to play again."
        : "Choose Next Round to continue.";
    } else {
      $("trickCaption").textContent = game.trick.length
        ? `${game.players[game.turn].name} to play · ${game.trick.length}/4 cards in trick`
        : `${game.players[game.turn].name} to lead`;
      $("trickMeta").textContent = game.heartsBroken
        ? "Hearts have been broken."
        : "Hearts have not been broken.";
    }
    $("tableCards").innerHTML = game.trick
      .map(
        (p) =>
          `<div class="played-card"><div>${escapeHtml(game.players[p.player].name)}</div>${cardHtml(p.card, false)}</div>`,
      )
      .join("");
    const canAct =
      game.phase === "pass" ? activeHumanTurn() && !handoff : activeHumanTurn();
    const hand = canAct && active >= 0 ? game.hands[active] || [] : [];
    $("handTitle").textContent = handoff
      ? "Hand hidden for privacy"
      : current
        ? game.phase === "pass"
          ? `${current.name}'s hand — choose 3 to pass`
          : `${current.name}'s hand`
        : game.over
          ? "Round complete"
          : "Waiting for computer passes";
    $("hand").innerHTML = handoff
      ? '<div class="note">The next player’s cards are hidden. Pass the device over and select Show Hand when ready.</div>'
      : hand.length
        ? hand.map((c) => cardHtml(c, game.selected.has(c.id))).join("")
        : game.phase === "play" && !game.over && current?.type === "computer"
          ? '<div class="note">Computer hand hidden while it thinks.</div>'
          : game.over
            ? '<div class="note">Round complete.</div>'
            : '<div class="note">Waiting for the next player…</div>';
    $("handHint").textContent =
      game.phase === "pass"
        ? handoff
          ? `Ready for ${current?.name || "the next player"}.`
          : `${game.selected.size}/3 cards selected`
        : canAct
          ? "Select a legal card to play."
          : "";
    $("confirmBtn").classList.toggle("hidden", game.phase !== "pass");
    $("confirmBtn").disabled = handoff
      ? !current
      : !canAct || game.selected.size !== 3;
    $("confirmBtn").textContent = handoff
      ? `Show ${current?.name || "Next Player"}'s Hand`
      : "Confirm Pass";
    $("nextRoundBtn").disabled = !game.over || game.matchOver;
    $("shootMoonBtn").classList.add("hidden");
    $("status").textContent = game.over
      ? game.matchOver
        ? "Game finished."
        : "Round finished."
      : game.phase === "pass"
        ? handoff
          ? `Pass the device to ${current?.name || "the next player"} and reveal their hand when ready.`
          : current
            ? `${current.name}, choose three cards to pass.`
            : "Waiting for computer passes."
        : `${game.players[game.turn].name}'s turn.`;
    $("scoreboard").innerHTML =
      `<table class="score-table"><thead><tr><th>Player</th><th>Round</th><th>Total</th></tr></thead><tbody>${game.players.map((p, i) => `<tr><td>${escapeHtml(p.name)}</td><td>${game.roundPoints[i]}</td><td>${game.totalScores[i]}</td></tr>`).join("")}</tbody></table>`;
    $("history").innerHTML = game.history
      .map((s) => `<div>${escapeHtml(s)}</div>`)
      .join("");
  }
  function humanTurn() {
    return (
      !game.over &&
      game.phase === "play" &&
      game.players[game.turn]?.type === "human"
    );
  }
  function runAI() {
    clearTimeout(aiTimer);
    if (game.over) return;
    if (game.phase === "pass") {
      for (let i = 0; i < 4; i++) {
        if (game.players[i].type === "computer" && !game.passChoices[i])
          game.passCards(i, window.HeartsAI.choosePass(game.hands[i]));
      }
      if (game.phase === "play") {
        render();
        runAI();
      }
      return;
    }
    if (game.players[game.turn].type !== "computer") return;
    aiTimer = setTimeout(() => {
      if (game.over) return;
      const id = window.HeartsAI.choosePlay(game, game.turn);
      if (id) game.play(game.turn, id);
      render();
      runAI();
    }, 450);
  }
  $("hand").addEventListener("click", (e) => {
    const el = e.target.closest(".card");
    if (!el || game.over) return;
    const id = el.dataset.card;
    if (game.phase === "pass") {
      if (!activeHumanTurn() || game.awaitingPassHandoff) return;
      const active = game.nextHumanToPass();
      if (!game.hands[active]?.some((c) => c.id === id)) return;
      if (game.selected.has(id)) game.selected.delete(id);
      else if (game.selected.size < 3) game.selected.add(id);
      render();
      return;
    }
    if (!humanTurn()) return;
    const player = game.turn;
    const legal = game.legalCards(player);
    if (!legal.some((c) => c.id === id)) {
      $("status").textContent =
        "That card is not legal. Follow suit if possible.";
      return;
    }
    game.play(player, id);
    render();
    runAI();
  });
  $("hand").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const el = e.target.closest(".card");
      if (el) {
        e.preventDefault();
        el.click();
      }
    }
  });
  $("confirmBtn").addEventListener("click", () => {
    if (game.phase !== "pass") return;
    if (game.awaitingPassHandoff) {
      game.awaitingPassHandoff = false;
      game.selected.clear();
      render();
      runAI();
      return;
    }
    const player = game.nextHumanToPass();
    if (player < 0 || game.selected.size !== 3) return;
    if (game.passCards(player, [...game.selected])) {
      game.selected.clear();
      if (game.phase === "pass" && game.nextHumanToPass() >= 0)
        game.awaitingPassHandoff = true;
      render();
      runAI();
    }
  });
  $("nextRoundBtn").addEventListener("click", () => {
    if (!game.over || game.matchOver) return;
    game.roundNumber++;
    game.startRound();
    render();
    runAI();
  });
  $("newGameBtn").addEventListener("click", () => {
    clearTimeout(aiTimer);
    game = new HeartsGame(launchConfig);
    render();
    runAI();
  });
  $("backBtn").addEventListener("click", () => {
    location.href = "../index.html";
  });
  render();
  runAI();
})();
