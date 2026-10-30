/* Rules and state engine shared by Standard Eins and Eins Flip. */
(() => {
  "use strict";

  const COLORS = ["red", "yellow", "green", "blue"];
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
    for (const color of COLORS) {
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
      deck.push({ id: `eins-${nextId++}`, color: null, type: "wild", value: "wild" });
      deck.push({ id: `eins-${nextId++}`, color: null, type: "wildDraw4", value: "+4" });
    }
    return shuffle(deck, random);
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
      this.players = normalizePlayers(config);
      this.options = {
        stacking: Boolean(config.stacking),
        drawUntilPlayable: Boolean(config.drawUntilPlayable),
      };
      this.roundNumber = 1;
      this.resetRound();
    }

    resetRound() {
      this.drawPile = createStandardDeck();
      this.discardPile = [];
      this.hands = this.players.map(() => []);
      this.players.forEach((_, playerIndex) => {
        for (let card = 0; card < STARTING_HAND_SIZE; card++) {
          this.hands[playerIndex].push(this.drawPile.pop());
        }
      });

      // Start with a numbered card so the first turn has no unresolved action.
      let firstCardIndex = this.drawPile.findIndex((card) => card.type === "number");
      if (firstCardIndex < 0) firstCardIndex = 0;
      const [firstCard] = this.drawPile.splice(firstCardIndex, 1);
      this.discardPile.push(firstCard);

      this.direction = 1;
      this.currentPlayer = 0;
      this.currentColor = firstCard.color;
      this.pendingPenalty = 0;
      this.pendingPenaltyType = null;
      // Once a player starts taking a draw penalty, they must finish it.
      // They cannot interrupt the sequence by stacking a newly drawn card.
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
      this.log(`The starting colour is ${this.currentColor}.`);
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
      if (this.pendingPenalty > 0) {
        return this.options.stacking && !this.penaltyDrawStarted && card.type === this.pendingPenaltyType;
      }

      if (card.type === "wild") return true;
      if (card.type === "wildDraw4") {
        return !this.hands[playerIndex].some((held) =>
          held.id !== card.id && held.color === this.currentColor,
        );
      }

      return card.color === this.currentColor || (
        this.topCard && card.type === this.topCard.type && card.value === this.topCard.value
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
      if (this.pendingPenalty > 0) return true;
      if (this.turnDraw) return this.turnDraw.status === "mustDraw";
      return this.playableCards(playerIndex).length === 0;
    }

    canPass(playerIndex = this.currentPlayer) {
      if (playerIndex !== this.currentPlayer || this.phase !== "play" || this.isFinished) return false;
      if (this.pendingPenalty > 0) return false;
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

      hand.splice(hand.findIndex((candidate) => candidate.id === cardId), 1);
      this.discardPile.push(card);

      // Every coloured card becomes the active colour, not just Wild cards.
      // This keeps matching rules, the displayed colour, and Wild artwork in sync.
      if (card.color !== null && card.color !== undefined) {
        this.currentColor = card.color;
      }

      this.emptyDeckPasses = 0;
      this.turnDraw = null;
      this.log(`${this.players[playerIndex].name} plays ${this.describeCard(card)}.`);

      if (!hand.length) {
        this.winner = playerIndex;
        this.phase = "finished";
        this.log(`${this.players[playerIndex].name} wins the round!`);
        return true;
      }

      this.pendingEffect = { playerIndex, card };
      if (hand.length === 1) {
        this.phase = "callEins";
        this.log(`${this.players[playerIndex].name} has one card left. They must call EINS or continue without calling.`);
      } else {
        this.resolvePendingEffect();
      }
      return true;
    }

    describeCard(card) {
      if (card.type === "number") return `${card.color} ${card.value}`;
      if (card.type === "draw2") return `${card.color} Draw Two`;
      if (card.type === "skip") return `${card.color} Skip`;
      if (card.type === "reverse") return `${card.color} Reverse`;
      if (card.type === "wild") return "Wild";
      if (card.type === "wildDraw4") return "Wild Draw Four";
      return "a card";
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
      this.log(`${this.players[playerIndex].name} continues without calling EINS.`);
      this.resolvePendingEffect();
      return true;
    }

    resolvePendingEffect() {
      if (!this.pendingEffect) return;
      const { playerIndex, card } = this.pendingEffect;
      this.pendingEffect = null;
      this.phase = "play";

      if (card.type === "wild" || card.type === "wildDraw4") {
        this.pendingWildCard = { playerIndex, card };
        this.phase = "chooseColor";
        return;
      }
      if (card.type === "draw2") {
        this.pendingPenalty = this.pendingPenaltyType === "draw2" ? this.pendingPenalty + 2 : 2;
        this.pendingPenaltyType = "draw2";
        this.log(`The next player must draw ${this.pendingPenalty} card${this.pendingPenalty === 1 ? "" : "s"}, unless they stack another Draw Two.`);
        this.advanceTurn();
        return;
      }
      if (card.type === "skip") {
        this.log(`${this.players[this.nextPlayerIndex()].name} is skipped.`);
        this.advanceTurn(2);
        return;
      }
      if (card.type === "reverse") {
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
      this.advanceTurn();
    }

    chooseColor(color, playerIndex = this.currentPlayer) {
      if (this.phase !== "chooseColor" || !this.pendingWildCard || playerIndex !== this.currentPlayer || !COLORS.includes(color)) return false;
      const { card } = this.pendingWildCard;
      this.currentColor = color;
      this.log(`${this.players[playerIndex].name} chooses ${color}.`);
      if (card.type === "wildDraw4") {
        this.pendingPenalty = this.pendingPenaltyType === "wildDraw4" ? this.pendingPenalty + 4 : 4;
        this.pendingPenaltyType = "wildDraw4";
        this.log(`The next player must draw ${this.pendingPenalty} cards, unless they stack another Wild Draw Four.`);
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
      this.log(`${this.players[playerIndex].name} catches ${this.players[this.catchTarget].name} for not calling EINS. Two cards are added one at a time.`);
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

  window.EinsRules = Object.freeze({
    COLORS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    STARTING_HAND_SIZE,
    shuffle,
    createStandardDeck,
    normalizePlayers,
    EinsGame,
  });
})();
