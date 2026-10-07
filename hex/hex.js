"use strict";

class HexGame {
  constructor(size = 11) {
    this.size = Number.isInteger(size) && size >= 2 ? size : 11;
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(0));
    this.turn = 1;
    this.history = [];
    this.moves = [];
    this.winner = 0;
  }

  clone() {
    return {
      board: this.board.map(row => row.slice()),
      turn: this.turn,
      moves: this.moves.map(move => ({ ...move })),
      winner: this.winner
    };
  }

  restore(state) {
    this.board = state.board.map(row => row.slice());
    this.turn = state.turn;
    this.moves = state.moves.map(move => ({ ...move }));
    this.winner = state.winner || 0;
  }

  undo() {
    if (!this.history.length || this.winner) return false;
    this.restore(this.history.pop());
    return true;
  }

  inside(r, c) {
    return r >= 0 && r < this.size && c >= 0 && c < this.size;
  }

  neighbors(r, c) {
    return [
      [r - 1, c],
      [r - 1, c + 1],
      [r, c - 1],
      [r, c + 1],
      [r + 1, c - 1],
      [r + 1, c]
    ].filter(([nr, nc]) => this.inside(nr, nc));
  }

  getLegalMoves() {
    if (this.winner) return [];
    const moves = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.board[r][c] === 0) moves.push({ r, c });
      }
    }
    return moves;
  }

  hasConnection(player) {
    const queue = [];
    const seen = Array.from({ length: this.size }, () => Array(this.size).fill(false));

    if (player === 1) {
      for (let c = 0; c < this.size; c++) {
        if (this.board[0][c] === player) {
          queue.push([0, c]);
          seen[0][c] = true;
        }
      }
      while (queue.length) {
        const [r, c] = queue.shift();
        if (r === this.size - 1) return true;
        for (const [nr, nc] of this.neighbors(r, c)) {
          if (!seen[nr][nc] && this.board[nr][nc] === player) {
            seen[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
    } else {
      for (let r = 0; r < this.size; r++) {
        if (this.board[r][0] === player) {
          queue.push([r, 0]);
          seen[r][0] = true;
        }
      }
      while (queue.length) {
        const [r, c] = queue.shift();
        if (c === this.size - 1) return true;
        for (const [nr, nc] of this.neighbors(r, c)) {
          if (!seen[nr][nc] && this.board[nr][nc] === player) {
            seen[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
    }

    return false;
  }

  makeMove(r, c, player = this.turn) {
    if (this.winner || player !== this.turn || !this.inside(r, c) || this.board[r][c] !== 0) {
      return false;
    }

    this.history.push(this.clone());
    this.board[r][c] = player;
    this.moves.push({ r, c, player });

    if (this.hasConnection(player)) {
      this.winner = player;
      return true;
    }

    this.turn = player === 1 ? 2 : 1;
    return true;
  }

  gameStatus() {
    if (this.winner === 1) {
      return { over: true, winner: 1, text: "Blue wins — Blue connected the top and bottom edges." };
    }
    if (this.winner === 2) {
      return { over: true, winner: 2, text: "Red wins — Red connected the left and right edges." };
    }

    return {
      over: false,
      winner: 0,
      text: this.turn === 1 ? "Blue to move — connect top to bottom." : "Red to move — connect left to right."
    };
  }
}

if (typeof window !== "undefined") {
  window.HexGame = HexGame;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { HexGame };
}
