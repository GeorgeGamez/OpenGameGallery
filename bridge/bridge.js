(function (root) {
  "use strict";

  const SUITS = ["C", "D", "H", "S"];
  const SUIT_SYMBOL = { C: "♣", D: "♦", H: "♥", S: "♠", NT: "NT" };
  const SUIT_ORDER = { C: 0, D: 1, H: 2, S: 3, NT: 4 };
  const SEAT_NAMES = ["North", "East", "South", "West"];
  const PARTNER_NAMES = ["North–South", "East–West"];
  const VULNERABILITY_CYCLE = ["none", "NS", "EW", "both", "NS", "EW", "both", "none", "EW", "both", "none", "NS", "both", "none", "NS", "EW"];
  const $ = (id) => document.getElementById(id);
  const partnerOf = (seat) => (seat + 2) % 4;
  const sideOf = (seat) => seat % 2 === 0 ? 0 : 1;
  const sideName = (side) => PARTNER_NAMES[side];
  const cardRankName = (rank) => ({ 14: "A", 13: "K", 12: "Q", 11: "J" }[rank] || String(rank));
  const suitSymbol = (suit) => SUIT_SYMBOL[suit] || suit;
  const cardText = (card) => `${cardRankName(card.rank)}${suitSymbol(card.suit)}`;
  const callText = (call) => {
    if (!call) return "—";
    if (call.type === "pass") return "Pass";
    if (call.type === "double") return "Double";
    if (call.type === "redouble") return "Redouble";
    return `${call.level}${suitSymbol(call.strain)}`;
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function buildDeck() {
    const deck = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push({ id: `${suit}-${rank}`, suit, rank });
    return shuffle(deck);
  }

  function sortHand(hand) {
    const order = { S: 0, H: 1, D: 2, C: 3 };
    hand.sort((a, b) => order[a.suit] - order[b.suit] || b.rank - a.rank);
    return hand;
  }

  function bidCompare(a, b) {
    if (a.level !== b.level) return a.level - b.level;
    return SUIT_ORDER[a.strain] - SUIT_ORDER[b.strain];
  }

  function getVulnerability(boardNumber) {
    const value = VULNERABILITY_CYCLE[(boardNumber - 1) % VULNERABILITY_CYCLE.length];
    return { label: ({ none: "Neither vulnerable", NS: "North–South vulnerable", EW: "East–West vulnerable", both: "Both vulnerable" })[value], code: value };
  }

  function isVulnerable(side, vulnerability) {
    return vulnerability.code === "both" || vulnerability.code === (side === 0 ? "NS" : "EW");
  }

  class BridgeGame {
    constructor(config = {}) {
      this.config = config;
      this.players = this.normalizePlayers(config.players || []);
      this.dealNumber = 0;
      this.totalScores = [0, 0];
      this.dealRecords = [];
      this.newDeal();
    }

    normalizePlayers(source) {
      let profiles = [];
      try { if (typeof localStorage !== "undefined") profiles = JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]"); } catch {}
      const fallback = [
        { type: "human", name: profiles[0]?.name || "Player 1", avatar: profiles[0]?.avatar || "♟", profileId: profiles[0]?.id || "" },
        { type: "computer", name: "Computer 1", avatar: "🤖" },
        { type: "computer", name: "Computer 2", avatar: "🤖" },
        { type: "computer", name: "Computer 3", avatar: "🤖" },
      ];
      const list = source.length ? source : fallback;
      const players = list.slice(0, 4).map((player, seat) => ({
        ...player,
        type: player.type === "computer" ? "computer" : "human",
        name: player.name || `${SEAT_NAMES[seat]} Player`,
        avatar: player.avatar || (player.type === "computer" ? "🤖" : "🃏"),
        seat,
        compass: SEAT_NAMES[seat],
        side: sideOf(seat),
      }));
      while (players.length < 4) {
        const seat = players.length;
        players.push({ type: "computer", name: `Computer ${seat}`, avatar: "🤖", seat, compass: SEAT_NAMES[seat], side: sideOf(seat) });
      }
      return players;
    }

    newDeal() {
      this.dealNumber++;
      this.dealer = (this.dealNumber - 1) % 4;
      this.vulnerability = getVulnerability(this.dealNumber);
      this.hands = this.players.map(() => []);
      const deck = buildDeck();
      for (let index = 0; index < deck.length; index++) this.hands[index % 4].push(deck[index]);
      this.hands.forEach(sortHand);
      this.auction = [];
      this.highBid = null;
      this.multiplier = 1;
      this.consecutivePasses = 0;
      this.phase = "auction";
      this.turn = this.dealer;
      this.contract = null;
      this.declarer = -1;
      this.dummy = -1;
      this.openingLeader = -1;
      this.dummyRevealed = false;
      this.trick = [];
      this.trickNumber = 0;
      this.tricksWon = [0, 0, 0, 0];
      this.over = false;
      this.passedOut = false;
      this.result = null;
      this.history = [`Board ${this.dealNumber} dealt. ${this.players[this.dealer].compass} is dealer.`, this.vulnerability.label + "."];
    }

    canCall(seat, call) {
      if (this.phase !== "auction" || this.over || seat !== this.turn || !call) return false;
      if (call.type === "pass") return true;
      if (call.type === "bid") {
        if (!Number.isInteger(call.level) || call.level < 1 || call.level > 7 || !Object.hasOwn(SUIT_ORDER, call.strain)) return false;
        return !this.highBid || bidCompare(call, this.highBid) > 0;
      }
      if (call.type === "double") return Boolean(this.highBid && sideOf(seat) !== sideOf(this.highBid.seat) && this.multiplier === 1);
      if (call.type === "redouble") return Boolean(this.highBid && sideOf(seat) === sideOf(this.highBid.seat) && this.multiplier === 2);
      return false;
    }

    makeCall(seat, call) {
      if (!this.canCall(seat, call)) return false;
      const stored = { ...call, seat };
      this.auction.push(stored);
      this.history.unshift(`${this.players[seat].compass} ${this.players[seat].name}: ${callText(call)}.`);
      if (call.type === "bid") {
        this.highBid = { ...call, seat };
        this.multiplier = 1;
        this.consecutivePasses = 0;
      } else if (call.type === "double") {
        this.multiplier = 2;
        this.consecutivePasses = 0;
      } else if (call.type === "redouble") {
        this.multiplier = 4;
        this.consecutivePasses = 0;
      } else {
        this.consecutivePasses++;
      }

      if (!this.highBid && this.consecutivePasses >= 4) {
        this.phase = "complete";
        this.over = true;
        this.passedOut = true;
        this.result = { passedOut: true, board: this.dealNumber, score: 0 };
        this.history.unshift("Passed out. No contract was played; score is zero.");
        this.dealRecords.push(this.result);
      } else if (this.highBid && this.consecutivePasses >= 3) {
        this.finishAuction();
      } else {
        this.turn = (seat + 1) % 4;
      }
      return true;
    }

    finishAuction() {
      const finalBid = this.highBid;
      let declarer = -1;
      for (const call of this.auction) {
        if (call.type === "bid" && sideOf(call.seat) === sideOf(finalBid.seat) && call.strain === finalBid.strain) {
          declarer = call.seat;
          break;
        }
      }
      this.declarer = declarer;
      this.dummy = partnerOf(declarer);
      this.openingLeader = (declarer + 1) % 4;
      this.contract = { level: finalBid.level, strain: finalBid.strain, multiplier: this.multiplier, bidSeat: finalBid.seat, side: sideOf(finalBid.seat) };
      this.phase = "play";
      this.turn = this.openingLeader;
      this.history.unshift(`${this.players[declarer].compass} is declarer in ${this.contract.level}${suitSymbol(this.contract.strain)}${this.multiplier === 2 ? " doubled" : this.multiplier === 4 ? " redoubled" : ""}. ${this.players[this.dummy].compass} is dummy.`);
    }

    legalCards(seat) {
      if (this.phase !== "play" || this.over || seat !== this.turn) return [];
      const hand = this.hands[seat] || [];
      if (!this.trick.length) return [...hand];
      const ledSuit = this.trick[0].card.suit;
      const follow = hand.filter((card) => card.suit === ledSuit);
      return follow.length ? follow : [...hand];
    }

    playCard(seat, cardId) {
      if (this.phase !== "play" || this.over || seat !== this.turn) return false;
      const legal = this.legalCards(seat);
      const card = legal.find((item) => item.id === cardId);
      if (!card) return false;
      this.hands[seat] = this.hands[seat].filter((item) => item.id !== cardId);
      this.trick.push({ seat, card });
      this.history.unshift(`${this.players[seat].compass} played ${cardText(card)}.`);
      if (this.trickNumber === 0 && this.trick.length === 1) this.dummyRevealed = true;
      if (this.trick.length === 4) {
        const winnerIndex = this.winningPlayIndex();
        const winner = this.trick[winnerIndex].seat;
        this.tricksWon[winner]++;
        this.history.unshift(`${this.players[winner].compass} won trick ${this.trickNumber + 1}.`);
        this.trickNumber++;
        this.trick = [];
        if (this.trickNumber >= 13) {
          this.finishDeal();
          return true;
        }
        this.turn = winner;
      } else {
        this.turn = (seat + 1) % 4;
      }
      return true;
    }

    winningPlayIndex() {
      if (!this.trick.length) return -1;
      const leadSuit = this.trick[0].card.suit;
      const trump = this.contract?.strain === "NT" ? null : this.contract?.strain;
      let winner = 0;
      for (let i = 1; i < this.trick.length; i++) {
        const candidate = this.trick[i].card;
        const incumbent = this.trick[winner].card;
        if (candidate.suit === incumbent.suit && candidate.rank > incumbent.rank) winner = i;
        else if (trump && candidate.suit === trump && incumbent.suit !== trump) winner = i;
        else if (incumbent.suit !== trump && candidate.suit === leadSuit && incumbent.suit !== leadSuit) winner = i;
      }
      return winner;
    }

    sideTricks(side) {
      return this.tricksWon.reduce((sum, count, seat) => sum + (sideOf(seat) === side ? count : 0), 0);
    }

    finishDeal() {
      const declarerSide = sideOf(this.declarer);
      const declarerTricks = this.sideTricks(declarerSide);
      const required = 6 + this.contract.level;
      const made = declarerTricks >= required;
      const vulnerable = isVulnerable(declarerSide, this.vulnerability);
      let score = 0;
      let explanation = "";

      if (made) {
        const multiplier = this.contract.multiplier;
        let contractPoints = 0;
        const bidTricks = this.contract.level;
        if (this.contract.strain === "NT") contractPoints = (40 + Math.max(0, bidTricks - 1) * 30) * multiplier;
        else contractPoints = bidTricks * (this.contract.strain === "C" || this.contract.strain === "D" ? 20 : 30) * multiplier;
        score += contractPoints;
        if (contractPoints >= 100) score += vulnerable ? 500 : 300;
        else score += 50;
        if (multiplier === 2) score += 50;
        if (multiplier === 4) score += 100;
        const overtricks = declarerTricks - required;
        if (overtricks > 0) {
          let overValue;
          if (multiplier === 1) overValue = this.contract.strain === "C" || this.contract.strain === "D" ? 20 : 30;
          else if (multiplier === 2) overValue = vulnerable ? 200 : 100;
          else overValue = vulnerable ? 400 : 200;
          score += overtricks * overValue;
        }
        if (this.contract.level === 6) score += vulnerable ? 750 : 500;
        if (this.contract.level === 7) score += vulnerable ? 1500 : 1000;
        explanation = `${sideName(declarerSide)} made ${this.contract.level}${suitSymbol(this.contract.strain)}${multiplier === 2 ? " doubled" : multiplier === 4 ? " redoubled" : ""}: ${declarerTricks} tricks, +${score}.`;
        this.totalScores[declarerSide] += score;
      } else {
        const under = required - declarerTricks;
        const multiplier = this.contract.multiplier;
        if (multiplier === 1) score = under * (vulnerable ? 100 : 50);
        else {
          const doubledPenalty = vulnerable
            ? (under === 1 ? 200 : under === 2 ? 500 : under === 3 ? 800 : 800 + (under - 3) * 300)
            : (under === 1 ? 100 : under === 2 ? 300 : under === 3 ? 500 : 500 + (under - 3) * 300);
          score = doubledPenalty * (multiplier === 4 ? 2 : 1);
        }
        explanation = `${sideName(1 - declarerSide)} defeated the contract by ${under}: +${score}.`;
        this.totalScores[1 - declarerSide] += score;
      }

      this.over = true;
      this.phase = "complete";
      this.result = {
        board: this.dealNumber,
        passedOut: false,
        contract: { ...this.contract, declarer: this.declarer, dummy: this.dummy },
        declarerTricks,
        required,
        made,
        vulnerable,
        scoringSide: made ? declarerSide : 1 - declarerSide,
        score,
        explanation,
        tricksWon: [...this.tricksWon],
      };
      this.dealRecords.push(this.result);
      this.history.unshift(explanation);
      this.history.unshift(`Result: ${declarerTricks} tricks for declarer's side; ${13 - declarerTricks} for defenders.`);
    }
  }

  root.BridgeGame = BridgeGame;
  root.BridgeUtils = { SUITS, SUIT_SYMBOL, SUIT_ORDER, SEAT_NAMES, partnerOf, sideOf, sideName, cardRankName, suitSymbol, cardText, callText, shuffle, buildDeck, sortHand, bidCompare };

  if (typeof document === "undefined") return;

  const params = new URLSearchParams(location.search);
  let launchConfig = {};
  try {
    const raw = params.get("onlineConfig") || sessionStorage.getItem("gameLibraryOnlineConfig") || "";
    if (raw) launchConfig = JSON.parse(raw);
  } catch {}
  if (launchConfig.options && typeof launchConfig.options === "object") launchConfig = { ...launchConfig, ...launchConfig.options };

  const profiles = (() => { try { return JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]"); } catch { return []; } })();
  if (!launchConfig.players?.length && profiles.length) {
    launchConfig.players = [
      { type: "human", name: profiles[0]?.name || "Player 1", avatar: profiles[0]?.avatar || "♟", profileId: profiles[0]?.id || "" },
      { type: "computer", name: "Computer East", avatar: "🤖" },
      { type: "computer", name: "Computer South", avatar: "🤖" },
      { type: "computer", name: "Computer West", avatar: "🤖" },
    ];
  }

  let game = new BridgeGame(launchConfig);
  let aiTimer = null;
  let lastShownSeat = -1;
  let messageText = "";
  const localHumanCount = game.players.filter((player) => player.type === "human").length;

  function actorSeat() {
    if (game.phase === "auction") return game.turn;
    if (game.phase === "play") return game.turn === game.dummy ? game.declarer : game.turn;
    return -1;
  }

  function currentActorIsHuman() {
    const seat = actorSeat();
    return seat >= 0 && game.players[seat]?.type === "human";
  }

  function handReady() {
    const seat = actorSeat();
    if (seat < 0 || !currentActorIsHuman()) return false;
    if (localHumanCount <= 1) {
      lastShownSeat = seat;
      return true;
    }
    return lastShownSeat === seat;
  }

  function cardHtml(card, options = {}) {
    const small = Boolean(options.small);
    const selected = Boolean(options.selected);
    const disabled = Boolean(options.disabled);
    const suit = suitSymbol(card.suit);
    const red = card.suit === "H" || card.suit === "D";
    return `<button type="button" class="card ${red ? "red" : "black"} ${selected ? "selected" : ""} ${small ? "small-card" : ""}" data-card="${card.id}" ${options.source ? `data-source="${options.source}"` : ""} aria-label="${cardRankName(card.rank)} of ${({ C: "clubs", D: "diamonds", H: "hearts", S: "spades" })[card.suit]}" ${disabled ? "disabled" : ""}><span class="corner"><b>${cardRankName(card.rank)}</b><span>${suit}</span></span><span class="face"><span class="center-rank">${cardRankName(card.rank)}</span><span class="center-suit">${suit}</span></span><span class="bottom"><b>${cardRankName(card.rank)}</b><span>${suit}</span></span></button>`;
  }

  function renderPlayers() {
    $("playerList").innerHTML = game.players.map((player, seat) => {
      const active = seat === actorSeat() && game.phase !== "complete";
      const score = game.totalScores[sideOf(seat)];
      return `<div class="player-row ${active ? "current" : ""}"><div class="avatar">${escapeHtml(player.avatar)}</div><div class="player-main"><div class="player-name">${escapeHtml(player.compass)} · ${escapeHtml(player.name)}</div><div class="player-sub">${sideOf(seat) === 0 ? "North–South" : "East–West"} · ${player.type === "computer" ? "Computer" : "Local player"}</div></div><div class="score">${score}</div></div>`;
    }).join("");
  }

  function renderAuction() {
    const calls = game.auction;
    if (!calls.length) return '<div class="muted">Auction has not started.</div>';
    return calls.map((call) => `<div class="auction-call"><small>${escapeHtml(game.players[call.seat].compass)}</small><b>${escapeHtml(callText(call))}</b></div>`).join("");
  }

  function renderTrick() {
    const cardsBySeat = new Map(game.trick.map((play) => [play.seat, play.card]));
    return game.players.map((player, seat) => {
      const card = cardsBySeat.get(seat);
      return `<div class="trick-slot ${seat === actorSeat() && game.phase === "play" ? "next-slot" : ""}"><div class="slot-label">${escapeHtml(player.compass)}</div>${card ? cardHtml(card, { small: true, disabled: true }) : '<div class="empty-card">·</div>'}</div>`;
    }).join("");
  }

  function renderDummy(ready) {
    const panel = $("dummyPanel");
    if (!game.dummyRevealed || game.phase === "auction" || game.dummy < 0) {
      panel.classList.add("hidden");
      $("dummyHand").innerHTML = "";
      return;
    }
    panel.classList.remove("hidden");
    $("dummyTitle").textContent = `Dummy · ${game.players[game.dummy].compass} (${game.players[game.dummy].name})`;
    const clickable = game.phase === "play" && game.turn === game.dummy && actorSeat() === game.declarer && game.players[game.declarer].type === "human" && ready;
    $("dummyHint").textContent = clickable ? "Declarer: select a legal card from dummy." : "Dummy's remaining cards are visible to everyone.";
    $("dummyHand").innerHTML = game.hands[game.dummy].length
      ? game.hands[game.dummy].map((card) => cardHtml(card, { small: true, source: "dummy", disabled: !clickable || !game.legalCards(game.dummy).some((legal) => legal.id === card.id) })).join("")
      : '<span class="muted">No cards remain.</span>';
  }

  function render() {
    renderPlayers();
    const actor = actorSeat();
    const ready = handReady();
    const pendingHandoff = localHumanCount > 1 && currentActorIsHuman() && !ready && !game.over;
    const handSeat = actor;
    const hand = ready && handSeat >= 0 ? (game.hands[handSeat] || []) : [];
    $("boardInfo").textContent = `Board ${game.dealNumber} · Dealer ${game.players[game.dealer].compass} · ${game.vulnerability.label}`;
    $("phaseTitle").textContent = game.phase === "auction" ? "Auction" : game.phase === "play" ? `Play · Trick ${Math.min(13, game.trickNumber + 1)} of 13` : "Deal complete";
    $("contractInfo").textContent = game.contract ? `${game.contract.level}${suitSymbol(game.contract.strain)}${game.contract.multiplier === 2 ? " ×2 (doubled)" : game.contract.multiplier === 4 ? " ×4 (redoubled)" : ""} · Declarer ${game.players[game.declarer].compass} · ${game.tricksWon.reduce((n, v, i) => n + (sideOf(i) === sideOf(game.declarer) ? v : 0), 0)} tricks for declarer` : game.passedOut ? "Passed out" : "No contract yet";
    $("auction").innerHTML = renderAuction();
    $("trickCards").innerHTML = renderTrick();
    $("auctionPanel").classList.toggle("hidden", game.phase !== "auction");
    $("dummyPanel").classList.toggle("hidden", !game.dummyRevealed || game.phase === "auction");
    renderDummy(ready);

    const phaseAuction = game.phase === "auction";
    const activeHuman = currentActorIsHuman() && ready && !game.over;
    $("handTitle").textContent = pendingHandoff ? `Private handoff · ${game.players[actor].compass}` : actor >= 0 ? `${game.players[actor].compass} · ${game.players[actor].name}${phaseAuction ? " — bidding hand" : game.phase === "play" && game.turn === game.dummy ? " — declarer controls dummy" : " — your hand"}` : "No active hand";
    if (pendingHandoff) {
      $("hand").innerHTML = '<div class="note">Pass the device to the next player, then reveal their cards.</div>';
    } else if (!ready && currentActorIsHuman() && localHumanCount > 1 && !game.over) {
      $("hand").innerHTML = '<div class="note">Press “Show Hand” when the correct player is ready.</div>';
    } else if (game.phase === "complete") {
      $("hand").innerHTML = '<div class="note">Deal complete. Start the next board to continue.</div>';
    } else if (ready && hand.length) {
      const legalIds = game.phase === "play" && actor === game.turn && activeHuman
        ? new Set(game.legalCards(game.turn).map((card) => card.id))
        : new Set();
      $("hand").innerHTML = hand.map((card) => cardHtml(card, { disabled: phaseAuction || game.phase !== "play" || actor !== game.turn || !activeHuman || !legalIds.has(card.id) })).join("");
    } else {
      $("hand").innerHTML = '<div class="note">Computer hands are hidden.</div>';
    }
    $("handHint").textContent = phaseAuction ? (activeHuman ? "Choose a call above." : "Waiting for the computer auction…") : game.phase === "play" ? (activeHuman ? "Follow suit whenever possible." : "Waiting for computer play…") : "";

    $("auctionBidBtn").disabled = !phaseAuction || !activeHuman;
    $("passBtn").disabled = !phaseAuction || !activeHuman || !game.canCall(actor, { type: "pass" });
    $("doubleBtn").disabled = !phaseAuction || !activeHuman || !game.canCall(actor, { type: "double" });
    $("redoubleBtn").disabled = !phaseAuction || !activeHuman || !game.canCall(actor, { type: "redouble" });
    $("showHandBtn").classList.toggle("hidden", !pendingHandoff);
    $("showHandBtn").disabled = !pendingHandoff;
    $("nextBoardBtn").disabled = !game.over;
    $("newMatchBtn").disabled = false;

    const status = game.phase === "auction"
      ? pendingHandoff ? `Pass the device to ${game.players[actor].name}, then show their hand.` : activeHuman ? `${game.players[actor].compass} to bid.` : `${game.players[actor].compass} (${game.players[actor].name}) is bidding…`
      : game.phase === "play"
        ? pendingHandoff ? `Pass the device to ${game.players[actor].name}, then show their hand.` : activeHuman ? (game.turn === game.dummy ? `${game.players[actor].compass} is playing dummy.` : `${game.players[game.turn].compass} to play.`) : `${game.players[actor].compass} is playing…`
        : game.passedOut ? "The auction was passed out. No score on this board." : game.result?.explanation || "Board complete.";
    $("status").textContent = messageText || status;
    $("scoreboard").innerHTML = `<table class="score-table"><thead><tr><th>Partnership</th><th>Total</th></tr></thead><tbody><tr><td>North–South</td><td>${game.totalScores[0]}</td></tr><tr><td>East–West</td><td>${game.totalScores[1]}</td></tr></tbody></table>`;
    $("history").innerHTML = game.history.slice(0, 100).map((entry) => `<div>${escapeHtml(entry)}</div>`).join("");
    $("resultBox").classList.toggle("hidden", !game.result || !game.over);
    if (game.result && !game.passedOut) {
      $("resultTitle").textContent = game.result.made ? "Contract made" : "Contract defeated";
      $("resultText").textContent = `${game.result.explanation} Declarer needed ${game.result.required} tricks; took ${game.result.declarerTricks}.`;
    } else if (game.passedOut) {
      $("resultTitle").textContent = "Passed out";
      $("resultText").textContent = "All four players passed. This board scores zero.";
    }
    $("trickHint").textContent = game.phase === "play" ? `${game.tricksWon.reduce((n, v) => n + v, 0)} of 13 tricks completed.` : game.phase === "complete" ? "Deal complete." : "Cards are not played until the auction ends.";
  }

  function runAI() {
    clearTimeout(aiTimer);
    if (game.over) { render(); return; }
    const actor = actorSeat();
    if (actor < 0 || game.players[actor].type !== "computer") { render(); return; }
    aiTimer = setTimeout(() => {
      if (game.over) return;
      if (game.phase === "auction") {
        let call = root.BridgeAI.chooseCall(game, game.turn);
        if (!game.canCall(game.turn, call)) call = { type: "pass" };
        game.makeCall(game.turn, call);
      } else if (game.phase === "play") {
        const seat = game.turn;
        const cardId = root.BridgeAI.chooseCard(game, seat);
        if (cardId) game.playCard(seat, cardId);
      }
      render();
      runAI();
    }, 360);
  }

  function parseSelectedBid() {
    const level = Number($("bidLevel").value);
    const strain = $("bidStrain").value;
    return { type: "bid", level, strain };
  }

  function makeHumanCall(call) {
    const seat = actorSeat();
    if (!currentActorIsHuman() || !handReady()) return;
    if (!game.canCall(seat, call)) {
      messageText = "That call is not legal in the current auction.";
      render();
      return;
    }
    messageText = "";
    game.makeCall(seat, call);
    render();
    runAI();
  }

  function playSelectedCard(cardId, source) {
    if (game.phase !== "play" || !handReady() || !currentActorIsHuman() || game.over) return;
    const seat = source === "dummy" ? game.dummy : game.turn;
    if (source === "dummy" && !(game.turn === game.dummy && actorSeat() === game.declarer)) return;
    if (source !== "dummy" && game.turn === game.dummy) return;
    const legal = game.legalCards(seat);
    if (!legal.some((card) => card.id === cardId)) {
      messageText = "You must follow suit if you have a card in the suit that was led.";
      render();
      return;
    }
    messageText = "";
    game.playCard(seat, cardId);
    render();
    runAI();
  }

  $("auctionBidBtn").addEventListener("click", () => makeHumanCall(parseSelectedBid()));
  $("passBtn").addEventListener("click", () => makeHumanCall({ type: "pass" }));
  $("doubleBtn").addEventListener("click", () => makeHumanCall({ type: "double" }));
  $("redoubleBtn").addEventListener("click", () => makeHumanCall({ type: "redouble" }));
  $("showHandBtn").addEventListener("click", () => {
    const seat = actorSeat();
    if (seat >= 0 && game.players[seat].type === "human") {
      lastShownSeat = seat;
      messageText = "";
      render();
      runAI();
    }
  });
  $("hand").addEventListener("click", (event) => {
    const card = event.target.closest("[data-card]");
    if (card) playSelectedCard(card.dataset.card, card.dataset.source || "main");
  });
  $("dummyHand").addEventListener("click", (event) => {
    const card = event.target.closest("[data-card]");
    if (card) playSelectedCard(card.dataset.card, "dummy");
  });
  $("nextBoardBtn").addEventListener("click", () => {
    if (!game.over) return;
    clearTimeout(aiTimer);
    game.newDeal();
    lastShownSeat = -1;
    messageText = "";
    render();
    runAI();
  });
  $("newMatchBtn").addEventListener("click", () => {
    clearTimeout(aiTimer);
    game = new BridgeGame(launchConfig);
    lastShownSeat = -1;
    messageText = "";
    render();
    runAI();
  });
  $("backBtn").addEventListener("click", () => { location.href = "../index.html"; });

  render();
  runAI();
})(typeof window !== "undefined" ? window : globalThis);
