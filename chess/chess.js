"use strict";

const SOLID_PIECES = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
  m: "●",
  K: "👑",
};
const PIECES = { w: SOLID_PIECES, b: SOLID_PIECES };
const FOUR_PIECES = {
  white: SOLID_PIECES,
  black: SOLID_PIECES,
  red: SOLID_PIECES,
  blue: SOLID_PIECES,
};
const LARGE_PIECES = {
  w: { ...SOLID_PIECES, m: "M", c: "C", e: "E" },
  b: { ...SOLID_PIECES, m: "M", c: "C", e: "E" },
};

// Shako represents its two fairy pieces as inverted orthodox chess pieces:
// Cannon = inverted rook, Elephant = inverted bishop.
const SHAKO_PIECES = {
  w: { ...SOLID_PIECES, c: "♜", e: "♝" },
  b: { ...SOLID_PIECES, c: "♜", e: "♝" },
};
const THREE_PIECES = {
  white: { ...SOLID_PIECES, a: "➹" },
  red: { ...SOLID_PIECES, a: "➹" },
  black: { ...SOLID_PIECES, a: "➹" },
};
const FOUR_COLORS = ["white", "red", "black", "blue"];

function inside(r, c, size) {
  return r >= 0 && r < size && c >= 0 && c < size;
}
function cloneBoard(b) {
  return b.map((row) => row.map((p) => (p ? { ...p } : null)));
}
function opposite(c) {
  return c === "w" ? "b" : "w";
}

// Exact six-wedge board geometry used by the 96-cell quadrilateral
// Three-Man Chess board. Each wedge contains a 4x4 grid. The wedges meet
// at their 60° corners in the centre and rotate around the centre.
// ------------------ GEORGE DEKLE THREE-MAN BOARD ------------------
//
// This constructs the 96-cell quadrilateral board used by George R.
// Dekle Sr.'s Three-Man Chess. The six 4x4 wedges are fused into a
// hexagon; the logical coordinates are then remapped into three 4x8
// player territories so each home side contains a complete back rank.
const THREE_MAN_GEOMETRY = (() => {
  const SQRT3 = Math.sqrt(3);
  const LONG = 4;
  const SHORT = LONG / SQRT3;
  const C = { x: 0, y: 0 };
  const A = { x: LONG, y: 0 };
  const B = { x: LONG, y: SHORT };
  const D = { x: LONG / 2, y: (LONG * SQRT3) / 2 };

  const lerp = (p, q, t) => ({
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
  });

  const rotate = (p, angle) => {
    const cs = Math.cos(angle),
      sn = Math.sin(angle);
    return { x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs };
  };

  const gridPoint = (u, v) => {
    const left = lerp(C, D, v);
    const right = lerp(A, B, v);
    return lerp(left, right, u);
  };

  // Six wedges around the center. The +30° rotation gives the normal
  // flat-top orientation: white bottom, red upper-left, black upper-right.
  const rawCells = [];
  for (let wedge = 0; wedge < 6; wedge++) {
    for (let localRow = 0; localRow < 4; localRow++) {
      const layer = 3 - localRow;
      for (let file = 0; file < 4; file++) {
        const u0 = layer / 4,
          u1 = (layer + 1) / 4;
        const v0 = file / 4,
          v1 = (file + 1) / 4;
        const points = [
          gridPoint(u0, v0),
          gridPoint(u1, v0),
          gridPoint(u1, v1),
          gridPoint(u0, v1),
        ].map((p) => rotate(p, (-wedge * Math.PI) / 3 + Math.PI / 6));

        const center = points.reduce(
          (a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }),
          { x: 0, y: 0 },
        );

        rawCells.push({
          id: rawCells.length,
          wedge,
          localRow,
          file,
          points,
          center,
          shade: 0,
          neighbors: [],
        });
      }
    }
  }

  const quantize = (p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
  const edgeMap = new Map();
  for (const cell of rawCells) {
    for (let i = 0; i < 4; i++) {
      const a = quantize(cell.points[i]);
      const b = quantize(cell.points[(i + 1) % 4]);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(cell.id);
    }
  }

  for (const ids of edgeMap.values()) {
    if (ids.length === 2) {
      rawCells[ids[0]].neighbors.push(ids[1]);
      rawCells[ids[1]].neighbors.push(ids[0]);
    }
  }

  // Checkerboard shades: every edge-adjacent cell is the opposite color.
  const queue = [0];
  const seenShade = new Set([0]);
  while (queue.length) {
    const id = queue.shift();
    const cell = rawCells[id];
    for (const nid of cell.neighbors) {
      if (seenShade.has(nid)) continue;
      rawCells[nid].shade = 1 - cell.shade;
      seenShade.add(nid);
      queue.push(nid);
    }
  }

  // The eight cells on each of the three starting sides, in the direction
  // in which that player's back rank reads R N B Q K B N R.
  // These IDs are derived directly from the six fused wedges.
  const homeOrders = {
    black: [3, 2, 1, 0, 31, 27, 23, 19],
    red: [67, 66, 65, 64, 95, 91, 87, 83],
    white: [51, 55, 59, 63, 32, 33, 34, 35],
  };

  const oppositeSides = {
    white: "top",
    red: "lower-right",
    black: "lower-left",
  };

  const sideVertices = {
    top: [
      [-LONG / SQRT3, 4],
      [LONG / SQRT3, 4],
    ],
    "upper-right": [
      [LONG / SQRT3, 4],
      [(2 * LONG) / SQRT3, 0],
    ],
    "lower-right": [
      [(2 * LONG) / SQRT3, 0],
      [LONG / SQRT3, -4],
    ],
    bottom: [
      [LONG / SQRT3, -4],
      [-LONG / SQRT3, -4],
    ],
    "lower-left": [
      [-LONG / SQRT3, -4],
      [(-2 * LONG) / SQRT3, 0],
    ],
    "upper-left": [
      [(-2 * LONG) / SQRT3, 0],
      [-LONG / SQRT3, 4],
    ],
  };

  const pointLineDistance = (p, a, b) =>
    Math.abs((b[0] - a[0]) * (a[1] - p.y) - (a[0] - p.x) * (b[1] - a[1])) /
    Math.hypot(b[0] - a[0], b[1] - a[1]);

  const touchesSide = (cell, name) => {
    const [a, b] = sideVertices[name];
    for (let i = 0; i < 4; i++) {
      const p = cell.points[i];
      const q = cell.points[(i + 1) % 4];
      if (
        pointLineDistance(p, a, b) < 1e-6 &&
        pointLineDistance(q, a, b) < 1e-6
      ) {
        return true;
      }
    }
    return false;
  };

  const outerSides = {};
  for (const name of Object.keys(sideVertices)) {
    outerSides[name] = new Set(
      rawCells.filter((cell) => touchesSide(cell, name)).map((cell) => cell.id),
    );
  }

  // Distance from each cell to each home side. The nearest-side partition
  // produces exactly three 32-cell territories, each four ranks by eight files.
  const distanceFromHome = {};
  for (const color of ["white", "red", "black"]) {
    const distances = new Map();
    const start = homeOrders[color];
    const bfs = [...start];
    for (const id of start) distances.set(id, 0);
    let head = 0;
    while (head < bfs.length) {
      const id = bfs[head++];
      const nextDistance = distances.get(id) + 1;
      for (const nid of rawCells[id].neighbors) {
        if (distances.has(nid)) continue;
        distances.set(nid, nextDistance);
        bfs.push(nid);
      }
    }
    distanceFromHome[color] = distances;
  }

  const colors = ["white", "red", "black"];
  const centerAngle = (cell) => Math.atan2(cell.center.y, cell.center.x);
  const normalAngles = {
    white: -Math.PI / 2,
    red: (5 * Math.PI) / 6,
    black: Math.PI / 6,
  };
  const angularDifference = (a, b) => {
    let d = Math.abs(a - b) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
  };

  const territoryById = new Map();
  for (const cell of rawCells) {
    let min = Infinity;
    let candidates = [];
    for (const color of colors) {
      const d = distanceFromHome[color].get(cell.id);
      if (d < min) {
        min = d;
        candidates = [color];
      } else if (d === min) {
        candidates.push(color);
      }
    }
    const region =
      candidates.length === 1
        ? candidates[0]
        : candidates.sort(
            (a, b) =>
              angularDifference(centerAngle(cell), normalAngles[a]) -
              angularDifference(centerAngle(cell), normalAngles[b]),
          )[0];
    territoryById.set(cell.id, { region, rank: min });
  }

  // Reorder each rank along its home side so the first file is the player's
  // leftmost home-square and the fourth/fifth files meet at the center seam.
  const axis = {};
  for (const color of colors) {
    const start = rawCells[homeOrders[color][0]].center;
    const end = rawCells[homeOrders[color][7]].center;
    const dx = end.x - start.x,
      dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    axis[color] = { x: dx / len, y: dy / len };
  }

  const byLogical = new Map();
  const cells = new Map();
  for (const color of colors) {
    for (let rank = 0; rank < 4; rank++) {
      const row = rawCells.filter((cell) => {
        const info = territoryById.get(cell.id);
        return info.region === color && info.rank === rank;
      });
      row.sort((a, b) => {
        const ax = axis[color];
        const ap = a.center.x * ax.x + a.center.y * ax.y;
        const bp = b.center.x * ax.x + b.center.y * ax.y;
        return ap - bp;
      });
      row.forEach((cell, file) => {
        cell.region = color;
        cell.rank = rank;
        cell.file = file;
        cell.r = (color === "black" ? 0 : color === "red" ? 4 : 8) + rank;
        cell.c = file;
        cell.idLogical = `${cell.r},${cell.c}`;
        byLogical.set(cell.idLogical, cell);
        cells.set(cell.idLogical, cell);
      });
    }
  }

  // Cross-center links are the shared edges between territories. There are
  // twelve such links on the 96-cell board.
  const cross = new Map();
  for (const cell of rawCells) {
    const targets = [];
    for (const nid of cell.neighbors) {
      const other = rawCells[nid];
      if (other.region !== cell.region) targets.push(other);
    }
    if (targets.length)
      cross.set(
        cell.idLogical,
        targets.map((x) => x.idLogical),
      );
    cell.cross = targets.map((x) => x.idLogical);
  }

  const cellByRawId = new Map(rawCells.map((cell) => [cell.id, cell]));
  const homeCells = Object.fromEntries(
    colors.map((color) => [
      color,
      homeOrders[color].map((id) => cellByRawId.get(id).idLogical),
    ]),
  );

  // SVG: reverse Y because SVG's y axis grows downward.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const cell of rawCells) {
    for (const p of cell.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  const pad = 0.12;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  const toSvg = (p) => ({
    x: ((p.x - minX) / (maxX - minX)) * 100,
    y: ((maxY - p.y) / (maxY - minY)) * 100,
  });

  for (const cell of rawCells) {
    cell.svgPoints = cell.points
      .map(toSvg)
      .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
      .join(" ");
    cell.svgCenter = toSvg(cell.center);
  }

  return {
    cells,
    byLogical,
    cross,
    homeCells,
    outerSides,
    oppositeSides,
    homeOrders,
    rawCells,
  };
})();

// ---------------------------- CHESS ENGINE ----------------------------
function generate960Row() {
  const row = Array(8).fill(null);
  const empty = () =>
    row.map((v, i) => (v === null ? i : null)).filter((v) => v !== null);
  const dark = [0, 2, 4, 6][Math.floor(Math.random() * 4)];
  const light = [1, 3, 5, 7][Math.floor(Math.random() * 4)];
  row[dark] = "b";
  row[light] = "b";
  let available = empty();
  row[available[Math.floor(Math.random() * available.length)]] = "q";
  available = empty();
  row[available.splice(Math.floor(Math.random() * available.length), 1)[0]] =
    "n";
  row[available.splice(Math.floor(Math.random() * available.length), 1)[0]] =
    "n";
  available = empty();
  row[available[0]] = "r";
  row[available[1]] = "k";
  row[available[2]] = "r";
  return row;
}

function initialBoard(is960 = false) {
  const back = is960
    ? generate960Row()
    : ["r", "n", "b", "q", "k", "b", "n", "r"];
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    b[0][c] = { type: back[c], color: "b" };
    b[1][c] = { type: "p", color: "b" };
    b[6][c] = { type: "p", color: "w" };
    b[7][c] = { type: back[c], color: "w" };
  }
  return b;
}

class ChessGame {
  constructor(is960 = false) {
    this.size = 8;
    this.is960 = is960;
    this.reset();
  }
  reset() {
    this.board = initialBoard(this.is960);
    this.turn = "w";
    this.history = [];
    this.sanHistory = [];
    this.captured = [];
    this.lastMove = null;
    const wK = this.board[7].findIndex(
      (p) => p?.type === "k" && p.color === "w",
    );
    const wR = [];
    this.board[7].forEach((p, c) => {
      if (p?.type === "r" && p.color === "w") wR.push(c);
    });
    const bK = this.board[0].findIndex(
      (p) => p?.type === "k" && p.color === "b",
    );
    const bR = [];
    this.board[0].forEach((p, c) => {
      if (p?.type === "r" && p.color === "b") bR.push(c);
    });
    this.castling = {
      w: {
        kingMoved: false,
        kingCol: wK,
        rooks: wR.map((c) => ({ col: c, moved: false })),
      },
      b: {
        kingMoved: false,
        kingCol: bK,
        rooks: bR.map((c) => ({ col: c, moved: false })),
      },
    };
  }
  clone() {
    return {
      board: cloneBoard(this.board),
      turn: this.turn,
      san: [...this.sanHistory],
      captured: [...this.captured.map((p) => ({ ...p }))],
      lastMove: this.lastMove
        ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } }
        : null,
      castling: JSON.parse(JSON.stringify(this.castling)),
    };
  }
  restore(s) {
    this.board = cloneBoard(s.board);
    this.turn = s.turn;
    this.sanHistory = [...s.san];
    this.captured = s.captured.map((p) => ({ ...p }));
    this.lastMove = s.lastMove
      ? { from: { ...s.lastMove.from }, to: { ...s.lastMove.to } }
      : null;
    this.castling = JSON.parse(JSON.stringify(s.castling));
  }
  undo() {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  }
  findKing(color, b = this.board) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (b[r][c]?.color === color && b[r][c].type === "k") return { r, c };
    return null;
  }
  attacked(r, c, by, b = this.board) {
    const pawn = by === "w" ? r + 1 : r - 1;
    for (const dc of [-1, 1])
      if (
        inside(pawn, c + dc, 8) &&
        b[pawn][c + dc]?.color === by &&
        b[pawn][c + dc].type === "p"
      )
        return true;
    for (const [dr, dc] of [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ])
      if (
        inside(r + dr, c + dc, 8) &&
        b[r + dr][c + dc]?.color === by &&
        b[r + dr][c + dc].type === "n"
      )
        return true;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (
          (dr || dc) &&
          inside(r + dr, c + dc, 8) &&
          b[r + dr][c + dc]?.color === by &&
          b[r + dr][c + dc].type === "k"
        )
          return true;
    for (const [directions, types] of [
      [
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ],
        ["r", "q"],
      ],
      [
        [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ],
        ["b", "q"],
      ],
    ])
      for (const [dr, dc] of directions) {
        let nr = r + dr,
          nc = c + dc;
        while (inside(nr, nc, 8)) {
          const p = b[nr][nc];
          if (p) {
            if (p.color === by && types.includes(p.type)) return true;
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
    return false;
  }
  moveList(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    const out = [],
      add = (tr, tc, x = {}) => {
        if (!inside(tr, tc, 8)) return;
        const t = this.board[tr][tc];
        if (!t || t.color !== p.color)
          out.push({ from: { r, c }, to: { r: tr, c: tc }, ...x });
      };
    if (p.type === "p") {
      const d = p.color === "w" ? -1 : 1,
        s = p.color === "w" ? 6 : 1;
      if (inside(r + d, c, 8) && !this.board[r + d][c]) {
        add(r + d, c, { promotion: r + d === 0 || r + d === 7 });
        if (r === s && !this.board[r + 2 * d][c]) add(r + 2 * d, c);
      }
      for (const dc of [-1, 1]) {
        const tr = r + d,
          tc = c + dc;
        if (
          inside(tr, tc, 8) &&
          this.board[tr][tc] &&
          this.board[tr][tc].color !== p.color
        )
          add(tr, tc, { promotion: tr === 0 || tr === 7 });
      }
    }
    if (p.type === "n")
      for (const [dr, dc] of [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ])
        add(r + dr, c + dc);
    if (["b", "r", "q"].includes(p.type)) {
      const ds = [];
      if (["b", "q"].includes(p.type))
        ds.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      if (["r", "q"].includes(p.type))
        ds.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      for (const [dr, dc] of ds) {
        let tr = r + dr,
          tc = c + dc;
        while (inside(tr, tc, 8)) {
          const t = this.board[tr][tc];
          if (!t) add(tr, tc);
          else {
            if (t.color !== p.color) add(tr, tc);
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
    }
    if (p.type === "k") {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) if (dr || dc) add(r + dr, c + dc);

      const cState = this.castling[p.color];
      if (!cState.kingMoved && !this.attacked(r, c, opposite(p.color))) {
        cState.rooks.forEach((rk) => {
          if (!rk.moved) {
            const isKingside = rk.col > cState.kingCol;
            const targetKCol = isKingside ? 6 : 2,
              targetRCol = isKingside ? 5 : 3;
            let clear = true;
            const minC = Math.min(
              cState.kingCol,
              targetKCol,
              rk.col,
              targetRCol,
            );
            const maxC = Math.max(
              cState.kingCol,
              targetKCol,
              rk.col,
              targetRCol,
            );

            for (let col = minC; col <= maxC; col++) {
              if (
                col !== cState.kingCol &&
                col !== rk.col &&
                this.board[r][col]
              ) {
                clear = false;
                break;
              }
            }
            if (clear) {
              const step = targetKCol > cState.kingCol ? 1 : -1;
              for (
                let col = cState.kingCol + step;
                col !== targetKCol + step;
                col += step
              ) {
                if (this.attacked(r, col, opposite(p.color))) {
                  clear = false;
                  break;
                }
              }
            }
            if (clear) {
              out.push({
                from: { r, c },
                to: { r, c: this.is960 ? rk.col : targetKCol },
                castling: { rookFromCol: rk.col, targetKCol, targetRCol },
              });
            }
          }
        });
      }
    }
    return out;
  }
  legalMovesFrom(r, c) {
    return this.moveList(r, c).filter((m) => {
      const b = cloneBoard(this.board);
      if (m.castling) {
        const p = b[m.from.r][m.from.c],
          rk = b[m.from.r][m.castling.rookFromCol];
        b[m.from.r][m.from.c] = null;
        b[m.from.r][m.castling.rookFromCol] = null;
        b[m.from.r][m.castling.targetKCol] = p;
        b[m.from.r][m.castling.targetRCol] = rk;
      } else {
        const p = b[m.from.r][m.from.c];
        b[m.from.r][m.from.c] = null;
        b[m.to.r][m.to.c] = p;
      }
      const k = this.findKing(this.board[r][c].color, b);
      return k && !this.attacked(k.r, k.c, opposite(this.board[r][c].color), b);
    });
  }
  makeMove(m, promotion = "q") {
    const legal = this.legalMovesFrom(m.from.r, m.from.c).find(
      (x) => x.to.r === m.to.r && x.to.c === m.to.c,
    );
    if (!legal) return false;
    this.history.push(this.clone());
    const p = this.board[legal.from.r][legal.from.c];

    if (legal.castling) {
      const rk = this.board[legal.from.r][legal.castling.rookFromCol];
      this.board[legal.from.r][legal.from.c] = null;
      this.board[legal.from.r][legal.castling.rookFromCol] = null;
      this.board[legal.from.r][legal.castling.targetKCol] = p;
      this.board[legal.from.r][legal.castling.targetRCol] = rk;
      this.castling[p.color].kingMoved = true;
      this.sanHistory.push(legal.castling.targetKCol === 6 ? "O-O" : "O-O-O");
    } else {
      const cap = this.board[legal.to.r][legal.to.c];
      this.board[legal.from.r][legal.from.c] = null;
      this.board[legal.to.r][legal.to.c] = {
        ...p,
        type: legal.promotion ? promotion : p.type,
      };
      if (p.type === "k") this.castling[p.color].kingMoved = true;
      if (p.type === "r") {
        const rk = this.castling[p.color].rooks.find(
          (r) => r.col === legal.from.c,
        );
        if (rk) rk.moved = true;
      }
      if (cap) this.captured.push(cap);
      this.sanHistory.push(this.san(p, legal, cap, promotion));
    }
    this.lastMove = { from: { ...legal.from }, to: { ...legal.to } };
    this.turn = opposite(this.turn);
    return true;
  }
  san(p, m, cap, promo) {
    const f = "abcdefgh";
    let s = p.type === "p" ? "" : p.type.toUpperCase();
    if (p.type === "p" && cap) s += f[m.from.c];
    if (cap) s += "x";
    s += f[m.to.c] + (8 - m.to.r);
    if (m.promotion) s += "=" + promo.toUpperCase();
    return s;
  }
  gameStatus() {
    const moves = this.allLegal(this.turn),
      k = this.findKing(this.turn),
      check = k && this.attacked(k.r, k.c, opposite(this.turn));
    if (!moves.length)
      return {
        over: true,
        check,
        text: check
          ? `Checkmate — ${this.turn === "w" ? "Black" : "White"} wins`
          : "Stalemate — draw",
      };
    return {
      over: false,
      check,
      text: `${this.turn === "w" ? "White" : "Black"}${check ? " is in check" : " to move"}`,
    };
  }
  allLegal(color) {
    const old = this.turn;
    this.turn = color;
    const a = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (this.board[r][c]?.color === color)
          a.push(...this.legalMovesFrom(r, c));
    this.turn = old;
    return a;
  }
}

// ---------------------------- 4-PLAYER CHESS ENGINE ----------------------------
function playable4(r, c) {
  return (r >= 3 && r <= 10) || (c >= 3 && c <= 10);
}
function setupSide(b, color, side) {
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  if (side === "top")
    for (let c = 3; c <= 10; c++) {
      b[0][c] = { type: back[c - 3], color };
      b[1][c] = { type: "p", color };
    }
  if (side === "bottom")
    for (let c = 3; c <= 10; c++) {
      b[13][c] = { type: back[10 - c], color };
      b[12][c] = { type: "p", color };
    }
  if (side === "left")
    for (let r = 3; r <= 10; r++) {
      b[r][0] = { type: back[10 - r], color };
      b[r][1] = { type: "p", color };
    }
  if (side === "right")
    for (let r = 3; r <= 10; r++) {
      b[r][13] = { type: back[r - 3], color };
      b[r][12] = { type: "p", color };
    }
}

class FourPlayerChessGame {
  constructor() {
    this.size = 14;
    this.reset();
  }
  reset() {
    this.board = Array.from({ length: 14 }, () => Array(14).fill(null));
    setupSide(this.board, "black", "top");
    setupSide(this.board, "white", "bottom");
    setupSide(this.board, "red", "left");
    setupSide(this.board, "blue", "right");
    this.turnIndex = 0;
    this.turn = FOUR_COLORS[this.turnIndex];
    this.history = [];
    this.sanHistory = [];
    this.captured = [];
    this.lastMove = null;
  }
  clone() {
    return {
      board: cloneBoard(this.board),
      turnIndex: this.turnIndex,
      turn: this.turn,
      san: [...this.sanHistory],
      captured: this.captured.map((p) => ({ ...p })),
      lastMove: this.lastMove ? { ...this.lastMove } : null,
    };
  }
  restore(s) {
    this.board = cloneBoard(s.board);
    this.turnIndex = s.turnIndex;
    this.turn = s.turn;
    this.sanHistory = [...s.san];
    this.captured = s.captured.map((p) => ({ ...p }));
    this.lastMove = s.lastMove ? { ...s.lastMove } : null;
  }
  undo() {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  }
  forward(color) {
    return color === "black"
      ? [1, 0]
      : color === "white"
        ? [-1, 0]
        : color === "red"
          ? [0, 1]
          : [0, -1];
  }
  moveList(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    const out = [],
      add = (tr, tc, x = {}) => {
        if (!inside(tr, tc, 14) || !playable4(tr, tc)) return;
        const t = this.board[tr][tc];
        if (!t || t.color !== p.color)
          out.push({ from: { r, c }, to: { r: tr, c: tc }, ...x });
      };
    if (p.type === "p") {
      const [dR, dC] = this.forward(p.color);
      const nr = r + dR,
        nc = c + dC;
      if (inside(nr, nc, 14) && playable4(nr, nc) && !this.board[nr][nc]) {
        add(nr, nc, { promotion: this.promotionSquare(p.color, nr, nc) });
        const isStart =
          (p.color === "black" && r === 1) ||
          (p.color === "white" && r === 12) ||
          (p.color === "red" && c === 1) ||
          (p.color === "blue" && c === 12);
        const nnr = r + 2 * dR,
          nnc = c + 2 * dC;
        if (
          isStart &&
          inside(nnr, nnc, 14) &&
          playable4(nnr, nnc) &&
          !this.board[nnr][nnc]
        ) {
          add(nnr, nnc, {
            promotion: this.promotionSquare(p.color, nnr, nnc),
          });
        }
      }
      // Pawn captures are diagonal-forward, regardless of which
      // direction the pawn is travelling.
      //
      // White: forward = up    -> captures up-left / up-right
      // Black: forward = down  -> captures down-left / down-right
      // Red:   forward = right -> captures up-right / down-right
      // Blue:  forward = left  -> captures up-left / down-left
      let captureSquares;

      if (p.color === "white") {
        captureSquares = [
          [r - 1, c - 1],
          [r - 1, c + 1],
        ];
      } else if (p.color === "black") {
        captureSquares = [
          [r + 1, c - 1],
          [r + 1, c + 1],
        ];
      } else if (p.color === "red") {
        captureSquares = [
          [r - 1, c + 1],
          [r + 1, c + 1],
        ];
      } else {
        captureSquares = [
          [r - 1, c - 1],
          [r + 1, c - 1],
        ];
      }

      for (const [tr, tc] of captureSquares) {
        if (
          inside(tr, tc, 14) &&
          playable4(tr, tc) &&
          this.board[tr][tc] &&
          this.board[tr][tc].color !== p.color
        ) {
          add(tr, tc, {
            promotion: this.promotionSquare(p.color, tr, tc),
          });
        }
      }
    } else if (p.type === "n") {
      for (const [dr, dc] of [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ])
        add(r + dr, c + dc);
    } else if (p.type === "k") {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) if (dr || dc) add(r + dr, c + dc);
    } else {
      const ds = [];
      if (["b", "q"].includes(p.type))
        ds.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      if (["r", "q"].includes(p.type))
        ds.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      for (const [dr, dc] of ds) {
        let tr = r + dr,
          tc = c + dc;
        while (inside(tr, tc, 14) && playable4(tr, tc)) {
          const t = this.board[tr][tc];
          if (!t) add(tr, tc);
          else {
            if (t.color !== p.color) add(tr, tc);
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
    }
    return out;
  }
  promotionSquare(color, r, c) {
    return color === "black"
      ? r === 10
      : color === "white"
        ? r === 3
        : color === "red"
          ? c === 10
          : c === 3;
  }
  legalMovesFrom(r, c) {
    return this.moveList(r, c);
  }
  makeMove(m, promotion = "q") {
    const legal = this.legalMovesFrom(m.from.r, m.from.c).find(
      (x) => x.to.r === m.to.r && x.to.c === m.to.c,
    );
    if (!legal) return false;
    this.history.push(this.clone());
    const p = this.board[legal.from.r][legal.from.c],
      cap = this.board[legal.to.r][legal.to.c];
    this.board[legal.from.r][legal.from.c] = null;
    this.board[legal.to.r][legal.to.c] = {
      ...p,
      type: legal.promotion ? promotion : p.type,
    };
    if (cap) this.captured.push(cap);
    this.lastMove = { from: { ...legal.from }, to: { ...legal.to } };
    this.sanHistory.push(
      `${this.turn[0].toUpperCase()}: ${String.fromCharCode(97 + m.from.c)}${14 - m.from.r}-${String.fromCharCode(97 + m.to.c)}${14 - m.to.r}`,
    );
    this.turnIndex = (this.turnIndex + 1) % 4;
    this.turn = FOUR_COLORS[this.turnIndex];
    return true;
  }
  gameStatus() {
    return {
      over: false,
      check: false,
      text: `${this.turn[0].toUpperCase() + this.turn.slice(1)} to move`,
    };
  }
}

// ---------------------------- LARGE-BOARD CHESS ENGINES ----------------------------
class LargeChessGame {
  constructor(variant) {
    this.variant = variant;
    this.size = 10;
    this.playersCount = 2;
    this.isShako = variant === "shako";
    this.isGrand = variant === "grand";
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: 10 }, () => Array(10).fill(null));

    if (this.isShako) {
      const back = ["e", "r", "n", "b", "q", "k", "b", "n", "r", "e"];
      for (let c = 0; c < 10; c++) {
        this.board[0][c] =
          c === 0 || c === 9 ? { type: "c", color: "b" } : null;
        this.board[1][c] = { type: back[c], color: "b" };
        this.board[8][c] = { type: "p", color: "w" };
        this.board[9][c] =
          c === 0 || c === 9
            ? { type: "e", color: "w" }
            : { type: back[c], color: "w" };
      }
      // White rank 10 has the same major-piece layout as black, with elephants on the ends.
      for (let c = 0; c < 10; c++)
        this.board[9][c] = { type: back[c], color: "w" };
    } else {
      const middle = [null, "n", "b", "q", "k", "m", "c", "b", "n", null];
      for (let c = 0; c < 10; c++) {
        this.board[0][c] =
          c === 0 || c === 9 ? { type: "r", color: "b" } : null;
        this.board[1][c] = middle[c] ? { type: middle[c], color: "b" } : null;
        this.board[2][c] = { type: "p", color: "b" };
        this.board[7][c] = { type: "p", color: "w" };
        this.board[8][c] = middle[c] ? { type: middle[c], color: "w" } : null;
        this.board[9][c] =
          c === 0 || c === 9 ? { type: "r", color: "w" } : null;
      }
    }

    this.turn = "w";
    this.history = [];
    this.sanHistory = [];
    this.captured = [];
    this.lastMove = null;
    const wK = 5,
      bK = 5;
    const wR = this.isShako ? [1, 8] : [];
    const bR = this.isShako ? [1, 8] : [];
    this.castling = {
      w: {
        kingMoved: false,
        kingCol: wK,
        rooks: wR.map((col) => ({ col, moved: false })),
      },
      b: {
        kingMoved: false,
        kingCol: bK,
        rooks: bR.map((col) => ({ col, moved: false })),
      },
    };
  }

  clone() {
    return {
      board: cloneBoard(this.board),
      turn: this.turn,
      san: [...this.sanHistory],
      captured: this.captured.map((p) => ({ ...p })),
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      castling: JSON.parse(JSON.stringify(this.castling)),
    };
  }

  restore(s) {
    this.board = cloneBoard(s.board);
    this.turn = s.turn;
    this.sanHistory = [...s.san];
    this.captured = s.captured.map((p) => ({ ...p }));
    this.lastMove = s.lastMove ? { ...s.lastMove } : null;
    this.castling = JSON.parse(JSON.stringify(s.castling));
  }

  undo() {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  }

  findKing(color, b = this.board) {
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++) {
        if (b[r][c]?.color === color && b[r][c]?.type === "k") return { r, c };
      }
    return null;
  }

  attacked(r, c, by, b = this.board) {
    const pawn = by === "w" ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      if (
        inside(pawn, c + dc, 10) &&
        b[pawn][c + dc]?.color === by &&
        b[pawn][c + dc]?.type === "p"
      )
        return true;
    }
    const jumps = [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ];
    for (const [dr, dc] of jumps) {
      const p = b[r + dr]?.[c + dc];
      if (
        inside(r + dr, c + dc, 10) &&
        p?.color === by &&
        (p.type === "n" || p.type === "m" || p.type === "c")
      )
        return true;
    }
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (
          (dr || dc) &&
          inside(r + dr, c + dc, 10) &&
          b[r + dr][c + dc]?.color === by &&
          b[r + dr][c + dc]?.type === "k"
        )
          return true;
      }
    if (this.isShako) {
      for (const [dr, dc] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        for (const d of [1, 2]) {
          const rr = r + dr * d,
            cc = c + dc * d;
          if (
            inside(rr, cc, 10) &&
            b[rr][cc]?.color === by &&
            b[rr][cc]?.type === "e"
          )
            return true;
        }
      }
    }
    const slideDirs = [
      [
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ],
        "r",
      ],
      [
        [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ],
        "b",
      ],
    ];
    for (const [dirs, base] of slideDirs)
      for (const [dr, dc] of dirs) {
        let rr = r + dr,
          cc = c + dc;
        while (inside(rr, cc, 10)) {
          const p = b[rr][cc];
          if (p) {
            if (
              p.color === by &&
              (p.type === base ||
                p.type === "q" ||
                (base === "r" && p.type === "m") ||
                (base === "b" && p.type === "c"))
            )
              return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
    if (this.isShako) {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dr, dc] of dirs) {
        let rr = r + dr,
          cc = c + dc,
          screen = false;
        while (inside(rr, cc, 10)) {
          const p = b[rr][cc];
          if (!p) {
            rr += dr;
            cc += dc;
            continue;
          }
          if (!screen) {
            screen = true;
            rr += dr;
            cc += dc;
            continue;
          }
          if (p.color === by && p.type === "c") return true;
          break;
        }
      }
    }
    return false;
  }

  addRay(out, r, c, dr, dc, p, captureOnly = false) {
    let rr = r + dr,
      cc = c + dc;
    while (inside(rr, cc, 10)) {
      const t = this.board[rr][cc];
      if (!t) {
        if (!captureOnly) out.push({ from: { r, c }, to: { r: rr, c: cc } });
      } else {
        if (t.color !== p.color)
          out.push({ from: { r, c }, to: { r: rr, c: cc } });
        break;
      }
      rr += dr;
      cc += dc;
    }
  }

  moveList(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    const out = [];
    const add = (tr, tc, x = {}) => {
      if (!inside(tr, tc, 10)) return;
      const t = this.board[tr][tc];
      if (!t || t.color !== p.color)
        out.push({ from: { r, c }, to: { r: tr, c: tc }, ...x });
    };
    if (p.type === "p") {
      const d = p.color === "w" ? -1 : 1,
        start = p.color === "w" ? 7 : 2;
      const rr = r + d;
      if (inside(rr, c, 10) && !this.board[rr][c]) {
        if (
          this.isGrand &&
          (rr === 0 || rr === 1 || rr === 2 || rr === 7 || rr === 8 || rr === 9)
        )
          add(rr, c, { promotion: true });
        else add(rr, c, { promotion: rr === 0 || rr === 9 });
        if (r === start && !this.board[r + 2 * d][c]) add(r + 2 * d, c);
      }
      for (const dc of [-1, 1]) {
        const tr = r + d,
          tc = c + dc;
        if (
          inside(tr, tc, 10) &&
          this.board[tr][tc] &&
          this.board[tr][tc].color !== p.color
        ) {
          const promo = this.isGrand
            ? [0, 1, 2, 7, 8, 9].includes(tr)
            : tr === 0 || tr === 9;
          add(tr, tc, { promotion: promo });
        }
      }
    } else if (p.type === "n") {
      for (const [dr, dc] of [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ])
        add(r + dr, c + dc);
    } else if (p.type === "k") {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) if (dr || dc) add(r + dr, c + dc);
      if (this.isShako) {
        const cs = this.castling[p.color];
        if (!cs.kingMoved && !this.attacked(r, c, opposite(p.color))) {
          for (const rk of cs.rooks) {
            if (rk.moved) continue;
            const kingSide = rk.col > cs.kingCol;
            const targetK = kingSide ? 7 : 2,
              targetR = kingSide ? 6 : 3;
            let clear = true;
            const min = Math.min(cs.kingCol, targetK, rk.col, targetR),
              max = Math.max(cs.kingCol, targetK, rk.col, targetR);
            for (let col = min; col <= max; col++)
              if (col !== cs.kingCol && col !== rk.col && this.board[r][col])
                clear = false;
            if (clear) {
              const step = targetK > cs.kingCol ? 1 : -1;
              for (
                let col = cs.kingCol + step;
                col !== targetK + step;
                col += step
              )
                if (this.attacked(r, col, opposite(p.color))) clear = false;
            }
            if (clear)
              out.push({
                from: { r, c },
                to: { r, c: targetK },
                castling: {
                  rookFromCol: rk.col,
                  targetKCol: targetK,
                  targetRCol: targetR,
                },
              });
          }
        }
      }
    } else if (
      p.type === "b" ||
      p.type === "q" ||
      p.type === "r" ||
      p.type === "m" ||
      p.type === "c"
    ) {
      const dirs = [];
      if (["b", "q", "c"].includes(p.type))
        dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      if (["r", "q", "m"].includes(p.type))
        dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      if (p.type === "c" && this.isShako) {
        const orth = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dr, dc] of orth) {
          let rr = r + dr,
            cc = c + dc;
          while (inside(rr, cc, 10) && !this.board[rr][cc]) {
            out.push({ from: { r, c }, to: { r: rr, c: cc } });
            rr += dr;
            cc += dc;
          }
          if (!inside(rr, cc, 10)) continue;
          rr += dr;
          cc += dc;
          while (inside(rr, cc, 10)) {
            const t = this.board[rr][cc];
            if (t) {
              if (t.color !== p.color)
                out.push({
                  from: { r, c },
                  to: { r: rr, c: cc },
                  cannon: true,
                });
              break;
            }
            rr += dr;
            cc += dc;
          }
        }
      } else {
        for (const [dr, dc] of dirs) this.addRay(out, r, c, dr, dc, p);
      }
      if (
        (p.type === "m" || p.type === "c") &&
        (!this.isShako || p.type === "m")
      ) {
        for (const [dr, dc] of [
          [-2, -1],
          [-2, 1],
          [-1, -2],
          [-1, 2],
          [1, -2],
          [1, 2],
          [2, -1],
          [2, 1],
        ])
          add(r + dr, c + dc);
      }
    } else if (p.type === "e") {
      for (const [dr, dc] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        add(r + dr, c + dc);
        add(r + 2 * dr, c + 2 * dc);
      }
    }
    return out;
  }

  legalMovesFrom(r, c) {
    return this.moveList(r, c).filter((m) => {
      const moving = this.board[m.from.r]?.[m.from.c];
      if (m.promotion) {
        const choices = this.getPromotionChoices(moving?.color, m);
        if (!choices.length) return false;
      }
      const b = cloneBoard(this.board);
      if (m.castling) {
        const p = b[m.from.r][m.from.c],
          rk = b[m.from.r][m.castling.rookFromCol];
        b[m.from.r][m.from.c] = null;
        b[m.from.r][m.castling.rookFromCol] = null;
        b[m.from.r][m.castling.targetKCol] = p;
        b[m.from.r][m.castling.targetRCol] = rk;
      } else {
        const p = b[m.from.r][m.from.c];
        b[m.from.r][m.from.c] = null;
        b[m.to.r][m.to.c] = p;
      }
      const color = moving?.color,
        k = this.findKing(color, b);
      return k && !this.attacked(k.r, k.c, opposite(color), b);
    });
  }

  getPromotionChoices(color, move) {
    if (this.isShako) return ["q", "r", "b", "n", "e", "c"];
    const capturedTypes = [];
    for (const p of this.captured) {
      if (
        p.color === color &&
        ["q", "r", "b", "n", "m", "c"].includes(p.type) &&
        !capturedTypes.includes(p.type)
      )
        capturedTypes.push(p.type);
    }
    const row = move.to.r;
    const mandatory = color === "w" ? row === 0 : row === 9;
    return mandatory ? capturedTypes : ["p", ...capturedTypes];
  }

  makeMove(m, promotion = "q") {
    const legal = this.legalMovesFrom(m.from.r, m.from.c).find(
      (x) =>
        x.to.r === m.to.r &&
        x.to.c === m.to.c &&
        Boolean(x.castling) === Boolean(m.castling),
    );
    if (!legal) return false;
    if (legal.promotion) {
      const choices = this.getPromotionChoices(
        this.board[legal.from.r][legal.from.c].color,
        legal,
      );
      if (!choices.includes(promotion)) return false;
    }
    this.history.push(this.clone());
    const p = this.board[legal.from.r][legal.from.c];
    if (legal.castling) {
      const rk = this.board[legal.from.r][legal.castling.rookFromCol];
      this.board[legal.from.r][legal.from.c] = null;
      this.board[legal.from.r][legal.castling.rookFromCol] = null;
      this.board[legal.from.r][legal.castling.targetKCol] = p;
      this.board[legal.from.r][legal.castling.targetRCol] = rk;
      this.castling[p.color].kingMoved = true;
      this.sanHistory.push(legal.castling.targetKCol === 7 ? "O-O" : "O-O-O");
    } else {
      const cap = this.board[legal.to.r][legal.to.c];
      this.board[legal.from.r][legal.from.c] = null;
      const type = legal.promotion ? promotion : p.type;
      this.board[legal.to.r][legal.to.c] = { ...p, type };
      if (cap) this.captured.push(cap);
      if (p.type === "k") this.castling[p.color].kingMoved = true;
      if (p.type === "r") {
        const rs = this.castling[p.color].rooks.find(
          (x) => x.col === legal.from.c,
        );
        if (rs) rs.moved = true;
      }
      this.sanHistory.push(this.san(p, legal, cap, promotion));
    }
    this.lastMove = { from: { ...legal.from }, to: { ...legal.to } };
    this.turn = opposite(this.turn);
    return true;
  }

  san(p, m, cap, promo) {
    const files = "abcdefghij";
    let s = p.type === "p" ? "" : p.type.toUpperCase();
    if (p.type === "p" && cap) s += files[m.from.c];
    if (cap) s += "x";
    s += files[m.to.c] + (10 - m.to.r);
    if (m.promotion && promo !== "p") s += "=" + promo.toUpperCase();
    return s;
  }

  gameStatus() {
    const moves = this.allLegal(this.turn),
      k = this.findKing(this.turn),
      check = k && this.attacked(k.r, k.c, opposite(this.turn));
    if (!moves.length)
      return {
        over: true,
        check,
        text: check
          ? `Checkmate — ${this.turn === "w" ? "Black" : "White"} wins`
          : "Stalemate — draw",
      };
    return {
      over: false,
      check,
      text: `${this.turn === "w" ? "White" : "Black"}${check ? " is in check" : " to move"}`,
    };
  }

  allLegal(color) {
    const old = this.turn;
    this.turn = color;
    const a = [];
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++)
        if (this.board[r][c]?.color === color)
          a.push(...this.legalMovesFrom(r, c));
    this.turn = old;
    return a;
  }
}

class ThreePlayerChessGame {
  constructor() {
    this.size = 12;
    this.playersCount = 3;
    this.variant = "threeman";
    this.turnOrder = ["white", "red", "black"];
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: 12 }, () => Array(8).fill(null));
    const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
    for (const color of this.turnOrder) {
      const homeRow = color === "white" ? 8 : color === "red" ? 4 : 0;
      for (let c = 0; c < 8; c++) {
        this.board[homeRow][c] = {
          type: back[c],
          color,
          home: color,
          moved: false,
        };
        this.board[homeRow + 1][c] = {
          type: "p",
          color,
          home: color,
          moved: false,
          arrow: false,
        };
      }
    }

    this.turnIndex = 0;
    this.turn = "white";
    this.history = [];
    this.sanHistory = [];
    this.captured = [];
    this.lastMove = null;
    this.castling = {
      white: { kingMoved: false, rooks: { 0: false, 7: false } },
      red: { kingMoved: false, rooks: { 0: false, 7: false } },
      black: { kingMoved: false, rooks: { 0: false, 7: false } },
    };
  }

  clone() {
    return {
      board: cloneBoard(this.board),
      turnIndex: this.turnIndex,
      turn: this.turn,
      san: [...this.sanHistory],
      captured: this.captured.map((p) => ({ ...p })),
      lastMove: this.lastMove
        ? JSON.parse(JSON.stringify(this.lastMove))
        : null,
      castling: JSON.parse(JSON.stringify(this.castling)),
    };
  }

  restore(snapshot) {
    this.board = cloneBoard(snapshot.board);
    this.turnIndex = snapshot.turnIndex;
    this.turn = snapshot.turn;
    this.sanHistory = [...snapshot.san];
    this.captured = snapshot.captured.map((p) => ({ ...p }));
    this.lastMove = snapshot.lastMove
      ? JSON.parse(JSON.stringify(snapshot.lastMove))
      : null;
    this.castling = JSON.parse(JSON.stringify(snapshot.castling));
  }

  undo() {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  }

  meta(r, c) {
    return THREE_MAN_GEOMETRY.byLogical.get(`${r},${c}`) || null;
  }

  regionOf(r, c) {
    return this.meta(r, c)?.region || null;
  }

  rankOf(r, c) {
    return this.meta(r, c)?.rank ?? -1;
  }

  fileOf(r, c) {
    return this.meta(r, c)?.file ?? -1;
  }

  cellByKey(key) {
    const cell = THREE_MAN_GEOMETRY.byLogical.get(key);
    return cell ? { r: cell.r, c: cell.c } : null;
  }

  crossTargets(r, c) {
    return (THREE_MAN_GEOMETRY.cross.get(`${r},${c}`) || [])
      .map((key) => this.cellByKey(key))
      .filter(Boolean);
  }

  ownerColors() {
    return this.turnOrder;
  }

  findKing(color, board = this.board) {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const p = board[r][c];
        if (p?.color === color && p.type === "k") return { r, c };
      }
    }
    return null;
  }

  isInCheck(color, board = this.board) {
    const king = this.findKing(color, board);
    if (!king) return true;
    return this.ownerColors().some(
      (enemy) => enemy !== color && this.attacked(king.r, king.c, enemy, board),
    );
  }

  attacked(r, c, byColor, board = this.board) {
    const oldBoard = this.board;
    this.board = board;
    try {
      for (let rr = 0; rr < 12; rr++) {
        for (let cc = 0; cc < 8; cc++) {
          const p = board[rr][cc];
          if (!p || p.color !== byColor) continue;
          const pseudo = this.moveList(rr, cc, true);
          if (pseudo.some((m) => m.to.r === r && m.to.c === c)) return true;
        }
      }
      return false;
    } finally {
      this.board = oldBoard;
    }
  }

  stepFile(r, c, dir) {
    const cell = this.meta(r, c);
    if (!cell) return null;
    const file = cell.file + dir;
    if (file < 0 || file > 7) return null;
    return this.cellByKey(`${cell.r},${file}`);
  }

  stepRank(r, c, dir) {
    const cell = this.meta(r, c);
    if (!cell) return null;
    if (dir < 0 && cell.rank > 0)
      return this.cellByKey(`${cell.r - 1},${cell.file}`);
    if (dir > 0 && cell.rank < 3)
      return this.cellByKey(`${cell.r + 1},${cell.file}`);
    if (dir > 0 && cell.rank === 3) {
      const cross = this.crossTargets(r, c);
      return cross.find((x) => this.rankOf(x.r, x.c) === 3) || null;
    }
    return null;
  }

  stepDiagonalLocal(r, c, dr, dc) {
    const cell = this.meta(r, c);
    if (!cell) return null;
    const rank = cell.rank + dr;
    const file = cell.file + dc;
    if (rank < 0 || rank > 3 || file < 0 || file > 7) return null;
    const base = cell.r - cell.rank;
    return this.cellByKey(`${base + rank},${file}`);
  }

  diagonalCross(r, c, dc) {
    const key = `${r},${c}`;
    const transitions = {
      "3,3": { "-1": ["7,4", -1] },
      "3,4": { 1: ["11,4", -1] },
      "11,4": { "-1": ["3,4", 1] },
      "11,3": { 1: ["7,3", 1] },
      "7,3": { "-1": ["11,3", -1] },
      "7,4": { 1: ["3,3", 1] },
    };
    const entry = transitions[key]?.[String(dc)];
    if (!entry) return null;
    const target = this.cellByKey(entry[0]);
    if (!target) return null;
    return { target, exitDc: entry[1] };
  }

  addMove(out, r, c, to, extra = {}, forAttack = false) {
    if (!to) return;
    const p = this.board[r]?.[c];
    if (!p) return;
    const target = this.board[to.r]?.[to.c];
    if (target?.color === p.color) return;
    if (target?.type === "k" && !forAttack) return;
    out.push({ from: { r, c }, to: { ...to }, ...extra });
  }

  rayRank(r, c, dir, p, out, forAttack) {
    let cur = { r, c };
    let direction = dir;
    for (let i = 0; i < 16; i++) {
      const next = this.stepRank(cur.r, cur.c, direction);
      if (!next) break;
      const target = this.board[next.r][next.c];
      this.addMove(out, r, c, next, {}, forAttack);
      if (target) break;

      cur = next;
      // Crossing the center sends a rook/queen ray outward through the
      // opponent's territory rather than back across the center.
      if (
        direction > 0 &&
        this.rankOf(cur.r, cur.c) === 3 &&
        this.regionOf(cur.r, cur.c) !== p.color
      ) {
        direction = -1;
      }
    }
  }

  rayFile(r, c, dir, out, forAttack) {
    let cur = { r, c };
    for (let i = 0; i < 8; i++) {
      const next = this.stepFile(cur.r, cur.c, dir);
      if (!next) break;
      const target = this.board[next.r][next.c];
      this.addMove(out, r, c, next, {}, forAttack);
      if (target) break;
      cur = next;
    }
  }

  rayBishop(r, c, dr, dc, out, forAttack) {
    let cur = { r, c };
    let rr = dr;
    let ff = dc;
    for (let i = 0; i < 16; i++) {
      const cell = this.meta(cur.r, cur.c);
      if (!cell) break;

      const local = this.stepDiagonalLocal(cur.r, cur.c, rr, ff);
      if (local) {
        const target = this.board[local.r][local.c];
        this.addMove(out, r, c, local, {}, forAttack);
        if (target) break;
        cur = local;
      } else if (rr > 0 && cell.rank === 3) {
        const cross = this.diagonalCross(cur.r, cur.c, ff);
        if (!cross) break;
        const target = this.board[cross.target.r][cross.target.c];
        this.addMove(out, r, c, cross.target, {}, forAttack);
        if (target) break;
        cur = cross.target;
        rr = -1;
        ff = cross.exitDc;
      } else {
        break;
      }
    }
  }

  canCastle(color, side) {
    const state = this.castling[color];
    if (!state || state.kingMoved) return false;
    const king = this.findKing(color);
    if (
      !king ||
      this.rankOf(king.r, king.c) !== 0 ||
      this.fileOf(king.r, king.c) !== 4
    )
      return false;

    const kingside = side === "king";
    const rookFile = kingside ? 7 : 0;
    if (state.rooks[rookFile]) return false;
    const rook = this.board[king.r]?.[rookFile];
    if (!rook || rook.color !== color || rook.type !== "r") return false;

    const pathFiles = kingside ? [5, 6] : [3, 2, 1];
    for (const file of pathFiles) {
      if (this.board[king.r][file]) return false;
    }

    if (this.isInCheck(color)) return false;
    const through = this.cellByKey(`${king.r},${kingside ? 5 : 3}`);
    const destination = this.cellByKey(`${king.r},${kingside ? 6 : 2}`);
    if (!through || !destination) return false;
    for (const enemy of this.ownerColors()) {
      if (enemy === color) continue;
      if (this.attacked(through.r, through.c, enemy, this.board)) return false;
      if (this.attacked(destination.r, destination.c, enemy, this.board))
        return false;
    }
    return true;
  }

  fourthRankCaptures(r, c, p, out, forAttack) {
    if (this.rankOf(r, c) !== 3) return;
    const origin = this.meta(r, c);
    if (!origin) return;
    const candidateKeys = new Set();
    const sources = [c - 1, c, c + 1].filter((file) => file >= 0 && file <= 7);
    for (const file of sources) {
      const source = this.cellByKey(`${r},${file}`);
      if (!source) continue;
      for (const target of this.crossTargets(source.r, source.c)) {
        if (this.rankOf(target.r, target.c) !== 3) continue;
        candidateKeys.add(`${target.r},${target.c}`);
      }
    }
    for (const key of candidateKeys) {
      const target = this.cellByKey(key);
      const piece = this.board[target.r][target.c];
      if (!piece || piece.color === p.color) continue;
      const destination = this.meta(target.r, target.c);
      if (!destination || destination.shade !== origin.shade) continue;
      this.addMove(out, r, c, target, { specialPawnCapture: true }, forAttack);
    }
  }

  arrowDiagonalTargets(r, c, p, out, forAttack) {
    const cell = this.meta(r, c);
    if (!cell) return;
    for (const dr of [-1, 1]) {
      for (const dc of [-1, 1]) {
        const local = this.stepDiagonalLocal(r, c, dr, dc);
        if (local) {
          const target = this.board[local.r][local.c];
          if (target && target.color !== p.color) {
            this.addMove(
              out,
              r,
              c,
              local,
              { promotion: this.isPromotionSquare(local.r, local.c, p.home) },
              forAttack,
            );
          }
          continue;
        }

        if (dr > 0 && this.rankOf(r, c) === 3) {
          const cross = this.diagonalCross(r, c, dc);
          if (cross) {
            const target = this.board[cross.target.r][cross.target.c];
            if (target && target.color !== p.color) {
              this.addMove(
                out,
                r,
                c,
                cross.target,
                {
                  promotion: this.isPromotionSquare(
                    cross.target.r,
                    cross.target.c,
                    p.home,
                  ),
                },
                forAttack,
              );
            }
          }
        }
      }
    }
  }

  moveList(r, c, forAttack = false) {
    const p = this.board[r]?.[c];
    if (!p || (!forAttack && p.color !== this.turn)) return [];

    const out = [];
    const rank = this.rankOf(r, c);
    const file = this.fileOf(r, c);

    if (p.type === "p") {
      if (p.arrow) {
        // Arrow pawn: orthogonal moves and diagonal captures in any direction,
        // but it may never return to its home third of the board.
        for (const dir of [-1, 1]) {
          const target = this.stepRank(r, c, dir);
          if (
            target &&
            this.regionOf(target.r, target.c) !== p.home &&
            !this.board[target.r][target.c]
          ) {
            this.addMove(
              out,
              r,
              c,
              target,
              { promotion: this.isPromotionSquare(target.r, target.c, p.home) },
              forAttack,
            );
          }
        }
        for (const dir of [-1, 1]) {
          const target = this.stepFile(r, c, dir);
          if (
            target &&
            this.regionOf(target.r, target.c) !== p.home &&
            !this.board[target.r][target.c]
          ) {
            this.addMove(
              out,
              r,
              c,
              target,
              { promotion: this.isPromotionSquare(target.r, target.c, p.home) },
              forAttack,
            );
          }
        }
        this.arrowDiagonalTargets(r, c, p, out, forAttack);

        // Dekle's documented cross-center en-passant example: a pawn that has
        // just made its initial double-step may be taken diagonally backwards
        // by an arrow pawn in the same territory.
        if (
          !forAttack &&
          this.lastMove?.pawnDouble &&
          this.lastMove.pieceColor !== p.color
        ) {
          const lm = this.lastMove;
          if (
            this.regionOf(lm.to.r, lm.to.c) === this.regionOf(r, c) &&
            this.rankOf(r, c) === 3 &&
            this.rankOf(lm.to.r, lm.to.c) === 3
          ) {
            for (const dc of [-1, 1]) {
              const target = this.stepDiagonalLocal(r, c, -1, dc) || null;
              if (!target || this.board[target.r][target.c]) continue;
              if (
                Math.abs(this.fileOf(lm.to.r, lm.to.c) - this.fileOf(r, c)) ===
                1
              ) {
                out.push({
                  from: { r, c },
                  to: target,
                  enPassant: true,
                  captureSquare: { ...lm.to },
                  promotion: this.isPromotionSquare(target.r, target.c, p.home),
                });
              }
            }
          }
        }
      } else if (rank < 3) {
        const one = this.stepRank(r, c, 1);
        if (one && !this.board[one.r][one.c]) {
          this.addMove(
            out,
            r,
            c,
            one,
            { promotion: this.isPromotionSquare(one.r, one.c, p.home) },
            forAttack,
          );
          if (!forAttack && rank === 1 && !p.moved) {
            const two = this.stepRank(one.r, one.c, 1);
            if (two && !this.board[two.r][two.c]) {
              out.push({ from: { r, c }, to: two, pawnDouble: true });
            }
          }
        }

        {
          for (const dc of [-1, 1]) {
            const target = this.stepDiagonalLocal(r, c, 1, dc);
            if (!target) continue;
            const enemy = this.board[target.r][target.c];
            if (enemy && enemy.color !== p.color) {
              this.addMove(
                out,
                r,
                c,
                target,
                {
                  promotion: this.isPromotionSquare(target.r, target.c, p.home),
                },
                forAttack,
              );
            }
          }
        }

        if (
          !forAttack &&
          this.lastMove?.pawnDouble &&
          this.lastMove.pieceColor !== p.color &&
          rank === 2
        ) {
          const lm = this.lastMove;
          if (
            this.regionOf(lm.to.r, lm.to.c) === p.home &&
            this.rankOf(lm.to.r, lm.to.c) === 3 &&
            Math.abs(this.fileOf(lm.to.r, lm.to.c) - file) === 1
          ) {
            const target = this.cellByKey(
              `${this.meta(r, c).r + 1},${this.fileOf(lm.to.r, lm.to.c)}`,
            );
            if (target && !this.board[target.r][target.c]) {
              out.push({
                from: { r, c },
                to: target,
                enPassant: true,
                captureSquare: { ...lm.to },
              });
            }
          }
        }
      } else {
        // The fourth rank has the special three-way forward capture rule.
        const forward = this.stepRank(r, c, 1);
        if (forward && !this.board[forward.r][forward.c]) {
          this.addMove(
            out,
            r,
            c,
            forward,
            { promotion: this.isPromotionSquare(forward.r, forward.c, p.home) },
            forAttack,
          );
        }
        this.fourthRankCaptures(r, c, p, out, forAttack);
      }
    } else if (p.type === "n") {
      // Knight: two orthogonal steps in one direction, then one orthogonal
      // step to the side. The rank/file step helpers carry this through the
      // center correctly.
      for (const [dr, dc] of [
        [2, 1],
        [2, -1],
        [-2, 1],
        [-2, -1],
      ]) {
        let x = { r, c };
        let ok = true;
        for (let i = 0; i < 2; i++) {
          x = this.stepRank(x.r, x.c, dr > 0 ? 1 : -1);
          if (!x) {
            ok = false;
            break;
          }
        }
        if (ok)
          this.addMove(
            out,
            r,
            c,
            this.stepFile(x.r, x.c, dc > 0 ? 1 : -1),
            {},
            forAttack,
          );
      }
      for (const [dc, dr] of [
        [2, 1],
        [2, -1],
        [-2, 1],
        [-2, -1],
      ]) {
        let x = { r, c };
        let ok = true;
        for (let i = 0; i < 2; i++) {
          x = this.stepFile(x.r, x.c, dc > 0 ? 1 : -1);
          if (!x) {
            ok = false;
            break;
          }
        }
        if (ok)
          this.addMove(
            out,
            r,
            c,
            this.stepRank(x.r, x.c, dr > 0 ? 1 : -1),
            {},
            forAttack,
          );
      }
    } else if (p.type === "k") {
      for (const dr of [-1, 0, 1]) {
        for (const dc of [-1, 0, 1]) {
          if (!dr && !dc) continue;
          const local = dr
            ? dc
              ? this.stepDiagonalLocal(r, c, dr, dc)
              : this.stepRank(r, c, dr)
            : this.stepFile(r, c, dc);
          this.addMove(out, r, c, local, {}, forAttack);
        }
      }
      if (!forAttack && rank === 0 && file === 4) {
        if (this.canCastle(p.color, "king")) {
          out.push({
            from: { r, c },
            to: { r, c: 6 },
            castle: "king",
            rookFrom: { r, c: 7 },
            rookTo: { r, c: 5 },
          });
        }
        if (this.canCastle(p.color, "queen")) {
          out.push({
            from: { r, c },
            to: { r, c: 2 },
            castle: "queen",
            rookFrom: { r, c: 0 },
            rookTo: { r, c: 3 },
          });
        }
      }
    } else {
      if (["r", "q"].includes(p.type)) {
        this.rayRank(r, c, -1, p, out, forAttack);
        this.rayRank(r, c, 1, p, out, forAttack);
        this.rayFile(r, c, -1, out, forAttack);
        this.rayFile(r, c, 1, out, forAttack);
      }
      if (["b", "q"].includes(p.type)) {
        this.rayBishop(r, c, -1, -1, out, forAttack);
        this.rayBishop(r, c, -1, 1, out, forAttack);
        this.rayBishop(r, c, 1, -1, out, forAttack);
        this.rayBishop(r, c, 1, 1, out, forAttack);
      }
    }

    return out;
  }

  applyMoveToBoard(board, move, promotion) {
    const p = board[move.from.r][move.from.c];
    board[move.from.r][move.from.c] = null;
    if (move.enPassant && move.captureSquare) {
      board[move.captureSquare.r][move.captureSquare.c] = null;
    }
    board[move.to.r][move.to.c] = {
      ...p,
      type: move.promotion ? promotion : p.type,
      arrow: p.type === "p" && !move.promotion ? p.arrow : false,
    };
    if (move.castle) {
      const rook = board[move.rookFrom.r][move.rookFrom.c];
      board[move.rookFrom.r][move.rookFrom.c] = null;
      board[move.rookTo.r][move.rookTo.c] = rook;
    }
    return board;
  }

  legalMovesFrom(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    return this.moveList(r, c, false).filter((move) => {
      const board = cloneBoard(this.board);
      this.applyMoveToBoard(board, move, move.promotion ? "q" : null);
      const king = this.findKing(p.color, board);
      if (!king) return false;
      return !this.isInCheck(p.color, board);
    });
  }

  isPromotionSquare(r, c, homeColor) {
    const cell = this.meta(r, c);
    if (!cell || !homeColor) return false;

    for (const color of this.ownerColors()) {
      if (color === homeColor) continue;
      if (THREE_MAN_GEOMETRY.homeOrders[color].includes(cell.id)) return true;
    }

    const oppositeSide = THREE_MAN_GEOMETRY.oppositeSides[homeColor];
    return THREE_MAN_GEOMETRY.outerSides[oppositeSide]?.has(cell.id) || false;
  }

  getPromotionChoices() {
    return ["q", "r", "b", "n"];
  }

  simpleLabel(square) {
    const cell = this.meta(square.r, square.c);
    if (!cell) return "?";
    const region = cell.region[0].toUpperCase();
    return `${region}${cell.rank + 1}${String.fromCharCode(97 + cell.file)}`;
  }

  makeMove(move, promotion = "q") {
    const legal = this.legalMovesFrom(move.from.r, move.from.c).find(
      (m) =>
        m.to.r === move.to.r &&
        m.to.c === move.to.c &&
        Boolean(m.castle) === Boolean(move.castle),
    );
    if (!legal) return false;

    this.history.push(this.clone());
    const p = this.board[legal.from.r][legal.from.c];
    const captured = legal.enPassant
      ? this.board[legal.captureSquare.r][legal.captureSquare.c]
      : this.board[legal.to.r][legal.to.c];

    this.applyMoveToBoard(this.board, legal, promotion);
    if (captured) this.captured.push(captured);

    if (p.type === "k") this.castling[p.color].kingMoved = true;
    if (p.type === "r" && this.rankOf(legal.from.r, legal.from.c) === 0) {
      const f = this.fileOf(legal.from.r, legal.from.c);
      if (f === 0 || f === 7) this.castling[p.color].rooks[f] = true;
    }
    if (captured?.type === "r" && this.rankOf(legal.to.r, legal.to.c) === 0) {
      const f = this.fileOf(legal.to.r, legal.to.c);
      if (f === 0 || f === 7) this.castling[captured.color].rooks[f] = true;
    }

    const moved = this.board[legal.to.r][legal.to.c];
    if (p.type === "p") {
      moved.moved = true;
      if (
        !legal.promotion &&
        !moved.arrow &&
        this.regionOf(legal.to.r, legal.to.c) !== p.home
      ) {
        moved.arrow = true;
      }
      if (legal.promotion) moved.arrow = false;
    }

    this.lastMove = {
      from: { ...legal.from },
      to: { ...legal.to },
      pieceColor: p.color,
      pieceType: p.type,
      pawnDouble: Boolean(legal.pawnDouble),
      enPassant: Boolean(legal.enPassant),
      castle: legal.castle || null,
      captureSquare: legal.captureSquare ? { ...legal.captureSquare } : null,
    };

    const actor = p.color[0].toUpperCase() + p.color.slice(1);
    this.sanHistory.push(
      `${actor}: ${this.simpleLabel(legal.from)}-${this.simpleLabel(legal.to)}${legal.promotion ? `=${promotion.toUpperCase()}` : ""}`,
    );

    this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
    this.turn = this.turnOrder[this.turnIndex];

    // A stalemated player loses their turn under the official rules.
    for (let i = 0; i < this.turnOrder.length; i++) {
      const king = this.findKing(this.turn);
      const moves = this.allLegal(this.turn);
      const check = king ? this.isInCheck(this.turn) : true;
      if (moves.length || check) break;
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
      this.turn = this.turnOrder[this.turnIndex];
    }
    return true;
  }

  gameStatus() {
    const king = this.findKing(this.turn);
    const check = king ? this.isInCheck(this.turn) : true;
    const moves = this.allLegal(this.turn);

    if (!king || (!moves.length && check)) {
      const winner =
        this.turnOrder[
          (this.turnIndex + this.turnOrder.length - 1) % this.turnOrder.length
        ];
      return {
        over: true,
        check: true,
        text: `Checkmate — ${winner[0].toUpperCase() + winner.slice(1)} wins`,
      };
    }
    if (!moves.length) {
      return {
        over: false,
        check: false,
        text: `${this.turn[0].toUpperCase() + this.turn.slice(1)} is stalemated`,
      };
    }
    return {
      over: false,
      check,
      text: `${this.turn[0].toUpperCase() + this.turn.slice(1)}${check ? " is in check" : " to move"}`,
    };
  }

  allLegal(color) {
    const oldTurn = this.turn;
    this.turn = color;
    const moves = [];
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.board[r][c]?.color === color)
          moves.push(...this.legalMovesFrom(r, c));
      }
    }
    this.turn = oldTurn;
    return moves;
  }
}

// ---------------------------- CHESS GAME REGISTRY ----------------------------
const GameRegistry = {
  chess: {
    name: "Chess",
    variants: {
      standard: {
        name: "Standard Chess",
        create: () => new ChessGame(false),
        players: 2,
      },
      chess960: {
        name: "Chess960",
        create: () => new ChessGame(true),
        players: 2,
      },
      fourplayer: {
        name: "4-Player Chess",
        create: () => new FourPlayerChessGame(),
        players: 4,
      },
      shako: {
        name: "Shako",
        create: () => new LargeChessGame("shako"),
        players: 2,
      },
      threeman: {
        name: "3-Player Chess",
        create: () => new ThreePlayerChessGame(),
        players: 3,
      },
      grand: {
        name: "Grand Chess",
        create: () => new LargeChessGame("grand"),
        players: 2,
      },
    },
  },
};

class GameManager {
  constructor() {
    this.game = null;
    this.gameId = "";
    this.variantId = "";
  }
  newGame(g, v) {
    const d = GameRegistry[g]?.variants[v];
    if (!d) return false;
    this.game = d.create();
    this.gameId = g;
    this.variantId = v;
    return true;
  }
}

const params = new URLSearchParams(location.search);
let selectedGameId = "chess";
let selectedVariantId = params.get("variant") || "standard";
if (!GameRegistry.chess.variants[selectedVariantId])
  selectedVariantId = "standard";

const localPlayerCount = Math.max(0, Number(params.get("localPlayers") || 1));
const computerPlayerCount = Math.max(
  0,
  Number(params.get("computerPlayers") || 0),
);
let profiles = [];
try {
  const saved = JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
  if (Array.isArray(saved)) profiles = saved;
} catch (error) {
  console.warn("Could not load player profiles:", error);
}

let localProfileIds = [];
try {
  const saved = JSON.parse(params.get("localProfileIds") || "[]");
  if (Array.isArray(saved)) localProfileIds = saved;
} catch (error) {
  console.warn("Could not read local profile IDs:", error);
}

let playerOrder = [];
try {
  const saved = JSON.parse(params.get("playerOrder") || "[]");
  if (Array.isArray(saved)) playerOrder = saved;
} catch (error) {
  console.warn("Could not read player order:", error);
}

let computerDifficulties = {};
try {
  const saved = JSON.parse(params.get("computerDifficulties") || "{}");
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    computerDifficulties = saved;
  }
} catch (error) {
  console.warn("Could not read computer difficulties:", error);
}

/* Backward compatibility with games using the old shared difficulty field. */
const legacyComputerDifficulty = params.get("computerDifficulty") || "normal";

function sessionPlayerEntries() {
  const entries = [];

  for (let i = 0; i < localPlayerCount; i++) {
    const profileId = localProfileIds[i];
    const profile = profileId
      ? profiles.find((p) => p.id === profileId)
      : profiles[i];

    entries.push({
      token: `local:${i}`,
      label: `P${i + 1}`,
      profileId: profile?.id || profileId || null,
      name: profile?.name || `Player ${i + 1}`,
      avatar: profile?.avatar || "♟",
      type: "Local player",
      difficulty: null,
    });
  }

  for (let i = 0; i < paramsOnlinePlayerCount(); i++) {
    entries.push({
      token: `online:${i}`,
      label: `O${i + 1}`,
      name: `Online Player Slot ${i + 1}`,
      avatar: "●",
      type: "Online player",
      difficulty: null,
    });
  }

  for (let i = 0; i < computerPlayerCount; i++) {
    const token = `computer:${i}`;
    entries.push({
      token,
      label: `B${i + 1}`,
      name: `Computer ${i + 1}`,
      avatar: "🤖",
      type: "Computer player",
      difficulty:
        computerDifficulties[token] || legacyComputerDifficulty || "normal",
    });
  }

  return entries;
}

function paramsOnlinePlayerCount() {
  return Math.max(0, Number(params.get("onlinePlayers") || 0));
}

function orderedPlayerEntries() {
  const entries = sessionPlayerEntries();
  const byToken = new Map(entries.map((entry) => [entry.token, entry]));

  const result = [];

  for (const token of playerOrder) {
    const entry = byToken.get(token);
    if (entry) result.push(entry);
  }

  for (const entry of entries) {
    if (!result.some((e) => e.token === entry.token)) {
      result.push(entry);
    }
  }

  return result;
}

function currentPlayerIndex(game) {
  if (Number.isInteger(game.turnIndex)) return game.turnIndex;
  if (["w"].includes(game.turn)) return 0;
  if (["b"].includes(game.turn)) return 1;
  if (["red"].includes(game.turn)) return 1;
  if (["black"].includes(game.turn)) return game.playersCount === 3 ? 2 : 2;
  if (["white"].includes(game.turn)) return 0;
  return 0;
}
function playerInfo(index) {
  const players = orderedPlayerEntries();
  const entry = players[index];

  if (entry) return entry;

  return {
    token: `unknown:${index}`,
    label: `P${index + 1}`,
    name: `Player ${index + 1}`,
    avatar: "♟",
    type: "Local player",
    difficulty: null,
  };
}
function renderPlayers() {
  const list = document.getElementById("playerList");
  if (!list) return;

  list.innerHTML = "";

  const count = Math.max(
    2,
    localPlayerCount + paramsOnlinePlayerCount() + computerPlayerCount,
  );

  const current = currentPlayerIndex(manager.game);

  for (let i = 0; i < count; i++) {
    const info = playerInfo(i);
    const row = document.createElement("div");

    row.className = "player-row" + (i === current ? " current" : "");

    const avatar = document.createElement("div");

    avatar.className = "player-avatar";

    avatar.textContent = info.avatar;

    const details = document.createElement("div");

    details.className = "player-details";

    const name = document.createElement("div");

    name.className = "player-name";

    name.textContent = info.name;

    const type = document.createElement("div");

    type.className = "player-type";

    let subtitle = info.type;

    if (info.difficulty) {
      subtitle += ` • ${info.difficulty.charAt(0).toUpperCase()}${info.difficulty.slice(1)}`;
    }

    if (i === current) {
      subtitle += " • Current turn";
    }

    type.textContent = subtitle;

    details.append(name, type);

    row.append(avatar, details);

    list.appendChild(row);
  }
}
const manager = new GameManager();
manager.newGame("chess", selectedVariantId);
let computerMoveTimer = null;
let computerMovePending = false;
let selected = null;
let pendingPromotion = null;

function isComputerTurn() {
  const info = playerInfo(currentPlayerIndex(manager.game));

  return info.type === "Computer player";
}

function currentComputerDifficulty() {
  const info = playerInfo(currentPlayerIndex(manager.game));

  return info.difficulty || legacyComputerDifficulty || "normal";
}

function computerPromotionChoice(game, move) {
  if (!move?.promotion || typeof game.getPromotionChoices !== "function")
    return "q";
  const piece = game.board[move.from.r]?.[move.from.c];
  const choices = game.getPromotionChoices(piece?.color, move);
  const preference = ["q", "m", "c", "e", "r", "b", "n", "p"];
  return (
    preference.find((type) => choices.includes(type)) || choices[0] || null
  );
}

function makeComputerMove() {
  const game = manager.game;

  if (game.gameStatus().over || !isComputerTurn()) {
    return false;
  }

  const difficulty = currentComputerDifficulty();

  const move = ChessAI.findBestMove(game, difficulty);

  if (!move) return false;

  const promotion = computerPromotionChoice(game, move);
  if (promotion === null) return false;

  return game.makeMove(move, promotion);
}
function scheduleComputerMove() {
  if (
    computerMovePending ||
    !isComputerTurn() ||
    manager.game.gameStatus().over
  )
    return;
  computerMovePending = true;
  clearTimeout(computerMoveTimer);
  computerMoveTimer = setTimeout(() => {
    computerMovePending = false;
    makeComputerMove();
    selected = null;
    render();
  }, 350);
}

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const moveListEl = document.getElementById("moveList");
const capturedPanel = document.getElementById("capturedPanel");
const promotionModal = document.getElementById("promotionModal");
const promotionOptions = document.getElementById("promotionOptions");

document.getElementById("pageTitle").textContent = "Chess";
document.getElementById("gameName").textContent = "Chess";
document.getElementById("variantName").textContent =
  GameRegistry.chess.variants[manager.variantId].name;

function pieceGlyph(game, piece) {
  if (!piece) return "";
  if (game.variant === "threeman" && piece.arrow) {
    return THREE_PIECES[piece.color]?.a || "➹";
  }
  if (game.variant === "threeman")
    return THREE_PIECES[piece.color]?.[piece.type] || piece.type.toUpperCase();
  if (game.variant === "shako")
    return SHAKO_PIECES[piece.color]?.[piece.type] || piece.type.toUpperCase();
  if (game.size === 14)
    return FOUR_PIECES[piece.color]?.[piece.type] || piece.type.toUpperCase();
  if (game.size === 10)
    return LARGE_PIECES[piece.color]?.[piece.type] || piece.type.toUpperCase();
  return PIECES[piece.color]?.[piece.type] || piece.type.toUpperCase();
}

function pieceClass(piece, game = null) {
  const classes = [piece?.color || ""];
  if (
    game?.variant === "shako" &&
    (piece?.type === "c" || piece?.type === "e")
  ) {
    classes.push("shako-inverted");
  }
  return classes.filter(Boolean).join(" ");
}

function renderCoordinates(size, variant) {
  const rowLabels = document.getElementById("rowLabels");
  const colLabels = document.getElementById("colLabels");
  const frame = document.getElementById("boardFrame");
  if (!rowLabels || !colLabels || !frame) return;

  const isThreeMan = variant === "threeman";
  frame.classList.toggle("four-player", size === 14);
  frame.classList.toggle("large-board", size === 10);
  frame.classList.toggle("three-player", isThreeMan);
  rowLabels.innerHTML = "";
  colLabels.innerHTML = "";
  rowLabels.style.display = isThreeMan ? "none" : "";
  colLabels.style.display = isThreeMan ? "none" : "";

  if (isThreeMan) return;

  rowLabels.style.gridTemplateRows = `repeat(${size}, 1fr)`;
  colLabels.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  for (let r = 0; r < size; r++) {
    const label = document.createElement("span");
    label.textContent = String(size - r);
    rowLabels.appendChild(label);
  }
  for (let c = 0; c < size; c++) {
    const label = document.createElement("span");
    label.textContent = String.fromCharCode(97 + c);
    colLabels.appendChild(label);
  }
}

function renderThreeManBoard(game, legal, selectedCell) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "three-man-svg");
  svg.setAttribute("aria-label", "Three-Man Chess board");

  const legalMap = new Map(legal.map((m) => [`${m.to.r},${m.to.c}`, m]));

  for (const cell of THREE_MAN_GEOMETRY.cells.values()) {
    const poly = document.createElementNS(svgNS, "polygon");
    poly.setAttribute("points", cell.svgPoints);
    poly.classList.add("three-cell", cell.shade ? "dark" : "light");

    if (selectedCell?.r === cell.r && selectedCell?.c === cell.c) {
      poly.classList.add("selected");
    }
    if (
      game.lastMove &&
      ((game.lastMove.from?.r === cell.r && game.lastMove.from?.c === cell.c) ||
        (game.lastMove.to?.r === cell.r && game.lastMove.to?.c === cell.c))
    ) {
      poly.classList.add("last-move");
    }

    const move = legalMap.get(`${cell.r},${cell.c}`);
    if (move)
      poly.classList.add(
        game.board[cell.r][cell.c] ? "legal-capture" : "legal",
      );

    svg.appendChild(poly);

    const piece = game.board[cell.r]?.[cell.c];
    if (piece) {
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", cell.svgCenter.x.toFixed(3));
      text.setAttribute("y", cell.svgCenter.y.toFixed(3));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.classList.add(
        "three-man-piece",
        ...pieceClass(piece, game).split(" "),
      );
      text.textContent = pieceGlyph(game, piece);
      text.style.pointerEvents = "none";
      svg.appendChild(text);
    }

    if (move) {
      const mark = document.createElementNS(
        svgNS,
        game.board[cell.r][cell.c] ? "circle" : "circle",
      );
      mark.setAttribute("cx", cell.svgCenter.x.toFixed(3));
      mark.setAttribute("cy", cell.svgCenter.y.toFixed(3));
      if (game.board[cell.r][cell.c]) {
        mark.setAttribute("r", "2.4");
        mark.classList.add("three-legal-capture");
      } else {
        mark.setAttribute("r", "0.95");
        mark.classList.add("three-legal-dot");
      }
      mark.style.pointerEvents = "none";
      svg.appendChild(mark);
    }
  }

  // Resolve Three-Man clicks from the SVG viewport rather than individual
  // polygons. This avoids the angled/meeting-cell hit-testing issue where
  // a visible capture marker could be attached to one cell while the click
  // landed on a neighboring polygon.
  svg.addEventListener("click", (event) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;

    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    let best = null;
    let bestDistance = Infinity;

    for (const candidate of THREE_MAN_GEOMETRY.cells.values()) {
      const dx = candidate.svgCenter.x - point.x;
      const dy = candidate.svgCenter.y - point.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }

    if (best) clickSquare(best.r, best.c);
  });

  boardEl.appendChild(svg);
}

function makeSquareButton(game, r, c, legal, status, selectedCell) {
  const sq = document.createElement("button");
  const p = game.board[r]?.[c];
  sq.className = "square " + ((r + c) % 2 ? "dark" : "light");
  if (game.size === 14 && !playable4(r, c)) sq.classList.add("unplayable");
  if (selectedCell?.r === r && selectedCell?.c === c)
    sq.classList.add("selected");
  if (
    game.lastMove &&
    ((game.lastMove.from?.r === r && game.lastMove.from?.c === c) ||
      (game.lastMove.to?.r === r && game.lastMove.to?.c === c))
  )
    sq.classList.add("last-move");
  const king = status.check ? game.findKing(game.turn) : null;
  if (king && king.r === r && king.c === c) sq.classList.add("in-check");
  if (legal.some((m) => m.to.r === r && m.to.c === c)) {
    const mark = document.createElement("span");
    mark.className = p ? "legal-capture" : "legal-dot";
    sq.appendChild(mark);
  }
  if (p) {
    const pe = document.createElement("span");
    pe.className = "piece " + pieceClass(p, game);
    pe.textContent = pieceGlyph(game, p);
    sq.appendChild(pe);
  }
  sq.onclick = () => clickSquare(r, c);
  return sq;
}

function render() {
  const g = manager.game,
    s = g.gameStatus(),
    size = g.size;
  renderCoordinates(size, g.variant);
  boardEl.innerHTML = "";
  const legal = selected ? g.legalMovesFrom(selected.r, selected.c) : [];
  boardEl.classList.toggle("four-player", size === 14);
  boardEl.classList.toggle("three-player-layout", g.variant === "threeman");

  if (g.variant === "threeman") {
    boardEl.style.display = "block";
    boardEl.style.gridTemplateColumns = "";
    renderThreeManBoard(g, legal, selected);
  } else {
    boardEl.style.display = "grid";
    boardEl.classList.remove("three-player-layout");
    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardEl.style.gridTemplateRows = `repeat(${size}, 1fr)`;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        boardEl.appendChild(makeSquareButton(g, r, c, legal, s, selected));
      }
    }
  }

  const info = playerInfo(currentPlayerIndex(g));
  statusEl.textContent = `${info.name}: ${s.text}`;
  renderMoves();
  renderCaptured();
  document.getElementById("undoBtn").disabled = !g.history.length;
}

function findHumanMoveToTarget(game, from, to) {
  const moves = game.legalMovesFrom(from.r, from.c);
  return moves.find((move) => move.to.r === to.r && move.to.c === to.c) || null;
}

function clickSquare(r, c) {
  const g = manager.game;
  if (g.gameStatus().over || isComputerTurn()) return;
  const p = g.board[r]?.[c];
  if (!selected) {
    if (p && p.color === g.turn) {
      selected = { r, c };
      render();
    }
    return;
  }
  if (
    p &&
    p.color === g.turn &&
    !(
      g.is960 &&
      g.board[selected.r][selected.c]?.type === "k" &&
      p.type === "r"
    )
  ) {
    selected = { r, c };
    render();
    return;
  }

  // Three-Man uses the same legal move generator for ordinary movement and
  // captures. Keeping the target lookup explicit here prevents an occupied
  // opponent cell from being treated as a re-selection when it is a capture.
  const m = findHumanMoveToTarget(g, selected, { r, c });
  if (!m) {
    selected = null;
    render();
    return;
  }
  if (m.promotion) {
    pendingPromotion = m;
    openPromotion(g.board[selected.r][selected.c].color);
    return;
  }
  g.makeMove(m);
  selected = null;
  render();
}

function openPromotion(color) {
  promotionOptions.innerHTML = "";
  const g = manager.game;
  const choices = g.getPromotionChoices
    ? g.getPromotionChoices(color, pendingPromotion)
    : ["q", "r", "b", "n"];
  for (const t of choices) {
    const b = document.createElement("button");
    b.textContent = t === "p" ? "Keep Pawn" : pieceGlyph(g, { color, type: t });
    b.title = t === "p" ? "Do not promote" : t.toUpperCase();
    b.onclick = () => {
      const ok = g.makeMove(pendingPromotion, t);
      if (!ok) return;
      pendingPromotion = null;
      promotionModal.classList.remove("open");
      selected = null;
      render();
    };
    promotionOptions.appendChild(b);
  }
  promotionModal.classList.add("open");
}

function renderMoves() {
  moveListEl.innerHTML = "";
  const m = manager.game.sanHistory;
  for (let i = 0; i < m.length; i += 2) {
    const row = document.createElement("div");
    row.className = "move-row";
    row.innerHTML = `<div class="move-number">${Math.floor(i / 2) + 1}.</div><div class="move">${m[i] || ""}</div><div class="move">${m[i + 1] || ""}</div>`;
    moveListEl.appendChild(row);
  }
  moveListEl.scrollTop = moveListEl.scrollHeight;
  renderPlayers();
  scheduleComputerMove();
}

function renderCaptured() {
  capturedPanel.innerHTML = "";
  const g = manager.game;
  if (!g.captured || !g.captured.length) {
    capturedPanel.textContent = "None";
    return;
  }
  const groups = {};
  for (const p of g.captured) (groups[p.color] ??= []).push(p);
  for (const [color, pieces] of Object.entries(groups)) {
    const box = document.createElement("div");
    box.className = "captured-group";
    box.innerHTML = `<div class="captured-label">${color.toUpperCase()} captured</div>`;
    const list = document.createElement("div");
    list.className = "captured";
    for (const p of pieces) {
      const x = document.createElement("span");
      x.className = "piece " + pieceClass(p, g);
      x.textContent = pieceGlyph(g, p);
      list.appendChild(x);
    }
    box.appendChild(list);
    capturedPanel.appendChild(box);
  }
}

// ---------------------------- ONLINE MULTIPLAYER ----------------------------
const ONLINE_SERVER_URL = params.get("onlineServer") || "";
const ONLINE_CODE =
  params.get("onlineCode") || params.get("onlineJoinedCode") || "";
const ONLINE_HOST_TOKEN = params.get("onlineHostToken") || "";
const ONLINE_CLIENT_ID =
  params.get("onlineClientId") ||
  localStorage.getItem("gameLibraryOnlineClientId") ||
  `client_${Math.random().toString(36).slice(2, 12)}`;
localStorage.setItem("gameLibraryOnlineClientId", ONLINE_CLIENT_ID);
const ONLINE_MODE = Boolean(ONLINE_SERVER_URL && ONLINE_CODE);

let onlineConfig = null;
try {
  const raw = params.get("onlineConfig");
  if (raw) onlineConfig = JSON.parse(raw);
} catch (error) {
  console.warn("Could not read online game configuration:", error);
}

let onlineSocket = null;
let onlineParticipants = [];
let onlineConnected = false;
let gamePlayers = Array.isArray(onlineConfig?.players)
  ? onlineConfig.players.map((player) => ({ ...player }))
  : [];

function refreshOnlinePlayerNames() {
  if (!gamePlayers.length) return;

  const byClientId = new Map(
    onlineParticipants.map((participant) => [
      participant.clientId,
      participant,
    ]),
  );

  gamePlayers = gamePlayers.map((player) => {
    if (player.type === "computer") return player;

    const participant = byClientId.get(player.controllerClientId);
    if (!participant) return player;

    return {
      ...player,
      name: participant.name || player.name,
      avatar: participant.avatar || player.avatar,
    };
  });
}

function effectivePlayerEntries() {
  return gamePlayers.length ? gamePlayers : orderedPlayerEntries();
}

function playerInfo(index) {
  const players = effectivePlayerEntries();
  const entry = players[index];

  if (entry) {
    return {
      ...entry,
      name: entry.name || `Player ${index + 1}`,
      avatar: entry.avatar || "♟",
      type:
        entry.type === "computer"
          ? "Computer player"
          : entry.playerType || "Online player",
      controllerClientId: entry.controllerClientId || "",
      id: entry.id || entry.token || `player:${index}`,
    };
  }

  return {
    token: `unknown:${index}`,
    label: `P${index + 1}`,
    name: `Player ${index + 1}`,
    avatar: "♟",
    type: "Local player",
    difficulty: null,
    controllerClientId: ONLINE_MODE ? "" : ONLINE_CLIENT_ID,
    id: `unknown:${index}`,
  };
}

function renderPlayers() {
  const list = document.getElementById("playerList");
  if (!list) return;

  list.innerHTML = "";
  const players = effectivePlayerEntries();
  const count =
    players.length || Math.max(2, localPlayerCount + computerPlayerCount);
  const current = currentPlayerIndex(manager.game);

  for (let i = 0; i < count; i++) {
    const info = playerInfo(i);
    const row = document.createElement("div");
    row.className = "player-row" + (i === current ? " current" : "");

    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    avatar.textContent = info.avatar;

    const details = document.createElement("div");
    details.className = "player-details";

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = info.name;

    const type = document.createElement("div");
    type.className = "player-type";
    let subtitle = info.type;
    if (info.difficulty) {
      subtitle += ` • ${info.difficulty.charAt(0).toUpperCase()}${info.difficulty.slice(1)}`;
    }
    if (i === current) subtitle += " • Current turn";
    if (
      ONLINE_MODE &&
      info.controllerClientId === ONLINE_CLIENT_ID &&
      info.type !== "Computer player"
    ) {
      subtitle += " • You";
    }
    type.textContent = subtitle;

    details.append(name, type);
    row.append(avatar, details);
    list.appendChild(row);
  }
}

function localProfileForOnlineIdentity() {
  let profileId = "";
  try {
    const ids = JSON.parse(params.get("localProfileIds") || "[]");
    if (Array.isArray(ids)) profileId = ids[0] || "";
  } catch {}

  return (
    profiles.find((profile) => profile.id === profileId) ||
    profiles[0] || { id: "", name: "Player 1", avatar: "♟" }
  );
}

function onlineWsUrl() {
  const base = ONLINE_SERVER_URL.replace(/^http/i, "ws").replace(/\/$/, "");
  const query = new URLSearchParams({
    role: "player",
    clientId: ONLINE_CLIENT_ID,
  });
  if (ONLINE_HOST_TOKEN) query.set("token", ONLINE_HOST_TOKEN);
  return `${base}/ws/${encodeURIComponent(ONLINE_CODE)}?${query.toString()}`;
}

function publishOnlineState() {
  if (
    !ONLINE_MODE ||
    !onlineSocket ||
    onlineSocket.readyState !== WebSocket.OPEN ||
    !ONLINE_HOST_TOKEN
  )
    return;

  try {
    onlineSocket.send(
      JSON.stringify({
        type: "game:state",
        state: {
          variant: manager.variantId,
          game: manager.game.clone(),
        },
      }),
    );
  } catch (error) {
    console.warn("Could not publish game state:", error);
  }
}

function publishOnlineMove(move, promotion = "q") {
  if (
    !ONLINE_MODE ||
    !onlineSocket ||
    onlineSocket.readyState !== WebSocket.OPEN
  )
    return;

  try {
    onlineSocket.send(
      JSON.stringify({
        type: "game:move",
        payload: {
          from: { ...move.from },
          to: { ...move.to },
          promotion,
        },
      }),
    );
  } catch (error) {
    console.warn("Could not send online move:", error);
  }
}

function applyRemoteState(state) {
  if (!state?.game) return;

  if (
    state.variant &&
    GameRegistry.chess.variants[state.variant] &&
    manager.variantId !== state.variant
  ) {
    manager.newGame("chess", state.variant);
    selectedVariantId = state.variant;
  }

  try {
    manager.game.restore(state.game);
    selected = null;
    pendingPromotion = null;
    promotionModal.classList.remove("open");
    render();
  } catch (error) {
    console.warn("Could not apply online game state:", error);
  }
}

function applyRemoteMove(payload) {
  if (!payload?.from || !payload?.to) return;

  const current = playerInfo(currentPlayerIndex(manager.game));
  if (
    current.controllerClientId &&
    current.controllerClientId !== lastRemoteSenderId
  )
    return;

  const promotion = payload.promotion || "q";
  const ok = manager.game.makeMove(
    { from: { ...payload.from }, to: { ...payload.to } },
    promotion,
  );

  if (!ok) return;

  selected = null;
  pendingPromotion = null;
  promotionModal.classList.remove("open");

  if (ONLINE_MODE && ONLINE_HOST_TOKEN) publishOnlineState();
  render();
}

let lastRemoteSenderId = "";

function connectOnlineGame() {
  if (!ONLINE_MODE) return;

  try {
    onlineSocket = new WebSocket(onlineWsUrl());
  } catch (error) {
    console.warn("Could not create online WebSocket:", error);
    return;
  }

  onlineSocket.addEventListener("open", () => {
    onlineConnected = true;
    const profile = localProfileForOnlineIdentity();

    onlineSocket.send(
      JSON.stringify({
        type: "player:identify",
        profileId: profile.id || "",
        name: profile.name || "Player 1",
        avatar: profile.avatar || "♟",
        spectator: false,
      }),
    );

    // The host is authoritative. Publishing shortly after connecting also
    // handles the case where a guest enters after the game has started.
    setTimeout(() => publishOnlineState(), 100);
    renderPlayers();
  });

  onlineSocket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "room:hello") {
      onlineParticipants = message.room?.participants || [];
      if (message.room?.config) onlineConfig = message.room.config;
      if (Array.isArray(onlineConfig?.players))
        gamePlayers = onlineConfig.players.map((p) => ({ ...p }));
      refreshOnlinePlayerNames();
      renderPlayers();
      if (message.room?.stateAvailable) publishOnlineState();
      return;
    }

    if (message.type === "room:participants") {
      onlineParticipants = Array.isArray(message.participants)
        ? message.participants
        : [];
      refreshOnlinePlayerNames();
      renderPlayers();
      if (ONLINE_HOST_TOKEN) publishOnlineState();
      return;
    }

    if (message.type === "room:config") {
      onlineConfig = message.config || onlineConfig;
      if (Array.isArray(onlineConfig?.players))
        gamePlayers = onlineConfig.players.map((p) => ({ ...p }));
      refreshOnlinePlayerNames();
      renderPlayers();
      return;
    }

    if (message.type === "game:start") {
      onlineConfig = message.config || onlineConfig;
      if (Array.isArray(onlineConfig?.players))
        gamePlayers = onlineConfig.players.map((p) => ({ ...p }));
      refreshOnlinePlayerNames();
      renderPlayers();
      return;
    }

    if (message.type === "game:state") {
      applyRemoteState(message.state);
      return;
    }

    if (message.type === "game:move") {
      if (message.sender?.clientId === ONLINE_CLIENT_ID) return;
      lastRemoteSenderId = message.sender?.clientId || "";
      applyRemoteMove(message.payload);
      lastRemoteSenderId = "";
      return;
    }
  });

  onlineSocket.addEventListener("close", () => {
    onlineConnected = false;
  });

  onlineSocket.addEventListener("error", (error) => {
    console.warn("Online chess connection error:", error);
    onlineConnected = false;
  });
}

function isComputerTurn() {
  const current = playerInfo(currentPlayerIndex(manager.game));
  if (current.type !== "Computer player") return false;
  return !ONLINE_MODE || current.controllerClientId === ONLINE_CLIENT_ID;
}

function canLocalPlayerMove() {
  const current = playerInfo(currentPlayerIndex(manager.game));
  if (!ONLINE_MODE) return current.type !== "Computer player";
  return current.controllerClientId === ONLINE_CLIENT_ID;
}

function computerPromotionChoice(game, move) {
  if (!move?.promotion || typeof game.getPromotionChoices !== "function")
    return "q";
  const piece = game.board[move.from.r]?.[move.from.c];
  const choices = game.getPromotionChoices(piece?.color, move);
  const preference = ["q", "m", "c", "e", "r", "b", "n", "p"];
  return (
    preference.find((type) => choices.includes(type)) || choices[0] || null
  );
}

function makeComputerMove() {
  const game = manager.game;
  if (game.gameStatus().over || !isComputerTurn()) return false;

  const current = playerInfo(currentPlayerIndex(game));
  const difficulty =
    current.difficulty ||
    computerDifficulties[current.id] ||
    legacyComputerDifficulty ||
    "normal";
  const move = ChessAI.findBestMove(game, difficulty);
  if (!move) return false;

  const promotion = computerPromotionChoice(game, move);
  if (promotion === null) return false;

  const ok = game.makeMove(move, promotion);
  if (ok && ONLINE_MODE) {
    publishOnlineMove(move, promotion);
    publishOnlineState();
  }
  return ok;
}

function scheduleComputerMove() {
  if (
    computerMovePending ||
    !isComputerTurn() ||
    manager.game.gameStatus().over
  )
    return;
  computerMovePending = true;
  clearTimeout(computerMoveTimer);
  computerMoveTimer = setTimeout(() => {
    computerMovePending = false;
    makeComputerMove();
    selected = null;
    render();
  }, 350);
}

function findHumanMoveToTarget(game, from, to) {
  return (
    game
      .legalMovesFrom(from.r, from.c)
      .find((move) => move.to.r === to.r && move.to.c === to.c) || null
  );
}

function clickSquare(r, c) {
  const g = manager.game;
  if (g.gameStatus().over || !canLocalPlayerMove()) return;

  const p = g.board[r]?.[c];
  if (!selected) {
    if (p && p.color === g.turn) {
      selected = { r, c };
      render();
    }
    return;
  }

  if (
    p &&
    p.color === g.turn &&
    !(
      g.is960 &&
      g.board[selected.r][selected.c]?.type === "k" &&
      p.type === "r"
    )
  ) {
    selected = { r, c };
    render();
    return;
  }

  const move = findHumanMoveToTarget(g, selected, { r, c });
  if (!move) {
    selected = null;
    render();
    return;
  }

  if (move.promotion) {
    pendingPromotion = move;
    openPromotion(g.board[selected.r][selected.c].color);
    return;
  }

  const from = { ...move.from };
  const ok = g.makeMove(move);
  if (!ok) return;

  selected = null;
  render();
  if (ONLINE_MODE) {
    publishOnlineMove({ from, to: { ...move.to } }, "q");
    if (ONLINE_HOST_TOKEN) publishOnlineState();
  }
}

function openPromotion(color) {
  promotionOptions.innerHTML = "";
  const g = manager.game;
  const choices = g.getPromotionChoices
    ? g.getPromotionChoices(color, pendingPromotion)
    : ["q", "r", "b", "n"];

  for (const type of choices) {
    const button = document.createElement("button");
    button.textContent =
      type === "p" ? "Keep Pawn" : pieceGlyph(g, { color, type });
    button.title = type === "p" ? "Keep Pawn" : type.toUpperCase();
    button.onclick = () => {
      const move = {
        ...pendingPromotion,
        from: { ...pendingPromotion.from },
        to: { ...pendingPromotion.to },
      };
      const ok = g.makeMove(move, type);
      if (!ok) return;

      pendingPromotion = null;
      promotionModal.classList.remove("open");
      selected = null;
      render();

      if (ONLINE_MODE) {
        publishOnlineMove(move, type);
        if (ONLINE_HOST_TOKEN) publishOnlineState();
      }
    };
    promotionOptions.appendChild(button);
  }

  promotionModal.classList.add("open");
}

// Replace the original local-only controls with host-authoritative online controls.
document.getElementById("newGameBtn").onclick = () => {
  window.location.href = "../index.html";
};

document.getElementById("clearBtn").onclick = () => {
  clearTimeout(computerMoveTimer);
  computerMovePending = false;
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  manager.newGame("chess", manager.variantId);
  selected = null;
  pendingPromotion = null;
  promotionModal.classList.remove("open");
  if (ONLINE_MODE) publishOnlineState();
  render();
};

document.getElementById("undoBtn").onclick = () => {
  clearTimeout(computerMoveTimer);
  computerMovePending = false;
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  if (manager.game.undo()) {
    selected = null;
    pendingPromotion = null;
    if (ONLINE_MODE) publishOnlineState();
    render();
  }
};

refreshOnlinePlayerNames();
connectOnlineGame();
render();
