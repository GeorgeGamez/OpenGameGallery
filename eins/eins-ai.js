/* Simple computer-player decisions for Standard Eins and Eins Flip. */
(() => {
  "use strict";

  function colourCounts(game, hand) {
    const counts = Object.fromEntries(game.availableColors.map((colour) => [colour, 0]));
    for (const card of hand) {
      const colour = game.face(card).color;
      if (colour && counts[colour] !== undefined) counts[colour]++;
    }
    return counts;
  }

  function chooseColour(game, hand) {
    const counts = colourCounts(game, hand);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function chooseCard(game, playerIndex) {
    const legal = game.playableCards(playerIndex);
    if (!legal.length) return null;
    const hand = game.hands[playerIndex];
    const counts = colourCounts(game, hand);
    const weights = {
      draw2: 8, draw1: 8, draw5: 9, wildDraw4: 8, wildDraw2: 8, wildDrawColor: 10,
      skip: 7, skipAll: 8, reverse: 6, flip: 6, number: 1, wild: 3,
    };

    return [...legal].sort((a, b) => {
      const faceA = game.face(a);
      const faceB = game.face(b);
      const scoreA = (weights[faceA.type] || 0) * 10 + (faceA.color ? counts[faceA.color] : 0);
      const scoreB = (weights[faceB.type] || 0) * 10 + (faceB.color ? counts[faceB.color] : 0);
      return scoreB - scoreA;
    })[0];
  }

  function chooseStackCard(game, playerIndex) {
    if (!game.options.stacking || !game.hasPendingPenalty() || game.pendingPenaltyType === "wildDrawColor") return null;
    if (game.pendingPenalty >= 8) return null;
    return chooseCard(game, playerIndex);
  }

  window.EinsAI = Object.freeze({ chooseColour, chooseCard, chooseStackCard });
})();
