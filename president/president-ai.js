(function () {
  "use strict";

  function chooseAction(game, playerIndex) {
    const player = game.players[playerIndex];
    if (!player || player.type !== "computer" || game.over) return null;
    const moves = game.legalPlays(playerIndex);
    const difficulty = String(player.difficulty || "normal").toLowerCase();

    if (!moves.length) {
      return game.currentPlay ? { type: "pass" } : null;
    }

    if (game.currentPlay) {
      // Avoid spending a high card on an inconsequential trick at Easy difficulty.
      if (difficulty === "easy" && !game.openingPending && Math.random() < 0.13) {
        return { type: "pass" };
      }
      moves.sort((a, b) => {
        const ar = a.rank, br = b.rank;
        if (ar !== br) return ar - br;
        // When ranks tie, shed the cards with the most duplicates first.
        const ac = game.hands[playerIndex].filter(c => c.rank === ar).length;
        const bc = game.hands[playerIndex].filter(c => c.rank === br).length;
        return bc - ac;
      });
      if (difficulty === "hard" && moves.length > 1) {
        // Hard generally saves low cards by preferring a higher group that empties a
        // large duplicate set only when it is a safe way to finish the hand.
        const finishing = moves.find(m => m.cardIds.length === game.hands[playerIndex].length);
        if (finishing) return { type: "play", cardIds: finishing.cardIds };
      }
      return { type: "play", cardIds: moves[0].cardIds };
    }

    // On a lead, prioritize shedding multiple cards while keeping the rank low.
    // Hard is more willing to lead with a pair/triple/quad; Easy chooses at random.
    if (difficulty === "easy") {
      const preferred = moves.filter(m => m.cardIds.length >= 2);
      const pool = preferred.length && Math.random() < 0.6 ? preferred : moves;
      const m = pool[Math.floor(Math.random() * pool.length)];
      return { type: "play", cardIds: m.cardIds };
    }

    moves.sort((a, b) => {
      const aSize = a.cardIds.length, bSize = b.cardIds.length;
      const aRank = a.rank, bRank = b.rank;
      const aScore = aRank * 4 - aSize * (difficulty === "hard" ? 5 : 3) - (aSize === 4 ? 4 : 0);
      const bScore = bRank * 4 - bSize * (difficulty === "hard" ? 5 : 3) - (bSize === 4 ? 4 : 0);
      return aScore - bScore || aRank - bRank;
    });
    const best = moves[0];
    return { type: "play", cardIds: best.cardIds };
  }

  window.PresidentAI = { chooseAction };
})();
