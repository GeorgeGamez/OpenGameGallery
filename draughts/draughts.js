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
    this.size = size;
    this.mandatoryCapture = mandatoryCapture;
    this.variant = variant || (size === 10 ? "international" : "american");
    this.international = this.variant === "international";
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(null));
    const rowsPerSide = this.size === 10 ? 4 : 3;
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
      captureChain: this.captureChain ? { from: { ...this.captureChain.from }, current: { ...this.captureChain.current } } : null,
      turnSnapshot: null,
    };
  }

  restore(s) {
    this.board = cloneBoard(s.board);
    this.turn = s.turn;
    this.sanHistory = [...(s.san || [])];
    this.captured = (s.captured || []).map((p) => ({ ...p }));
    this.lastMove = s.lastMove ? { from: { ...s.lastMove.from }, to: { ...s.lastMove.to } } : null;
    this.captureChain = s.captureChain ? { from: { ...s.captureChain.from }, current: { ...s.captureChain.current } } : null;
    this.turnSnapshot = null;
  }

  undo() {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  }

  directionsForStep(piece) {
    if (piece.type === "K" || this.international) {
      // International kings can move/capture in every diagonal direction.
      if (piece.type === "K") return [[1,1],[1,-1],[-1,1],[-1,-1]];
    }
    if (piece.color === "w") return [[-1,-1],[-1,1]];
    return [[1,-1],[1,1]];
  }

  simpleMovesFor(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    const out = [];
    if (p.type === "K" && this.international) {
      for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
        let tr=r+dr, tc=c+dc;
        while (inside(tr,tc,this.size) && !this.board[tr][tc]) {
          out.push({from:{r,c},to:{r:tr,c:tc}});
          tr+=dr; tc+=dc;
        }
      }
      return out;
    }
    for (const [dr,dc] of this.directionsForStep(p)) {
      const tr=r+dr, tc=c+dc;
      if (inside(tr,tc,this.size) && !this.board[tr][tc]) out.push({from:{r,c},to:{r:tr,c:tc}});
    }
    return out;
  }

  captureMovesFor(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    const out = [];
    const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];

    if (p.type === "K" && this.international) {
      for (const [dr,dc] of dirs) {
        let tr=r+dr, tc=c+dc;
        while (inside(tr,tc,this.size) && !this.board[tr][tc]) { tr+=dr; tc+=dc; }
        if (!inside(tr,tc,this.size)) continue;
        const jumped=this.board[tr][tc];
        if (!jumped || jumped.color===p.color) continue;
        let lr=tr+dr, lc=tc+dc;
        while (inside(lr,lc,this.size) && !this.board[lr][lc]) {
          out.push({from:{r,c},to:{r:lr,c:lc},jump:{r:tr,c:tc}});
          lr+=dr; lc+=dc;
        }
      }
      return out;
    }

    let captureDirs = dirs;
    if (p.type !== "K" && !this.international) {
      captureDirs = p.color === "w" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
    }
    for (const [dr,dc] of captureDirs) {
      const mr=r+dr, mc=c+dc, tr=r+2*dr, tc=c+2*dc;
      if (!inside(tr,tc,this.size) || !inside(mr,mc,this.size)) continue;
      const jumped=this.board[mr][mc];
      if (jumped && jumped.color!==p.color && !this.board[tr][tc]) {
        out.push({from:{r,c},to:{r:tr,c:tc},jump:{r:mr,c:mc}});
      }
    }
    return out;
  }

  hasAnyCaptures(color=this.turn) {
    const saveTurn=this.turn;
    this.turn=color;
    for(let r=0;r<this.size;r++) for(let c=0;c<this.size;c++) {
      if(this.board[r][c]?.color===color && this.captureMovesFor(r,c).length) { this.turn=saveTurn; return true; }
    }
    this.turn=saveTurn;
    return false;
  }

  allLegalMoves() {
    const moves=[];
    if (this.captureChain) return this.captureMovesFor(this.captureChain.current.r,this.captureChain.current.c);
    const forced=this.mandatoryCapture && this.hasAnyCaptures(this.turn);
    for(let r=0;r<this.size;r++) for(let c=0;c<this.size;c++) {
      if(this.board[r][c]?.color!==this.turn) continue;
      const captures=this.captureMovesFor(r,c);
      if(forced) moves.push(...captures);
      else moves.push(...captures,...this.simpleMovesFor(r,c));
    }
    return moves;
  }

  legalMovesFrom(r,c) {
    const p=this.board[r]?.[c];
    if(!p || p.color!==this.turn) return [];
    if(this.captureChain && !sameSquare(this.captureChain.current,{r,c})) return [];
    const captures=this.captureMovesFor(r,c);
    const forced=this.captureChain || (this.mandatoryCapture && this.hasAnyCaptures(this.turn));
    return forced ? captures : [...captures,...this.simpleMovesFor(r,c)];
  }

  promotionRow(color,r) { return color === "w" ? r === 0 : r === this.size-1; }

  makeMove(move) {
    const legal=this.legalMovesFrom(move.from.r,move.from.c).find((m)=>sameSquare(m.to,move.to));
    if(!legal) return false;

    if(!this.turnSnapshot) this.turnSnapshot=this.clone();
    const p=this.board[legal.from.r][legal.from.c];
    this.board[legal.from.r][legal.from.c]=null;
    let capturedPiece=null;
    if(legal.jump){
      capturedPiece=this.board[legal.jump.r][legal.jump.c];
      this.board[legal.jump.r][legal.jump.c]=null;
      if(capturedPiece) this.captured.push(capturedPiece);
    }

    let nextType=p.type;
    const promoted=p.type === "m" && this.promotionRow(p.color,legal.to.r);
    if(promoted) nextType="K";
    this.board[legal.to.r][legal.to.c]={...p,type:nextType};
    this.lastMove={from:{...legal.from},to:{...legal.to}};
    this.sanHistory.push(`${this.turn === "w" ? "White" : "Black"}: ${squareName(legal.from,this.size)}-${squareName(legal.to,this.size)}${legal.jump ? "x" : ""}`);

    if(legal.jump) {
      const canContinue=this.captureMovesFor(legal.to.r,legal.to.c).length>0 && !(promoted && !this.international);
      if(canContinue) {
        this.captureChain={from:{...this.turnSnapshot?.lastMove?.from || legal.from},current:{...legal.to}};
        return true;
      }
    }

    this.history.push(this.turnSnapshot);
    this.turnSnapshot=null;
    this.captureChain=null;
    this.turn=opposite(this.turn);
    return true;
  }

  gameStatus() {
    let white=0,black=0;
    for(const row of this.board) for(const p of row) { if(p?.color==="w") white++; if(p?.color==="b") black++; }
    if(!white) return {over:true,winner:"b",text:"Game Over — Black wins!"};
    if(!black) return {over:true,winner:"w",text:"Game Over — White wins!"};
    const moves=this.allLegalMoves();
    if(!moves.length) return {over:true,winner:opposite(this.turn),text:`Game Over — ${opposite(this.turn)==="w"?"White":"Black"} wins!`};
    if(this.captureChain) return {over:false,text:`${this.turn==="w"?"White":"Black"} must continue capturing`};
    return {over:false,text:`${this.turn==="w"?"White":"Black"} to move`};
  }
}

if (typeof window !== "undefined") window.DraughtsGame = DraughtsGame;

function squareName(s,n) { return String.fromCharCode(97+s.c)+(n-s.r); }

function createGame() { return new DraughtsGame(selectedVariantId === "international" ? 10 : 8, mandatoryCapture, selectedVariantId); }
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
function localProfileForIdentity() { return profiles.find((p)=>p.id===localStorage.getItem("gameLibraryActiveProfileId")) || profiles[0] || {id:"",name:"Player 1",avatar:"♟"}; }
function humanControlsTurn() {
  const p=playerForColor(game.turn);
  if(!p || p.type !== "human") return false;
  if(!ONLINE_MODE) return true;
  return p.controllerClientId === ONLINE_CLIENT_ID;
}
function isComputerTurn() { return playerForColor(game.turn)?.type === "computer" && (!ONLINE_MODE || (onlineConnected && Boolean(ONLINE_HOST_TOKEN))); }
function boardFlipped() { return false; }

function render() {
  const title=document.getElementById("pageTitle");
  const subtitle=document.getElementById("subtitle");
  title.textContent=selectedVariantId === "international" ? "International Draughts" : "American Checkers";
  subtitle.textContent=mandatoryCapture ? "Forced captures enabled" : "Forced captures disabled";
  document.getElementById("status").textContent=game.gameStatus().text;

  const list=document.getElementById("playerList");
  list.innerHTML="";
  for(const p of gamePlayers) {
    const color=p.seat === "white" ? "White" : "Black";
    const row=document.createElement("div"); row.className="player-row" + ((game.turn === (p.seat === "white"?"w":"b")) ? " active":"");
    row.innerHTML=`<span class="avatar">${escapeHtml(p.avatar||"♟")}</span><span class="player-name">${escapeHtml(p.name||color)}</span><span class="player-type">${escapeHtml(p.type === "computer" ? `Computer • ${p.difficulty||"normal"}` : p.playerType||"Human")} • ${color}</span>`;
    list.appendChild(row);
  }

  const board=document.getElementById("board");
  board.style.gridTemplateColumns=`repeat(${game.size},1fr)`;
  board.innerHTML="";
  const rows=[...Array(game.size).keys()];
  const cols=[...Array(game.size).keys()];
  for(const r of rows) for(const c of cols) {
    const cell=document.createElement("button"); cell.type="button"; cell.className="cell " + (((r+c)%2===1)?"dark":"light");
    cell.dataset.r=r; cell.dataset.c=c;
    const piece=game.board[r][c];
    if(piece) {
      const el=document.createElement("span"); el.className=`piece ${piece.color}`+(piece.type === "K"?" king":"");
      el.textContent=piece.type === "K" ? "♛" : "●";
      cell.appendChild(el);
    }
    if(selected && sameSquare(selected,{r,c})) cell.classList.add("selected");
    const target=legalTargets.some((m)=>sameSquare(m.to,{r,c}));
    if(target) cell.classList.add("target");
    if(game.lastMove && (sameSquare(game.lastMove.from,{r,c})||sameSquare(game.lastMove.to,{r,c}))) cell.classList.add("last");
    cell.onclick=()=>handleCell(r,c);
    board.appendChild(cell);
  }

  const history=document.getElementById("history");
  history.innerHTML=(game.sanHistory||[]).slice(-40).map((x,i)=>`<div>${i+1}. ${escapeHtml(x)}</div>`).join("") || '<div class="muted">No moves yet.</div>';
  scheduleComputerMove();
  if(ONLINE_HOST_TOKEN && onlineConnected) publishOnlineState();
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
function setOnlineStatus(t,error=false){ const el=document.getElementById("onlineStatus"); el.textContent=t; el.className=error?"status error":"status"; }
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
  const size=selectedVariantId === "international" ? 10 : 8;
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
    onlineSocket.send(JSON.stringify({type:"player:identify",profileId:p.id||"",name:p.name||"Player 1",avatar:p.avatar||"♟",spectator:Boolean((onlineConfig?.spectators||[]).includes(ONLINE_CLIENT_ID))}));
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

document.getElementById("newGameBtn").onclick=()=>{clearTimeout(computerTimer);computerPending=false;game=createGame();selected=null;legalTargets=[];onlineResultSent=false;render();};
document.getElementById("undoBtn").onclick=()=>{clearTimeout(computerTimer);computerPending=false;if(ONLINE_MODE&&!ONLINE_HOST_TOKEN)return;if(game.undo()){selected=null;legalTargets=[];onlineResultSent=false;render();}};
document.getElementById("backBtn").onclick=goBackToLibrary;
document.getElementById("onlineStatus").textContent=ONLINE_MODE?"Connecting…":"Offline/local game";

if (params.get("game") && params.get("game") !== "draughts") console.warn("Draughts page opened for unexpected game", params.get("game"));
render();
connectOnline();
