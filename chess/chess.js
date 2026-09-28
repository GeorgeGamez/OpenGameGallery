"use strict";

const PIECES = {
  w: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
function inside(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}
function cloneBoard(b) {
  return b.map((row) => row.map((p) => (p ? { ...p } : null)));
}
function opposite(c) {
  return c === "w" ? "b" : "w";
}
function initialBoard() {
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
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
  constructor() {
    this.size = 8;
    this.reset();
  }
  reset() {
    this.board = initialBoard();
    this.turn = "w";
    this.history = [];
    this.sanHistory = [];
    this.captured = [];
    this.lastMove = null;
    this.castling = {
      w: {
        kingMoved: false,
        kingCol: 4,
        rooks: [
          { col: 0, moved: false },
          { col: 7, moved: false },
        ],
      },
      b: {
        kingMoved: false,
        kingCol: 4,
        rooks: [
          { col: 0, moved: false },
          { col: 7, moved: false },
        ],
      },
    };
  }
  clone() {
    return {
      board: cloneBoard(this.board),
      turn: this.turn,
      san: [...this.sanHistory],
      captured: this.captured.map((p) => ({ ...p })),
      lastMove: this.lastMove
        ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } }
        : null,
      castling: JSON.parse(JSON.stringify(this.castling)),
    };
  }
  restore(s) {
    this.board = cloneBoard(s.board);
    this.turn = s.turn;
    this.sanHistory = [...(s.san || [])];
    this.captured = (s.captured || []).map((p) => ({ ...p }));
    this.lastMove = s.lastMove
      ? { from: { ...s.lastMove.from }, to: { ...s.lastMove.to } }
      : null;
    this.castling = JSON.parse(
      JSON.stringify(
        s.castling || {
          w: {
            kingMoved: false,
            kingCol: 4,
            rooks: [
              { col: 0, moved: false },
              { col: 7, moved: false },
            ],
          },
          b: {
            kingMoved: false,
            kingCol: 4,
            rooks: [
              { col: 0, moved: false },
              { col: 7, moved: false },
            ],
          },
        },
      ),
    );
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
        inside(pawn, c + dc) &&
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
        inside(r + dr, c + dc) &&
        b[r + dr][c + dc]?.color === by &&
        b[r + dr][c + dc].type === "n"
      )
        return true;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (
          (dr || dc) &&
          inside(r + dr, c + dc) &&
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
        while (inside(nr, nc)) {
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
    const out = [];
    const add = (tr, tc, x = {}) => {
      if (!inside(tr, tc)) return;
      const t = this.board[tr][tc];
      if (!t || t.color !== p.color)
        out.push({ from: { r, c }, to: { r: tr, c: tc }, ...x });
    };
    if (p.type === "p") {
      const d = p.color === "w" ? -1 : 1,
        s = p.color === "w" ? 6 : 1;
      if (inside(r + d, c) && !this.board[r + d][c]) {
        add(r + d, c, { promotion: r + d === 0 || r + d === 7 });
        if (r === s && !this.board[r + 2 * d][c]) add(r + 2 * d, c);
      }
      for (const dc of [-1, 1]) {
        const tr = r + d,
          tc = c + dc;
        if (
          inside(tr, tc) &&
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
        while (inside(tr, tc)) {
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
      const cs = this.castling[p.color];
      if (!cs.kingMoved && !this.attacked(r, c, opposite(p.color))) {
        for (const rk of cs.rooks) {
          if (rk.moved || this.board[r][rk.col]?.type !== "r") continue;
          const kingTarget = rk.col > cs.kingCol ? 6 : 2,
            rookTarget = rk.col > cs.kingCol ? 5 : 3;
          let clear = true;
          const min = Math.min(cs.kingCol, kingTarget, rk.col, rookTarget),
            max = Math.max(cs.kingCol, kingTarget, rk.col, rookTarget);
          for (let col = min; col <= max; col++)
            if (col !== cs.kingCol && col !== rk.col && this.board[r][col]) {
              clear = false;
              break;
            }
          if (clear) {
            const step = kingTarget > cs.kingCol ? 1 : -1;
            for (
              let col = cs.kingCol + step;
              col !== kingTarget + step;
              col += step
            )
              if (this.attacked(r, col, opposite(p.color))) {
                clear = false;
                break;
              }
          }
          if (clear)
            out.push({
              from: { r, c },
              to: { r, c: kingTarget },
              castling: { rookFromCol: rk.col, kingTarget, rookTarget },
            });
        }
      }
    }
    return out;
  }
  legalMovesFrom(r, c) {
    const p = this.board[r]?.[c];
    if (!p || p.color !== this.turn) return [];
    return this.moveList(r, c).filter((m) => {
      const b = cloneBoard(this.board);
      if (m.castling) {
        const king = b[r][c],
          rook = b[r][m.castling.rookFromCol];
        b[r][c] = null;
        b[r][m.castling.rookFromCol] = null;
        b[r][m.castling.kingTarget] = king;
        b[r][m.castling.rookTarget] = rook;
      } else {
        const piece = b[r][c];
        b[r][c] = null;
        b[m.to.r][m.to.c] = piece;
      }
      const k = this.findKing(p.color, b);
      return !!k && !this.attacked(k.r, k.c, opposite(p.color), b);
    });
  }
  makeMove(m, promotion = "q") {
    const legal = this.legalMovesFrom(m.from.r, m.from.c).find(
      (x) => x.to.r === m.to.r && x.to.c === m.to.c,
    );
    if (!legal) return false;
    this.history.push(this.clone());
    const p = this.board[legal.from.r][legal.from.c];
    let cap = null;
    if (legal.castling) {
      const rook = this.board[legal.from.r][legal.castling.rookFromCol];
      this.board[legal.from.r][legal.from.c] = null;
      this.board[legal.from.r][legal.castling.rookFromCol] = null;
      this.board[legal.from.r][legal.castling.kingTarget] = p;
      this.board[legal.from.r][legal.castling.rookTarget] = rook;
      this.castling[p.color].kingMoved = true;
      this.sanHistory.push(legal.castling.kingTarget === 6 ? "O-O" : "O-O-O");
    } else {
      cap = this.board[legal.to.r][legal.to.c];
      this.board[legal.from.r][legal.from.c] = null;
      this.board[legal.to.r][legal.to.c] = {
        ...p,
        type: legal.promotion ? promotion : p.type,
      };
      if (p.type === "k") this.castling[p.color].kingMoved = true;
      if (p.type === "r") {
        const rs = this.castling[p.color].rooks.find(
          (x) => x.col === legal.from.c,
        );
        if (rs) rs.moved = true;
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
  allLegal(color) {
    const old = this.turn;
    this.turn = color;
    const out = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (this.board[r][c]?.color === color)
          out.push(...this.legalMovesFrom(r, c));
    this.turn = old;
    return out;
  }
  gameStatus() {
    const moves = this.allLegal(this.turn),
      k = this.findKing(this.turn),
      check = !!k && this.attacked(k.r, k.c, opposite(this.turn));
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
}

const params = new URLSearchParams(location.search);
const online = params.get("online") === "1";
const serverUrl = (params.get("server") || "").replace(/\/$/, "");
const onlineCode = params.get("code") || "";
const onlineToken = params.get("hostToken") || "";
const clientId =
  params.get("clientId") ||
  localStorage.getItem("gameLibraryOnlineClientId") ||
  "client_" + Math.random().toString(36).slice(2, 12);
localStorage.setItem("gameLibraryOnlineClientId", clientId);
let onlineConfig = null;
try {
  const stored = sessionStorage.getItem("gameLibraryOnlineConfig");
  if (stored) onlineConfig = JSON.parse(stored);
} catch {}
if (params.get("config")) {
  try {
    onlineConfig = JSON.parse(params.get("config"));
  } catch {}
}

const manager = { game: new ChessGame() };
let selected = null,
  pendingPromotion = null,
  keyboardBuffer = "",
  boardFlipped = false,
  computerMoveTimer = null,
  onlineSocket = null,
  onlineConnected = false,
  onlineRevision = 0,
  onlineSelf = null;
const boardEl = document.getElementById("board"),
  statusEl = document.getElementById("status"),
  moveListEl = document.getElementById("moveList"),
  capturedPanel = document.getElementById("capturedPanel"),
  playerListEl = document.getElementById("playerList"),
  onlineBar = document.getElementById("onlineBar"),
  promotionModal = document.getElementById("promotionModal"),
  promotionOptions = document.getElementById("promotionOptions");
const defaultProfiles = (() => {
  try {
    const p = JSON.parse(localStorage.getItem("gameLibraryProfiles") || "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
})();
function gamePlayers() {
  if (onlineConfig?.players?.length === 2) return onlineConfig.players;
  return [
    {
      seat: "white",
      clientId: null,
      name: defaultProfiles[0]?.name || "Player 1",
      avatar: defaultProfiles[0]?.avatar || "♟",
      type: "human",
    },
    {
      seat: "black",
      clientId: "computer",
      name: "Computer",
      avatar: "🤖",
      type: "computer",
      difficulty: "normal",
    },
  ];
}
function selfPlayer() {
  const players = gamePlayers();
  return online
    ? players.find((p) => p.clientId === clientId) || null
    : players[0];
}
function playerInfoByColor(color) {
  const players = gamePlayers();
  const seat = color === "w" ? "white" : "black";
  return players.find((p) => p.seat === seat) || players[0];
}
function isMyTurn() {
  if (!online) return manager.game.turn === "w";
  const p = selfPlayer();
  return !!p && p.seat === (manager.game.turn === "w" ? "white" : "black");
}
function isComputerTurn() {
  if (online) return false;
  return manager.game.turn === "b";
}
function send(msg) {
  if (!onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return false;
  onlineSocket.send(JSON.stringify(msg));
  return true;
}
function statePayload() {
  return manager.game.clone();
}
function applyState(state) {
  if (!state?.board) return;
  manager.game.history = [];
  manager.game.restore(state);
  selected = null;
  pendingPromotion = null;
  promotionModal.classList.remove("open");
  render(false);
}
function publishState() {
  if (!online || !selfPlayer() || selfPlayer().seat !== "white") return;
  send({ type: "game:state", state: statePayload() });
}
function onlineMove(move, promotion) {
  send({
    type: "game:move",
    seat: manager.game.turn === "w" ? "white" : "black",
    move: { from: move.from, to: move.to, promotion: promotion || null },
  });
}
function renderPlayers() {
  playerListEl.innerHTML = "";
  const players = gamePlayers();
  for (const p of players) {
    const row = document.createElement("div");
    row.className = "player-row";
    if ((p.seat === "white" ? "w" : "b") === manager.game.turn)
      row.classList.add("current");
    row.innerHTML = `<div class="player-avatar">${escapeHtml(p.avatar || "♟")}</div><div class="player-details"><div class="player-name">${escapeHtml(p.name || "Player")}</div><div class="player-type">${p.seat === "white" ? "White" : "Black"}${p.type === "computer" ? " • Computer" : online && p.clientId === clientId ? " • You" : " • Player"}</div></div>`;
    playerListEl.appendChild(row);
  }
  if (online) {
    onlineBar.hidden = false;
    onlineBar.innerHTML = onlineConnected
      ? `<strong>Online</strong> • Room ${escapeHtml(onlineCode)} • ${onlineSelf?.name ? `Playing as ${escapeHtml(onlineSelf.name)}` : "Connected"}`
      : `Connecting to room ${escapeHtml(onlineCode)}…`;
  } else onlineBar.hidden = true;
}
function escapeHtml(v) {
  return String(v).replace(
    /[&<>\"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}
function renderCoordinates() {
  const rows = document.getElementById("rowLabels"),
    cols = document.getElementById("colLabels");
  rows.innerHTML = "";
  cols.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    const x = document.createElement("span");
    x.textContent = 8 - r;
    rows.appendChild(x);
  }
  for (let c = 0; c < 8; c++) {
    const x = document.createElement("span");
    x.textContent = String.fromCharCode(97 + c);
    cols.appendChild(x);
  }
}
function render(sendState = false) {
  const g = manager.game,
    s = g.gameStatus();
  renderCoordinates();
  boardEl.innerHTML = "";
  const legal = selected ? g.legalMovesFrom(selected.r, selected.c) : [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement("button");
      sq.className = "square " + ((r + c) % 2 ? "dark" : "light");
      if (selected?.r === r && selected?.c === c) sq.classList.add("selected");
      if (
        g.lastMove &&
        ((g.lastMove.from.r === r && g.lastMove.from.c === c) ||
          (g.lastMove.to.r === r && g.lastMove.to.c === c))
      )
        sq.classList.add("last-move");
      if (s.check) {
        const k = g.findKing(g.turn);
        if (k && k.r === r && k.c === c) sq.classList.add("in-check");
      }
      const m = legal.find((x) => x.to.r === r && x.to.c === c);
      if (m) {
        const mark = document.createElement("span");
        mark.className = g.board[r][c] ? "legal-capture" : "legal-dot";
        sq.appendChild(mark);
      }
      const p = g.board[r][c];
      if (p) {
        const pe = document.createElement("span");
        pe.className = "piece " + p.color;
        pe.textContent = PIECES[p.color][p.type];
        sq.appendChild(pe);
      }
      sq.onclick = () => clickSquare(r, c);
      boardEl.appendChild(sq);
    }
  const current = playerInfoByColor(g.turn);
  statusEl.textContent = `${current?.name || "Player"}: ${s.text}`;
  statusEl.classList.toggle("ok", online && onlineConnected && isMyTurn());
  statusEl.classList.remove("error");
  if (online && !onlineConnected) {
    statusEl.textContent += ` • connecting to room ${onlineCode}`;
  }
  renderMoves();
  renderCaptured();
  renderPlayers();
  document.getElementById("undoBtn").disabled = online || !g.history.length;
  if (sendState) publishState();
  scheduleComputerMove();
}
function clickSquare(r, c) {
  const g = manager.game;
  if (g.gameStatus().over || !isMyTurn() || isComputerTurn()) return;
  const p = g.board[r][c];
  if (!selected) {
    if (p && p.color === g.turn) {
      selected = { r, c };
      render();
    }
    return;
  }
  if (p && p.color === g.turn) {
    selected = { r, c };
    render();
    return;
  }
  const move = g
    .legalMovesFrom(selected.r, selected.c)
    .find((m) => m.to.r === r && m.to.c === c);
  if (!move) {
    selected = null;
    render();
    return;
  }
  if (move.promotion) {
    pendingPromotion = move;
    openPromotion(g.turn);
    return;
  }
  commitMove(move, null);
}
function commitMove(move, promotion) {
  const color = manager.game.turn;
  const ok = manager.game.makeMove(move, promotion || "q");
  if (!ok) return;
  selected = null;
  pendingPromotion = null;
  promotionModal.classList.remove("open");
  render(true);
  if (online) onlineMove(move, promotion);
}
function openPromotion(color) {
  promotionOptions.innerHTML = "";
  for (const t of ["q", "r", "b", "n"]) {
    const b = document.createElement("button");
    b.textContent = PIECES[color][t];
    b.onclick = () => commitMove(pendingPromotion, t);
    promotionOptions.appendChild(b);
  }
  promotionModal.classList.add("open");
}
function renderMoves() {
  moveListEl.innerHTML = "";
  for (let i = 0; i < manager.game.sanHistory.length; i += 2) {
    const row = document.createElement("div");
    row.className = "move-row";
    row.innerHTML = `<div class="move-number">${Math.floor(i / 2) + 1}.</div><div class="move">${manager.game.sanHistory[i] || ""}</div><div class="move">${manager.game.sanHistory[i + 1] || ""}</div>`;
    moveListEl.appendChild(row);
  }
  moveListEl.scrollTop = moveListEl.scrollHeight;
}
function renderCaptured() {
  capturedPanel.innerHTML = "";
  if (!manager.game.captured.length) {
    capturedPanel.textContent = "None";
    return;
  }
  const groups = {};
  for (const p of manager.game.captured) (groups[p.color] ??= []).push(p);
  for (const [color, pieces] of Object.entries(groups)) {
    const box = document.createElement("div");
    box.className = "captured-group";
    box.innerHTML = `<div class="captured-label">${color === "w" ? "White" : "Black"} pieces captured</div>`;
    const list = document.createElement("div");
    list.className = "captured";
    for (const p of pieces) {
      const x = document.createElement("span");
      x.className = "piece " + p.color;
      x.textContent = PIECES[p.color][p.type];
      list.appendChild(x);
    }
    box.appendChild(list);
    capturedPanel.appendChild(box);
  }
}
function scheduleComputerMove() {
  clearTimeout(computerMoveTimer);
  if (online || !isComputerTurn() || manager.game.gameStatus().over) return;
  computerMoveTimer = setTimeout(() => {
    const diff =
      gamePlayers().find((p) => p.seat === "black")?.difficulty || "normal";
    const move =
      typeof ChessAI !== "undefined"
        ? ChessAI.findBestMove(manager.game, diff)
        : null;
    if (move) commitMove(move, null);
  }, 250);
}
function connectOnline() {
  if (!online || !serverUrl || !onlineCode) return;
  const base = serverUrl.replace(/^http/i, "ws");
  const q = new URLSearchParams({
    clientId,
    role: onlineToken ? "host" : "player",
  });
  if (onlineToken) q.set("token", onlineToken);
  const ws = new WebSocket(`${base}/ws/${encodeURIComponent(onlineCode)}?${q}`);
  onlineSocket = ws;
  ws.onopen = () => {
    onlineConnected = true;
    const me = defaultProfiles[0] || { id: "", name: "Player", avatar: "♟" };
    send({
      type: "player:identify",
      profileId: me.id,
      name: me.name,
      avatar: me.avatar,
      spectator: false,
    });
    render(false);
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === "room:hello") {
      onlineSelf = m.self || selfPlayer();
      if (m.room?.config) onlineConfig = m.room.config;
      if (m.room?.stateAvailable && m.room?.gameState)
        applyState(m.room.gameState);
      render(false);
      return;
    }
    if (m.type === "room:participants") {
      onlineSelf =
        m.participants?.find((p) => p.clientId === clientId) || onlineSelf;
      render(false);
      return;
    }
    if (m.type === "room:config") {
      onlineConfig = m.config || onlineConfig;
      render(false);
      return;
    }
    if (m.type === "game:state") {
      applyState(m.state);
      return;
    }
    if (m.type === "game:move") {
      if (m.sender?.clientId === clientId) return;
      const move = m.payload?.move;
      if (move) {
        const before = manager.game.turn;
        const ok = manager.game.makeMove(move, move.promotion || "q");
        if (ok) {
          selected = null;
          pendingPromotion = null;
          promotionModal.classList.remove("open");
          render(false);
          if (manager.game.turn === before)
            manager.game.turn = opposite(before);
          if (onlineToken && selfPlayer()?.seat === "white") publishState();
        }
      }
    }
    if (m.type === "error") {
      onlineConnected = false;
      statusEl.classList.add("error");
      statusEl.textContent = m.message || "Online server error";
      renderPlayers();
    }
  };
  ws.onclose = () => {
    onlineConnected = false;
    render(false);
  };
  ws.onerror = () => {
    onlineConnected = false;
    statusEl.classList.add("error");
    statusEl.textContent = "Could not connect to the multiplayer server.";
    renderPlayers();
  };
}
document.getElementById("newGameBtn").onclick = () =>
  (location.href = "../index.html");
document.getElementById("clearBtn").onclick = () => {
  if (online) {
    if (!selfPlayer()?.seat || selfPlayer().seat !== "white") return;
    manager.game.reset();
    selected = null;
    pendingPromotion = null;
    render(true);
    return;
  }
  clearTimeout(computerMoveTimer);
  manager.game.reset();
  selected = null;
  pendingPromotion = null;
  render(false);
};
document.getElementById("undoBtn").onclick = () => {
  if (online) return;
  if (manager.game.undo()) {
    selected = null;
    render(false);
  }
};
render(false);
connectOnline();
