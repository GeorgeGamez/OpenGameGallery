/* Shared Standard Eins / Eins Flip local multiplayer controller. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  let launchConfig = {};
  try {
    const raw = params.get("onlineConfig") || sessionStorage.getItem("gameLibraryOnlineConfig") || "";
    if (raw) launchConfig = JSON.parse(raw);
  } catch (error) {
    console.warn("Could not read the game launch configuration.", error);
  }

  const selectedVariant = params.get("variant") || launchConfig.variant || "eins";
  if (params.get("online") === "1") {
    showNotice("Online play is not available in this build", "This rebuild starts with local play. Online support will be added after the Standard and Flip game logic has been stabilised.");
    return;
  }

  function showNotice(title, message) {
    $("gameApp").classList.add("hidden");
    $("variantNotice").classList.remove("hidden");
    $("variantNoticeTitle").textContent = title;
    $("variantNoticeText").textContent = message;
    $("variantBackBtn").addEventListener("click", () => { window.location.href = "../index.html"; });
    $("backBtn").addEventListener("click", () => { window.location.href = "../index.html"; });
  }

  const profiles = (() => {
    try { return JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]"); }
    catch { return []; }
  })();

  const config = { ...launchConfig, ...(launchConfig.options || {}), variant: selectedVariant };
  if (!Array.isArray(config.players) || !config.players.length) {
    const firstProfile = profiles[0] || {};
    config.players = [
      { id: firstProfile.id || "player-1", type: "human", name: firstProfile.name || "Player 1", avatar: firstProfile.avatar || "♟" },
      { id: "computer-1", type: "computer", name: "Computer 2", avatar: "🤖" },
      { id: "computer-2", type: "computer", name: "Computer 3", avatar: "🤖" },
      { id: "computer-3", type: "computer", name: "Computer 4", avatar: "🤖" },
    ];
  }

  const GameClass = selectedVariant === "flip" ? window.EinsRules.EinsFlipGame : window.EinsRules.EinsGame;
  let game = new GameClass(config);
  let selectedCardId = null;
  let aiTimer = null;
  let blackoutTimer = null;
  let lastTurnPlayer = null;
  let einsTimerTimeout = null;
  let einsTimerInterval = null;
  let einsTimerDeadline = 0;
  let einsTimerKey = null;

  const humanCount = game.players.filter((player) => player.type === "human").length;
  const optionText = [
    `Stacking: ${game.options.stacking ? "On" : "Off"}`,
    `Draw Until Playable: ${game.options.drawUntilPlayable ? "On" : "Off"}`,
  ];
  $("optionSummary").textContent = optionText.join(" · ") + ". These options are set before the game starts.";
  $("gameTitle").textContent = selectedVariant === "flip" ? "Eins Flip" : "Standard Eins";
  $("rulesText").textContent = selectedVariant === "flip"
    ? "112 double-sided cards. Start on the Light Side; Flip cards turn over the draw pile, discard pile, and every hand. Light actions: Draw One, Skip, Reverse, Flip, Wild, and Wild Draw Two. Dark actions: Draw Five, Skip Everyone, Reverse, Flip, Wild, and Wild Draw Colour."
    : "Standard 108-card deck, seven cards per player, matching by colour or symbol, plain Wild, Wild Draw Four, Skip, Reverse, and Draw Two. Optional stacking and Draw Until Playable are configured before the game. Draw penalties are collected one card per click.";
  $("backBtn").addEventListener("click", () => { window.location.href = "../index.html"; });

  function playerName(index) {
    return game.players[index]?.name || `Player ${index + 1}`;
  }

  function isHumanTurn() {
    return !game.isFinished && game.players[game.currentPlayer]?.type === "human";
  }

  function stopEinsTimer() {
    window.clearTimeout(einsTimerTimeout);
    window.clearInterval(einsTimerInterval);
    einsTimerTimeout = null;
    einsTimerInterval = null;
    einsTimerDeadline = 0;
    einsTimerKey = null;
  }

  function updateEinsTimerDisplay() {
    const remaining = Math.max(0, einsTimerDeadline - Date.now());
    $("callEinsBtn").textContent = `Call EINS (${(remaining / 1000).toFixed(1)}s)`;
    $("einsTimerBar").style.width = `${Math.min(100, (remaining / 2000) * 100)}%`;
  }

  function syncEinsTimer() {
    const active = game.phase === "callEins" && Boolean(game.pendingEffect);
    const human = isHumanTurn();
    $("einsTimerPanel").classList.toggle("hidden", !active || !human);
    $("callEinsBtn").classList.toggle("hidden", !active || !human);
    if (!active) {
      if (einsTimerKey !== null) stopEinsTimer();
      return;
    }

    const key = `${game.pendingEffect.playerIndex}:${game.pendingEffect.card.id}`;
    if (einsTimerKey !== key) {
      stopEinsTimer();
      einsTimerKey = key;
      einsTimerDeadline = Date.now() + 2000;
      einsTimerTimeout = window.setTimeout(() => {
        if (einsTimerKey !== key || game.phase !== "callEins") return;
        const playerIndex = game.currentPlayer;
        stopEinsTimer();
        if (game.skipEinsCall(playerIndex)) {
          selectedCardId = null;
          render();
          runAI();
        }
      }, 2000);
      einsTimerInterval = window.setInterval(updateEinsTimerDisplay, 50);
    }
    updateEinsTimerDisplay();
  }

  function startTurnBlackoutIfNeeded() {
    if (lastTurnPlayer !== null && lastTurnPlayer !== game.currentPlayer && humanCount > 1 && isHumanTurn()) {
      window.clearTimeout(blackoutTimer);
      $("blackoutTitle").textContent = `Pass to ${playerName(game.currentPlayer)}`;
      $("blackoutText").textContent = "The next player's hand will appear in a moment.";
      $("blackout").classList.remove("hidden");
      blackoutTimer = window.setTimeout(() => {
        $("blackout").classList.add("hidden");
      }, 2000);
    }
    lastTurnPlayer = game.currentPlayer;
  }

  function renderPlayers() {
    $("playerList").innerHTML = game.players.map((player, index) => {
      const active = !game.isFinished && game.currentPlayer === index;
      const count = game.hands[index]?.length ?? 0;
      const cardText = count === 1 ? "1 card" : `${count} cards`;
      return `<div class="player-row${active ? " current" : ""}">
        <div class="avatar">${escapeHTML(player.avatar)}</div>
        <div><div class="player-name">${escapeHTML(player.name)}</div><div class="player-sub">${player.type === "computer" ? "Computer" : "Local player"}</div></div>
        <div class="player-count">${cardText}</div>
      </div>`;
    }).join("");
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function currentMessage() {
    const name = playerName(game.currentPlayer);
    if (game.isFinished) return game.isDraw ? "The round is a draw because no more playable cards or draw cards remain." : `${playerName(game.winner)} wins this game.`;
    if (game.phase === "callEins") return `${name} has one card left. They have two seconds to call EINS.`;
    if (game.phase === "chooseColor") return `${name} must choose the colour for the Wild card.`;
    if (game.phase === "catchPenalty") return `${playerName(game.catchTarget)} must receive ${game.catchRemaining} more catch-penalty card${game.catchRemaining === 1 ? "" : "s"}.`;
    if (game.missedUnoPlayer !== null && game.missedUnoPlayer !== game.currentPlayer) return `${name} may catch ${playerName(game.missedUnoPlayer)} for not calling EINS, or continue the turn.`;
    if (game.hasPendingPenalty()) {
      if (game.pendingPenaltyType === "wildDrawColor") return `${name} must draw until they find ${game.pendingDrawColor}, one card at a time.`;
      const canStack = game.options.stacking && !game.penaltyDrawStarted && game.playableCards().length > 0;
      if (game.penaltyDrawStarted) {
        return `${name} must finish drawing the ${game.pendingPenalty} remaining penalty card${game.pendingPenalty === 1 ? "" : "s"}, one click at a time.`;
      }
      return canStack
        ? `${name} must draw ${game.pendingPenalty} card${game.pendingPenalty === 1 ? "" : "s"}, or stack a matching draw card before drawing.`
        : `${name} must draw ${game.pendingPenalty} penalty card${game.pendingPenalty === 1 ? "" : "s"}, one click at a time.`;
    }
    if (game.turnDraw?.status === "mustDraw") return `${name} must continue drawing until a playable card is found.`;
    if (game.turnDraw?.status === "pass") return `${name} has drawn. They may pass${game.options.drawUntilPlayable ? " because the draw pile is empty" : ""}.`;
    if (game.turnDraw?.status === "playable") return `${name} drew a playable card. Select that card and press Play, or pass if Draw Until Playable is off.`;
    return `${name}'s turn. Select a playable card, or draw if no card can be played.`;
  }

  function render() {
    startTurnBlackoutIfNeeded();
    renderPlayers();
    $("roundInfo").textContent = `Round ${game.roundNumber} · ${game.players.length} players${game.variant === "flip" ? ` · ${game.sideName}` : ""}`;
    $("tableCaption").textContent = currentMessage();
    $("activeColour").textContent = game.currentColor ? (window.EinsCards.COLOR_LABELS[game.currentColor] || game.currentColor) : "Choose a colour";
    $("directionLabel").textContent = game.direction === 1 ? "Clockwise" : "Counter-clockwise";
    $("tableSurface").classList.toggle("flip-dark", game.variant === "flip" && game.side === "dark");
    $("drawPile").innerHTML = window.EinsCards.renderBack({ variant: game.variant, side: game.side });
    const visibleTop = game.topCard ? { ...game.face(game.topCard), id: game.topCard.id } : null;
    $("discardPile").innerHTML = window.EinsCards.renderCard(visibleTop, {
      variant: game.variant,
      side: game.side,
      activeColor: game.currentColor,
      disabled: true,
    });
    $("drawCount").textContent = `${game.drawPile.length} remaining`;
    $("discardCount").textContent = `${game.discardPile.length} discarded`;
    $("history").innerHTML = game.history.map((entry) => `<div>${escapeHTML(entry)}</div>`).join("");

    const human = isHumanTurn();
    const activeHand = human ? game.hands[game.currentPlayer] : [];
    const playableIds = new Set(game.playableCards().map((card) => card.id));
    $("handTitle").textContent = human ? `${playerName(game.currentPlayer)}'s hand` : (game.isFinished ? "Game complete" : "Computer hand");
    if (human) {
      $("hand").innerHTML = activeHand.map((card) => window.EinsCards.renderCard(
        { ...game.face(card), id: card.id },
        {
          variant: game.variant,
          side: game.side,
          selected: selectedCardId === card.id,
          disabled: !playableIds.has(card.id),
        },
      )).join("");
    } else {
      $("hand").innerHTML = game.isFinished
        ? `<div class="note">${escapeHTML(playerName(game.winner))} has won the game.</div>`
        : `<div class="note">The computer's cards are hidden.</div>`;
    }

    const hint = game.isFinished
      ? "Start another game from the controls."
      : !human
        ? "The computer is taking its turn."
        : game.hasPendingPenalty()
          ? game.pendingPenaltyType === "wildDrawColor"
            ? `Draw one card at a time until you find ${game.pendingDrawColor}.`
            : game.penaltyDrawStarted
              ? "Finish drawing the penalty one card at a time; stacking is no longer available this turn."
              : "Draw the penalty one card at a time, or stack a matching draw card before drawing starts."
          : game.turnDraw?.status === "mustDraw"
            ? "Draw one card at a time until a playable card appears."
            : game.turnDraw?.status === "playable"
            ? "Only the card just drawn may be played. Select it, then press Play."
            : game.turnDraw?.status === "pass"
              ? "You may play the drawn card if it is playable, or pass."
              : "Clicking a card only selects it. Use Play Selected Card to play it.";
    $("handHint").textContent = hint;

    const selectedIsPlayable = human && game.playableCards().some((card) => card.id === selectedCardId);
    $("playBtn").classList.toggle("hidden", !human || game.phase !== "play");
    $("playBtn").disabled = !selectedIsPlayable;
    $("drawBtn").classList.toggle("hidden", !human || game.phase !== "play" || !game.canDraw());
    $("drawBtn").textContent = game.pendingPenaltyType === "wildDrawColor"
      ? `Draw Until ${window.EinsCards.COLOR_LABELS[game.pendingDrawColor] || game.pendingDrawColor}`
      : game.pendingPenalty > 0
        ? `Draw Penalty (${game.pendingPenalty} left)`
        : game.turnDraw?.status === "mustDraw" ? "Draw Another Card" : "Draw One Card";
    $("passBtn").classList.toggle("hidden", !human || !game.canPass());
    $("catchBtn").classList.toggle("hidden", !human || game.phase !== "play" || game.missedUnoPlayer === null || game.missedUnoPlayer === game.currentPlayer);
    $("catchBtn").textContent = game.missedUnoPlayer === null ? "Catch EINS (+2)" : `Catch ${playerName(game.missedUnoPlayer)} (+2)`;
    $("catchDrawBtn").classList.toggle("hidden", !human || game.phase !== "catchPenalty");
    $("catchDrawBtn").textContent = `Add One Penalty Card (${game.catchRemaining} left)`;
    $("colourChoices").innerHTML = game.availableColors.map((color) =>
      `<button class="colour-choice" data-colour="${escapeHTML(color)}" aria-label="Choose ${escapeHTML(color)}" title="${escapeHTML(window.EinsCards.COLOR_LABELS[color] || color)}"></button>`
    ).join("");
    $("colourChoices").classList.toggle("hidden", !human || game.phase !== "chooseColor");
    syncEinsTimer();
    $("turnActions").classList.toggle("hidden", !human || game.isFinished);

    if (game.isFinished) {
      $("status").textContent = game.isDraw
        ? "The round ended in a draw: the draw pile is empty and no player could make a legal move."
        : `${playerName(game.winner)} wins. No further cards are dealt in this game.`;
    } else {
      $("status").textContent = currentMessage();
    }
    $("nextRoundBtn").disabled = !game.isFinished;
  }

  function doHumanAction(action) {
    if (game.phase === "callEins") stopEinsTimer();
    const result = action();
    selectedCardId = null;
    render();
    runAI();
  }

  function runAI() {
    window.clearTimeout(aiTimer);
    if (game.isFinished || game.players[game.currentPlayer]?.type !== "computer") return;

    aiTimer = window.setTimeout(() => {
      const playerIndex = game.currentPlayer;
      if (game.phase === "callEins") {
        game.callEins(playerIndex);
      } else if (game.phase === "chooseColor") {
        const colour = window.EinsAI.chooseColour(game, game.hands[playerIndex]);
        game.chooseColor(colour, playerIndex);
      } else if (game.phase === "catchPenalty") {
        game.drawCatchCard();
      } else if (game.phase === "play") {
        if (game.missedUnoPlayer !== null && game.missedUnoPlayer !== playerIndex) {
          game.catchEins(playerIndex);
        } else {
          const stack = window.EinsAI.chooseStackCard(game, playerIndex);
          if (stack) {
            game.playCard(playerIndex, stack.id);
          } else if (game.hasPendingPenalty()) {
            game.drawOne(playerIndex);
          } else {
            const chosen = window.EinsAI.chooseCard(game, playerIndex);
            if (chosen) {
              game.playCard(playerIndex, chosen.id);
            } else if (game.canDraw(playerIndex)) {
              game.drawOne(playerIndex);
            } else if (game.canPass(playerIndex)) {
              game.passAfterDraw(playerIndex);
            }
          }
        }
      }
      render();
      runAI();
    }, 430);
  }

  $("hand").addEventListener("click", (event) => {
    const cardElement = event.target.closest("[data-card-id]");
    if (!cardElement || !isHumanTurn() || game.phase !== "play") return;
    const cardId = cardElement.dataset.cardId;
    if (!game.playableCards().some((card) => card.id === cardId)) return;
    selectedCardId = selectedCardId === cardId ? null : cardId;
    render();
  });

  $("playBtn").addEventListener("click", () => {
    if (!selectedCardId || !isHumanTurn()) return;
    doHumanAction(() => game.playCard(game.currentPlayer, selectedCardId));
  });

  $("drawBtn").addEventListener("click", () => doHumanAction(() => game.drawOne()));
  $("passBtn").addEventListener("click", () => doHumanAction(() => game.passAfterDraw()));
  $("catchBtn").addEventListener("click", () => doHumanAction(() => game.catchEins()));
  $("catchDrawBtn").addEventListener("click", () => doHumanAction(() => game.drawCatchCard()));
  $("callEinsBtn").addEventListener("click", () => doHumanAction(() => game.callEins()));
  $("colourChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-colour]");
    if (!button) return;
    doHumanAction(() => game.chooseColor(button.dataset.colour));
  });

  $("newGameBtn").addEventListener("click", () => {
    window.clearTimeout(aiTimer);
    window.clearTimeout(blackoutTimer);
    stopEinsTimer();
    $("blackout").classList.add("hidden");
    selectedCardId = null;
    lastTurnPlayer = null;
    game = new GameClass(config);
    render();
    runAI();
  });

  $("nextRoundBtn").addEventListener("click", () => {
    stopEinsTimer();
    if (!game.startNextRound()) return;
    selectedCardId = null;
    lastTurnPlayer = null;
    render();
    runAI();
  });

  render();
  runAI();
})();
