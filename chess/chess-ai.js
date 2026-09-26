"use strict";

/*
 * Chess computer player.
 *
 * This is deliberately a starting point rather than a full chess engine.
 * It uses material + a few simple positional ideas and searches with
 * minimax/alpha-beta pruning. The difficulty setting controls search depth.
 *
 * Standard Chess and Chess960 use two-player minimax. 4-player Chess uses a
 * multi-player Max-N search, where each player chooses moves that improve that
 * player's own evaluation.
 */

const ChessAI = (() => {
  const PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000,
  };

  const DIFFICULTY = {
    easy: { depth: 1, randomness: 0.18 },
    normal: { depth: 2, randomness: 0.06 },
    hard: { depth: 3, randomness: 0.015 },
    expert: { depth: 4, randomness: 0 },
  };

  const FOUR_DIFFICULTY = {
    easy: { depth: 1, randomness: 0.18, nodeLimit: 300 },
    normal: { depth: 2, randomness: 0.06, nodeLimit: 1200 },
    hard: { depth: 2, randomness: 0.015, nodeLimit: 5000 },
    expert: { depth: 3, randomness: 0, nodeLimit: 12000 },
  };

  const FOUR_COLORS_LOCAL = ["white", "red", "black", "blue"];

  const CENTER = new Set(["3,3", "3,4", "4,3", "4,4"]);

  function config(difficulty) {
    return DIFFICULTY[difficulty] || DIFFICULTY.normal;
  }

  function allMoves(game) {
    const moves = [];

    for (let r = 0; r < game.board.length; r++) {
      for (let c = 0; c < game.board[r].length; c++) {
        const p = game.board[r][c];
        if (p && p.color === game.turn) {
          moves.push(...game.legalMovesFrom(r, c));
        }
      }
    }

    return moves;
  }

  function moveIsCapture(game, move) {
    return Boolean(game.board[move.to.r]?.[move.to.c]);
  }

  function moveScore(game, move) {
    let score = 0;
    const piece = game.board[move.from.r]?.[move.from.c];
    const captured = game.board[move.to.r]?.[move.to.c];

    if (captured) {
      score += 10000 + (PIECE_VALUES[captured.type] || 0);
      score -= PIECE_VALUES[piece?.type] || 0;
    }

    if (move.promotion) score += 8000;

    if (piece?.type === "p" && CENTER.has(`${move.to.r},${move.to.c}`)) {
      score += 120;
    }

    if (piece?.type === "n" || piece?.type === "b") {
      if (move.to.r >= 2 && move.to.r <= 5 && move.to.c >= 2 && move.to.c <= 5) {
        score += 40;
      }
    }

    if (move.castling) score += 150;

    return score;
  }

  function orderedMoves(game, moves) {
    return [...moves].sort(
      (a, b) => moveScore(game, b) - moveScore(game, a),
    );
  }

  function evaluate(game, rootColor) {
    let score = 0;

    for (let r = 0; r < game.board.length; r++) {
      for (let c = 0; c < game.board[r].length; c++) {
        const piece = game.board[r][c];
        if (!piece) continue;

        let value = PIECE_VALUES[piece.type] || 0;

        // Encourage occupying the centre with pawns and minor pieces.
        if (game.size === 8) {
          if (CENTER.has(`${r},${c}`)) value += 25;
          if ((piece.type === "n" || piece.type === "b") && r >= 2 && r <= 5 && c >= 2 && c <= 5) {
            value += 10;
          }
        }

        // A small mobility bonus makes the engine prefer active positions.
        if (piece.color === rootColor) score += value;
        else score -= value;
      }
    }

    const ownMoves = legalMoveCountFor(game, rootColor);
    const enemy = rootColor === "w" ? "b" : "w";
    const enemyMoves = legalMoveCountFor(game, enemy);
    score += (ownMoves - enemyMoves) * 3;

    const rootKing = game.findKing(rootColor);
    const enemyKing = game.findKing(enemy);

    if (rootKing && game.attacked(rootKing.r, rootKing.c, enemy)) score -= 35;
    if (enemyKing && game.attacked(enemyKing.r, enemyKing.c, rootColor)) score += 35;

    return score;
  }

  function legalMoveCountFor(game, color) {
    const oldTurn = game.turn;
    game.turn = color;
    let count = 0;

    for (let r = 0; r < game.board.length; r++) {
      for (let c = 0; c < game.board[r].length; c++) {
        if (game.board[r][c]?.color === color) {
          count += game.legalMovesFrom(r, c).length;
        }
      }
    }

    game.turn = oldTurn;
    return count;
  }

  function makeTemporaryMove(game, move) {
    const snapshot = game.clone();
    const historyLength = game.history.length;
    const ok = game.makeMove(move, move.promotion ? "q" : "q");

    return { snapshot, historyLength, ok };
  }

  function restoreTemporaryMove(game, state) {
    game.restore(state.snapshot);
    game.history.length = state.historyLength;
  }

  function search(game, depth, alpha, beta, rootColor) {
    const status = game.gameStatus();

    if (status.over) {
      if (status.check) {
        // The side to move has been checkmated.
        return game.turn === rootColor ? -1000000 - depth : 1000000 + depth;
      }
      return 0;
    }

    if (depth <= 0) return evaluate(game, rootColor);

    const moves = orderedMoves(game, allMoves(game));
    if (!moves.length) return evaluate(game, rootColor);

    const maximizing = game.turn === rootColor;

    if (maximizing) {
      let best = -Infinity;

      for (const move of moves) {
        const { snapshot, historyLength, ok } = makeTemporaryMove(game, move);
        if (!ok) continue;

        const value = search(game, depth - 1, alpha, beta, rootColor);
        restoreTemporaryMove(game, { snapshot, historyLength });

        best = Math.max(best, value);
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }

      return best;
    }

    let best = Infinity;

    for (const move of moves) {
      const { snapshot, historyLength, ok } = makeTemporaryMove(game, move);
      if (!ok) continue;

      const value = search(game, depth - 1, alpha, beta, rootColor);
      restoreTemporaryMove(game, { snapshot, historyLength });

      best = Math.min(best, value);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }

    return best;
  }

  function fourAllMoves(game) {
    return allMoves(game);
  }

  function fourEvaluate(game) {
    const scores = Object.fromEntries(
      FOUR_COLORS_LOCAL.map((color) => [color, 0]),
    );

    for (let r = 0; r < game.board.length; r++) {
      for (let c = 0; c < game.board[r].length; c++) {
        const piece = game.board[r][c];
        if (!piece) continue;

        let value = PIECE_VALUES[piece.type] || 0;

        // Encourage pieces to move toward the central playable area.
        const centerDistance = Math.abs(r - 6.5) + Math.abs(c - 6.5);
        value += Math.max(0, 8 - centerDistance) * 2;

        scores[piece.color] += value;
      }
    }

    // Mobility is useful in four-player chess, but keep it relatively small
    // so that material remains the dominant factor.
    const oldTurn = game.turn;
    for (const color of FOUR_COLORS_LOCAL) {
      game.turn = color;
      let mobility = 0;

      for (let r = 0; r < game.board.length; r++) {
        for (let c = 0; c < game.board[r].length; c++) {
          if (game.board[r][c]?.color === color) {
            mobility += game.legalMovesFrom(r, c).length;
          }
        }
      }

      scores[color] += mobility * 2;
    }
    game.turn = oldTurn;

    return scores;
  }

  function fourMoveScore(game, move) {
    const piece = game.board[move.from.r]?.[move.from.c];
    const captured = game.board[move.to.r]?.[move.to.c];
    let score = 0;

    if (captured) {
      score += 10000 + (PIECE_VALUES[captured.type] || 0);
      score -= PIECE_VALUES[piece?.type] || 0;
    }

    if (move.promotion) score += 8000;

    return score;
  }

  function fourOrderedMoves(game, moves) {
    return [...moves].sort(
      (a, b) => fourMoveScore(game, b) - fourMoveScore(game, a),
    );
  }

  function fourSearch(game, depth, rootColor, nodeState) {
    nodeState.count++;

    if (depth <= 0 || nodeState.count >= nodeState.limit) {
      return fourEvaluate(game);
    }

    const moves = fourOrderedMoves(game, fourAllMoves(game));

    if (!moves.length) return fourEvaluate(game);

    let bestVector = null;
    let bestOwnScore = -Infinity;

    for (const move of moves) {
      if (nodeState.count >= nodeState.limit) break;

      const snapshot = game.clone();
      const historyLength = game.history.length;
      const ok = game.makeMove(move, move.promotion ? "q" : "q");

      if (!ok) continue;

      const vector = fourSearch(
        game,
        depth - 1,
        rootColor,
        nodeState,
      );

      game.restore(snapshot);
      game.history.length = historyLength;

      const currentPlayer = snapshot.turn;
      const ownScore = vector[currentPlayer] ?? 0;

      // Max-N: the player whose turn it was at this node chooses the move
      // that maximizes that player's own score.
      if (bestVector === null || ownScore > bestOwnScore) {
        bestOwnScore = ownScore;
        bestVector = vector;
      }
    }

    return bestVector || fourEvaluate(game);
  }

  function findBestFourPlayerMove(game, difficulty = "normal") {
    const moves = fourOrderedMoves(game, fourAllMoves(game));
    if (!moves.length) return null;

    const settings = FOUR_DIFFICULTY[difficulty] || FOUR_DIFFICULTY.normal;
    const rootColor = game.turn;
    const scored = [];

    for (const move of moves) {
      const snapshot = game.clone();
      const historyLength = game.history.length;
      const ok = game.makeMove(move, move.promotion ? "q" : "q");

      if (!ok) continue;

      const nodeState = { count: 0, limit: settings.nodeLimit };
      const vector = fourSearch(
        game,
        Math.max(0, settings.depth - 1),
        rootColor,
        nodeState,
      );

      game.restore(snapshot);
      game.history.length = historyLength;

      scored.push({
        move,
        score: vector[rootColor] ?? -Infinity,
      });
    }

    if (!scored.length) return null;

    scored.sort((a, b) => b.score - a.score);

    if (
      settings.randomness > 0 &&
      scored.length > 1 &&
      Math.random() < settings.randomness
    ) {
      const poolSize = Math.min(3, scored.length);
      return scored[Math.floor(Math.random() * poolSize)].move;
    }

    return scored[0].move;
  }

  function findBestMove(game, difficulty = "normal") {
    if (!game) return null;

    if (game.size !== 8) {
      return findBestFourPlayerMove(game, difficulty);
    }

    const moves = allMoves(game);
    if (!moves.length) return null;

    const settings = config(difficulty);
    const rootColor = game.turn;
    const candidates = orderedMoves(game, moves);
    const scored = [];

    for (const move of candidates) {
      const { snapshot, historyLength, ok } = makeTemporaryMove(game, move);
      if (!ok) continue;

      const score = search(
        game,
        settings.depth - 1,
        -Infinity,
        Infinity,
        rootColor,
      );

      restoreTemporaryMove(game, { snapshot, historyLength });
      scored.push({ move, score });
    }

    if (!scored.length) return null;

    scored.sort((a, b) => b.score - a.score);

    // Easy/Normal retain a small amount of variety. The engine still strongly
    // prefers its best moves, but it does not play identically every game.
    if (settings.randomness > 0 && scored.length > 1 && Math.random() < settings.randomness) {
      const poolSize = Math.min(3, scored.length);
      return scored[Math.floor(Math.random() * poolSize)].move;
    }

    return scored[0].move;
  }

  function findFallbackMove(game) {
    if (!game) return null;
    const moves = allMoves(game);
    return moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
  }

  return {
    findBestMove,
    difficultyNames: Object.keys(DIFFICULTY),
  };
})();
