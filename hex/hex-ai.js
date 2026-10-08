"use strict";

function shortestPathCost(game, player) {
  const n = game.size;
  const INF = 1e9;
  const dist = Array.from({ length: n }, () => Array(n).fill(INF));
  const heap = [];

  const push = (node) => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };

  const pop = () => {
    const root = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < heap.length && heap[l].d < heap[best].d) best = l;
        if (r < heap.length && heap[r].d < heap[best].d) best = r;
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

function immediateWinningMove(game, player) {
  for (const move of game.getLegalMoves()) {
    game.board[move.r][move.c] = { type: "m", color: player };
    const win = game.checkWin(player);
    game.board[move.r][move.c] = null;
    if (win) return move;
  }
  return null;
}

function localScore(game, player, move) {
  let score = 0;
  for (const [r, c] of game.neighbors(move.r, move.c)) {
    const cell = game.board[r][c];
    if (cell?.color === player) score += 5;
    else if (!cell) score += 1;
    else score -= 3;
  }
  return score;
}

function findBestMove(game, difficulty = "normal") {
  const legal = game.getLegalMoves();
  if (!legal.length) return null;

  const player = game.turn;
  const opponent = player === "blue" ? "red" : "blue";
  const winning = immediateWinningMove(game, player);
  if (winning) return winning;

  const blocking = immediateWinningMove(game, opponent);
  const level = String(difficulty || "normal").toLowerCase();
  if (blocking && level !== "easy") return blocking;

  const opponentPath = shortestPathCost(game, opponent);
  const scored = [];

  for (const move of legal) {
    game.board[move.r][move.c] = { type: "m", color: player };
    const ownPath = shortestPathCost(game, player);
    const enemyPath = shortestPathCost(game, opponent);
    const local = localScore(game, player, move);
    game.board[move.r][move.c] = null;

    let score =
      (opponentPath - enemyPath) * 9 +
      (game.size + 1 - ownPath) * 7 +
      local;

    if (level === "easy") {
      score *= 0.45;
      score += Math.random() * 6;
    } else if (level === "hard") {
      score += (opponentPath - enemyPath) * 6;
      score += Math.random() * 0.2;
    } else {
      score += Math.random() * 1.2;
    }

    scored.push({ move, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].move;
}

if (typeof window !== "undefined") window.HexAI = { findBestMove };
if (typeof module !== "undefined" && module.exports) module.exports = { findBestMove };
