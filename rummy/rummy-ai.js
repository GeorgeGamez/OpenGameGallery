"use strict";

(function () {
  function isJoker(card) {
    return Boolean(card && (card.joker === true || card.isJoker === true || (card.rank === 0 && card.suit === "★")));
  }

  function usefulness(card, hand) {
    // Keep wild Jokers unless they are the only sensible discard.
    if (isJoker(card)) return 100;
    let score = 0;
    for (const other of hand) {
      if (other.id === card.id) continue;
      if (isJoker(other)) score += 1;
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

  function canMakeNewMeldWithCard(card, pool, options = {}, game = null) {
    if (game && typeof game.canMakeNewMeldWithCard === "function") {
      return game.canMakeNewMeldWithCard(card, pool);
    }
    if (!card) return false;

    const isWild = isJoker(card);
    const sameRank = pool.filter((candidate) => !isJoker(candidate) && (isWild || candidate.rank === card.rank));
    const jokerCount = pool.filter(isJoker).length;
    if (sameRank.length + jokerCount >= 3) {
      for (let rank = 1; rank <= 13; rank++) {
        const naturals = pool.filter((candidate) => !isJoker(candidate) && candidate.rank === rank);
        const suits = new Set(naturals.map((candidate) => candidate.suit));
        if ((isWild || card.rank === rank) && suits.size + jokerCount >= 3) return true;
      }
    }

    const runSuits = isWild ? ["♣", "♦", "♥", "♠"] : [card.suit];
    for (const suit of runSuits) {
      for (let length = 3; length <= 13; length++) {
        const lastStart = options.topToBottomMeld ? 13 : 14 - length;
        for (let start = 1; start <= lastStart; start++) {
          const sequence = [];
          for (let i = 0; i < length; i++) sequence.push(options.topToBottomMeld ? ((start - 1 + i) % 13) + 1 : start + i);
          if (!isWild && (card.suit !== suit || !sequence.includes(card.rank))) continue;
          const ranks = new Set(pool.filter((candidate) => !isJoker(candidate) && candidate.suit === suit && sequence.includes(candidate.rank)).map((candidate) => candidate.rank));
          if (ranks.size + jokerCount >= length) return true;
        }
      }
    }
    return false;
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

      if (canMakeNewMeldWithCard(firstTaken, pool, options, game)) {
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
