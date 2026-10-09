"use strict";

/*
 * Hex AI
 *
 * This uses three layers of play:
 *   1. forced wins / forced blocks,
 *   2. connection-distance evaluation, and
 *   3. Monte-Carlo position sampling with heuristic rollouts.
 *
 * The combination makes the computer actually reason about likely future
 * connections instead of simply choosing a nearby empty cell.
 */

function shortestPathCost(game, player) {
  const n = game.size;
  const INF = 1e9;
  const dist = Array.from({ length: n }, () => Array(n).fill(INF));
  const heap = [];

  const push = (node) => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].d <= heap[i].d) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };

  const pop = () => {
    const root = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < heap.length && heap[left].d < heap[best].d) best = left;
        if (right < heap.length && heap[right].d < heap[best].d) best = right;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return root;
  };

  const cost = (r, c) => {
    const cell = game.board[r][c];
    if (cell?.color === player) return 0;
    if (!cell) return 1;
    return 1000;
  };

  if (player === "blue") {
    for (let c = 0; c < n; c++) {
      dist[0][c] = cost(0, c);
      push({ r: 0, c, d: dist[0][c] });
    }
  } else {
    for (let r = 0; r < n; r++) {
      dist[r][0] = cost(r, 0);
      push({ r, c: 0, d: dist[r][0] });
    }
  }

  while (heap.length) {
    const current = pop();
    if (!current || current.d !== dist[current.r][current.c]) continue;
    for (const [nr, nc] of game.neighbors(current.r, current.c)) {
      const nd = current.d + cost(nr, nc);
      if (nd < dist[nr][nc]) {
        dist[nr][nc] = nd;
        push({ r: nr, c: nc, d: nd });
      }
    }
  }

  let best = INF;
  if (player === "blue") {
    for (let c = 0; c < n; c++) best = Math.min(best, dist[n - 1][c]);
  } else {
    for (let r = 0; r < n; r++) best = Math.min(best, dist[r][n - 1]);
  }
  return best;
}

function otherPlayer(player) {
  return player === "blue" ? "red" : "blue";
}

function putStone(game, move, player) {
  game.board[move.r][move.c] = { type: "m", color: player };
}

function immediateWinningMove(game, player) {
  for (const move of game.getLegalMoves()) {
    putStone(game, move, player);
    const win = game.checkWin(player);
    game.board[move.r][move.c] = null;
    if (win) return move;
  }
  return null;
}

function moveShapeScore(game, player, move) {
  const opponent = otherPlayer(player);
  const n = game.size;
  let score = 0;

  // Prefer cells that advance toward the player's target sides.
  const progress = player === "blue" ? (n - 1 - move.r) : (n - 1 - move.c);
  const center = (n - 1) / 2;
  const lateral = player === "blue" ? Math.abs(move.c - center) : Math.abs(move.r - center);
  score += progress * 0.15;
  score -= lateral * 0.04;

  for (const [r, c] of game.neighbors(move.r, move.c)) {
    const cell = game.board[r][c];
    if (cell?.color === player) score += 3.5;
    else if (cell?.color === opponent) score += 1.4;
    else score += 0.25;
  }

  // A move that reduces either player's connection distance is strategically useful.
  game.board[move.r][move.c] = { type: "m", color: player };
  const ownAfter = shortestPathCost(game, player);
  const enemyAfter = shortestPathCost(game, opponent);
  game.board[move.r][move.c] = null;

  score += (n + 1 - ownAfter) * 1.7;
  score += (enemyAfter - 1) * 1.2;
  return score;
}

function rankCandidates(game, moves, player, limit) {
  const ranked = moves.map(move => ({ move, score: moveShapeScore(game, player, move) }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.min(limit, ranked.length)).map(x => x.move);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function rolloutWinner(game, startPlayer, baseEmpties) {
  const originalTurn = game.turn;
  const played = [];
  const empties = baseEmpties.map(move => ({ r: move.r, c: move.c }));
  shuffle(empties);
  let turn = startPlayer;
  let winner = null;

  while (empties.length) {
    const move = empties.pop();
    putStone(game, move, turn);
    played.push(move);

    if (game.checkWin(turn)) {
      winner = turn;
      break;
    }
    turn = otherPlayer(turn);
  }

  for (let i = played.length - 1; i >= 0; i--) {
    const move = played[i];
    game.board[move.r][move.c] = null;
  }
  game.turn = originalTurn;
  return winner;
}

function monteCarloScore(game, move, player, simulations) {
  putStone(game, move, player);
  if (game.checkWin(player)) {
    game.board[move.r][move.c] = null;
    return 1;
  }

  const baseEmpties = game.getLegalMoves();
  let wins = 0;

  for (let i = 0; i < simulations; i++) {
    if (rolloutWinner(game, otherPlayer(player), baseEmpties) === player) wins++;
  }

  game.board[move.r][move.c] = null;
  return (wins + 0.5) / Math.max(1, simulations);
}


function findBestMove(game, difficulty = "normal") {
  const legal = game.getLegalMoves();
  if (!legal.length) return null;

  const level = String(difficulty || "normal").toLowerCase();
  const player = game.turn;
  const opponent = otherPlayer(player);

  const winning = immediateWinningMove(game, player);
  if (winning) return winning;

  const blocking = immediateWinningMove(game, opponent);
  if (blocking && level !== "easy") return blocking;

  // Easy: still an AI, but intentionally imperfect and quick.
  if (level === "easy") {
    if (Math.random() < 0.2) return legal[Math.floor(Math.random() * legal.length)];
    const candidates = rankCandidates(game, legal, player, Math.min(6, legal.length));
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const candidateLimit = game.size >= 14 ? 10 : game.size >= 11 ? 12 : 14;
  const candidates = rankCandidates(game, legal, player, candidateLimit);
  const simulations = level === "hard"
    ? (game.size >= 14 ? 45 : game.size >= 11 ? 60 : 80)
    : (game.size >= 14 ? 20 : game.size >= 11 ? 30 : 45);

  let bestMove = candidates[0];
  let bestScore = -Infinity;
  const ownBefore = shortestPathCost(game, player);
  const enemyBefore = shortestPathCost(game, opponent);

  for (const move of candidates) {
    const winRate = monteCarloScore(game, move, player, simulations);

    // Blend simulation results with connection pressure. The simulations decide
    // most of the move, while the distance term gives stable play when samples tie.
    putStone(game, move, player);
    const ownAfter = shortestPathCost(game, player);
    const enemyAfter = shortestPathCost(game, opponent);
    game.board[move.r][move.c] = null;

    const connection =
      (ownBefore - ownAfter) * 2.2 +
      (enemyBefore - enemyAfter) * 1.7;
    const jitter = level === "hard" ? Math.random() * 0.01 : Math.random() * 0.08;
    const score = winRate * 100 + connection * 3 + moveShapeScore(game, player, move) * 0.18 + jitter;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

if (typeof window !== "undefined") window.HexAI = { findBestMove };
if (typeof module !== "undefined" && module.exports) module.exports = { findBestMove };
