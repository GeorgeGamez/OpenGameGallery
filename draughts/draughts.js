"use strict";

const params = new URLSearchParams(location.search);
const ONLINE_MODE = params.get("online") === "1";
const ONLINE_SERVER = params.get("onlineServer") || "";
const ONLINE_CODE = params.get("onlineCode") || "";
const ONLINE_CLIENT_ID = params.get("onlineClientId") || sessionStorage.getItem("gameLibraryOnlineClientId") || ("client_" + Math.random().toString(36).slice(2, 12));
const ONLINE_HOST_TOKEN = params.get("hostToken") || sessionStorage.getItem("gameLibraryOnlineHostToken") || "";

let onlineSocket = null;
let onlineConnected = false;
let onlineConfig = null;
let onlineParticipants = [];
let onlineMatchId = "";
let onlineResultSent = false;
let localScoreRecorded = false;

let selectedVariantId = params.get("variant") || "international";
let mandatoryCapture = params.get("mandatoryCapture") !== "false";
try {
  const raw = params.get("onlineConfig") || sessionStorage.getItem("gameLibraryOnlineConfig") || "";
  if (raw) onlineConfig = JSON.parse(raw);
} catch (error) {
  console.warn("Could not read online configuration:", error);
}
if (onlineConfig?.variant) selectedVariantId = onlineConfig.variant;
if (typeof onlineConfig?.options?.mandatoryCapture === "boolean") mandatoryCapture = onlineConfig.options.mandatoryCapture;

const profiles = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
})();

function cloneBoard(board) {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)));
}
function inside(r, c, n) { return r >= 0 && r < n && c >= 0 && c < n; }
function opposite(color) { return color === "w" ? "b" : "w"; }
function sameSquare(a, b) { return a?.r === b?.r && a?.c === b?.c; }

class DraughtsGame {
  constructor(size = 10, mandatoryCapture = true, variant = null) {
    this.variant = variant || (size === 12 ? "canadian" : size === 10 ? "international" : "american");
    this.size = this.variant === "canadian" ? 12 : this.variant === "international" ? 10 : 8;
    this.mandatoryCapture = mandatoryCapture;
    this.flyingKings = ["international", "russian", "canadian"].includes(this.variant);
    this.menCaptureBackward = ["international", "russian", "canadian"].includes(this.variant);
    this.majorityCapture = ["international", "canadian"].includes(this.variant);
    this.delayedCaptureRemoval = ["international", "canadian"].includes(this.variant);
    this.midCapturePromotion = this.variant === "russian";
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(null));
    const rowsPerSide = this.variant === "canadian" ? 5 : this.size === 10 ? 4 : 3;
    for (let r = 0; r < rowsPerSide; r++) {
      for (let c = 0; c < this.size; c++) {
        if ((r + c) % 2 === 1) this.board[r][c] = { type: "m", color: "b" };
      }
    }
    for (let r = this.size - rowsPerSide; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if ((r + c) % 2 === 1) this.board[r][c] = { type: "m", color: "w" };
      }
    }
    this.turn = "w";
    this.history = [];
    this.sanHistory = [];
    this.captured = [];
    this.lastMove = null;
    this.captureChain = null;
    this.turnSnapshot = null;
  }

  clone() {
    return {
      board: cloneBoard(this.board),
      turn: this.turn,
      san: [...this.sanHistory],
      captured: this.captured.map((p) => ({ ...p })),
      lastMove: this.lastMove ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } } : null,
      captureChain: this.captureChain ? {
        from: { ...this.captureChain.from },
        current: { ...this.captureChain.current },
        capturedSquares: [...(this.captureChain.capturedSquares || [])],
      } : null,
      turnSnapshot: null,
    };
  }

  restore(s) {
    this.board = cloneBoard(s.board);
    this.turn = s.turn;
    this.sanHistory = [...(s.san || [])];
    this.captured = (s.captured || []).map((p) => ({ ...p }));
    this.lastMove = s.lastMove ? { from: { ...s.lastMove.from }, to: { ...s.lastMove.to } } : null;
    this.captureChain = s.captureChain ? {
      from: { ...s.captureChain.from },
      current: { ...s.captureChain.current },
      capturedSquares: [...(s.captureChain.capturedSquares || [])],
    } : null;
    this.turnSnapshot = null;
  }

  undo() {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  }

  squareKey(r, c) { return `${r},${c}`; }

  stepDirections(piece) {
    if (piece.type === "K") return [[1,1],[1,-1],[-1,1],[-1,-1]];
    return piece.color === "w" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
  }

  captureDirections(piece) {
    if (piece.type === "K" || this.menCaptureBackward) return [[1,1],[1,-1],[-1,1],[-1,-1]];
    return piece.color === "w" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
  }

  simpleMovesFor(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn || this.captureChain) return [];
    const out = [];
    if (p.type === "K" && this.flyingKings) {
      for (const [dr, dc] of this.stepDirections(p)) {
        let tr = r + dr, tc = c + dc;
        while (inside(tr, tc, this.size) && !this.board[tr][tc]) {
          out.push({ from: { r, c }, to: { r: tr, c: tc } });
          tr += dr; tc += dc;
        }
      }
      return out;
    }
    for (const [dr, dc] of this.stepDirections(p)) {
      const tr = r + dr, tc = c + dc;
      if (inside(tr, tc, this.size) && !this.board[tr][tc]) {
        out.push({ from: { r, c }, to: { r: tr, c: tc } });
      }
    }
    return out;
  }

  captureMovesFor(r, c, board = this.board, turnColor = this.turn, capturedSquares = new Set()) {
    const p = board[r]?.[c];
    if (!p || p.color !== turnColor) return [];
    const out = [];
    const dirs = this.captureDirections(p);

    if (p.type === "K" && this.flyingKings) {
      for (const [dr, dc] of dirs) {
        let tr = r + dr, tc = c + dc;
        while (inside(tr, tc, this.size) && !board[tr][tc]) {
          tr += dr; tc += dc;
        }
        if (!inside(tr, tc, this.size)) continue;
        const key = this.squareKey(tr, tc);
        const jumped = board[tr][tc];
        if (!jumped || jumped.color === p.color || capturedSquares.has(key)) continue;
        let lr = tr + dr, lc = tc + dc;
        while (inside(lr, lc, this.size) && !board[lr][lc]) {
          out.push({ from: { r, c }, to: { r: lr, c: lc }, jump: { r: tr, c: tc } });
          lr += dr; lc += dc;
        }
      }
      return out;
    }

    for (const [dr, dc] of dirs) {
      const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
      if (!inside(tr, tc, this.size) || !inside(mr, mc, this.size)) continue;
      const jumpKey = this.squareKey(mr, mc);
      const jumped = board[mr][mc];
      if (jumped && jumped.color !== p.color && !capturedSquares.has(jumpKey) && !board[tr][tc]) {
        out.push({ from: { r, c }, to: { r: tr, c: tc }, jump: { r: mr, c: mc } });
      }
    }
    return out;
  }

  simulateCaptureState(board, r, c, move, capturedSquares) {
    const next = cloneBoard(board);
    const p = next[r][c];
    next[r][c] = null;
    const jumpKey = this.squareKey(move.jump.r, move.jump.c);
    if (!this.delayedCaptureRemoval) next[move.jump.r][move.jump.c] = null;
    const promoted = p.type === "m" && this.promotionRow(p.color, move.to.r);
    const nextPiece = this.midCapturePromotion && promoted ? { ...p, type: "K" } : { ...p };
    next[move.to.r][move.to.c] = nextPiece;
    const nextCaptured = new Set(capturedSquares);
    nextCaptured.add(jumpKey);
    return { board: next, r: move.to.r, c: move.to.c, piece: nextPiece, capturedSquares: nextCaptured };
  }

  maxCaptureCountFromState(board, r, c, piece, capturedSquares = new Set()) {
    const moves = this.captureMovesFor(r, c, board, piece.color, capturedSquares);
    let best = 0;
    for (const move of moves) {
      const state = this.simulateCaptureState(board, r, c, move, capturedSquares);
      best = Math.max(best, 1 + this.maxCaptureCountFromState(state.board, state.r, state.c, state.piece, state.capturedSquares));
    }
    return best;
  }

  maxCaptureAfterMove(move, capturedSquares = new Set()) {
    const state = this.simulateCaptureState(this.board, move.from.r, move.from.c, move, capturedSquares);
    return 1 + this.maxCaptureCountFromState(state.board, state.r, state.c, state.piece, state.capturedSquares);
  }

  hasAnyCaptures(color = this.turn) {
    const capturedSquares = new Set(this.captureChain?.capturedSquares || []);
    for (let r = 0; r < this.size; r++) for (let c = 0; c < this.size; c++) {
      if (this.board[r][c]?.color === color && this.captureMovesFor(r, c, this.board, color, capturedSquares).length) return true;
    }
    return false;
  }

  bestCaptureMoves(moves, capturedSquares = new Set()) {
    if (!this.majorityCapture || !moves.length) return moves;
    let best = -1;
    const result = [];
    for (const move of moves) {
      const count = this.maxCaptureAfterMove(move, capturedSquares);
      if (count > best) {
        best = count;
        result.length = 0;
        result.push(move);
      } else if (count === best) {
        result.push(move);
      }
    }
    return result;
  }

  captureMovesForCurrent(r, c) {
    const capturedSquares = new Set(this.captureChain?.capturedSquares || []);
    const moves = this.captureMovesFor(r, c, this.board, this.turn, capturedSquares);
    if (!this.majorityCapture || !moves.length) return moves;
    return this.bestCaptureMoves(moves, capturedSquares);
  }

  allLegalMoves() {
    if (this.captureChain) return this.captureMovesForCurrent(this.captureChain.current.r, this.captureChain.current.c);
    const captures = [];
    for (let r = 0; r < this.size; r++) for (let c = 0; c < this.size; c++) {
      if (this.board[r][c]?.color !== this.turn) continue;
      captures.push(...this.captureMovesFor(r, c));
    }
    if (this.mandatoryCapture && captures.length) return this.bestCaptureMoves(captures);

    const moves = [...captures];
    for (let r = 0; r < this.size; r++) for (let c = 0; c < this.size; c++) {
      if (this.board[r][c]?.color !== this.turn) continue;
      moves.push(...this.simpleMovesFor(r, c));
    }
    return moves;
  }

  legalMovesFrom(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    if (this.captureChain && !sameSquare(this.captureChain.current, { r, c })) return [];
    const captures = this.captureMovesForCurrent(r, c);
    if (this.captureChain || (this.mandatoryCapture && this.hasAnyCaptures(this.turn))) return captures;
    return [...captures, ...this.simpleMovesFor(r, c)];
  }

  promotionRow(color, r) { return color === "w" ? r === 0 : r === this.size - 1; }

  makeMove(move) {
    const legal = this.legalMovesFrom(move.from.r, move.from.c).find((m) => sameSquare(m.to, move.to));
    if (!legal) return false;

    if (!this.turnSnapshot) this.turnSnapshot = this.clone();
    const p = this.board[legal.from.r][legal.from.c];
    this.board[legal.from.r][legal.from.c] = null;
    let capturedPiece = null;
    if (legal.jump) {
      capturedPiece = this.board[legal.jump.r][legal.jump.c];
      if (this.delayedCaptureRemoval) {
        // International/Canadian keep the captured man on the board until the entire sequence ends.
        // It is tracked in captureChain so it cannot be captured again in the same sequence.
      } else {
        this.board[legal.jump.r][legal.jump.c] = null;
      }
      if (capturedPiece) this.captured.push({ ...capturedPiece });
    }

    const reachesPromotion = p.type === "m" && this.promotionRow(p.color, legal.to.r);
    const kingNow = p.type === "K" || (this.midCapturePromotion && reachesPromotion);
    this.board[legal.to.r][legal.to.c] = { ...p, type: kingNow ? "K" : "m" };
    this.lastMove = { from: { ...legal.from }, to: { ...legal.to } };

    const actor = this.turn === "w" ? "White" : "Black";
    const notation = `${actor}: ${squareName(legal.from, this.size)}-${squareName(legal.to, this.size)}${legal.jump ? "x" : ""}${kingNow && p.type === "m" ? "K" : ""}`;
    this.sanHistory.push(notation);

    if (legal.jump) {
      const chainCaptured = [...new Set([...(this.captureChain?.capturedSquares || []), this.squareKey(legal.jump.r, legal.jump.c)])];
      const continuation = this.captureMovesFor(legal.to.r, legal.to.c, this.board, this.turn, new Set(chainCaptured));
      if (continuation.length) {
        this.captureChain = {
          from: { ...(this.captureChain?.from || legal.from) },
          current: { ...legal.to },
          capturedSquares: chainCaptured,
        };
        return true;
      }

      // Promotion is delayed until the capture sequence ends in International/Canadian/American.
      if (!this.midCapturePromotion && reachesPromotion && this.board[legal.to.r][legal.to.c]?.type === "m") {
        this.board[legal.to.r][legal.to.c].type = "K";
      }

      if (this.delayedCaptureRemoval) {
        for (const key of chainCaptured) {
          const [rr, cc] = key.split(",").map(Number);
          if (this.board[rr][cc] && this.board[rr][cc].color !== this.turn) this.board[rr][cc] = null;
        }
      }
    } else if (reachesPromotion) {
      this.board[legal.to.r][legal.to.c].type = "K";
    }

    this.history.push(this.turnSnapshot);
    this.turnSnapshot = null;
    this.captureChain = null;
    this.turn = opposite(this.turn);
    return true;
  }

  gameStatus() {
    let white = 0, black = 0;
    for (const row of this.board) for (const p of row) {
      if (p?.color === "w") white++;
      if (p?.color === "b") black++;
    }
    if (!white) return { over: true, winner: "b", text: "Game Over — Black wins!" };
    if (!black) return { over: true, winner: "w", text: "Game Over — White wins!" };
    if (this.captureChain) return { over: false, text: `${this.turn === "w" ? "White" : "Black"} must continue capturing` };
    const moves = this.allLegalMoves();
    if (!moves.length) return { over: true, winner: opposite(this.turn), text: `Game Over — ${opposite(this.turn) === "w" ? "White" : "Black"} wins!` };
    return { over: false, text: `${this.turn === "w" ? "White" : "Black"} to move` };
  }
}
if (typeof window !== "undefined") window.DraughtsGame = DraughtsGame;

function squareName(s,n) { return String.fromCharCode(97+s.c)+(n-s.r); }

function draughtsSizeForVariant(variant) {
  return variant === "canadian" ? 12 : variant === "international" ? 10 : 8;
}
function draughtsVariantLabel(variant) {
  return ({ international: "International Draughts", american: "American Checkers", russian: "Russian Draughts", canadian: "Canadian Draughts" })[variant] || "Draughts";
}
function createGame() { return new DraughtsGame(draughtsSizeForVariant(selectedVariantId), mandatoryCapture, selectedVariantId); }
let game=createGame();
let selected=null;
let legalTargets=[];
let computerTimer=null;
let computerPending=false;

function activePlayers() {
  if (onlineConfig?.players?.length) return onlineConfig.players;
  return [
    {seat:"white",type:"human",profileId:profiles[0]?.id||"",name:profiles[0]?.name||"Player 1",avatar:profiles[0]?.avatar||"♟"},
    {seat:"black",type:"computer",name:"Computer",avatar:"🤖",difficulty:"normal",id:"computer:0"}
  ];
}
let gamePlayers=activePlayers();

function playerForColor(color) { return gamePlayers.find((p)=>p.seat=== (color === "w" ? "white" : "black")) || null; }
function localPartyProfiles() {
  try {
    const ids=JSON.parse(sessionStorage.getItem("gameLibraryParty")||"[]");
    if(Array.isArray(ids)) {
      const party=ids.map((id)=>profiles.find((p)=>p.id===id)).filter(Boolean);
      if(party.length) return party;
    }
  } catch {}
  return profiles;
}
function localProfileForIdentity() { return localPartyProfiles()[0] || {id:"",name:"Player 1",avatar:"♟"}; }
function recordLocalWinIfOver() {
  if(ONLINE_MODE || localScoreRecorded) return;
  const status=game.gameStatus(); if(!status.over) return;
  const winner=playerForColor(status.winner);
  const profileId=winner?.profileId||"";
  if(!profileId) return;
  let scores={}; try{scores=JSON.parse(localStorage.getItem("gameLibraryLocalScores")||"{}");}catch{}
  scores[profileId]=Math.max(0,Number(scores[profileId])||0)+1;
  localStorage.setItem("gameLibraryLocalScores",JSON.stringify(scores));
  localScoreRecorded=true;
}
function humanControlsTurn() {
  const p=playerForColor(game.turn);
  if(!p || p.type !== "human") return false;
  if(!ONLINE_MODE) return true;
  return p.controllerClientId === ONLINE_CLIENT_ID;
}
function isComputerTurn() { return playerForColor(game.turn)?.type === "computer" && (!ONLINE_MODE || (onlineConnected && Boolean(ONLINE_HOST_TOKEN))); }
function boardFlipped() { return false; }

function render() {
  recordLocalWinIfOver();
  const pageTitle = document.getElementById("pageTitle");
  const subtitle = document.getElementById("subtitle");
  const gameName = document.getElementById("gameName");
  const variantName = document.getElementById("variantName");
  const status = game.gameStatus();

  pageTitle.textContent = "Draughts";
  subtitle.textContent = "Game Player";
  gameName.textContent = "Draughts";
  variantName.textContent = draughtsVariantLabel(selectedVariantId);
  document.title = `${variantName.textContent} — Game Library`;
  document.getElementById("status").textContent = status.text;

  const list = document.getElementById("playerList");
  list.innerHTML = "";
  for (const p of gamePlayers) {
    const color = p.seat === "white" ? "White" : "Black";
    const colorCode = p.seat === "white" ? "w" : "b";
    const row = document.createElement("div");
    row.className = "player-row" + (game.turn === colorCode ? " current" : "");

    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    avatar.textContent = p.avatar || "♟";

    const details = document.createElement("div");
    details.className = "player-details";
    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = p.name || color;
    const type = document.createElement("div");
    type.className = "player-type";
    type.textContent = `${p.type === "computer" ? `Computer • ${p.difficulty || "normal"}` : p.playerType || "Human"} • ${color}`;
    details.append(name, type);
    row.append(avatar, details);
    list.appendChild(row);
  }

  const frame = document.getElementById("boardFrame");
  frame.classList.toggle("eight", game.size === 8);
  frame.classList.toggle("twelve", game.size === 12);

  const rowLabels = document.getElementById("rowLabels");
  const colLabels = document.getElementById("colLabels");
  rowLabels.innerHTML = "";
  colLabels.innerHTML = "";
  for (let r = 0; r < game.size; r++) {
    const label = document.createElement("span");
    label.textContent = String(game.size - r);
    rowLabels.appendChild(label);
  }
  for (let c = 0; c < game.size; c++) {
    const label = document.createElement("span");
    label.textContent = String.fromCharCode(97 + c);
    colLabels.appendChild(label);
  }

  const board = document.getElementById("board");
  board.style.gridTemplateColumns = `repeat(${game.size}, minmax(0, 1fr))`;
  board.style.gridTemplateRows = `repeat(${game.size}, minmax(0, 1fr))`;
  board.innerHTML = "";

  for (let r = 0; r < game.size; r++) {
    for (let c = 0; c < game.size; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "square " + (((r + c) % 2 === 1) ? "dark" : "light");
      cell.dataset.r = r;
      cell.dataset.c = c;

      const piece = game.board[r][c];
      if (piece) {
        const el = document.createElement("span");
        el.className = `piece ${piece.color}` + (piece.type === "K" ? " king" : "");
        el.textContent = piece.type === "K" ? "♛" : "●";
        cell.appendChild(el);
      }

      if (selected && sameSquare(selected, { r, c })) cell.classList.add("selected");
      const target = legalTargets.some((m) => sameSquare(m.to, { r, c }));
      if (target) {
        cell.classList.add("target");
        const isCapture = legalTargets.some((m) => sameSquare(m.to, { r, c }) && Boolean(m.jump));
        const marker = document.createElement("span");
        marker.className = isCapture ? "legal-capture" : "legal-dot";
        cell.appendChild(marker);
      }
      if (game.lastMove && (sameSquare(game.lastMove.from, { r, c }) || sameSquare(game.lastMove.to, { r, c }))) {
        cell.classList.add("last-move");
      }
      cell.onclick = () => handleCell(r, c);
      board.appendChild(cell);
    }
  }

  const moveList = document.getElementById("moveList");
  const history = game.sanHistory || [];
  moveList.innerHTML = history.length
    ? history.map((move, i) => `<div class="move-row"><div class="move-number">${i + 1}.</div><div class="move" style="grid-column:2/-1">${escapeHtml(move)}</div></div>`).join("")
    : '<div class="note" style="padding:10px">No moves yet.</div>';

  const capturedPanel = document.getElementById("capturedPanel");
  const captured = game.captured || [];
  const capturedWhite = captured.filter((p) => p.color === "w");
  const capturedBlack = captured.filter((p) => p.color === "b");
  capturedPanel.innerHTML = "";
  for (const [label, pieces, cls] of [["White pieces captured", capturedWhite, "w"], ["Black pieces captured", capturedBlack, "b"]]) {
    const group = document.createElement("div");
    group.className = "captured-group";
    const heading = document.createElement("div");
    heading.className = "captured-label";
    heading.textContent = label;
    const icons = document.createElement("div");
    icons.className = "captured";
    if (pieces.length) {
      for (const piece of pieces) {
        const el = document.createElement("span");
        el.className = `captured-piece ${cls}`;
        el.textContent = piece.type === "K" ? "♛" : "●";
        icons.appendChild(el);
      }
    } else {
      icons.innerHTML = '<span class="note">None</span>';
    }
    group.append(heading, icons);
    capturedPanel.appendChild(group);
  }

  scheduleComputerMove();
  if (ONLINE_HOST_TOKEN && onlineConnected) publishOnlineState();
}

function handleCell(r,c) {
  if(game.gameStatus().over || computerPending || !humanControlsTurn()) return;
  const piece=game.board[r][c];
  if(selected) {
    const move=legalTargets.find((m)=>sameSquare(m.to,{r,c}));
    if(move) {
      if(applyMove(move)) { selected=game.captureChain ? {...game.captureChain.current} : null; legalTargets=selected?game.legalMovesFrom(selected.r,selected.c):[]; render(); }
      return;
    }
  }
  if(piece?.color===game.turn) {
    selected={r,c}; legalTargets=game.legalMovesFrom(r,c); render();
  }
}

function applyMove(move, fromRemote=false) {
  const ok=game.makeMove(move);
  if(!ok) return false;
  if(ONLINE_MODE && !fromRemote) publishOnlineMove(move);
  const status=game.gameStatus();
  if(status.over) publishOnlineResult();
  recordLocalWinIfOver();
  return true;
}

function randomComputerMove() {
  const moves=window.DraughtsAI?.chooseMove ? window.DraughtsAI.chooseMove(game, playerForColor(game.turn)?.difficulty||"normal") : game.allLegalMoves()[0];
  if(!moves) return false;
  return applyMove(moves);
}
function scheduleComputerMove() {
  clearTimeout(computerTimer);
  if(computerPending || !isComputerTurn() || game.gameStatus().over) return;
  computerPending=true;
  computerTimer=setTimeout(()=>{
    computerPending=false;
    const move=randomComputerMove();
    selected=game.captureChain?{...game.captureChain.current}:null;
    legalTargets=selected?game.legalMovesFrom(selected.r,selected.c):[];
    render();
  },380);
}

function onlineWsUrl() {
  const base=ONLINE_SERVER.replace(/\/$/,"").replace(/^http:/,"ws:").replace(/^https:/,"wss:");
  return `${base}/ws/${encodeURIComponent(ONLINE_CODE)}?clientId=${encodeURIComponent(ONLINE_CLIENT_ID)}&role=${ONLINE_HOST_TOKEN?"host":"player"}`;
}
function setOnlineStatus(t,error=false){ const el=document.getElementById("onlineBar"); el.textContent=t; el.className=error?"online-bar error":"online-bar"; }
function publishOnlineState() {
  if(!ONLINE_MODE || !ONLINE_HOST_TOKEN || !onlineSocket || onlineSocket.readyState!==WebSocket.OPEN || game.gameStatus().over) return;
  onlineSocket.send(JSON.stringify({type:"game:state",state:{game:game.clone(),variant:selectedVariantId,mandatoryCapture}}));
}
function publishOnlineMove(move) {
  if(!ONLINE_MODE || !onlineSocket || onlineSocket.readyState!==WebSocket.OPEN) return false;
  onlineSocket.send(JSON.stringify({type:"game:move",payload:{from:{...move.from},to:{...move.to},mandatoryCapture,variant:selectedVariantId}}));
  return true;
}
function publishOnlineResult() {
  if(!ONLINE_MODE || !ONLINE_HOST_TOKEN || onlineResultSent || !onlineSocket || onlineSocket.readyState!==WebSocket.OPEN) return;
  const status=game.gameStatus(); if(!status.over) return;
  const winnerColor=status.winner;
  const winner=playerForColor(winnerColor);
  const winnerClientId=winner?.controllerClientId||"";
  if(!winnerClientId) return;
  onlineResultSent=true;
  onlineSocket.send(JSON.stringify({type:"game:result",winnerClientId,matchId:onlineMatchId}));
}
function applyRemoteState(state) {
  if(!state?.game) return;
  if(state.variant) selectedVariantId=state.variant;
  if(typeof state.mandatoryCapture === "boolean") mandatoryCapture=state.mandatoryCapture;
  const size=draughtsSizeForVariant(selectedVariantId);
  if(game.size!==size || game.variant!==selectedVariantId || game.mandatoryCapture!==mandatoryCapture) game=new DraughtsGame(size,mandatoryCapture,selectedVariantId);
  game.restore(state.game);
  selected=null; legalTargets=[]; render();
}
function refreshPlayers() { if(onlineConfig?.players?.length) gamePlayers=onlineConfig.players; }

function connectOnline() {
  if(!ONLINE_MODE || !ONLINE_SERVER || !ONLINE_CODE) return;
  try { onlineSocket=new WebSocket(onlineWsUrl()); }
  catch(error) { setOnlineStatus("Could not connect.",true); return; }
  onlineSocket.addEventListener("open",()=>{
    onlineConnected=true;
    const p=localProfileForIdentity();
    onlineSocket.send(JSON.stringify({type:"player:identify",profileId:p.id||"",name:p.name||"Player 1",avatar:p.avatar||"♟",party:localPartyProfiles().map((x)=>({id:x.id,name:x.name||"Player",avatar:x.avatar||"♟"})),spectator:Boolean((onlineConfig?.spectators||[]).includes(ONLINE_CLIENT_ID))}));
    setOnlineStatus("Connected");
    if(onlineConfig?.players?.length) refreshPlayers();
    render();
    if(ONLINE_HOST_TOKEN) setTimeout(()=>publishOnlineState(),100);
  });
  onlineSocket.addEventListener("message",(event)=>{
    let message; try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==="room:participants") { onlineParticipants=message.participants||[]; refreshPlayers(); render(); return; }
    if(message.type==="room:config") { onlineConfig=message.config||onlineConfig; mandatoryCapture=Boolean(onlineConfig?.options?.mandatoryCapture ?? mandatoryCapture); selectedVariantId=onlineConfig?.variant||selectedVariantId; refreshPlayers(); if(onlineConfig?.players?.length) gamePlayers=onlineConfig.players; game=createGame(); render(); return; }
    if(message.type==="game:start") {
      onlineMatchId=message.matchId||onlineMatchId;
      onlineResultSent=false;
      localScoreRecorded=false;
      onlineConfig=message.config||onlineConfig;
      mandatoryCapture=Boolean(onlineConfig?.options?.mandatoryCapture ?? mandatoryCapture);
      selectedVariantId=onlineConfig?.variant||selectedVariantId;
      refreshPlayers();
      game=createGame();
      if(message.state) applyRemoteState(message.state);
      else { selected=null; legalTargets=[]; render(); if(ONLINE_HOST_TOKEN) setTimeout(()=>publishOnlineState(),75); }
      return;
    }
    if(message.type==="game:state") { applyRemoteState(message.state); return; }
    if(message.type==="game:move") {
      if(message.sender?.clientId===ONLINE_CLIENT_ID) return;
      if(ONLINE_HOST_TOKEN) { const ok=applyMove(message.payload,true); if(ok) render(); }
      else applyRemoteMove(message.payload);
      return;
    }
    if(message.type==="game:back") { window.location.href="../index.html"; return; }
    if(message.type==="player:spectator") { onlineParticipants=message.participants||onlineParticipants; return; }
  });
  onlineSocket.addEventListener("close",()=>{onlineConnected=false;setOnlineStatus("Disconnected",true);});
  onlineSocket.addEventListener("error",()=>setOnlineStatus("Connection error",true));
}
function applyRemoteMove(move) { if(applyMove(move,true)) render(); }
function goBackToLibrary() {
  if(ONLINE_MODE && onlineSocket?.readyState===WebSocket.OPEN) { try{onlineSocket.send(JSON.stringify({type:"game:back"}));}catch{} setTimeout(()=>window.location.href="../index.html",250); }
  else window.location.href="../index.html";
}

function escapeHtml(value){return String(value).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

document.getElementById("newGameBtn").onclick=goBackToLibrary;
document.getElementById("clearBtn").onclick=()=>{clearTimeout(computerTimer);computerPending=false;if(ONLINE_MODE&&!ONLINE_HOST_TOKEN)return;game=createGame();selected=null;legalTargets=[];onlineResultSent=false;localScoreRecorded=false;render();};
document.getElementById("undoBtn").onclick=()=>{clearTimeout(computerTimer);computerPending=false;if(ONLINE_MODE&&!ONLINE_HOST_TOKEN)return;if(game.undo()){selected=null;legalTargets=[];onlineResultSent=false;render();}};
document.getElementById("onlineBar").textContent=ONLINE_MODE?"Connecting…":"Offline/local game";

if (params.get("game") && params.get("game") !== "draughts") console.warn("Draughts page opened for unexpected game", params.get("game"));
render();
connectOnline();
