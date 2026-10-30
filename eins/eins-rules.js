/* Shared rules engine for Standard Eins and Eins Flip. */
(() => {
  "use strict";

  const STANDARD_COLORS = ["red", "yellow", "green", "blue"];
  const FLIP_LIGHT_COLORS = ["blue", "green", "red", "yellow"];
  const FLIP_DARK_COLORS = ["pink", "cyan", "orange", "purple"];
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 10;
  const STARTING_HAND_SIZE = 7;

  function shuffle(cards, random = Math.random) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function createStandardDeck(random = Math.random) {
    const deck = [];
    let nextId = 1;
    for (const color of STANDARD_COLORS) {
      deck.push({ id: `eins-${nextId++}`, color, type: "number", value: 0 });
      for (let value = 1; value <= 9; value++) {
        deck.push({ id: `eins-${nextId++}`, color, type: "number", value });
        deck.push({ id: `eins-${nextId++}`, color, type: "number", value });
      }
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: `eins-${nextId++}`, color, type: "skip", value: "skip" });
        deck.push({ id: `eins-${nextId++}`, color, type: "reverse", value: "reverse" });
        deck.push({ id: `eins-${nextId++}`, color, type: "draw2", value: "+2" });
      }
    }
    for (let copy = 0; copy < 4; copy++) {
      deck.push({ id: `eins-${nextId++}`, color: null, type: "wild", value: "wild", faceFile: "standard" });
      deck.push({ id: `eins-${nextId++}`, color: null, type: "wildDraw4", value: "+4", faceFile: "drawFour" });
    }
    return shuffle(deck, random);
  }

  function makeFace(color, type, value, faceFile) {
    return { color, type, value, ...(faceFile ? { faceFile } : {}) };
  }

  function createFlipDeck(random = Math.random) {
    const light = [];
    const dark = [];
    for (const color of FLIP_LIGHT_COLORS) {
      for (let value = 1; value <= 9; value++) {
        light.push(makeFace(color, "number", value), makeFace(color, "number", value));
      }
      for (let copy = 0; copy < 2; copy++) {
        light.push(makeFace(color, "draw1", "+1", "+1"));
        light.push(makeFace(color, "reverse", "reverse"));
        light.push(makeFace(color, "skip", "skip"));
        light.push(makeFace(color, "flip", "flip"));
      }
    }
    for (let copy = 0; copy < 4; copy++) {
      light.push(makeFace(null, "wild", "wild", "standard"));
      light.push(makeFace(null, "wildDraw2", "+2", "drawTwo"));
    }

    for (const color of FLIP_DARK_COLORS) {
      for (let value = 1; value <= 9; value++) {
        dark.push(makeFace(color, "number", value), makeFace(color, "number", value));
      }
      for (let copy = 0; copy < 2; copy++) {
        dark.push(makeFace(color, "draw5", "+5", "+5"));
        dark.push(makeFace(color, "reverse", "reverse"));
        dark.push(makeFace(color, "skipAll", "skipAll"));
        dark.push(makeFace(color, "flip", "flip"));
      }
    }
    for (let copy = 0; copy < 4; copy++) {
      dark.push(makeFace(null, "wild", "wild", "standard"));
      dark.push(makeFace(null, "wildDrawColor", "drawUntilColour", "drawUntilColour"));
    }

    if (light.length !== 112 || dark.length !== 112) {
      throw new Error(`Invalid Eins Flip deck composition: Light ${light.length}, Dark ${dark.length}.`);
    }

    // Each physical Flip card has a Flip face on both sides, so pairing is
    // performed separately for those eight cards before the remaining faces.
    const lightFlip = shuffle(light.filter((face) => face.type === "flip"), random);
    const darkFlip = shuffle(dark.filter((face) => face.type === "flip"), random);
    const lightOther = shuffle(light.filter((face) => face.type !== "flip"), random);
    const darkOther = shuffle(dark.filter((face) => face.type !== "flip"), random);
    const physical = [];
    let nextId = 1;

    for (let i = 0; i < lightFlip.length; i++) {
      physical.push({ id: `eins-flip-${nextId++}`, sides: { light: lightFlip[i], dark: darkFlip[i] } });
    }
    for (let i = 0; i < lightOther.length; i++) {
      physical.push({ id: `eins-flip-${nextId++}`, sides: { light: lightOther[i], dark: darkOther[i] } });
    }
    return shuffle(physical, random);
  }

  function normalizePlayers(config = {}) {
    const source = Array.isArray(config.players) ? config.players : [];
    const players = source.slice(0, MAX_PLAYERS).map((player, index) => ({
      id: String(player.id || player.profileId || `player-${index + 1}`),
      type: player.type === "computer" ? "computer" : "human",
      name: String(player.name || `Player ${index + 1}`),
      avatar: String(player.avatar || (player.type === "computer" ? "🤖" : "🃏")),
      difficulty: String(player.difficulty || "normal"),
    }));

    if (!players.length) {
      players.push({ id: "player-1", type: "human", name: "Player 1", avatar: "♟", difficulty: "normal" });
      players.push({ id: "computer-1", type: "computer", name: "Computer 2", avatar: "🤖", difficulty: "normal" });
      players.push({ id: "computer-2", type: "computer", name: "Computer 3", avatar: "🤖", difficulty: "normal" });
      players.push({ id: "computer-3", type: "computer", name: "Computer 4", avatar: "🤖", difficulty: "normal" });
    }
    while (players.length < MIN_PLAYERS) {
      const index = players.length;
      players.push({ id: `computer-${index}`, type: "computer", name: `Computer ${index + 1}`, avatar: "🤖", difficulty: "normal" });
    }
    return players;
  }

  class EinsGame {
    constructor(config = {}) {
      this.variant = config.variant === "flip" ? "flip" : "eins";
      this.players = normalizePlayers(config);
      this.options = {
        stacking: Boolean(config.stacking),
        drawUntilPlayable: Boolean(config.drawUntilPlayable),
      };
      this.roundNumber = 1;
      this.resetRound();
    }

    createDeck() {
      return createStandardDeck();
    }

    face(card) {
      return card;
    }

    get availableColors() {
      if (this.variant === "flip") return this.side === "dark" ? FLIP_DARK_COLORS : FLIP_LIGHT_COLORS;
      return STANDARD_COLORS;
    }

    get sideName() {
      if (this.variant !== "flip") return "Standard";
      return this.side === "dark" ? "Dark Side" : "Light Side";
    }

    resetRound() {
      this.side = this.variant === "flip" ? "light" : null;
      this.drawPile = this.createDeck();
      this.discardPile = [];
      this.hands = this.players.map(() => []);
      this.players.forEach((_, playerIndex) => {
        for (let card = 0; card < STARTING_HAND_SIZE; card++) {
          this.hands[playerIndex].push(this.drawPile.pop());
        }
      });

      let firstCard;
      if (this.variant === "flip") {
        // A starting Wild Draw Two is returned to the deck and replaced.
        do {
          firstCard = this.drawPile.pop();
          if (this.face(firstCard)?.type === "wildDraw2") {
            this.drawPile.push(firstCard);
            shuffle(this.drawPile);
          } else {
            break;
          }
        } while (this.drawPile.length);
      } else {
        let firstCardIndex = this.drawPile.findIndex((card) => this.face(card).type === "number");
        if (firstCardIndex < 0) firstCardIndex = 0;
        [firstCard] = this.drawPile.splice(firstCardIndex, 1);
      }
      if (!firstCard) firstCard = this.drawPile.pop();
      this.discardPile.push(firstCard);

      this.direction = 1;
      this.currentPlayer = 0;
      this.currentColor = this.face(firstCard).color;
      this.pendingPenalty = 0;
      this.pendingPenaltyType = null;
      this.pendingDrawColor = null;
      this.penaltyDrawStarted = false;
      this.turnDraw = null;
      this.phase = "play";
      this.pendingEffect = null;
      this.pendingWildCard = null;
      this.missedUnoPlayer = null;
      this.catchTarget = null;
      this.catchRemaining = 0;
      this.winner = null;
      this.isDraw = false;
      this.emptyDeckPasses = 0;
      this.history = [];
      this.log(`Round ${this.roundNumber} begins. ${this.players.length} players have been dealt ${STARTING_HAND_SIZE} cards each.`);
      if (this.variant === "flip") {
        this.log("The Light Side is active.");
        this.applyFlipOpeningAction(firstCard);
      }
      if (this.currentColor) this.log(`The starting colour is ${this.currentColor}.`);
    }

    applyFlipOpeningAction(card) {
      const face = this.face(card);
      if (face.type === "draw1") {
        this.pendingPenalty = 1;
        this.pendingPenaltyType = "draw1";
        this.currentPlayer = this.nextPlayerIndex(0);
        this.log("The opening Draw One makes the next player draw one card and lose their turn.");
      } else if (face.type === "reverse") {
        this.direction = -1;
        this.log("The opening Reverse changes direction; the dealer starts.");
      } else if (face.type === "skip") {
        this.currentPlayer = this.nextPlayerIndex(0);
        this.log("The opening Skip skips the first player; the following player starts.");
      } else if (face.type === "wild") {
        this.pendingWildCard = { playerIndex: 0, card, face: { ...face }, applyPenalty: false };
        this.phase = "chooseColor";
        this.log("The opening Wild requires the first player to choose the starting colour.");
      } else if (face.type === "flip") {
        this.side = "dark";
        this.currentColor = this.face(card).color;
        this.log("The opening Flip starts the round on the Dark Side.");
      }
    }

    log(message) {
      this.history.unshift(message);
      if (this.history.length > 120) this.history.length = 120;
    }

    get topCard() {
      return this.discardPile[this.discardPile.length - 1] || null;
    }

    get isFinished() {
      return this.phase === "finished";
    }

    get currentPlayerData() {
      return this.players[this.currentPlayer];
    }

    hasPendingPenalty() {
      return this.pendingPenalty > 0 || (this.pendingPenaltyType === "wildDrawColor" && Boolean(this.pendingDrawColor));
    }

    takeFromDrawPile() {
      if (!this.drawPile.length && this.discardPile.length > 1) {
        const top = this.discardPile.pop();
        this.drawPile = shuffle(this.discardPile.splice(0));
        this.discardPile.push(top);
        this.log("The discard pile was reshuffled into the draw pile.");
      }
      return this.drawPile.pop() || null;
    }

    isCardPlayable(card, playerIndex = this.currentPlayer) {
      if (!card || this.phase !== "play" || this.isFinished) return false;
      const face = this.face(card);
      if (this.hasPendingPenalty()) {
        return this.options.stacking && this.pendingPenaltyType !== "wildDrawColor" &&
          !this.penaltyDrawStarted && face.type === this.pendingPenaltyType;
      }

      if (face.type === "wild") return true;
      if (["wildDraw4", "wildDraw2", "wildDrawColor"].includes(face.type)) {
        return !this.hands[playerIndex].some((held) => this.face(held).color === this.currentColor);
      }

      const topFace = this.face(this.topCard);
      return face.color === this.currentColor || (
        topFace && face.type === topFace.type && face.value === topFace.value
      );
    }

    playableCards(playerIndex = this.currentPlayer) {
      const hand = this.hands[playerIndex] || [];
      if (this.phase !== "play" || this.isFinished) return [];
      if (this.turnDraw && this.turnDraw.status !== "playable") return [];
      if (this.turnDraw?.status === "playable") {
        const drawn = hand.find((card) => card.id === this.turnDraw.drawnCardId);
        return drawn && this.isCardPlayable(drawn, playerIndex) ? [drawn] : [];
      }
      return hand.filter((card) => this.isCardPlayable(card, playerIndex));
    }

    canDraw(playerIndex = this.currentPlayer) {
      if (playerIndex !== this.currentPlayer || this.phase !== "play" || this.isFinished) return false;
      if (this.hasPendingPenalty()) return true;
      if (this.turnDraw) return this.turnDraw.status === "mustDraw";
      return this.playableCards(playerIndex).length === 0;
    }

    canPass(playerIndex = this.currentPlayer) {
      if (playerIndex !== this.currentPlayer || this.phase !== "play" || this.isFinished) return false;
      if (this.hasPendingPenalty()) return false;
      return Boolean(this.turnDraw && this.turnDraw.status === "pass" && (!this.options.drawUntilPlayable || this.turnDraw.exhausted)) ||
        Boolean(this.turnDraw && this.turnDraw.status === "playable" && !this.options.drawUntilPlayable);
    }

    _closeMissedUnoWindow() {
      if (this.missedUnoPlayer !== null) {
        this.log(`${this.players[this.missedUnoPlayer].name} was not caught for missing EINS.`);
        this.missedUnoPlayer = null;
      }
    }

    drawOne(playerIndex = this.currentPlayer) {
      if (!this.canDraw(playerIndex)) return false;
      this._closeMissedUnoWindow();

      if (this.pendingPenaltyType === "wildDrawColor" && this.pendingDrawColor) {
        const card = this.takeFromDrawPile();
        if (card) {
          this.hands[playerIndex].push(card);
          const face = this.face(card);
          this.log(`${this.players[playerIndex].name} draws one card for Wild Draw Colour.`);
          if (face.color === this.pendingDrawColor) {
            this.log(`${this.players[playerIndex].name} found ${this.pendingDrawColor} and completes the penalty.`);
            this.pendingPenaltyType = null;
            this.pendingDrawColor = null;
            this.penaltyDrawStarted = false;
            this.advanceTurn();
          } else {
            this.penaltyDrawStarted = true;
          }
        } else {
          this.log("The draw pile is exhausted before the required colour is found; the penalty ends.");
          this.pendingPenaltyType = null;
          this.pendingDrawColor = null;
          this.penaltyDrawStarted = false;
          this.advanceTurn();
        }
        return true;
      }

      if (this.pendingPenalty > 0) {
        this.penaltyDrawStarted = true;
        const card = this.takeFromDrawPile();
        if (card) {
          this.hands[playerIndex].push(card);
          this.log(`${this.players[playerIndex].name} draws one penalty card.`);
        } else {
          this.log(`${this.players[playerIndex].name} could not draw; the draw pile is empty.`);
        }
        this.pendingPenalty--;
        if (this.pendingPenalty <= 0) {
          this.pendingPenalty = 0;
          this.pendingPenaltyType = null;
          this.penaltyDrawStarted = false;
          this.log(`${this.players[playerIndex].name} completes the penalty and loses the turn.`);
          this.advanceTurn();
        }
        return true;
      }

      const card = this.takeFromDrawPile();
      if (!card) {
        this.turnDraw = { status: "pass", drawnCardId: null, exhausted: true };
        this.log(`${this.players[playerIndex].name} has no card to draw and may pass.`);
        return true;
      }
      this.hands[playerIndex].push(card);
      if (this.isCardPlayable(card, playerIndex)) {
        this.turnDraw = { status: "playable", drawnCardId: card.id };
        this.log(`${this.players[playerIndex].name} draws one playable card. Select it and choose Play, or pass if Draw Once is enabled.`);
      } else if (this.options.drawUntilPlayable) {
        this.turnDraw = { status: "mustDraw", drawnCardId: null };
        this.log(`${this.players[playerIndex].name} draws one card; it is not playable and another draw is required.`);
      } else {
        this.turnDraw = { status: "pass", drawnCardId: card.id };
        this.log(`${this.players[playerIndex].name} draws one card. They may play that card if playable or pass.`);
      }
      return true;
    }

    passAfterDraw(playerIndex = this.currentPlayer) {
      if (!this.canPass(playerIndex)) return false;
      this._closeMissedUnoWindow();
      const exhausted = Boolean(this.turnDraw.exhausted);
      this.log(`${this.players[playerIndex].name} passes after drawing.`);
      if (exhausted) {
        this.emptyDeckPasses++;
        if (this.emptyDeckPasses >= this.players.length) {
          this.phase = "finished";
          this.isDraw = true;
          this.winner = null;
          this.turnDraw = null;
          this.log("The draw pile and recyclable discard cards are exhausted. No player can make a move, so the round ends in a draw.");
          return true;
        }
      }
      this.advanceTurn();
      return true;
    }

    playCard(playerIndex, cardId) {
      if (playerIndex !== this.currentPlayer || this.phase !== "play" || this.isFinished) return false;
      this._closeMissedUnoWindow();
      const hand = this.hands[playerIndex];
      const card = hand.find((candidate) => candidate.id === cardId);
      if (!card || !this.isCardPlayable(card, playerIndex)) return false;
      if (this.turnDraw && (this.turnDraw.status !== "playable" || this.turnDraw.drawnCardId !== card.id)) return false;

      const playedFace = { ...this.face(card) };
      hand.splice(hand.findIndex((candidate) => candidate.id === cardId), 1);
      this.discardPile.push(card);
      if (playedFace.color !== null && playedFace.color !== undefined) this.currentColor = playedFace.color;

      this.emptyDeckPasses = 0;
      this.turnDraw = null;
      this.log(`${this.players[playerIndex].name} plays ${this.describeFace(playedFace)}.`);

      if (!hand.length) {
        this.winner = playerIndex;
        this.phase = "finished";
        this.log(`${this.players[playerIndex].name} wins the round!`);
        return true;
      }

      this.pendingEffect = { playerIndex, card, face: playedFace };
      if (hand.length === 1) {
        this.phase = "callEins";
        this.log(`${this.players[playerIndex].name} has one card left. They have two seconds to call EINS.`);
      } else {
        this.resolvePendingEffect();
      }
      return true;
    }

    describeFace(face) {
      switch (face.type) {
        case "number": return `${face.color} ${face.value}`;
        case "draw2": return `${face.color} Draw Two`;
        case "draw1": return `${face.color} Draw One`;
        case "draw5": return `${face.color} Draw Five`;
        case "skip": return `${face.color} Skip`;
        case "skipAll": return `${face.color} Skip Everyone`;
        case "reverse": return `${face.color} Reverse`;
        case "flip": return `${face.color} Flip`;
        case "wild": return "Wild";
        case "wildDraw4": return "Wild Draw Four";
        case "wildDraw2": return "Wild Draw Two";
        case "wildDrawColor": return "Wild Draw Colour";
        default: return "a card";
      }
    }

    describeCard(card) {
      return this.describeFace(this.face(card));
    }

    callEins(playerIndex = this.currentPlayer) {
      if (this.phase !== "callEins" || !this.pendingEffect || playerIndex !== this.currentPlayer) return false;
      this.log(`${this.players[playerIndex].name} calls EINS!`);
      this.resolvePendingEffect();
      return true;
    }

    skipEinsCall(playerIndex = this.currentPlayer) {
      if (this.phase !== "callEins" || !this.pendingEffect || playerIndex !== this.currentPlayer) return false;
      this.missedUnoPlayer = playerIndex;
      this.log(`${this.players[playerIndex].name} does not call EINS within two seconds.`);
      this.resolvePendingEffect();
      return true;
    }

    resolvePendingEffect() {
      if (!this.pendingEffect) return;
      const { playerIndex, card, face } = this.pendingEffect;
      this.pendingEffect = null;
      this.phase = "play";

      if (["wild", "wildDraw4", "wildDraw2", "wildDrawColor"].includes(face.type)) {
        this.pendingWildCard = { playerIndex, card, face, applyPenalty: true };
        this.phase = "chooseColor";
        return;
      }

      if (["draw2", "draw1", "draw5"].includes(face.type)) {
        const amount = face.type === "draw2" ? 2 : face.type === "draw1" ? 1 : 5;
        this.pendingPenalty = this.pendingPenaltyType === face.type ? this.pendingPenalty + amount : amount;
        this.pendingPenaltyType = face.type;
        this.log(`The next player must draw ${this.pendingPenalty} card${this.pendingPenalty === 1 ? "" : "s"}, unless they stack the same draw type.`);
        this.advanceTurn();
        return;
      }

      if (face.type === "skip") {
        this.log(`${this.players[this.nextPlayerIndex()].name} is skipped.`);
        this.advanceTurn(2);
        return;
      }
      if (face.type === "skipAll") {
        this.log("Everyone else is skipped; the player who used Skip Everyone takes another turn.");
        this.turnDraw = null;
        this.penaltyDrawStarted = false;
        this.phase = "play";
        return;
      }
      if (face.type === "reverse") {
        this.direction *= -1;
        if (this.players.length === 2) {
          this.log("Reverse acts as a skip with two players.");
          this.advanceTurn(2);
        } else {
          this.log(`Play direction is now ${this.direction === 1 ? "clockwise" : "counter-clockwise"}.`);
          this.advanceTurn();
        }
        return;
      }
      if (face.type === "flip") {
        this.flipSides(playerIndex);
        return;
      }
      this.advanceTurn();
    }

    flipSides(playerIndex) {
      const oldSide = this.side;
      this.side = oldSide === "light" ? "dark" : "light";
      this.discardPile.reverse();
      this.log(`The deck flips from the ${oldSide === "light" ? "Light Side" : "Dark Side"} to the ${this.side === "light" ? "Light Side" : "Dark Side"}.`);

      // The previously played Flip card becomes the bottom discard. The old
      // top discard is now visible; its action is not activated by the flip.
      const revealedFace = this.face(this.topCard);
      if (revealedFace.color) {
        this.currentColor = revealedFace.color;
      } else {
        this.currentColor = null;
        this.pendingWildCard = {
          playerIndex,
          card: this.topCard,
          face: { ...revealedFace },
          applyPenalty: false,
          revealedByFlip: true,
        };
        this.phase = "chooseColor";
        this.log("A Wild card is revealed by the flip. The player who flipped the deck chooses the new colour; its action is not activated.");
        return;
      }
      this.advanceTurn();
    }

    chooseColor(color, playerIndex = this.currentPlayer) {
      if (this.phase !== "chooseColor" || !this.pendingWildCard || playerIndex !== this.currentPlayer || !this.availableColors.includes(color)) return false;
      const pending = this.pendingWildCard;
      const face = pending.face;
      this.currentColor = color;
      this.log(`${this.players[playerIndex].name} chooses ${color}.`);

      if (pending.applyPenalty) {
        if (face.type === "wildDraw4" || face.type === "wildDraw2") {
          const amount = face.type === "wildDraw4" ? 4 : 2;
          this.pendingPenalty = this.pendingPenaltyType === face.type ? this.pendingPenalty + amount : amount;
          this.pendingPenaltyType = face.type;
          this.log(`The next player must draw ${this.pendingPenalty} cards, unless they stack the same Wild Draw type.`);
        } else if (face.type === "wildDrawColor") {
          this.pendingPenalty = 0;
          this.pendingPenaltyType = "wildDrawColor";
          this.pendingDrawColor = color;
          this.log(`The next player must draw one card at a time until they draw ${color}, then lose their turn.`);
        }
      }

      this.pendingWildCard = null;
      this.advanceTurn();
      return true;
    }

    nextPlayerIndex(from = this.currentPlayer) {
      return (from + this.direction + this.players.length) % this.players.length;
    }

    advanceTurn(steps = 1) {
      this.turnDraw = null;
      this.penaltyDrawStarted = false;
      this.currentPlayer = (this.currentPlayer + (this.direction * steps) + this.players.length * 2) % this.players.length;
      this.phase = "play";
    }

    catchEins(playerIndex = this.currentPlayer) {
      if (playerIndex !== this.currentPlayer || this.phase !== "play" || this.missedUnoPlayer === null || this.missedUnoPlayer === playerIndex || this.isFinished) return false;
      this.catchTarget = this.missedUnoPlayer;
      this.catchRemaining = 2;
      this.phase = "catchPenalty";
      this.log(`${this.players[playerIndex].name} catches ${this.players[this.catchTarget].name} for missing EINS. Two cards are added one at a time.`);
      return true;
    }

    drawCatchCard() {
      if (this.phase !== "catchPenalty" || this.catchTarget === null || this.catchRemaining <= 0) return false;
      const card = this.takeFromDrawPile();
      if (card) this.hands[this.catchTarget].push(card);
      this.catchRemaining--;
      this.log(`${this.players[this.catchTarget].name} receives one catch penalty card.`);
      if (this.catchRemaining <= 0) {
        this.catchTarget = null;
        this.missedUnoPlayer = null;
        this.phase = "play";
      }
      return true;
    }

    startNextRound() {
      if (!this.isFinished) return false;
      this.roundNumber++;
      this.resetRound();
      return true;
    }
  }

  class EinsFlipGame extends EinsGame {
    constructor(config = {}) {
      super({ ...config, variant: "flip" });
    }

    createDeck() {
      return createFlipDeck();
    }

    face(card) {
      if (!card) return null;
      return card.sides ? card.sides[this.side || "light"] : card;
    }
  }

  window.EinsRules = Object.freeze({
    COLORS: STANDARD_COLORS,
    STANDARD_COLORS,
    FLIP_LIGHT_COLORS,
    FLIP_DARK_COLORS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    STARTING_HAND_SIZE,
    shuffle,
    createStandardDeck,
    createFlipDeck,
    normalizePlayers,
    EinsGame,
    EinsFlipGame,
  });
})();
