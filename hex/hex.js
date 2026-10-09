"use strict";

class HexGame {
  constructor(size = 11) {
    this.size = Number.isInteger(size) && size >= 2 ? size : 11;
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: this.size }, () =>
      Array(this.size).fill(null),
    );
    this.turn = "blue";
    this.history = [];
    this.sanHistory = [];
    this.lastMove = null;
  }

  clone() {
    return {
      board: this.board.map((row) => row.map((p) => (p ? { ...p } : null))),
      turn: this.turn,
      san: [...this.sanHistory],
      lastMove: this.lastMove
        ? {
            from: { ...this.lastMove.from },
            to: { ...this.lastMove.to },
          }
        : null,
    };
  }

  restore(state) {
    this.board = state.board.map((row) =>
      row.map((p) => (p ? { ...p } : null)),
    );
    this.turn = state.turn;
    this.sanHistory = [...state.san];
    this.lastMove = state.lastMove
      ? {
          from: { ...state.lastMove.from },
          to: { ...state.lastMove.to },
        }
      : null;
  }

  undo() {
    if (!this.history.length) return false;
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
      [r + 1, c],
    ].filter(([nr, nc]) => this.inside(nr, nc));
  }

  legalMovesFrom(r, c) {
    if (!this.inside(r, c) || this.board[r][c] !== null) return [];
    return [{ from: { r, c }, to: { r, c } }];
  }

  getLegalMoves() {
    const moves = [];
    if (this.gameStatus().over) return moves;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.board[r][c] === null) moves.push({ r, c });
      }
    }
    return moves;
  }

  makeMove(m) {
    const r = m?.to?.r ?? m?.r;
    const c = m?.to?.c ?? m?.c;
    if (!this.inside(r, c) || this.board[r][c] !== null) return false;

    this.history.push(this.clone());
    this.board[r][c] = { type: "m", color: this.turn };
    this.lastMove = { from: { r, c }, to: { r, c } };
    this.sanHistory.push(
      `${this.turn === "blue" ? "B" : "R"}: ${String.fromCharCode(97 + c)}${this.size - r}`,
    );

    if (this.checkWin(this.turn)) return true;

    this.turn = this.turn === "blue" ? "red" : "blue";
    return true;
  }

  checkWin(color) {
    const visited = Array.from({ length: this.size }, () =>
        Array(this.size).fill(false),
      ),
      queue = [];

    if (color === "blue") {
      for (let c = 0; c < this.size; c++) {
        if (this.board[0][c]?.color === "blue") {
          queue.push({ r: 0, c });
          visited[0][c] = true;
        }
      }
      while (queue.length > 0) {
        const { r, c } = queue.shift();
        if (r === this.size - 1) return true;
        for (const [nr, nc] of this.neighbors(r, c)) {
          if (!visited[nr][nc] && this.board[nr][nc]?.color === "blue") {
            visited[nr][nc] = true;
            queue.push({ r: nr, c: nc });
          }
        }
      }
    } else {
      for (let r = 0; r < this.size; r++) {
        if (this.board[r][0]?.color === "red") {
          queue.push({ r, c: 0 });
          visited[r][0] = true;
        }
      }
      while (queue.length > 0) {
        const { r, c } = queue.shift();
        if (c === this.size - 1) return true;
        for (const [nr, nc] of this.neighbors(r, c)) {
          if (!visited[nr][nc] && this.board[nr][nc]?.color === "red") {
            visited[nr][nc] = true;
            queue.push({ r: nr, c: nc });
          }
        }
      }
    }

    return false;
  }

  gameStatus() {
    if (this.checkWin("blue")) {
      return { over: true, winner: "blue", text: "Game Over — Blue wins!" };
    }
    if (this.checkWin("red")) {
      return { over: true, winner: "red", text: "Game Over — Red wins!" };
    }
    return {
      over: false,
      winner: null,
      text:
        this.turn === "blue"
          ? "Blue (Top-Bottom) to move"
          : "Red (Left-Right) to move",
    };
  }
}

if (typeof window !== "undefined") window.HexGame = HexGame;
if (typeof module !== "undefined" && module.exports)
  module.exports = { HexGame };
