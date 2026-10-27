(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let launchConfig = {};
  try {
    const raw = params.get("onlineConfig") || sessionStorage.getItem("gameLibraryOnlineConfig") || "";
    if (raw) launchConfig = JSON.parse(raw);
  } catch {}
  if (launchConfig.options && typeof launchConfig.options === "object") {
    launchConfig = { ...launchConfig, ...launchConfig.options };
  }

  let profiles = [];
  try { profiles = JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]"); } catch {}

  const SUITS = ["♣", "♦", "♥", "♠"];
  const ORDER = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };
  const rankLabel = (rank) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[rank] || String(rank));
  const cardText = (card) => `${rankLabel(card.rank)}${card.suit}`;
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cloneJson = (value) => JSON.parse(JSON.stringify(value));
  const validCard = (card) => Boolean(card && SUITS.includes(card.suit) && Number.isInteger(card.rank) && card.rank >= 1 && card.rank <= 13 && !String(card.id || "").startsWith("hidden-"));

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  function deck() {
    const cards = [];
    for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) cards.push({ id: `${suit}${rank}`, suit, rank });
    return shuffle(cards);
  }
  function sortHand(hand) { hand.sort((a, b) => ORDER[a.suit] - ORDER[b.suit] || a.rank - b.rank); }
  function cardHtml(card, selected = false) {
    const rank = rankLabel(card.rank);
    const color = card.suit === "♥" || card.suit === "♦" ? "red" : "black";
    return `<div class="card ${color} ${selected ? "selected" : ""}" data-card="${esc(card.id)}" role="button" tabindex="0" aria-label="${rank} ${card.suit}"><span class="corner"><span>${rank}</span><span>${card.suit}</span></span><span class="face"><span class="center-rank">${rank}</span><span class="center-suit">${card.suit}</span></span><span class="bottom"><span>${rank}</span><span>${card.suit}</span></span></div>`;
  }

  class SpadesGame {
    constructor(config = {}) {
      this.cfg = config;
      const source = config.players || [];
      const fallback = [
        { type: "human", name: profiles[0]?.name || "Player 1", avatar: profiles[0]?.avatar || "♟", profileId: profiles[0]?.id || "" },
        { type: "computer", name: "Computer 2", avatar: "🤖" },
        { type: "computer", name: "Computer 3", avatar: "🤖" },
        { type: "computer", name: "Computer 4", avatar: "🤖" },
      ];
      this.players = (source.length ? source : fallback).slice(0, 4).map((player, index) => ({
        ...player,
        type: player.type === "computer" ? "computer" : "human",
        name: player.name || `Player ${index + 1}`,
        avatar: player.avatar || (player.type === "computer" ? "🤖" : "🃏"),
      }));
      while (this.players.length < 4) {
        const index = this.players.length;
        this.players.push({ type: "computer", name: `Computer ${index + 1}`, avatar: "🤖" });
      }
      this.teamScores = [0, 0];
      this.bags = [0, 0];
      this.handNo = 1;
      this.startHand();
    }
    startHand() {
      this.hands = [[], [], [], []];
      deck().forEach((card, index) => this.hands[index % 4].push(card));
      this.hands.forEach(sortHand);
      this.bids = [null, null, null, null];
      this.tricks = [0, 0, 0, 0];
      this.trick = [];
      this.trickNo = 0;
      this.spadesBroken = false;
      this.phase = "bid";
      this.turn = 0;
      this.over = false;
      this.matchOver = false;
      this.history = [];
      this.selected = null;
      this.log(`Hand ${this.handNo} begins. Players bid in order.`);
    }
    log(message) { this.history.unshift(message); }
    bid(player, amount) {
      if (this.phase !== "bid" || this.over || player !== this.turn || this.bids[player] !== null || !Number.isInteger(amount) || amount < 0 || amount > 13) return false;
      this.bids[player] = amount;
      this.log(`${this.players[player].name} bids ${amount}.`);
      if (this.bids.every((value) => value !== null)) {
        this.phase = "play";
        this.turn = 0;
        this.log(`Bids complete: Team NS ${this.bids[0] + this.bids[2]}, Team EW ${this.bids[1] + this.bids[3]}.`);
      } else {
        this.turn = this.bids.findIndex((value) => value === null);
      }
      return true;
    }
    legalCards(player) {
      const hand = this.hands[player] || [];
      if (this.trick.length) {
        const leadSuit = this.trick[0].card.suit;
        const following = hand.filter((card) => card.suit === leadSuit);
        if (following.length) return following;
      }
      if (!this.trick.length && !this.spadesBroken && hand.some((card) => card.suit !== "♠")) return hand.filter((card) => card.suit !== "♠");
      return hand;
    }
    winnerIndex() {
      let best = 0;
      const leadSuit = this.trick[0].card.suit;
      for (let i = 1; i < this.trick.length; i++) {
        const candidate = this.trick[i].card;
        const current = this.trick[best].card;
        if ((candidate.suit === "♠" && current.suit !== "♠") || (candidate.suit === current.suit && candidate.rank > current.rank)) best = i;
        else if (candidate.suit === leadSuit && current.suit !== "♠" && current.suit !== leadSuit) best = i;
      }
      return best;
    }
    play(player, cardId) {
      if (this.phase !== "play" || this.over || player !== this.turn) return false;
      const card = this.legalCards(player).find((candidate) => candidate.id === cardId);
      if (!card) return false;
      this.hands[player] = this.hands[player].filter((candidate) => candidate.id !== cardId);
      this.trick.push({ player, card });
      this.selected = null;
      this.log(`${this.players[player].name} plays ${cardText(card)}.`);
      if (card.suit === "♠") this.spadesBroken = true;
      if (this.trick.length === 4) {
        const winner = this.trick[this.winnerIndex()].player;
        this.tricks[winner]++;
        this.trickNo++;
        this.log(`${this.players[winner].name} wins trick ${this.trickNo}.`);
        this.trick = [];
        this.turn = winner;
        if (this.trickNo === 13) this.finishHand();
      } else {
        this.turn = (player + 1) % 4;
      }
      return true;
    }
    finishHand() {
      for (let team = 0; team < 2; team++) {
        const members = team === 0 ? [0, 2] : [1, 3];
        const bid = members.reduce((total, player) => total + this.bids[player], 0);
        const taken = members.reduce((total, player) => total + this.tricks[player], 0);
        if (taken >= bid) {
          const score = bid * 10 + (taken - bid);
          this.teamScores[team] += score;
          this.bags[team] += taken - bid;
          this.log(`Team ${team === 0 ? "NS" : "EW"} makes ${bid} bid and takes ${taken}: +${score}.`);
        } else {
          this.teamScores[team] -= bid * 10;
          this.log(`Team ${team === 0 ? "NS" : "EW"} misses ${bid} bid with ${taken}: -${bid * 10}.`);
        }
        if (this.bags[team] >= 10) {
          const penalty = Math.floor(this.bags[team] / 10) * 100;
          this.teamScores[team] -= penalty;
          this.bags[team] %= 10;
          this.log(`Team ${team === 0 ? "NS" : "EW"} pays ${penalty} for 10 bags.`);
        }
      }
      this.over = true;
      if (this.teamScores.some((score) => score >= 500)) {
        this.matchOver = true;
        const northSouth = this.teamScores[0], eastWest = this.teamScores[1];
        this.winner = northSouth === eastWest ? -1 : northSouth > eastWest ? 0 : 1;
        this.log(this.winner < 0 ? "Game ends tied." : `Team ${this.winner === 0 ? "NS" : "EW"} wins the game!`);
      } else {
        this.log("Hand complete. Start the next hand when ready.");
      }
    }
  }

  const ONLINE_SERVER_URL = params.get("onlineServer") || params.get("server") || "";
  const ONLINE_CODE = params.get("onlineCode") || params.get("onlineJoinedCode") || params.get("code") || "";
  const ONLINE_HOST_TOKEN = params.get("onlineHostToken") || params.get("hostToken") || "";
  const ONLINE_CLIENT_ID = params.get("onlineClientId") || params.get("clientId") || (() => { try { return sessionStorage.getItem("gameLibraryOnlineClientId") || ""; } catch { return ""; } })() || `client_${Math.random().toString(36).slice(2, 12)}`;
  const ONLINE_MODE = Boolean(ONLINE_SERVER_URL && ONLINE_CODE);
  const IS_ONLINE_HOST = Boolean(ONLINE_MODE && ONLINE_HOST_TOKEN);
  const HOST_STATE_KEY = `openGameGallerySpadesHostState:${ONLINE_CODE}`;
  try { sessionStorage.setItem("gameLibraryOnlineClientId", ONLINE_CLIENT_ID); } catch {}

  let game = new SpadesGame(launchConfig);
  let aiTimer = null;
  let onlineSocket = null;
  let onlineConnected = false;
  let onlineParticipants = [];
  let onlineMatchId = "";
  let pendingOnlineAction = false;
  let messageText = "";

  function seatIsLocalHuman(seat) {
    const player = game.players[seat];
    if (!player || player.type !== "human") return false;
    return ONLINE_MODE ? player.controllerClientId === ONLINE_CLIENT_ID : seat === 0;
  }
  function localHumanSeats() { return game.players.map((_, seat) => seatIsLocalHuman(seat) ? seat : -1).filter((seat) => seat >= 0); }
  function seatHasPrivateHand(seat) { return seat >= 0 && Array.isArray(game.hands?.[seat]) && game.hands[seat].every(validCard); }
  function activeHumanTurn() {
    if (game.over || pendingOnlineAction) return false;
    if (!ONLINE_MODE) return game.turn === 0 && game.players[0]?.type === "human";
    return seatIsLocalHuman(game.turn) && seatHasPrivateHand(game.turn);
  }
  function displayHandSeat() {
    if (!ONLINE_MODE) return 0;
    if (seatIsLocalHuman(game.turn)) return game.turn;
    return localHumanSeats()[0] ?? -1;
  }
  function setOnlineStatus(message, isError = false) {
    const el = $("modeText");
    if (!el) return;
    el.classList.toggle("hidden", !message);
    el.classList.toggle("error", Boolean(isError));
    el.textContent = message || "";
  }
  function assignOnlineSeats() {
    if (!ONLINE_MODE || !IS_ONLINE_HOST || !Array.isArray(game.players)) return;
    const participants = onlineParticipants.filter((p) => p && p.clientId && p.spectator !== true);
    const participantIds = new Set(participants.map((p) => p.clientId));
    const idOf = (value) => String(value || "");
    const ownsProfile = (participant, profileId) => Boolean(profileId) && (idOf(participant.profileId) === idOf(profileId) || (participant.party || []).some((member) => idOf(member.id) === idOf(profileId)));

    for (const player of game.players) {
      if (player.type !== "human") { delete player.controllerClientId; continue; }
      if (!player.controllerClientId) continue;
      if (!participantIds.has(player.controllerClientId)) player.controllerClientId = "";
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
        const free = game.players.find((p) => p.type === "human" && !p.controllerClientId);
        if (free) free.controllerClientId = host.clientId;
      }
    }
    const used = new Set(game.players.filter((p) => p.type === "human" && p.controllerClientId).map((p) => p.controllerClientId));
    for (const player of game.players) {
      if (player.type !== "human" || player.controllerClientId) continue;
      const participant = participants.find((p) => !used.has(p.clientId));
      if (participant) { player.controllerClientId = participant.clientId; used.add(participant.clientId); }
    }
    // If setup contains more human seats than connected controllers, convert the
    // unassigned seats to computers rather than leaving the game stuck on them.
    for (const player of game.players) {
      if (player.type === "human" && !player.controllerClientId) {
        player.type = "computer";
        player.name = player.name || "Computer";
        player.avatar = player.avatar || "🤖";
      }
    }
    launchConfig.players = cloneJson(game.players);
  }
  function publicGameState() {
    const snapshot = cloneJson(game);
    snapshot.hands = snapshot.hands.map((hand, seat) => hand.map((_, index) => ({ id: `hidden-${seat}-${index}`, suit: "?", rank: 0 })));
    snapshot.selected = null;
    return { game: snapshot };
  }
  function publishPrivateHands() {
    if (!ONLINE_MODE || !IS_ONLINE_HOST || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
    const byClient = new Map();
    for (let seat = 0; seat < game.players.length; seat++) {
      const player = game.players[seat];
      if (player.type !== "human" || !player.controllerClientId) continue;
      if (!onlineParticipants.some((p) => p.clientId === player.controllerClientId && p.spectator !== true && p.connected !== false)) continue;
      if (!byClient.has(player.controllerClientId)) byClient.set(player.controllerClientId, []);
      byClient.get(player.controllerClientId).push({ seat, cards: cloneJson(game.hands[seat]) });
    }
    for (const [targetClientId, hands] of byClient) {
      if (targetClientId === ONLINE_CLIENT_ID) continue;
      onlineSocket.send(JSON.stringify({ type: "game:private", targetClientId, payload: { spadesMessage: "privateHands", targetClientId, hands, matchId: onlineMatchId } }));
    }
  }
  function publishOnlineState() {
    if (!ONLINE_MODE || !IS_ONLINE_HOST || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
    try {
      sessionStorage.setItem(HOST_STATE_KEY, JSON.stringify({ matchId: onlineMatchId, game: cloneJson(game) }));
      onlineSocket.send(JSON.stringify({ type: "game:state", state: publicGameState() }));
      publishPrivateHands();
      setOnlineStatus(`Connected · ${onlineParticipants.length} participant${onlineParticipants.length === 1 ? "" : "s"} · game synchronized`);
    } catch (error) {
      setOnlineStatus(`Could not synchronize game: ${error.message || error}`, true);
    }
  }
  function applySnapshot(state) {
    const incoming = state?.game || state;
    if (!incoming || !Array.isArray(incoming.hands) || !Array.isArray(incoming.players)) return false;
    try {
      const restored = new SpadesGame(launchConfig);
      Object.assign(restored, incoming);
      restored.cfg = launchConfig;
      restored.selected = null;
      game = restored;
      pendingOnlineAction = false;
      messageText = "";
      render();
      return true;
    } catch (error) {
      console.warn("Could not apply online Spades state:", error);
      return false;
    }
  }
  function applyPrivateHands(payload) {
    if (!payload || !Array.isArray(payload.hands) || payload.matchId !== onlineMatchId || payload.targetClientId !== ONLINE_CLIENT_ID) return;
    let changed = false;
    for (const entry of payload.hands) {
      if (Number.isInteger(entry.seat) && entry.seat >= 0 && entry.seat < game.hands.length && Array.isArray(entry.cards) && seatIsLocalHuman(entry.seat)) {
        game.hands[entry.seat] = cloneJson(entry.cards);
        changed = true;
      }
    }
    if (changed) render();
  }
  function restoreCachedHostState() {
    if (!IS_ONLINE_HOST || !onlineMatchId) return false;
    try {
      const cached = JSON.parse(sessionStorage.getItem(HOST_STATE_KEY) || "null");
      if (!cached || cached.matchId !== onlineMatchId || !cached.game || !Array.isArray(cached.game.hands)) return false;
      const restored = new SpadesGame(launchConfig);
      Object.assign(restored, cached.game);
      restored.cfg = launchConfig;
      restored.selected = null;
      game = restored;
      return true;
    } catch { return false; }
  }
  function sendOnlineAction(action) {
    if (!ONLINE_MODE || IS_ONLINE_HOST) return false;
    if (!onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) {
      messageText = "Online connection is unavailable. Your action was not sent.";
      render();
      return false;
    }
    if (pendingOnlineAction) return false;
    pendingOnlineAction = true;
    messageText = "Action sent · waiting for the host…";
    onlineSocket.send(JSON.stringify({ type: "game:move", payload: { ...action, matchId: onlineMatchId } }));
    render();
    return true;
  }
  function onlineWsUrl() {
    const base = ONLINE_SERVER_URL.replace(/^http/i, "ws").replace(/\/$/, "");
    const query = new URLSearchParams({ role: "player", clientId: ONLINE_CLIENT_ID });
    if (ONLINE_HOST_TOKEN) query.set("token", ONLINE_HOST_TOKEN);
    return `${base}/ws/${encodeURIComponent(ONLINE_CODE)}?${query.toString()}`;
  }
  function connectOnlineGame() {
    if (!ONLINE_MODE) return;
    setOnlineStatus("Connecting to online room…");
    try { onlineSocket = new WebSocket(onlineWsUrl()); }
    catch (error) { setOnlineStatus(`Could not connect: ${error.message || error}`, true); return; }
    onlineSocket.addEventListener("open", () => {
      onlineConnected = true;
      setOnlineStatus("Connected · registering player…");
      const ownSeat = game.players.find((player) => player.controllerClientId === ONLINE_CLIENT_ID);
      const profile = profiles.find((p) => p.id === (ownSeat?.profileId || "")) || profiles[0] || {};
      let party = [];
      try { party = JSON.parse(sessionStorage.getItem("gameLibraryParty") || "[]").map((id) => profiles.find((profile) => profile.id === id)).filter(Boolean); } catch {}
      onlineSocket.send(JSON.stringify({ type: "player:identify", profileId: profile.id || "", name: profile.name || "Player", avatar: profile.avatar || "🃏", party: party.map((p) => ({ id: p.id, name: p.name || "Player", avatar: p.avatar || "🃏" })) }));
    });
    onlineSocket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "player:identified") {
        setOnlineStatus(`Connected · registered as ${message.player?.name || "Player"}`);
        return;
      }
      if (message.type === "room:hello") {
        onlineParticipants = message.room?.participants || [];
        onlineMatchId = message.room?.matchId || onlineMatchId;
        const roomConfig = message.room?.config;
        if (roomConfig && Object.keys(roomConfig).length) {
          launchConfig = { ...launchConfig, ...roomConfig };
          if (Array.isArray(roomConfig.players) && roomConfig.players.length) launchConfig.players = roomConfig.players;
        }
        game = new SpadesGame(launchConfig);
        if (IS_ONLINE_HOST) restoreCachedHostState();
        if (IS_ONLINE_HOST) assignOnlineSeats();
        else if (message.state?.game) applySnapshot(message.state);
        render();
        if (IS_ONLINE_HOST) {
          setTimeout(() => { assignOnlineSeats(); runAI(); publishOnlineState(); render(); }, 120);
        } else if (message.room?.started && !message.state?.game) {
          setOnlineStatus("Connected · waiting for host to synchronize the deal…");
        }
        return;
      }
      if (message.type === "room:participants") {
        onlineParticipants = Array.isArray(message.participants) ? message.participants : [];
        if (IS_ONLINE_HOST) { assignOnlineSeats(); runAI(); publishOnlineState(); }
        setOnlineStatus(`Connected · ${onlineParticipants.length} participant${onlineParticipants.length === 1 ? "" : "s"}`);
        render();
        return;
      }
      if (message.type === "room:config") {
        if (!IS_ONLINE_HOST || !game.over) return;
        launchConfig = message.config || launchConfig;
        game = new SpadesGame(launchConfig);
        assignOnlineSeats(); runAI(); publishOnlineState(); render();
        return;
      }
      if (message.type === "game:start") {
        onlineMatchId = message.matchId || onlineMatchId;
        launchConfig = message.config || launchConfig;
        if (IS_ONLINE_HOST) {
          game = new SpadesGame(launchConfig);
          assignOnlineSeats(); runAI(); publishOnlineState(); render();
        } else if (message.state?.game) {
          applySnapshot(message.state);
        } else {
          pendingOnlineAction = false;
          setOnlineStatus("Connected · waiting for host to synchronize the deal…");
        }
        return;
      }
      if (message.type === "game:state") {
        if (!IS_ONLINE_HOST) applySnapshot(message.state);
        return;
      }
      if (message.type === "game:private") {
        const payload = message.payload;
        if (payload?.spadesMessage === "privateHands" && payload.targetClientId === ONLINE_CLIENT_ID && payload.matchId === onlineMatchId) applyPrivateHands(payload);
        return;
      }
      if (message.type === "game:move") {
        if (!IS_ONLINE_HOST || message.sender?.clientId === ONLINE_CLIENT_ID) return;
        const action = message.payload;
        if (!action || (action.matchId && onlineMatchId && action.matchId !== onlineMatchId)) { publishOnlineState(); return; }
        const seat = Number(action.seat);
        const player = game.players[seat];
        if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !player || player.type !== "human" || player.controllerClientId !== message.sender?.clientId) { publishOnlineState(); return; }
        let accepted = false;
        if (action.kind === "bid" && game.phase === "bid" && Number.isInteger(action.amount)) accepted = game.bid(seat, action.amount);
        else if (action.kind === "play" && game.phase === "play" && seat === game.turn && typeof action.cardId === "string") accepted = game.play(seat, action.cardId);
        if (accepted) {
          pendingOnlineAction = false;
          messageText = "";
          render();
          publishOnlineState();
          runAI();
        } else {
          publishOnlineState();
        }
        return;
      }
      if (message.type === "game:back") { location.href = "../index.html"; return; }
      if (message.type === "error") setOnlineStatus(`Server error: ${message.message || message.code || "Unknown error"}`, true);
    });
    onlineSocket.addEventListener("close", () => { onlineConnected = false; setOnlineStatus("Disconnected from online room", true); render(); });
    onlineSocket.addEventListener("error", () => { onlineConnected = false; setOnlineStatus("Online connection error", true); render(); });
  }

  function teamName(team) { return team === 0 ? "Team NS" : "Team EW"; }
  function renderPlayers() {
    $("playerList").innerHTML = game.players.map((player, index) => {
      let label = player.type === "computer" ? "Computer" : "Local player";
      if (ONLINE_MODE && player.type === "human") {
        label = player.controllerClientId === ONLINE_CLIENT_ID ? "You · this device" : onlineParticipants.some((participant) => participant.clientId === player.controllerClientId && participant.connected) ? "Online player · connected" : "Online player";
      }
      return `<div class="player-row ${!game.over && game.turn === index ? "current" : ""}"><div class="avatar">${esc(player.avatar)}</div><div><div class="player-name">${esc(player.name)}</div><div class="player-sub">${index % 2 === 0 ? "Team NS" : "Team EW"} · ${label}</div></div><div class="score">${game.bids[index] === null ? "—" : `Bid ${game.bids[index]}`}<br>${game.tricks[index]} tricks</div></div>`;
    }).join("");
  }
  function render() {
    renderPlayers();
    const handSeat = displayHandSeat();
    const shownPlayer = handSeat >= 0 ? game.players[handSeat] : null;
    const currentPlayer = game.players[game.turn];
    const canAct = activeHumanTurn();
    $("roundInfo").textContent = `Hand ${game.handNo} · ${game.phase === "bid" ? "Bidding" : `Trick ${Math.min(game.trickNo + 1, 13)} of 13`}`;
    $("tableLabel").textContent = game.phase === "bid" ? "Bidding" : "Current trick";
    $("trickCaption").textContent = game.over
      ? (game.matchOver ? (game.winner < 0 ? "The game is tied." : `${teamName(game.winner)} wins!`) : "Hand complete.")
      : game.phase === "bid"
        ? `${currentPlayer.name}, how many tricks do you expect to take?`
        : `${currentPlayer.name}'s turn · ${game.trick.length}/4 cards played`;
    $("trickMeta").textContent = game.phase === "bid"
      ? `Your team's partner bid: ${game.bids[handSeat >= 0 ? (handSeat + 2) % 4 : 2] === null ? "not yet made" : game.bids[handSeat >= 0 ? (handSeat + 2) % 4 : 2]}`
      : `Spades ${game.spadesBroken ? "broken" : "not broken"} · Team NS ${game.tricks[0] + game.tricks[2]} tricks · Team EW ${game.tricks[1] + game.tricks[3]} tricks`;
    $("tableCards").innerHTML = game.trick.map((entry) => `<div class="played-card"><div>${esc(game.players[entry.player].name)}</div>${cardHtml(entry.card)}</div>`).join("");

    const hand = handSeat >= 0 && seatHasPrivateHand(handSeat) ? game.hands[handSeat] : [];
    $("handTitle").textContent = shownPlayer ? `${shownPlayer.name}'s hand` : "Your hand";
    if (hand.length) $("hand").innerHTML = hand.map((card) => cardHtml(card, game.selected === card.id)).join("");
    else if (ONLINE_MODE && handSeat >= 0 && !game.over) $("hand").innerHTML = '<div class="note">Synchronizing your private hand…</div>';
    else if (game.over) $("hand").innerHTML = '<div class="note">Hand complete.</div>';
    else if (ONLINE_MODE) $("hand").innerHTML = '<div class="note">No hand is assigned to this device. Waiting for the next update…</div>';
    else $("hand").innerHTML = '<div class="note">No human hand is available.</div>';
    $("handHint").textContent = messageText || (canAct ? (game.phase === "bid" ? "Choose your bid and submit it." : "Select a legal card to play.") : ONLINE_MODE && pendingOnlineAction ? "Waiting for the host to confirm your move…" : ONLINE_MODE ? "Waiting for your turn." : "Your hand is shown for reference.");

    $("bidControls").classList.toggle("hidden", game.phase !== "bid" || !canAct);
    $("playActions").classList.toggle("hidden", game.phase !== "play" || !canAct);
    $("bidBtn").disabled = !canAct || game.bids[ONLINE_MODE ? game.turn : 0] !== null;
    $("bidSelect").disabled = !canAct || game.bids[ONLINE_MODE ? game.turn : 0] !== null;
    $("nextRoundBtn").disabled = !game.over || game.matchOver || (ONLINE_MODE && !IS_ONLINE_HOST);
    $("newGameBtn").disabled = ONLINE_MODE && !IS_ONLINE_HOST;
    $("status").textContent = game.over
      ? (game.matchOver ? "Match finished." : "Hand finished.")
      : pendingOnlineAction ? "Move sent · waiting for the host…"
        : ONLINE_MODE && !seatIsLocalHuman(game.turn) ? `${currentPlayer.name}'s turn.`
          : game.phase === "bid" ? `${currentPlayer.name} is bidding.` : `${currentPlayer.name} to play.`;
    $("scoreboard").innerHTML = `<table class="score-table"><thead><tr><th>Team</th><th>Score</th><th>Bags</th></tr></thead><tbody><tr><td>NS (P1 + P3)</td><td>${game.teamScores[0]}</td><td>${game.bags[0]}</td></tr><tr><td>EW (P2 + P4)</td><td>${game.teamScores[1]}</td><td>${game.bags[1]}</td></tr></tbody></table><p class="note">Current hand bids: NS ${game.bids[0] === null || game.bids[2] === null ? "—" : game.bids[0] + game.bids[2]} · EW ${game.bids[1] === null || game.bids[3] === null ? "—" : game.bids[1] + game.bids[3]}</p>`;
    $("history").innerHTML = game.history.map((entry) => `<div>${esc(entry)}</div>`).join("");
  }
  function aiBid(player) { return window.SpadesAI.bid(game.hands[player]); }
  function runAI() {
    clearTimeout(aiTimer);
    if (game.over || (ONLINE_MODE && !IS_ONLINE_HOST)) return;
    if (game.players[game.turn]?.type !== "computer") return;
    const isBidding = game.phase === "bid";
    aiTimer = setTimeout(() => {
      if (game.over || game.players[game.turn]?.type !== "computer") return;
      const seat = game.turn;
      if (game.phase === "bid") game.bid(seat, aiBid(seat));
      else {
        const cardId = window.SpadesAI.play(game, seat);
        if (cardId) game.play(seat, cardId);
      }
      messageText = "";
      render();
      if (ONLINE_MODE && IS_ONLINE_HOST) publishOnlineState();
      runAI();
    }, isBidding ? 260 : 420);
  }
  function submitBid() {
    const seat = ONLINE_MODE ? game.turn : 0;
    const amount = Number($("bidSelect").value);
    if (!activeHumanTurn()) return;
    if (ONLINE_MODE && !IS_ONLINE_HOST) {
      sendOnlineAction({ kind: "bid", seat, amount });
      return;
    }
    if (game.bid(seat, amount)) {
      messageText = "";
      render();
      if (ONLINE_MODE) publishOnlineState();
      runAI();
    }
  }
  function handleCardClick(element) {
    if (!element || game.phase !== "play" || !activeHumanTurn()) return;
    const seat = ONLINE_MODE ? game.turn : 0;
    const cardId = element.dataset.card;
    if (!game.legalCards(seat).some((card) => card.id === cardId)) {
      messageText = "Illegal play: follow suit if possible, and do not lead spades until broken unless you only have spades.";
      render();
      return;
    }
    if (ONLINE_MODE && !IS_ONLINE_HOST) {
      sendOnlineAction({ kind: "play", seat, cardId });
      return;
    }
    if (game.play(seat, cardId)) {
      messageText = "";
      render();
      if (ONLINE_MODE) publishOnlineState();
      runAI();
    }
  }

  for (let i = 0; i <= 13; i++) {
    const option = document.createElement("option");
    option.value = String(i); option.textContent = String(i);
    if (i === 3) option.selected = true;
    $("bidSelect").appendChild(option);
  }
  $("hand").addEventListener("click", (event) => handleCardClick(event.target.closest(".card")));
  $("hand").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const element = event.target.closest(".card");
      if (element) { event.preventDefault(); handleCardClick(element); }
    }
  });
  $("bidBtn").addEventListener("click", submitBid);
  $("clearBtn").addEventListener("click", () => { game.selected = null; messageText = ""; render(); });
  $("nextRoundBtn").addEventListener("click", () => {
    if (!game.over || game.matchOver || (ONLINE_MODE && !IS_ONLINE_HOST)) return;
    game.handNo++;
    game.startHand();
    messageText = "";
    render();
    if (ONLINE_MODE) publishOnlineState();
    runAI();
  });
  $("newGameBtn").addEventListener("click", () => {
    if (ONLINE_MODE && !IS_ONLINE_HOST) return;
    clearTimeout(aiTimer);
    game = new SpadesGame(launchConfig);
    if (ONLINE_MODE) assignOnlineSeats();
    messageText = "";
    render();
    if (ONLINE_MODE) publishOnlineState();
    runAI();
  });
  $("backBtn").addEventListener("click", () => {
    if (ONLINE_MODE && IS_ONLINE_HOST && onlineSocket && onlineSocket.readyState === WebSocket.OPEN) onlineSocket.send(JSON.stringify({ type: "game:back" }));
    location.href = "../index.html";
  });

  if (ONLINE_MODE) {
    $("modeText")?.classList.remove("hidden");
    connectOnlineGame();
  } else {
    setOnlineStatus("Local game · online mode not enabled");
    render();
    runAI();
  }

  window.__spadesOnlineDebug = () => ({ online: ONLINE_MODE, host: IS_ONLINE_HOST, connected: onlineConnected, matchId: onlineMatchId, phase: game.phase, turn: game.turn, over: game.over, matchOver: game.matchOver, players: game.players.map((player) => ({ name: player.name, type: player.type, controllerClientId: player.controllerClientId })), handCounts: game.hands.map((hand) => hand.length), privateHands: game.hands.map((hand) => hand.every(validCard)) });
})();
