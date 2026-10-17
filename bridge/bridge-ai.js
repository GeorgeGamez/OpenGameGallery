(function (root) {
  "use strict";

  const SUITS = ["C", "D", "H", "S"];
  const SUIT_SYMBOL = { C: "♣", D: "♦", H: "♥", S: "♠", NT: "NT" };
  const SUIT_ORDER = { C: 0, D: 1, H: 2, S: 3, NT: 4 };
  const rankName = (rank) => ({ 14: "A", 13: "K", 12: "Q", 11: "J" }[rank] || String(rank));
  const partnerOf = (seat) => (seat + 2) % 4;
  const sideOf = (seat) => seat % 2 === 0 ? 0 : 1;
  const suitName = (suit) => SUIT_SYMBOL[suit] || suit;

  function highCardPoints(hand) {
    return hand.reduce((sum, card) => sum + ({ 14: 4, 13: 3, 12: 2, 11: 1 }[card.rank] || 0), 0);
  }

  function suitLengths(hand) {
    return Object.fromEntries(SUITS.map((suit) => [suit, hand.filter((card) => card.suit === suit).length]));
  }

  function isBalanced(lengths) {
    const values = Object.values(lengths);
    return Math.min(...values) >= 2 && Math.max(...values) <= 5;
  }

  function bidCall(level, strain) {
    return { type: "bid", level, strain };
  }

  function bidText(call) {
    if (!call) return "—";
    if (call.type === "pass") return "Pass";
    if (call.type === "double") return "Double";
    if (call.type === "redouble") return "Redouble";
    return `${call.level}${suitName(call.strain)}`;
  }

  function lowestLegalBid(game, seat, strain, startAt = 1, maxLevel = 7) {
    for (let level = startAt; level <= maxLevel; level++) {
      const bid = bidCall(level, strain);
      if (game.canCall(seat, bid)) return bid;
    }
    return null;
  }

  function openingCall(hand) {
    const hcp = highCardPoints(hand);
    const lengths = suitLengths(hand);
    if (hcp < 13) return { type: "pass" };
    if (hcp >= 15 && hcp <= 17 && isBalanced(lengths)) return bidCall(1, "NT");

    const majors = ["S", "H"].sort((a, b) => lengths[b] - lengths[a] || SUIT_ORDER[b] - SUIT_ORDER[a]);
    if (lengths[majors[0]] >= 5) return bidCall(1, majors[0]);
    if (lengths.S === 4 && lengths.H === 4) return bidCall(1, "S");
    if (lengths.H === 4) return bidCall(1, "H");
    if (lengths.S === 4) return bidCall(1, "S");
    const minors = ["D", "C"].sort((a, b) => lengths[b] - lengths[a] || SUIT_ORDER[b] - SUIT_ORDER[a]);
    return bidCall(1, minors[0]);
  }

  function latestBidBy(game, seat) {
    for (let i = game.auction.length - 1; i >= 0; i--) {
      const call = game.auction[i];
      if (call.seat === seat && call.type === "bid") return call;
    }
    return null;
  }

  function partnershipHasBid(game, seat) {
    return game.auction.some((call) => call.type === "bid" && sideOf(call.seat) === sideOf(seat));
  }

  function chooseCall(game, seat) {
    const hand = game.hands[seat];
    const hcp = highCardPoints(hand);
    const lengths = suitLengths(hand);
    const partner = partnerOf(seat);
    const partnerBid = latestBidBy(game, partner);
    const highBid = game.highBid;

    if (!highBid) return openingCall(hand);

    // If partner owns the current contract, respond naturally to their latest bid.
    if (sideOf(highBid.seat) === sideOf(seat)) {
      if (partnerBid && partnerBid.strain === "NT") {
        if (partnerBid.level === 1) {
          if (hcp >= 10) return bidCall(3, "NT");
          if (hcp >= 8) return bidCall(2, "NT");
        } else if (partnerBid.level === 2 && hcp >= 10) {
          return bidCall(3, "NT");
        }
        return { type: "pass" };
      }

      if (partnerBid && partnerBid.strain !== "NT") {
        const support = lengths[partnerBid.strain] || 0;
        if (support >= 3 && hcp >= 6) {
          let target = 2;
          if (hcp >= 13) target = ["H", "S"].includes(partnerBid.strain) ? 4 : 5;
          else if (hcp >= 10) target = 3;
          target = Math.max(target, highBid.level + (highBid.seat === partner ? 0 : 1));
          const raise = lowestLegalBid(game, seat, partnerBid.strain, target, Math.min(7, target + 1));
          if (raise) return raise;
        }

        if (hcp >= 6) {
          const candidates = ["S", "H", "D", "C"]
            .filter((suit) => suit !== partnerBid.strain && lengths[suit] >= (suit === "S" || suit === "H" ? 4 : 5))
            .sort((a, b) => lengths[b] - lengths[a] || SUIT_ORDER[b] - SUIT_ORDER[a]);
          for (const suit of candidates) {
            const response = lowestLegalBid(game, seat, suit, 1, 2);
            if (response) return response;
          }
        }
        if (hcp >= 8 && isBalanced(lengths)) {
          const ntLevel = hcp >= 10 ? 2 : 1;
          const nt = lowestLegalBid(game, seat, "NT", ntLevel, ntLevel + 1);
          if (nt) return nt;
        }
      }
      return { type: "pass" };
    }

    // Light natural overcalls; the AI deliberately avoids complex competitive conventions.
    if (hcp >= 10) {
      const candidates = ["S", "H", "D", "C"]
        .filter((suit) => lengths[suit] >= 5)
        .sort((a, b) => lengths[b] - lengths[a] || SUIT_ORDER[b] - SUIT_ORDER[a]);
      for (const suit of candidates) {
        const overcall = lowestLegalBid(game, seat, suit, 1, 2);
        if (overcall) return overcall;
      }
    }

    // Support a partner who bid before the opponents entered the auction.
    if (partnerBid && hcp >= 7 && lengths[partnerBid.strain] >= 3 && partnerBid.strain !== "NT") {
      const raise = lowestLegalBid(game, seat, partnerBid.strain, Math.max(2, highBid.level + 1), 4);
      if (raise) return raise;
    }
    return { type: "pass" };
  }

  function cardBeats(candidate, incumbent, leadSuit, trumpSuit) {
    if (candidate.suit === incumbent.suit) return candidate.rank > incumbent.rank;
    if (candidate.suit === trumpSuit && incumbent.suit !== trumpSuit) return true;
    if (incumbent.suit === trumpSuit && candidate.suit !== trumpSuit) return false;
    return candidate.suit === leadSuit && incumbent.suit !== leadSuit;
  }

  function winningPlayIndex(game) {
    if (!game.trick.length) return -1;
    const leadSuit = game.trick[0].card.suit;
    const trump = game.contract.strain === "NT" ? null : game.contract.strain;
    let winner = 0;
    for (let i = 1; i < game.trick.length; i++) {
      if (cardBeats(game.trick[i].card, game.trick[winner].card, leadSuit, trump)) winner = i;
    }
    return winner;
  }

  function chooseCard(game, seat) {
    const legal = game.legalCards(seat);
    if (!legal.length) return null;
    const rankOrder = (a, b) => a.rank - b.rank;
    const trump = game.contract.strain === "NT" ? null : game.contract.strain;

    if (game.trick.length === 0) {
      const lengths = suitLengths(legal);
      const longSuit = Object.keys(lengths).sort((a, b) => lengths[b] - lengths[a] || SUIT_ORDER[a] - SUIT_ORDER[b])[0];
      const inLong = legal.filter((card) => card.suit === longSuit).sort((a, b) => b.rank - a.rank);
      // A modest lead heuristic: fourth-highest from a long suit, otherwise the lowest card.
      const lead = inLong.length >= 4 ? inLong[Math.min(3, inLong.length - 1)] : inLong[inLong.length - 1];
      return (lead || [...legal].sort(rankOrder)[0]).id;
    }

    const leadSuit = game.trick[0].card.suit;
    const winnerIndex = winningPlayIndex(game);
    const winnerPlay = game.trick[winnerIndex];
    const currentWinnerSide = sideOf(winnerPlay.seat);
    const partnerIsWinning = currentWinnerSide === sideOf(seat);
    const beatsWinner = (card) => cardBeats(card, winnerPlay.card, leadSuit, trump);

    if (!partnerIsWinning) {
      const winners = legal.filter(beatsWinner).sort(rankOrder);
      if (winners.length) return winners[0].id;
    }

    // Preserve high cards when a partner already wins; otherwise throw a cheap card.
    const nonTrump = legal.filter((card) => card.suit !== trump).sort(rankOrder);
    if (partnerIsWinning && nonTrump.length) return nonTrump[0].id;
    if (nonTrump.length) return nonTrump[0].id;
    return [...legal].sort(rankOrder)[0].id;
  }

  root.BridgeAI = { highCardPoints, suitLengths, isBalanced, bidText, chooseCall, chooseCard };
})(typeof window !== "undefined" ? window : globalThis);
