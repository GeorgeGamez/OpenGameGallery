"use strict";

/*
 * Hex AI for the OpenGameGallery Hex implementation.
 * Uses weighted shortest connection paths, immediate tactical checks,
 * local connection bonuses, and a one-ply minimax reply search.
 */

const HEX_DIRECTIONS = [
  [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0],
];
// Positive half of the six directions, so each friendly connection is counted once.
const HEX_UNIQUE_DIRECTIONS = [[0, 1], [1, -1], [1, 0]];
const HEX_WIN_SCORE = 1e8;

function hexOtherColor(color) {
  return color === "blue" ? "red" : "blue";
}

function hexEmptyMoves(game) {
  const moves = [];
  for (let r = 0; r < game.size; r++) {
    for (let c = 0; c < game.size; c++) {
      if (!game.board[r][c]) moves.push({ r, c });
    }
  }
  return moves;
}

function hexPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].d <= heap[i].d) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}

function hexPop(heap) {
  if (!heap.length) return null;
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
}

// Dijkstra cost for the cheapest potential connection between a player's edges.
// Friendly stones cost nothing, empty cells cost one, and enemy stones are very
// expensive. This encourages routes around enemy stones while still giving the
// evaluator a usable score when a route is heavily obstructed.
function hexShortestPathCost(game, player) {
  const n = game.size;
  const total = n * n;
  const dist = new Float64Array(total);
  dist.fill(Infinity);
  const heap = [];
  const enemyPenalty = n * 3 + 8;
  const cellCost = (r, c) => {
    const color = game.board[r][c]?.color;
    if (color === player) return 0;
    if (color && color !== player) return enemyPenalty;
    return 1;
  };

  if (player === "blue") {
    for (let c = 0; c < n; c++) {
      const idx = c;
      dist[idx] = cellCost(0, c);
      hexPush(heap, { idx, d: dist[idx] });
    }
  } else {
    for (let r = 0; r < n; r++) {
      const idx = r * n;
      dist[idx] = cellCost(r, 0);
      hexPush(heap, { idx, d: dist[idx] });
    }
  }

  while (heap.length) {
    const current = hexPop(heap);
    if (!current || current.d !== dist[current.idx]) continue;
    const r = Math.floor(current.idx / n);
    const c = current.idx % n;
    if ((player === "blue" && r === n - 1) ||
        (player === "red" && c === n - 1)) return current.d;

    for (const [dr, dc] of HEX_DIRECTIONS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      const nextIdx = nr * n + nc;
      const nextDist = current.d + cellCost(nr, nc);
      if (nextDist < dist[nextIdx]) {
        dist[nextIdx] = nextDist;
        hexPush(heap, { idx: nextIdx, d: nextDist });
      }
    }
  }
  return Infinity;
}

function hexConnectedPairScore(game, perspective) {
  let ownPairs = 0;
  let opponentPairs = 0;
  const opponent = hexOtherColor(perspective);
  for (let r = 0; r < game.size; r++) {
    for (let c = 0; c < game.size; c++) {
      const color = game.board[r][c]?.color;
      if (!color) continue;
      for (const [dr, dc] of HEX_UNIQUE_DIRECTIONS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= game.size || nc < 0 || nc >= game.size) continue;
        if (game.board[nr][nc]?.color !== color) continue;
        if (color === perspective) ownPairs++;
        else if (color === opponent) opponentPairs++;
      }
    }
  }
  return (ownPairs - opponentPairs) * 1.6;
}

function hexCenterBias(game, move, player) {
  // In the opening, prefer a central foothold instead of an arbitrary corner.
  // The bias fades as the board fills and path tactics matter more.
  let stones = 0;
  for (const row of game.board) for (const cell of row) if (cell) stones++;
  if (stones >= Math.max(5, game.size * 0.45)) return 0;
  const middle = (game.size - 1) / 2;
  const dr = Math.abs(move.r - middle);
  const dc = Math.abs(move.c - middle);
  const transverse = player === "blue" ? dc : dr;
  const along = player === "blue" ? dr : dc;
  return -(transverse * 1.5 + along * 0.25);
}

function hexEvaluate(game, perspective) {
  const opponent = hexOtherColor(perspective);
  const ownPath = hexShortestPathCost(game, perspective);
  const opponentPath = hexShortestPathCost(game, opponent);
  if (ownPath === 0) return HEX_WIN_SCORE;
  if (opponentPath === 0) return -HEX_WIN_SCORE;
  return (opponentPath - ownPath) * 40 + hexConnectedPairScore(game, perspective);
}

function hexWinningMoves(game, player, candidates) {
  const found = [];
  for (const move of candidates) {
    game.board[move.r][move.c] = { type: "m", color: player };
    const wins = game.checkWin(player);
    game.board[move.r][move.c] = null;
    if (wins) found.push(move);
  }
  return found;
}

function hexMoveStaticScore(game, move, player) {
  game.board[move.r][move.c] = { type: "m", color: player };
  let score;
  if (game.checkWin(player)) {
    score = HEX_WIN_SCORE;
  } else {
    score = hexEvaluate(game, player);
  }
  game.board[move.r][move.c] = null;
  score += hexCenterBias(game, move, player);
  return score;
}

function findBestMove(game, difficulty = "normal") {
  const legal = game.getLegalMoves();
  if (!legal.length) return null;

  const player = game.turn;
  const opponent = hexOtherColor(player);
  const level = String(difficulty || "normal").toLowerCase();

  // Always take a win if one is available.
  const winningMoves = hexWinningMoves(game, player, legal);
  if (winningMoves.length) return winningMoves[0];

  // If the opponent has exactly one winning square, occupy it immediately.
  const opponentWins = hexWinningMoves(game, opponent, legal);
  if (opponentWins.length === 1) return opponentWins[0];

  const scored = legal.map((move) => ({
    move,
    score: hexMoveStaticScore(game, move, player),
  }));
  scored.sort((a, b) => b.score - a.score);

  if (level === "easy") {
    // Easy still follows paths and blocks immediate threats, but avoids perfect
    // play by choosing randomly from a small group of reasonable candidates.
    const pool = scored.slice(0, Math.min(7, scored.length));
    const floor = pool[pool.length - 1]?.score ?? 0;
    const weighted = pool.map((entry) => ({
      ...entry,
      weight: Math.max(0.05, entry.score - floor + 1),
    }));
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = Math.random() * totalWeight;
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick <= 0) return entry.move;
    }
    return pool[0].move;
  }

  // Look ahead at the opponent's best reply to each promising move. The reply
  // search checks every remaining empty cell, so the AI doesn't only react to
  // the local neighborhood around its own last move.
  const candidateCount = level === "hard" ? 14 : 9;
  const candidates = scored.slice(0, Math.min(candidateCount, scored.length));
  let bestMove = candidates[0].move;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const move = candidate.move;
    game.board[move.r][move.c] = { type: "m", color: player };
    if (game.checkWin(player)) {
      game.board[move.r][move.c] = null;
      return move;
    }

    let worstReplyScore = Infinity;
    for (const reply of legal) {
      if (reply.r === move.r && reply.c === move.c) continue;
      if (game.board[reply.r][reply.c] !== null) continue;

      game.board[reply.r][reply.c] = { type: "m", color: opponent };
      let replyScore;
      if (game.checkWin(opponent)) {
        replyScore = -HEX_WIN_SCORE;
      } else {
        replyScore = hexEvaluate(game, player);
      }
      game.board[reply.r][reply.c] = null;

      if (replyScore < worstReplyScore) worstReplyScore = replyScore;
      // Nothing is worse than an immediate loss; no need to examine more replies.
      if (worstReplyScore <= -HEX_WIN_SCORE) break;
    }
    game.board[move.r][move.c] = null;

    if (!Number.isFinite(worstReplyScore)) worstReplyScore = candidate.score;
    let score = candidate.score * 0.22 + worstReplyScore * 0.78;
    if (level !== "hard") score += (Math.random() - 0.5) * 0.8;
    else score += (Math.random() - 0.5) * 0.03;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

if (typeof window !== "undefined") window.HexAI = { findBestMove };
if (typeof module !== "undefined" && module.exports) module.exports = { findBestMove };
