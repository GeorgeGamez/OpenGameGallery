/* Simple computer-player decisions for Standard Eins. */
(() => {
  "use strict";

  function colourCounts(hand) {
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const card of hand) if (card.color && counts[card.color] !== undefined) counts[card.color]++;
    return counts;
  }

  function chooseColour(hand) {
    const counts = colourCounts(hand);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function chooseCard(game, playerIndex) {
    const legal = game.playableCards(playerIndex);
    if (!legal.length) return null;
    const hand = game.hands[playerIndex];
    const counts = colourCounts(hand);
    const weights = {
      draw2: 7,
      skip: 6,
      reverse: 5,
      number: 1,
      wild: 3,
      wildDraw4: 4,
    };

    return [...legal].sort((a, b) => {
      const scoreA = weights[a.type] * 10 + (a.color ? counts[a.color] : 0);
      const scoreB = weights[b.type] * 10 + (b.color ? counts[b.color] : 0);
      return scoreB - scoreA;
    })[0];
  }

  function chooseStackCard(game, playerIndex) {
    if (!game.options.stacking || game.pendingPenalty <= 0) return null;
    // Stacking is optional. Computer players stop extending a large chain and
    // take the accumulated penalty instead, preventing endless AI pile-ons.
    if (game.pendingPenalty >= 8) return null;
    return chooseCard(game, playerIndex);
  }

  window.EinsAI = Object.freeze({ chooseColour, chooseCard, chooseStackCard });
})();
