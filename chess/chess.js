"use strict";

const SOLID_PIECES = {
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟", m: "●", K: "👑",
};
const PIECES = { w: SOLID_PIECES, b: SOLID_PIECES };
const THREE_PIECES = { white: SOLID_PIECES, red: SOLID_PIECES, black: SOLID_PIECES };
const FOUR_PIECES = { white: SOLID_PIECES, black: SOLID_PIECES, red: SOLID_PIECES, blue: SOLID_PIECES };
const THREE_COLORS = ["white", "red", "black"];
const FOUR_COLORS = ["white", "red", "black", "blue"];

function inside(r, c, size) { return r >= 0 && r < size && c >= 0 && c < size; }
function cloneBoard(b) { return b.map((row) => row.map((p) => (p ? { ...p } : null))); }
function opposite(c) { return c === "w" ? "b" : "w"; }

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
  row[
    available.splice(Math.floor(Math.random() * available.length), 1)[0]
  ] = "n";
  row[
    available.splice(Math.floor(Math.random() * available.length), 1)[0]
  ] = "n";
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
        if (b[r][c]?.color === color && b[r][c].type === "k")
          return { r, c };
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
        for (let dc = -1; dc <= 1; dc++)
          if (dr || dc) add(r + dr, c + dc);

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
      return (
        k && !this.attacked(k.r, k.c, opposite(this.board[r][c].color), b)
      );
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
      this.sanHistory.push(
        legal.castling.targetKCol === 6 ? "O-O" : "O-O-O",
      );
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

// ---------------------------- THREE-PLAYER CHESS ENGINE ----------------------------
const THREE_ROWS = 12;
const THREE_COLS = 8;
function wrapThreeRow(r) { return ((r % THREE_ROWS) + THREE_ROWS) % THREE_ROWS; }
function playable3(r, c) { return r >= 0 && r < THREE_ROWS && c >= 0 && c < THREE_COLS; }
function threeStartRow(color) { return color === "white" ? 0 : color === "red" ? 4 : 8; }
function setupThreeSide(board, color, startRow) {
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let c = 0; c < THREE_COLS; c++) {
    board[startRow][c] = { type: back[c], color };
    board[startRow + 1][c] = { type: "p", color };
  }
}
class ThreePlayerChessGame {
  constructor() { this.size = THREE_ROWS; this.cols = THREE_COLS; this.variant = "threeman"; this.playersCount = 3; this.reset(); }
  reset() {
    this.board = Array.from({ length: THREE_ROWS }, () => Array(THREE_COLS).fill(null));
    setupThreeSide(this.board, "white", 0); setupThreeSide(this.board, "red", 4); setupThreeSide(this.board, "black", 8);
    this.turnIndex = 0; this.turn = THREE_COLORS[0]; this.history = []; this.sanHistory = []; this.captured = []; this.lastMove = null;
    this.castling = {
      white: { kingMoved: false, rooks: [{ col: 0, moved: false }, { col: 7, moved: false }] },
      red: { kingMoved: false, rooks: [{ col: 0, moved: false }, { col: 7, moved: false }] },
      black: { kingMoved: false, rooks: [{ col: 0, moved: false }, { col: 7, moved: false }] },
    };
  }
  clone() { return { board: cloneBoard(this.board), turnIndex: this.turnIndex, turn: this.turn, san: [...this.sanHistory], captured: this.captured.map(p => ({...p})), lastMove: this.lastMove ? {from:{...this.lastMove.from},to:{...this.lastMove.to}} : null, castling: JSON.parse(JSON.stringify(this.castling)) }; }
  restore(s) { this.board=cloneBoard(s.board); this.turnIndex=s.turnIndex; this.turn=s.turn; this.sanHistory=[...s.san]; this.captured=s.captured.map(p=>({...p})); this.lastMove=s.lastMove?{from:{...s.lastMove.from},to:{...s.lastMove.to}}:null; this.castling=JSON.parse(JSON.stringify(s.castling)); }
  undo() { if (!this.history.length) return false; this.restore(this.history.pop()); return true; }
  nextRow(r,d) { return wrapThreeRow(r+d); }
  pawnStartRow(color) { return threeStartRow(color)+1; }
  promotionRow(color) { return threeStartRow(color); }
  findKing(color,b=this.board) { for(let r=0;r<THREE_ROWS;r++) for(let c=0;c<THREE_COLS;c++) if(b[r][c]?.color===color&&b[r][c].type==="k") return {r,c}; return null; }
  otherColors(color) { return THREE_COLORS.filter(c=>c!==color); }
  attacked(r,c,by,b=this.board) {
    for(let sr=0;sr<THREE_ROWS;sr++) for(let sc=0;sc<THREE_COLS;sc++) {
      const p=b[sr][sc]; if(!p||p.color!==by) continue;
      if(p.type==="p") { const nr=this.nextRow(sr,1); if(nr===r&&(sc-1===c||sc+1===c)) return true; continue; }
      if(p.type==="n") { for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) if(this.nextRow(sr,dr)===r&&sc+dc===c&&playable3(r,c)) return true; continue; }
      if(p.type==="k") { for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if((dr||dc)&&this.nextRow(sr,dr)===r&&sc+dc===c&&playable3(r,c)) return true; continue; }
      const dirs=[]; if(["b","q"].includes(p.type)) dirs.push([1,1],[1,-1],[-1,1],[-1,-1]); if(["r","q"].includes(p.type)) dirs.push([1,0],[-1,0],[0,1],[0,-1]);
      for(const [dr,dc] of dirs){ let tr=sr,tc=sc; for(let step=0;step<12;step++){ tr=this.nextRow(tr,dr); tc+=dc; if(tc<0||tc>=THREE_COLS) break; if(tr===r&&tc===c) return true; if(b[tr][tc]) break; } }
    }
    return false;
  }
  moveList(r,c) {
    const p=this.board[r]?.[c]; if(!p||p.color!==this.turn) return [];
    const out=[]; const add=(tr,tc,x={})=>{ if(!playable3(tr,tc)) return; const t=this.board[tr][tc]; if(!t||t.color!==p.color) out.push({from:{r,c},to:{r:tr,c:tc},...x}); };
    if(p.type==="p") {
      const nr=this.nextRow(r,1); if(!this.board[nr][c]) { add(nr,c,{promotion:nr===this.promotionRow(p.color)}); if(r===this.pawnStartRow(p.color)){const nnr=this.nextRow(r,2); if(!this.board[nnr][c]) add(nnr,c,{promotion:nnr===this.promotionRow(p.color)});} }
      for(const dc of [-1,1]){const nc=c+dc; if(nc>=0&&nc<THREE_COLS&&this.board[nr][nc]&&this.board[nr][nc].color!==p.color) add(nr,nc,{promotion:nr===this.promotionRow(p.color)});}
    } else if(p.type==="n") {
      for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(this.nextRow(r,dr),c+dc);
    } else if(p.type==="k") {
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc) add(this.nextRow(r,dr),c+dc);
      const cs=this.castling[p.color];
      if(r===threeStartRow(p.color)&&c===4&&!cs.kingMoved&&!this.otherColors(p.color).some(e=>this.attacked(r,c,e))) {
        for(const rook of cs.rooks){ if(rook.moved) continue; const kingSide=rook.col>c,targetKCol=kingSide?6:2,targetRCol=kingSide?5:3; let clear=true;
          for(let col=Math.min(c,rook.col);col<=Math.max(c,rook.col);col++) if(col!==c&&col!==rook.col&&this.board[r][col]) {clear=false;break;}
          if(clear&&(this.board[r][targetKCol]||this.board[r][targetRCol])) clear=false;
          if(clear){const step=targetKCol>c?1:-1;for(let col=c+step;col!==targetKCol+step;col+=step) if(this.otherColors(p.color).some(e=>this.attacked(r,col,e))){clear=false;break;}}
          if(clear) out.push({from:{r,c},to:{r,c:targetKCol},castling:{rookFromCol:rook.col,targetKCol,targetRCol}});
        }
      }
    } else {
      const ds=[]; if(["b","q"].includes(p.type)) ds.push([1,1],[1,-1],[-1,1],[-1,-1]); if(["r","q"].includes(p.type)) ds.push([1,0],[-1,0],[0,1],[0,-1]);
      for(const [dr,dc] of ds){let tr=r,tc=c;for(let step=0;step<12;step++){tr=this.nextRow(tr,dr);tc+=dc;if(tc<0||tc>=THREE_COLS)break;const t=this.board[tr][tc];if(!t)add(tr,tc);else{if(t.color!==p.color)add(tr,tc);break;}}}
    }
    return out;
  }
  legalMovesFrom(r,c){ return this.moveList(r,c).filter(m=>{const snap=this.clone();const p=this.board[m.from.r][m.from.c];if(m.castling){const rook=this.board[m.from.r][m.castling.rookFromCol];this.board[m.from.r][m.from.c]=null;this.board[m.from.r][m.castling.rookFromCol]=null;this.board[m.from.r][m.castling.targetKCol]=p;this.board[m.from.r][m.castling.targetRCol]=rook;}else{this.board[m.from.r][m.from.c]=null;this.board[m.to.r][m.to.c]=p;}const king=this.findKing(p.color);const safe=king&&!this.otherColors(p.color).some(e=>this.attacked(king.r,king.c,e));this.restore(snap);return safe;}); }
  allLegal(color){const old=this.turn;this.turn=color;const a=[];for(let r=0;r<THREE_ROWS;r++)for(let c=0;c<THREE_COLS;c++)if(this.board[r][c]?.color===color)a.push(...this.legalMovesFrom(r,c));this.turn=old;return a;}
  makeMove(m,promotion="q"){const legal=this.legalMovesFrom(m.from.r,m.from.c).find(x=>x.to.r===m.to.r&&x.to.c===m.to.c);if(!legal)return false;this.history.push(this.clone());const p=this.board[legal.from.r][legal.from.c];if(legal.castling){const rook=this.board[legal.from.r][legal.castling.rookFromCol];this.board[legal.from.r][legal.from.c]=null;this.board[legal.from.r][legal.castling.rookFromCol]=null;this.board[legal.from.r][legal.castling.targetKCol]=p;this.board[legal.from.r][legal.castling.targetRCol]=rook;this.castling[p.color].kingMoved=true;const rk=this.castling[p.color].rooks.find(x=>x.col===legal.castling.rookFromCol);if(rk)rk.moved=true;this.sanHistory.push(legal.castling.targetKCol===6?"O-O":"O-O-O");}else{const cap=this.board[legal.to.r][legal.to.c];this.board[legal.from.r][legal.from.c]=null;this.board[legal.to.r][legal.to.c]={...p,type:legal.promotion?promotion:p.type};if(p.type==="k")this.castling[p.color].kingMoved=true;if(p.type==="r"){const rk=this.castling[p.color].rooks.find(x=>x.col===legal.from.c);if(rk)rk.moved=true;}if(cap)this.captured.push(cap);const file="abcdefgh";this.sanHistory.push(`${p.type==="p"?"":p.type.toUpperCase()}${cap?"x":""}${file[legal.to.c]}${THREE_ROWS-legal.to.r}${legal.promotion?"="+promotion.toUpperCase():""}`);}this.lastMove={from:{...legal.from},to:{...legal.to}};this.turnIndex=(this.turnIndex+1)%3;this.turn=THREE_COLORS[this.turnIndex];return true;}
  gameStatus(){const king=this.findKing(this.turn);const check=king&&this.otherColors(this.turn).some(e=>this.attacked(king.r,king.c,e));const moves=this.allLegal(this.turn);if(!moves.length){const winner=this.turnIndex===0?"black":this.turnIndex===1?"white":"red";return{over:true,check:Boolean(check),winner,text:check?`Checkmate — ${winner[0].toUpperCase()+winner.slice(1)} wins`:"Stalemate — draw"};}return{over:false,check:Boolean(check),text:`${this.turn[0].toUpperCase()+this.turn.slice(1)}${check?" is in check":" to move"}`};}
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
      if (
        inside(nr, nc, 14) &&
        playable4(nr, nc) &&
        !this.board[nr][nc]
      ) {
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
      const captureDirs = p.color === "red"
        ? [[1, 1], [-1, 1]]
        : p.color === "blue"
          ? [[1, -1], [-1, -1]]
          : p.color === "black"
            ? [[1, -1], [1, 1]]
            : [[-1, -1], [-1, 1]];
      for (const [dr, dc] of captureDirs) {
        const tr = r + dr,
          tc = c + dc;
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
        for (let dc = -1; dc <= 1; dc++)
          if (dr || dc) add(r + dr, c + dc);
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
  attacked(r, c, by, b = this.board) {
    // Determine whether a four-player piece attacks the target square.
    // This is deliberately separate from legal movement because pawns attack
    // empty squares for Fog of War visibility purposes.
    for (let sr = 0; sr < 14; sr++) {
      for (let sc = 0; sc < 14; sc++) {
        const p = b[sr]?.[sc];
        if (!p || p.color !== by) continue;

        if (p.type === "p") {
          const captures = by === "red" || by === "blue"
            ? [[sr + 1, sc + (by === "red" ? 1 : -1)], [sr - 1, sc + (by === "red" ? 1 : -1)]]
            : [[sr + (by === "black" ? 1 : -1), sc - 1], [sr + (by === "black" ? 1 : -1), sc + 1]];
          if (captures.some(([tr, tc]) => tr === r && tc === c && inside(tr, tc, 14) && playable4(tr, tc))) return true;
          continue;
        }

        if (p.type === "n") {
          for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
            if (sr + dr === r && sc + dc === c && inside(r, c, 14) && playable4(r, c)) return true;
          }
          continue;
        }

        if (p.type === "k") {
          if (Math.max(Math.abs(r - sr), Math.abs(c - sc)) === 1 && playable4(r, c)) return true;
          continue;
        }

        const dirs = [];
        if (["b", "q"].includes(p.type)) dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
        if (["r", "q"].includes(p.type)) dirs.push([1,0],[-1,0],[0,1],[0,-1]);
        for (const [dr, dc] of dirs) {
          let tr = sr + dr, tc = sc + dc;
          while (inside(tr, tc, 14) && playable4(tr, tc)) {
            if (tr === r && tc === c) return true;
            if (b[tr][tc]) break;
            tr += dr;
            tc += dc;
          }
        }
      }
    }
    return false;
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

// ---------------------------- CHESS GAME REGISTRY ----------------------------
const GameRegistry = {
  chess: {
    name: "Chess",
    variants: {
standard: { name: "Standard Chess", create: () => new ChessGame(false) },
chess960: { name: "Chess960", create: () => new ChessGame(true) },
threeman: { name: "Three Player Chess", create: () => new ThreePlayerChessGame() },
fourplayer: { name: "4-Player Chess", create: () => new FourPlayerChessGame() },
    },
  },
};

class GameManager {
  constructor() { this.game = null; this.gameId = ""; this.variantId = ""; }
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
if (!GameRegistry.chess.variants[selectedVariantId]) selectedVariantId = "standard";

const localPlayerCount = 1;
const computerPlayerCount = 1;
const ONLINE_SERVER_URL =
  params.get("onlineServer") ||
  params.get("server") ||
  "";
const ONLINE_CODE =
  params.get("onlineCode") ||
  params.get("onlineJoinedCode") ||
  params.get("code") ||
  "";
const ONLINE_HOST_TOKEN =
  params.get("onlineHostToken") ||
  params.get("hostToken") ||
  "";
const ONLINE_CLIENT_ID =
  params.get("onlineClientId") ||
  params.get("clientId") ||
  sessionStorage.getItem("gameLibraryOnlineClientId") ||
  `client_${Math.random().toString(36).slice(2, 12)}`;
sessionStorage.setItem("gameLibraryOnlineClientId", ONLINE_CLIENT_ID);
const ONLINE_MODE = Boolean(ONLINE_SERVER_URL && ONLINE_CODE);

let onlineConfig = null;
try {
  const rawConfig = params.get("onlineConfig");
  if (rawConfig) onlineConfig = JSON.parse(rawConfig);
} catch (error) {
  console.warn("Could not read online game configuration from URL:", error);
}

// index.html stores the exact host-generated configuration in sessionStorage
// before navigating here. Use it immediately so the chess page starts with
// the same human seats instead of briefly/defaulting to Computer.
if (!onlineConfig) {
  try {
    const storedConfig = sessionStorage.getItem("gameLibraryOnlineConfig");
    if (storedConfig) onlineConfig = JSON.parse(storedConfig);
  } catch (error) {
    console.warn("Could not read online game configuration from sessionStorage:", error);
  }
}

const FOG_OF_WAR = Boolean(onlineConfig?.options?.fogOfWar || params.get("fogOfWar") === "true");

let onlineSocket = null;
let onlineParticipants = [];
let onlineConnected = false;
let onlineMatchId = "";
let onlineResultSent = false;
let profiles = [];
try {
  const saved = JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
  if (Array.isArray(saved)) profiles = saved;
} catch (error) { console.warn("Could not load player profiles:", error); }

function parseOnlinePlayers(config) {
  return Array.isArray(config?.players) ? config.players.map(player => ({...player})) : [];
}

let gamePlayers = parseOnlinePlayers(onlineConfig);

function refreshOnlinePlayerNames() {
  if (!gamePlayers.length) return;

  const byClientId = new Map(
    onlineParticipants.map(participant => [participant.clientId, participant])
  );

  gamePlayers = gamePlayers.map(player => {
    if (player.type === "computer") return player;
    const participant = byClientId.get(player.controllerClientId);
    if (!participant) return player;
    return {
      ...player,
      name: participant.name || player.name,
      avatar: participant.avatar || player.avatar
    };
  });
}

function currentPlayerIndex(game) {
  if (Number.isInteger(game.turnIndex)) return game.turnIndex;
  if (game.turn === "w" || game.turn === "white") return 0;
  if (game.turn === "red") return 1;
  if (game.turn === "b" || game.turn === "black") return game.size === 12 ? 2 : 1;
  if (game.turn === "blue") return 3;
  return 0;
}

function playerInfo(index) {
  if (gamePlayers.length) {
    const p = gamePlayers[index];
    if (p) {
      return {
        name: p.name || `Player ${index + 1}`,
        avatar: p.avatar || "♟",
        type: p.type === "computer" ? "Computer player" : (p.playerType || "Online player"),
        controllerClientId: p.controllerClientId || p.clientId || "",
        seat: p.seat || "",
        id: p.id || p.seat || ""
      };
    }
  }

  if (index < localPlayerCount) {
    const p = profiles[index];
    return { name: p?.name || `Player ${index + 1}`, avatar: p?.avatar || "♟", type: "Local player", controllerClientId: "", id: `local:${index}` };
  }

  return { name: `Computer ${index - localPlayerCount + 1}`, avatar: "🤖", type: "Computer player", controllerClientId: "", id: `computer:${index - localPlayerCount}` };
}

function currentPlayerEntry(game) {
  if (!gamePlayers.length) return playerInfo(currentPlayerIndex(game));
  return gamePlayers[currentPlayerIndex(game)] || playerInfo(currentPlayerIndex(game));
}

function isComputerTurn() {
  if (!gameHasStarted) return false;
  const current = currentPlayerEntry(manager.game);
  if (current?.type !== "computer") return false;
  return !ONLINE_MODE || current.controllerClientId === ONLINE_CLIENT_ID;
}

function isOnlineSpectator() {
  if (!ONLINE_MODE) return false;
  const self = onlineParticipants.find((p) => p.clientId === ONLINE_CLIENT_ID);
  return Boolean(self?.spectator) || Boolean((onlineConfig?.spectators || []).includes(ONLINE_CLIENT_ID));
}

function canLocalPlayerMove() {
  if (!gameHasStarted || localHandoffActive) return false;
  if (isOnlineSpectator()) return false;
  const current = currentPlayerEntry(manager.game);
  if (!ONLINE_MODE) return current?.type !== "computer";

  // The index page supplies the controllerClientId for each human seat.
  // Either online player may be White or Black.
  return current?.controllerClientId === ONLINE_CLIENT_ID;
}

function localHumanEntries() {
  return gamePlayers.filter((p) => p?.type !== "computer" && !p?.spectator && !p?.controllerClientId);
}

function isLocalHotseatGame() {
  return !ONLINE_MODE && localHumanEntries().length >= 2;
}

function fogColorForSeat(seat, game = manager.game) {
  if (!seat) return null;

  // Four-player Chess uses its four literal colour names on the board.
  if (game?.size === 14) {
    return ["white", "red", "black", "blue"].includes(seat) ? seat : null;
  }

  if (game?.size === 12) {
    return ["white", "red", "black"].includes(seat) ? seat : null;
  }

  // Standard Chess and Chess960 use the compact engine colours.
  if (seat === "white") return "w";
  if (seat === "black") return "b";
  return null;
}

function fogViewerColor() {
  if (!FOG_OF_WAR) return null;
  if (ONLINE_MODE) {
    if (isOnlineSpectator()) return null;
    const own = gamePlayers.find((p) => p?.controllerClientId === ONLINE_CLIENT_ID);
    return fogColorForSeat(own?.seat);
  }

  const humans = localHumanEntries();
  if (humans.length >= 2) {
    return fogColorForSeat(currentPlayerEntry(manager.game)?.seat);
  }

  return fogColorForSeat(humans[0]?.seat);
}

function squareVisibleToColor(r, c, color, game = manager.game) {
  if (!FOG_OF_WAR || !color) return true;
  const piece = game.board[r]?.[c];
  if (piece?.color === color) return true;
  return game.attacked(r, c, color, game.board);
}

function squareVisibleToViewer(r, c, game = manager.game) {
  return squareVisibleToColor(r, c, fogViewerColor(), game);
}

function squareVisibleOrOwnLastMove(r, c) {
  return squareVisibleToViewer(r, c);
}

function clearLocalHandoff() {
  if (localHandoffTimer) clearInterval(localHandoffTimer);
  localHandoffTimer = null;
  localHandoffActive = false;
  localHandoffUntil = 0;
  const overlay = document.getElementById("handoffOverlay");
  if (overlay) {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }
}

function beginLocalHandoff() {
  // The pass-the-device screen only exists when Fog of War is enabled.
  // Without hidden information there is nothing to hide between turns.
  if (!FOG_OF_WAR || !isLocalHotseatGame() || manager.game.gameStatus().over) return;
  const next = currentPlayerEntry(manager.game);
  if (!next || next.type === "computer") return;

  clearLocalHandoff();
  localHandoffActive = true;
  localHandoffUntil = Date.now() + 2000;
  const overlay = document.getElementById("handoffOverlay");
  const title = document.getElementById("handoffTitle");
  const countdown = document.getElementById("handoffCountdown");
  if (!overlay || !title || !countdown) return;

  title.textContent = `Pass the device to ${next.name || "the next player"}`;
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");

  const update = () => {
    const remaining = Math.max(0, localHandoffUntil - Date.now());
    countdown.textContent = (remaining / 1000).toFixed(1);
    if (remaining <= 0) {
      clearLocalHandoff();
      render();
    }
  };
  update();
  localHandoffTimer = setInterval(update, 50);
}

function renderPlayers() {
  const list = document.getElementById("playerList");
  list.innerHTML = "";
  const count = gamePlayers.length || Math.max(2, localPlayerCount + computerPlayerCount);
  const current = currentPlayerIndex(manager.game);

  for (let i = 0; i < count; i++) {
    const info = playerInfo(i), row = document.createElement("div");
    row.className = "player-row" + (i === current ? " current" : "");
    const avatar = document.createElement("div"); avatar.className = "player-avatar"; avatar.textContent = info.avatar;
    const details = document.createElement("div"); details.className = "player-details";
    const name = document.createElement("div"); name.className = "player-name"; name.textContent = info.name;
    const type = document.createElement("div"); type.className = "player-type"; type.textContent = info.type + (i === current ? " • Current turn" : "");
    details.append(name, type); row.append(avatar, details); list.appendChild(row);
  }
}

const manager = new GameManager();
if (onlineConfig?.variant && GameRegistry.chess.variants[onlineConfig.variant]) {
  selectedVariantId = onlineConfig.variant;
}
manager.newGame("chess", selectedVariantId);
let gameHasStarted = false;
let computerMoveTimer = null;
let computerMovePending = false;
let selected = null;
let pendingPromotion = null;
let localHandoffTimer = null;
let localHandoffActive = false;
let localHandoffUntil = 0;

const computerDifficulty = params.get("computerDifficulty") || "normal";
let computerDifficulties = {};
try {
  const rawDifficulties = params.get("computerDifficulties");
  if (rawDifficulties) computerDifficulties = JSON.parse(rawDifficulties) || {};
} catch (error) {
  console.warn("Could not read computer difficulties:", error);
}

function onlineWsUrl() {
  const base = ONLINE_SERVER_URL.replace(/^http/i, "ws").replace(/\/$/, "");
  const query = new URLSearchParams({ role: "player", clientId: ONLINE_CLIENT_ID });
  if (ONLINE_HOST_TOKEN) query.set("token", ONLINE_HOST_TOKEN);
  return `${base}/ws/${encodeURIComponent(ONLINE_CODE)}?${query.toString()}`;
}

function localProfileForOnlineIdentity() {
  const activeId = localStorage.getItem("gameLibraryActiveProfileId") || "";
  return profiles.find((p) => p.id === activeId) || profiles[0] || { id: "", name: "Player 1", avatar: "♟" };
}

function setOnlineStatus(text, isError = false) {
  const bar = document.getElementById("onlineBar");
  if (!bar) return;
  bar.hidden = !ONLINE_MODE;
  bar.textContent = text;
  bar.classList.toggle("error", Boolean(isError));
}

function publishOnlineState() {
  if (!ONLINE_MODE || !gameHasStarted || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN || !ONLINE_HOST_TOKEN) return;

  try {
    onlineSocket.send(JSON.stringify({
      type: "game:state",
      state: {
        variant: manager.variantId,
        game: manager.game.clone()
      }
    }));
  } catch (error) {
    console.warn("Could not publish game state:", error);
  }
}

function publishOnlineResultIfOver() {
  if (!ONLINE_MODE || !ONLINE_HOST_TOKEN || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
  if (!onlineMatchId || onlineResultSent) return;

  const status = manager.game.gameStatus();
  if (!status.over) return;

  const winner = status.winner || (status.check ? opposite(manager.game.turn) : null);
  const winnerClientId = winner
    ? (gamePlayers.find((player) => {
        if (player.seat === winner) return true;
        if (player.seat === "white" && winner === "w") return true;
        if (player.seat === "black" && winner === "b") return true;
        return false;
      })?.controllerClientId || "")
    : null;

  if (winner && !winnerClientId) return;

  try {
    onlineSocket.send(JSON.stringify({
      type: "game:result",
      matchId: onlineMatchId,
      winnerClientId,
      draw: !winner,
    }));
    onlineResultSent = true;
  } catch (error) {
    console.warn("Could not publish online game result:", error);
  }
}

function goBackToLibrary() {
  if (ONLINE_MODE && onlineSocket && onlineSocket.readyState === WebSocket.OPEN) {
    try {
      onlineSocket.send(JSON.stringify({ type: "game:back" }));
    } catch (error) {
      console.warn("Could not notify the room before leaving:", error);
    }
    setTimeout(() => { window.location.href = "../index.html"; }, 350);
    return;
  }
  window.location.href = "../index.html";
}

function publishOnlineMove(move, promotion = "q") {
  if (!ONLINE_MODE) return false;
  if (!onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) {
    setOnlineStatus("Online connection is not open; move was not sent.", true);
    return false;
  }

  const payload = {
    from: { ...move.from },
    to: { ...move.to },
    promotion,
    ply: manager.game.sanHistory.length,
    moveId: `${ONLINE_CLIENT_ID}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  };

  try {
    onlineSocket.send(JSON.stringify({
      type: "game:move",
      payload
    }));
    setOnlineStatus(`Connected • sent move ${payload.ply}`);
    console.debug("Online chess: sent move", payload);
    return true;
  } catch (error) {
    setOnlineStatus(`Failed to send move: ${error.message || error}`, true);
    console.warn("Could not send online move:", error);
    return false;
  }
}

function applyRemoteState(state) {
  if (!state?.game) return;
  if (state.variant && GameRegistry.chess.variants[state.variant]) {
    if (manager.variantId !== state.variant) {
      manager.newGame("chess", state.variant);
      selectedVariantId = state.variant;
    }
  }
  updateGameHeader();

  try {
    manager.game.restore(state.game);
    gameHasStarted = true;
    clearLocalHandoff();
    renderPlayers();
    selected = null;
    pendingPromotion = null;
    promotionModal.classList.remove("open");
    render();
  } catch (error) {
    console.warn("Could not apply online game state:", error);
  }
}

function applyRemoteMove(payload) {
  if (!payload?.from || !payload?.to) return false;

  const expectedPly = manager.game.sanHistory.length + 1;
  if (Number.isInteger(payload.ply) && payload.ply !== expectedPly) {
    console.warn("Online chess: move is out of sequence", {
      expectedPly,
      receivedPly: payload.ply,
      payload
    });
    if (ONLINE_HOST_TOKEN) publishOnlineState();
    return false;
  }

  const promotion = payload.promotion || "q";
  const ok = manager.game.makeMove(
    { from: { ...payload.from }, to: { ...payload.to } },
    promotion
  );

  if (!ok) {
    console.warn("Online chess: remote move was illegal in local state", payload);
    if (ONLINE_HOST_TOKEN) publishOnlineState();
    return false;
  }

  selected = null;
  pendingPromotion = null;
  promotionModal.classList.remove("open");
  setOnlineStatus(`Connected • received move ${manager.game.sanHistory.length}`);
  console.debug("Online chess: applied remote move", payload);

  // The host is authoritative. After applying a guest move, immediately
  // publish the resulting state so both sides converge on the same board.
  if (ONLINE_HOST_TOKEN) publishOnlineState();
  publishOnlineResultIfOver();
  render();
  return true;
}

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
    setOnlineStatus("Connected • registering player…");
    const profile = localProfileForOnlineIdentity();

    onlineSocket.send(JSON.stringify({
      type: "player:identify",
      profileId: profile.id || "",
      name: profile.name || "Player 1",
      avatar: profile.avatar || "♟",
      spectator: Boolean((onlineConfig?.spectators || []).includes(ONLINE_CLIENT_ID))
    }));

    // Do not publish a random local Chess960 position before the host starts.
    if (ONLINE_HOST_TOKEN && gameHasStarted) setTimeout(() => publishOnlineState(), 100);
  });

  onlineSocket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(event.data); }
    catch { return; }

    if (message.type === "room:hello") {
      onlineParticipants = message.room?.participants || [];
      onlineMatchId = message.room?.matchId || onlineMatchId || "";
      if (!message.room?.matchId || !message.room?.started) onlineResultSent = false;

      // The room is authoritative. Replace stale session configuration with
      // whatever the room currently has, including a pre-game config without players.
      onlineConfig = message.room?.config || null;
      if (onlineConfig?.players?.length) gamePlayers = parseOnlinePlayers(onlineConfig);
      if (onlineConfig?.variant && GameRegistry.chess.variants[onlineConfig.variant]) {
        selectedVariantId = onlineConfig.variant;
        if (!message.room?.started) manager.newGame("chess", selectedVariantId);
      }
      try {
        if (onlineConfig) sessionStorage.setItem("gameLibraryOnlineConfig", JSON.stringify(onlineConfig));
        else sessionStorage.removeItem("gameLibraryOnlineConfig");
      } catch {}

      refreshOnlinePlayerNames();
      if (message.room?.started) {
        gameHasStarted = true;
        renderPlayers();
        if (message.room?.state) {
          applyRemoteState(message.room.state);
        } else {
          // The host may have launched the match from index.html before this
          // chess page connected. Create the local initial position now; for
          // Chess960 the host immediately publishes its authoritative random
          // position, which replaces this temporary one.
          manager.newGame("chess", selectedVariantId);
          updateGameHeader();
          selected = null;
          pendingPromotion = null;
          render();
          if (ONLINE_HOST_TOKEN) setTimeout(() => publishOnlineState(), 75);
        }
      } else {
        gameHasStarted = false;
      }
      renderPlayers();
      return;
    }

    if (message.type === "room:participants") {
      onlineParticipants = Array.isArray(message.participants) ? message.participants : [];
      refreshOnlinePlayerNames();
      renderPlayers();
      if (gameHasStarted) publishOnlineState();
      return;
    }

    if (message.type === "room:config") {
      onlineConfig = message.config || onlineConfig;
      gamePlayers = onlineConfig?.players?.length ? parseOnlinePlayers(onlineConfig) : gamePlayers;
      if (onlineConfig?.variant && GameRegistry.chess.variants[onlineConfig.variant]) {
        selectedVariantId = onlineConfig.variant;
        if (!gameHasStarted) manager.newGame("chess", selectedVariantId);
      }
      refreshOnlinePlayerNames();
      updateGameHeader();
      renderPlayers();
      render();
      return;
    }

    if (message.type === "game:start") {
      onlineMatchId = message.matchId || onlineMatchId || "";
      onlineResultSent = false;
      onlineConfig = message.config || onlineConfig;
      gameHasStarted = true;
      clearLocalHandoff();
      if (onlineConfig?.players?.length) {
        gamePlayers = parseOnlinePlayers(onlineConfig);
                try {
          sessionStorage.setItem("gameLibraryOnlineConfig", JSON.stringify(onlineConfig));
        } catch {}
      }
      if (onlineConfig?.variant && GameRegistry.chess.variants[onlineConfig.variant]) {
        selectedVariantId = onlineConfig.variant;
      }
      refreshOnlinePlayerNames();
      updateGameHeader();
      renderPlayers();
      if (message.state) {
        applyRemoteState(message.state);
      } else {
        manager.newGame("chess", selectedVariantId);
        selected = null;
        pendingPromotion = null;
        render();
        if (ONLINE_HOST_TOKEN) setTimeout(() => publishOnlineState(), 75);
      }
      return;
    }

    if (message.type === "game:state") {
      applyRemoteState(message.state);
      return;
    }

    if (message.type === "game:back") {
      window.location.href = "../index.html";
      return;
    }

    if (message.type === "player:spectator") {
      onlineParticipants = Array.isArray(message.participants) ? message.participants : onlineParticipants;
      refreshOnlinePlayerNames();
      renderPlayers();
      return;
    }

    if (message.type === "game:result") {
      return;
    }

    if (message.type === "game:move") {
      // Ignore our own echoed move. Compare role as well as ID so a host
      // can still receive a guest move if both test windows share an ID.
      if (
        message.sender?.clientId === ONLINE_CLIENT_ID &&
        message.sender?.role === (ONLINE_HOST_TOKEN ? "host" : "player")
      ) {
        return;
      }

      applyRemoteMove(message.payload);
      return;
    }

    if (message.type === "error") {
      setOnlineStatus(`Server error: ${message.message || message.code || "Unknown error"}`, true);
      console.warn("Online chess server error:", message);
      return;
    }
  });

  onlineSocket.addEventListener("close", () => {
    onlineConnected = false;
  });

  onlineSocket.addEventListener("error", error => {
    console.warn("Online chess connection error:", error);
    onlineConnected = false;
  });
}

function makeComputerMove() {
  const game = manager.game;
  if (game.gameStatus().over || !isComputerTurn()) return false;

  const current = currentPlayerEntry(game);
  const difficulty =
    current?.difficulty ||
    computerDifficulties[current?.id] ||
    computerDifficulty;

  // When Fog of War is enabled, give the AI only the same information its
  // controlled side would have. Spectators still receive the full board.
  const fogColor = fogColorForSeat(current?.seat, game);
  const aiFog = FOG_OF_WAR && fogColor
    ? {
        enabled: true,
        color: fogColor,
        visible: (r, c) => squareVisibleToColor(r, c, fogColor, game),
      }
    : null;

  const move = ChessAI.findBestMove(game, difficulty, aiFog);
  if (!move) return false;

  const promotion = move.promotion ? "q" : "q";
  const ok = game.makeMove(move, promotion);
  if (ok && ONLINE_MODE) {
    publishOnlineMove(move, promotion);
    publishOnlineState();
    publishOnlineResultIfOver();
  }
  return ok;
}
function scheduleComputerMove() {
  if (!gameHasStarted || localHandoffActive || computerMovePending || !isComputerTurn() || manager.game.gameStatus().over) return;
  computerMovePending = true;
  clearTimeout(computerMoveTimer);
  computerMoveTimer = setTimeout(() => {
    computerMovePending = false;
    makeComputerMove();
    selected = null;
    render();
    beginLocalHandoff();
  }, 350);
}

const boardEl = document.getElementById("board");
const boardFrameEl = document.getElementById("boardFrame");
const rowLabelsEl = document.getElementById("rowLabels");
const colLabelsEl = document.getElementById("colLabels");
const statusEl = document.getElementById("status");
const moveListEl = document.getElementById("moveList");
const capturedPanel = document.getElementById("capturedPanel");
const promotionModal = document.getElementById("promotionModal");
const promotionOptions = document.getElementById("promotionOptions");

function updateGameHeader() {
  document.getElementById("pageTitle").textContent = "Chess";
  document.getElementById("gameName").textContent = "Chess";
  document.getElementById("variantName").textContent = GameRegistry.chess.variants[manager.variantId]?.name || manager.variantId;
}
updateGameHeader();

function render() {
  const g = manager.game, s = g.gameStatus(), size = g.size;
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  boardEl.classList.toggle("four-player", size === 14);
  boardFrameEl.classList.toggle("four-player", size === 14);
  renderCoordinates(size);
  const legal = selected ? g.legalMovesFrom(selected.r, selected.c) : [];
  const king = s.check ? g.findKing(g.turn) : null;

  for (let r = 0; r < size; r++) for (let c = 0; c < cols; c++) {
    const sq = document.createElement("button");
    sq.className = "square " + ((r + c) % 2 ? "dark" : "light");
    if (size === 14 && !playable4(r, c)) sq.classList.add("unplayable");
    if (selected?.r === r && selected?.c === c) sq.classList.add("selected");
    const legalDestination = !!legal.find((m) => m.to.r === r && m.to.c === c);
    const visible = squareVisibleToViewer(r, c, g) || Boolean(selected && legalDestination);
    if (g.lastMove && visible && ((g.lastMove.from?.r === r && g.lastMove.from?.c === c) || (g.lastMove.to?.r === r && g.lastMove.to?.c === c))) sq.classList.add("last-move");
    if (king && visible && king.r === r && king.c === c) sq.classList.add("in-check");

    const isLegalMove = visible && legalDestination;
    if (isLegalMove) {
const mark = document.createElement("span");
mark.className = g.board[r][c] ? "legal-capture" : "legal-dot";
sq.appendChild(mark);
    }
    const p = g.board[r][c];
    if (p && visible) {
const pe = document.createElement("span");
pe.className = "piece " + p.color;
pe.textContent = size === 14 ? FOUR_PIECES[p.color][p.type] : size === 12 ? THREE_PIECES[p.color][p.type] : PIECES[p.color][p.type];
sq.appendChild(pe);
    }
    if (!visible) {
      const fog = document.createElement("span");
      fog.className = "fog-mask";
      sq.appendChild(fog);
    }
    sq.onclick = () => clickSquare(r, c);
    boardEl.appendChild(sq);
  }
  statusEl.textContent = `${playerInfo(currentPlayerIndex(g)).name}: ${s.text}`;
  renderMoves();
  renderCaptured();
  document.getElementById("undoBtn").disabled = !g.history.length;
}


function renderCoordinates(size) {
  const cols = size === 12 ? 8 : size;
  const files = "abcdefghijklmnopqrstuvwxyz".slice(0, cols).split("");
  const ranks = Array.from({ length: size }, (_, i) => size - i);

  rowLabelsEl.innerHTML = ranks
    .map((rank) => `<span>${rank}</span>`)
    .join("");

  colLabelsEl.innerHTML = files
    .map((file) => `<span>${file}</span>`)
    .join("");
}

function clickSquare(r, c) {
  const g = manager.game;
  if (!gameHasStarted || g.gameStatus().over || isComputerTurn() || !canLocalPlayerMove()) return;
  const p = g.board[r]?.[c];
  if (!selected) {
    if (p && p.color === g.turn) { selected = { r, c }; render(); }
    return;
  }
  if (p && p.color === g.turn && !(g.is960 && g.board[selected.r][selected.c]?.type === "k" && p.type === "r")) {
    selected = { r, c };
    render();
    return;
  }
  const m = g.legalMovesFrom(selected.r, selected.c).find((x) => x.to.r === r && x.to.c === c);
  if (!m) { selected = null; render(); return; }
  if (m.promotion) { pendingPromotion = m; openPromotion(g.board[selected.r][selected.c].color); return; }
  const ok = g.makeMove(m);
  if (ok && ONLINE_MODE) {
    publishOnlineMove(m, "q");
    publishOnlineState();
    publishOnlineResultIfOver();
  }
  selected = null;
  render();
  beginLocalHandoff();
}

function openPromotion(color) {
  promotionOptions.innerHTML = "";
  for (const t of ["q", "r", "b", "n"]) {
    const b = document.createElement("button");
    b.textContent = (manager.game.size === 14 ? FOUR_PIECES[color] : manager.game.size === 12 ? THREE_PIECES[color] : PIECES[color])[t];
    b.onclick = () => {
      const move = pendingPromotion;
      const ok = manager.game.makeMove(move, t);
      if (ok && ONLINE_MODE) {
        publishOnlineMove(move, t);
        publishOnlineState();
        publishOnlineResultIfOver();
      }
      pendingPromotion = null;
      promotionModal.classList.remove("open");
      selected = null;
      render();
      beginLocalHandoff();
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
  if (!g.captured || !g.captured.length) { capturedPanel.textContent = "None"; return; }
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
x.className = "piece " + p.color;
x.textContent = g.size === 14 ? FOUR_PIECES[p.color][p.type] : g.size === 12 ? THREE_PIECES[p.color][p.type] : PIECES[p.color][p.type];
list.appendChild(x);
    }
    box.appendChild(list); capturedPanel.appendChild(box);
  }
}

document.getElementById("newGameBtn").onclick = goBackToLibrary;
document.getElementById("clearBtn").onclick = () => {
  if (!gameHasStarted) return;
  clearLocalHandoff();
  clearTimeout(computerMoveTimer); computerMovePending = false;
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  manager.newGame("chess", manager.variantId);
  selected = null; pendingPromotion = null; promotionModal.classList.remove("open");
  if (ONLINE_MODE) publishOnlineState();
  render();
};
document.getElementById("undoBtn").onclick = () => {
  if (!gameHasStarted) return;
  clearLocalHandoff();
  clearTimeout(computerMoveTimer); computerMovePending = false;
  if (ONLINE_MODE && !ONLINE_HOST_TOKEN) return;
  if (manager.game.undo()) {
    if (ONLINE_MODE) publishOnlineState();
    selected = null;
    render();
  }
};

if (onlineConfig?.players?.length) {
  gamePlayers = parseOnlinePlayers(onlineConfig);
} else {
  const active = localProfileForOnlineIdentity();
  gamePlayers = [
    { seat: "white", type: "human", controllerClientId: ONLINE_MODE ? ONLINE_CLIENT_ID : "", profileId: active.id || "", name: active.name || "Player 1", avatar: active.avatar || "♟", playerType: ONLINE_MODE ? "Online player" : "Local player", id: ONLINE_MODE ? `online:${ONLINE_CLIENT_ID}` : `local:${active.id || "0"}` },
    { seat: "black", type: "computer", controllerClientId: ONLINE_MODE ? (onlineConfig?.hostClientId || "") : "", name: "Computer", avatar: "🤖", difficulty: computerDifficulty, id: "computer:0" }
  ];
}
if (onlineConfig?.variant && GameRegistry.chess.variants[onlineConfig.variant]) {
  selectedVariantId = onlineConfig.variant;
  manager.newGame("chess", selectedVariantId);
}
gameHasStarted = true;
refreshOnlinePlayerNames();
renderPlayers();
connectOnlineGame();

render();
