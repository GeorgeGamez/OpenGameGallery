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
let selectedVariantId = params.get("variant") || "standard";

try {
  const raw = params.get("onlineConfig") || sessionStorage.getItem("gameLibraryOnlineConfig") || "";
  if (raw) onlineConfig = JSON.parse(raw);
} catch (error) {
  console.warn("Could not read online configuration:", error);
}
if (onlineConfig?.variant) selectedVariantId = onlineConfig.variant;

const profiles = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
})();

function cloneBoard(board) { return board.map((row) => [...row]); }
function opposite(color) { return color === "b" ? "w" : "b"; }
function sameSquare(a, b) { return a?.r === b?.r && a?.c === b?.c; }
function inside(r,c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function squareName(r,c) { return String.fromCharCode(97+c) + (8-r); }

class ReversiGame {
  constructor() { this.reset(); }

  reset() {
    this.board = Array.from({length:8}, () => Array(8).fill(null));
    this.board[3][3] = "w";
    this.board[3][4] = "b";
    this.board[4][3] = "b";
    this.board[4][4] = "w";
    this.turn = "b";
    this.history = [];
    this.moveHistory = [];
    this.lastMove = null;
    this.lastPass = null;
  }

  clone() {
    return {
      board: cloneBoard(this.board), turn: this.turn,
      moveHistory: [...this.moveHistory],
      lastMove: this.lastMove ? {...this.lastMove} : null,
      lastPass: this.lastPass || null,
    };
  }

  restore(s) {
    this.board = cloneBoard(s.board);
    this.turn = s.turn;
    this.moveHistory = [...(s.moveHistory || [])];
    this.lastMove = s.lastMove ? {...s.lastMove} : null;
    this.lastPass = s.lastPass || null;
    this.history = [];
  }

  undo() {
    if (!this.history.length) return false;
    const previous = this.history.pop();
    const remaining = [...this.history];
    this.restore(previous);
    this.history = remaining;
    return true;
  }

  flipsForMove(r,c,color) {
    if (!inside(r,c) || this.board[r][c]) return [];
    const opp = opposite(color);
    const flips = [];
    const directions = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dr,dc] of directions) {
      const line=[];
      let rr=r+dr, cc=c+dc;
      while (inside(rr,cc) && this.board[rr][cc]===opp) {
        line.push({r:rr,c:cc}); rr+=dr; cc+=dc;
      }
      if (line.length && inside(rr,cc) && this.board[rr][cc]===color) flips.push(...line);
    }
    return flips;
  }

  legalMoves(color=this.turn) {
    const moves=[];
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
      const flips=this.flipsForMove(r,c,color);
      if (flips.length) moves.push({r,c,flips});
    }
    return moves;
  }

  score() {
    let b=0,w=0,empty=0;
    for(const row of this.board) for(const cell of row) {
      if(cell==="b") b++; else if(cell==="w") w++; else empty++;
    }
    return {b,w,empty};
  }

  gameStatus() {
    const score=this.score();
    const current=this.legalMoves(this.turn);
    if (current.length) {
      if (this.lastPass === this.turn) return {over:false,text:`${this.turn === "b" ? "Black" : "White"} to move after a forced pass`,pass:this.lastPass,score};
      return {over:false,text:`${this.turn === "b" ? "Black" : "White"} to move`,score};
    }
    const other=opposite(this.turn);
    const otherMoves=this.legalMoves(other);
    if (!otherMoves.length) {
      const winner=score.b===score.w ? null : (score.b>score.w ? "b" : "w");
      const result=winner ? `${winner === "b" ? "Black" : "White"} wins!` : "Draw game!";
      return {over:true,winner,text:`Game Over — ${result}`,score};
    }
    return {over:false,text:`${this.turn === "b" ? "Black" : "White"} has no legal move and passes — ${other === "b" ? "Black" : "White"} to move`,pass:this.turn,score};
  }

  makeMove(move) {
    const legal=this.legalMoves(this.turn).find(m => sameSquare(m,move));
    if(!legal) return false;
    this.history.push(this.clone());
    const color=this.turn;
    this.board[move.r][move.c]=color;
    for(const f of legal.flips) this.board[f.r][f.c]=color;
    this.lastMove={r:move.r,c:move.c};
    this.lastPass=null;
    this.moveHistory.push(`${color === "b" ? "Black" : "White"}: ${squareName(move.r,move.c)} (+${legal.flips.length})`);

    const next=opposite(color);
    this.turn=next;
    if(!this.legalMoves(next).length) {
      if(!this.legalMoves(color).length) return true;
      this.lastPass=next;
      this.turn=color;
    }
    return true;
  }
}

window.ReversiGame=ReversiGame;

function activePlayers() {
  if (onlineConfig?.players?.length) return onlineConfig.players;
  return [
    {seat:"black",type:"human",profileId:profiles[0]?.id||"",name:profiles[0]?.name||"Player 1",avatar:profiles[0]?.avatar||"♟"},
    {seat:"white",type:"computer",name:"Computer",avatar:"🤖",difficulty:"normal",id:"computer:0"}
  ];
}
let gamePlayers=activePlayers();
let game=new ReversiGame();
let selected=null;
let legalTargets=[];
let computerTimer=null;
let computerPending=false;

function playerForColor(color) { return gamePlayers.find(p=>p.seat===(color==="b"?"black":"white"))||null; }
function localPartyProfiles() {
  try {
    const ids=JSON.parse(sessionStorage.getItem("gameLibraryParty")||"[]");
    if(Array.isArray(ids)) {
      const party=ids.map(id=>profiles.find(p=>p.id===id)).filter(Boolean);
      if(party.length) return party;
    }
  } catch {}
  return profiles;
}
function localProfileForIdentity() { return localPartyProfiles()[0]||{id:"",name:"Player 1",avatar:"♟"}; }
function recordLocalWinIfOver() {
  if(ONLINE_MODE || localScoreRecorded) return;
  const status=game.gameStatus(); if(!status.over || !status.winner) return;
  const winner=playerForColor(status.winner); const profileId=winner?.profileId||"";
  if(!profileId) return;
  let scores={}; try{scores=JSON.parse(localStorage.getItem("gameLibraryLocalScores")||"{}");}catch{}
  scores[profileId]=Math.max(0,Number(scores[profileId])||0)+1;
  localStorage.setItem("gameLibraryLocalScores",JSON.stringify(scores));
  localScoreRecorded=true;
}
function currentParticipantProfileIds() {
  if(!ONLINE_MODE) return new Set();
  const me=onlineParticipants.find(p=>String(p.clientId||"")===String(ONLINE_CLIENT_ID));
  if(!me) return new Set();
  const ids=new Set();
  if(me.profileId) ids.add(String(me.profileId));
  if(Array.isArray(me.party)) for(const member of me.party) if(member?.id) ids.add(String(member.id));
  return ids;
}

function playerControlledByCurrentClient(p) {
  if(!p || p.type!=="human") return false;
  if(!ONLINE_MODE) return true;
  const controller=String(p.controllerClientId || p.participantClientId || "");
  if(controller && controller===String(ONLINE_CLIENT_ID)) return true;

  // Older/stale room configurations may lack controllerClientId. Fall back to
  // matching the configured profile against this participant's profile/party.
  const profileId=String(p.profileId || "");
  return Boolean(profileId && currentParticipantProfileIds().has(profileId));
}

function humanControlsTurn() {
  return playerControlledByCurrentClient(playerForColor(game.turn));
}
function isComputerTurn() { return playerForColor(game.turn)?.type==="computer" && (!ONLINE_MODE || (onlineConnected && Boolean(ONLINE_HOST_TOKEN))); }

function render() {
  recordLocalWinIfOver();
  const status=game.gameStatus();
  legalTargets = !status.over && humanControlsTurn() ? game.legalMoves(game.turn) : [];
  selected = null;
  document.getElementById("pageTitle").textContent="Reversi";
  document.getElementById("subtitle").textContent="Game Player";
  document.getElementById("gameName").textContent="Reversi";
  document.getElementById("variantName").textContent="Standard Reversi";
  document.title="Standard Reversi — Game Library";
  document.getElementById("status").textContent=status.text;

  const list=document.getElementById("playerList"); list.innerHTML="";
  for(const p of gamePlayers) {
    const colorCode=p.seat==="black"?"b":"w", color=colorCode==="b"?"Black":"White";
    const row=document.createElement("div"); row.className="player-row"+(game.turn===colorCode&&!status.over?" current":"");
    const avatar=document.createElement("div"); avatar.className="player-avatar"; avatar.textContent=p.avatar||"♟";
    const details=document.createElement("div"); details.className="player-details";
    const name=document.createElement("div"); name.className="player-name"; name.textContent=p.name||color;
    const type=document.createElement("div"); type.className="player-type"; type.textContent=`${p.type==="computer"?`Computer • ${p.difficulty||"normal"}`:p.playerType||"Human"} • ${color}`;
    details.append(name,type); row.append(avatar,details); list.appendChild(row);
  }

  const score=game.score();
  const scorePanel=document.getElementById("scorePanel"); scorePanel.innerHTML="";
  for(const [color,label] of [["b","Black"],["w","White"]]) {
    const p=playerForColor(color); const row=document.createElement("div"); row.className="score-row";
    const name=document.createElement("div"); name.className="score-name"; name.textContent=`${label} — ${p?.name||label}`;
    const value=document.createElement("div"); value.className="score-value"; value.textContent=String(score[color]);
    row.append(name,value); scorePanel.appendChild(row);
  }
  const empty=document.createElement("div"); empty.className="note"; empty.style.marginTop="8px"; empty.textContent=`Empty squares: ${score.empty}`; scorePanel.appendChild(empty);

  const frame=document.getElementById("boardFrame"); frame.classList.add("eight");
  const board=document.getElementById("board"); board.style.gridTemplateColumns="repeat(8,minmax(0,1fr))"; board.style.gridTemplateRows="repeat(8,minmax(0,1fr))"; board.innerHTML="";
  const rowLabels=document.getElementById("rowLabels"), colLabels=document.getElementById("colLabels"); rowLabels.innerHTML=""; colLabels.innerHTML="";
  for(let r=0;r<8;r++){const el=document.createElement("span");el.textContent=String(8-r);rowLabels.appendChild(el);} for(let c=0;c<8;c++){const el=document.createElement("span");el.textContent=String.fromCharCode(97+c);colLabels.appendChild(el);}
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    const cell=document.createElement("button"); cell.type="button"; cell.className="square"; cell.dataset.r=r; cell.dataset.c=c;
    if(game.board[r][c]) { const el=document.createElement("span"); el.className=`piece ${game.board[r][c]}`; cell.appendChild(el); }
    if(selected && sameSquare(selected,{r,c})) cell.classList.add("selected");
    if(legalTargets.some(m=>sameSquare(m,{r,c}))) { const dot=document.createElement("span"); dot.className="legal-dot"; cell.appendChild(dot); }
    if(game.lastMove && sameSquare(game.lastMove,{r,c})) cell.classList.add("last-move");
    cell.onclick=()=>handleCell(r,c); board.appendChild(cell);
  }
  const history=game.moveHistory||[]; const moveList=document.getElementById("moveList");
  moveList.innerHTML=history.length?history.map((move,i)=>`<div class="move-row"><div class="move-number">${i+1}.</div><div class="move" style="grid-column:2/-1">${escapeHtml(move)}</div></div>`).join(""): '<div class="note" style="padding:10px">No moves yet.</div>';
  scheduleComputerMove();
  if(ONLINE_HOST_TOKEN && onlineConnected) publishOnlineState();
}

function handleCell(r,c) {
  if(game.gameStatus().over || computerPending || !humanControlsTurn()) return;
  const move=legalTargets.find(m=>sameSquare(m,{r,c}));
  if(move && applyMove({r,c})) { render(); }
}
function applyMove(move,fromRemote=false) {
  const ok=game.makeMove(move); if(!ok) return false;
  if(ONLINE_MODE && !fromRemote) publishOnlineMove(move);
  if(game.gameStatus().over) publishOnlineResult();
  recordLocalWinIfOver(); return true;
}
function randomComputerMove() {
  const move=window.ReversiAI?.chooseMove?window.ReversiAI.chooseMove(game,playerForColor(game.turn)?.difficulty||"normal"):(game.legalMoves(game.turn)[0]||null);
  return move?applyMove(move):false;
}
function scheduleComputerMove() {
  clearTimeout(computerTimer);
  if(computerPending || !isComputerTurn() || game.gameStatus().over) return;
  computerPending=true;
  computerTimer=setTimeout(()=>{ computerPending=false; randomComputerMove(); selected=null; legalTargets=[]; render(); },350);
}
function onlineWsUrl() {
  const base=ONLINE_SERVER.replace(/\/$/,"").replace(/^http:/,"ws:").replace(/^https:/,"wss:");
  return `${base}/ws/${encodeURIComponent(ONLINE_CODE)}?clientId=${encodeURIComponent(ONLINE_CLIENT_ID)}&role=${ONLINE_HOST_TOKEN?"host":"player"}`;
}
function setOnlineStatus(t,error=false){const el=document.getElementById("onlineBar");el.textContent=t;el.className=error?"online-bar error":"online-bar";}
function publishOnlineState(){if(!ONLINE_MODE||!ONLINE_HOST_TOKEN||!onlineSocket||onlineSocket.readyState!==WebSocket.OPEN)return;onlineSocket.send(JSON.stringify({type:"game:state",state:{game:game.clone(),variant:selectedVariantId}}));}
function publishOnlineMove(move){if(!ONLINE_MODE||!onlineSocket||onlineSocket.readyState!==WebSocket.OPEN)return false;onlineSocket.send(JSON.stringify({type:"game:move",payload:{r:move.r,c:move.c}}));return true;}
function publishOnlineResult(){if(!ONLINE_MODE||!ONLINE_HOST_TOKEN||onlineResultSent||!onlineSocket||onlineSocket.readyState!==WebSocket.OPEN)return;const status=game.gameStatus();if(!status.over||!status.winner)return;const winner=playerForColor(status.winner);const winnerClientId=winner?.controllerClientId||"";if(!winnerClientId)return;onlineResultSent=true;onlineSocket.send(JSON.stringify({type:"game:result",winnerClientId,matchId:onlineMatchId}));}
function applyRemoteState(state){
  if(!state?.game || !Array.isArray(state.game.board) || state.game.board.length!==8) return;
  if(state.variant)selectedVariantId=state.variant;
  game.restore(state.game);
  selected=null;
  legalTargets=[];
  render();
}
function refreshPlayers(){if(onlineConfig?.players?.length)gamePlayers=onlineConfig.players;}
function connectOnline(){
  if(!ONLINE_MODE||!ONLINE_SERVER||!ONLINE_CODE)return;
  try{onlineSocket=new WebSocket(onlineWsUrl());}catch{setOnlineStatus("Could not connect.",true);return;}
  onlineSocket.addEventListener("open",()=>{
    onlineConnected=true; const p=localProfileForIdentity();
    onlineSocket.send(JSON.stringify({type:"player:identify",profileId:p.id||"",name:p.name||"Player 1",avatar:p.avatar||"♟",party:localPartyProfiles().map(x=>({id:x.id,name:x.name||"Player",avatar:x.avatar||"♟"})),spectator:Boolean((onlineConfig?.spectators||[]).includes(ONLINE_CLIENT_ID))}));
    setOnlineStatus("Connected"); refreshPlayers(); render(); if(ONLINE_HOST_TOKEN)setTimeout(()=>publishOnlineState(),100);
  });
  onlineSocket.addEventListener("message",event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==="room:participants"){onlineParticipants=message.participants||[];refreshPlayers();render();return;}
    if(message.type==="room:config"){onlineConfig=message.config||onlineConfig;selectedVariantId=onlineConfig?.variant||selectedVariantId;refreshPlayers();game=new ReversiGame();render();return;}
    if(message.type==="game:start"){
      onlineMatchId=message.matchId||onlineMatchId;
      onlineResultSent=false;
      localScoreRecorded=false;
      onlineConfig=message.config||onlineConfig;
      selectedVariantId=onlineConfig?.variant||selectedVariantId;
      refreshPlayers();

      // A new match must begin from Reversi's initial position. The Worker may
      // still have a state from the previous match when it broadcasts game:start.
      // The host publishes the fresh authoritative state immediately afterwards.
      game=new ReversiGame();
      selected=null;
      legalTargets=[];
      render();
      if(ONLINE_HOST_TOKEN)setTimeout(()=>publishOnlineState(),75);
      return;
    }
    if(message.type==="game:state"){applyRemoteState(message.state);return;}
    if(message.type==="game:move"){if(message.sender?.clientId===ONLINE_CLIENT_ID)return;const ok=applyMove(message.payload,true);if(ok)render();return;}
    if(message.type==="game:back"){window.location.href="../index.html";return;}
    if(message.type==="player:spectator"){onlineParticipants=message.participants||onlineParticipants;render();return;}
  });
  onlineSocket.addEventListener("close",()=>{onlineConnected=false;setOnlineStatus("Disconnected",true);});
  onlineSocket.addEventListener("error",()=>setOnlineStatus("Connection error",true));
}
function goBackToLibrary(){if(ONLINE_MODE&&onlineSocket?.readyState===WebSocket.OPEN){try{onlineSocket.send(JSON.stringify({type:"game:back"}));}catch{}setTimeout(()=>window.location.href="../index.html",250);}else window.location.href="../index.html";}
function escapeHtml(value){return String(value).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

document.getElementById("newGameBtn").onclick=goBackToLibrary;
document.getElementById("clearBtn").onclick=()=>{clearTimeout(computerTimer);computerPending=false;if(ONLINE_MODE&&!ONLINE_HOST_TOKEN)return;game=new ReversiGame();selected=null;legalTargets=[];onlineResultSent=false;localScoreRecorded=false;render();};
document.getElementById("undoBtn").onclick=()=>{clearTimeout(computerTimer);computerPending=false;if(ONLINE_MODE&&!ONLINE_HOST_TOKEN)return;if(game.undo()){selected=null;legalTargets=[];onlineResultSent=false;localScoreRecorded=false;render();}};
document.getElementById("onlineBar").textContent=ONLINE_MODE?"Connecting…":"Offline/local game";
if(params.get("game")&&params.get("game")!=="reversi")console.warn("Reversi page opened for unexpected game",params.get("game"));
render();connectOnline();
