"use strict";

(function () {
  function usefulness(card, hand) {
    let score = 0;
    for (const other of hand) {
      if (other.id === card.id) continue;
      if (other.rank === card.rank) score += 3;
      if (other.suit === card.suit && Math.abs(other.rank - card.rank) <= 2) {
        score += Math.abs(other.rank - card.rank) === 1 ? 3 : 1;
      }
    }
    return score;
  }

  function chooseDiscard(hand) {
    return [...hand].sort(
      (a, b) => usefulness(a, hand) - usefulness(b, hand) || b.rank - a.rank,
    )[0];
  }

  function cardCanJoinRun(card, ranks, topToBottom) {
    if (!ranks.has(card.rank)) return false;
    if (!topToBottom) {
      const sorted = [...ranks].sort((a, b) => a - b);
      for (let start = 0; start < sorted.length; start++) {
        let end = start;
        while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
        if (end - start + 1 >= 3 && sorted.slice(start, end + 1).includes(card.rank)) return true;
      }
      return false;
    }

    for (const start of ranks) {
      for (let len = 3; len <= 13; len++) {
        const sequence = [];
        for (let i = 0; i < len; i++) sequence.push(((start - 1 + i) % 13) + 1);
        if (sequence.includes(card.rank) && sequence.every((rank) => ranks.has(rank))) return true;
      }
    }
    return false;
  }

  function canMakeNewMeldWithCard(card, pool, options = {}) {
    if (!card) return false;

    const sameRank = pool.filter((candidate) => candidate.rank === card.rank);
    if (new Set(sameRank.map((candidate) => candidate.suit)).size >= 3) return true;

    const ranks = new Set(
      pool.filter((candidate) => candidate.suit === card.suit).map((candidate) => candidate.rank),
    );
    return cardCanJoinRun(card, ranks, Boolean(options.topToBottomMeld));
  }

  function canAddToExistingMeld(card, melds, game) {
    if (!card || !Array.isArray(melds)) return false;
    return melds.some((meld) => game?.canLayOffCards?.([card], meld));
  }

  function chooseDiscardTake(discard, hand, options = {}, melds = [], game = null) {
    // Try every possible pickup point. The clicked card is the first card taken,
    // so every newer card to its right comes along.
    for (let index = 0; index < discard.length; index++) {
      const taken = discard.slice(index);
      const firstTaken = taken[0];
      const lastTaken = taken[taken.length - 1];
      const pool = [...hand, ...taken];

      if (canMakeNewMeldWithCard(firstTaken, pool, options)) {
        return { index, mode: "newMeld" };
      }

      if (canAddToExistingMeld(lastTaken, melds, game)) {
        return { index, mode: "layoff" };
      }
    }
    return null;
  }

  window.RummyAI = {
    chooseDiscard,
    chooseDiscardTake,
    canMakeNewMeldWithCard,
  };
})();
