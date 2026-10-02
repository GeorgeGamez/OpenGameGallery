"use strict";

(function(){
  const INF=1e15;
  function movesFor(game){ return game.allLegalMoves(); }
  function snapshot(game){
    return {
      board: game.clone().board,
      turn: game.turn,
      san: [...game.sanHistory],
      captured: game.captured.map((p)=>({...p})),
      lastMove: game.lastMove ? {from:{...game.lastMove.from},to:{...game.lastMove.to}} : null,
      captureChain: game.captureChain ? {from:{...game.captureChain.from},current:{...game.captureChain.current},capturedSquares:[...(game.captureChain.capturedSquares||[])]} : null,
      history: game.history.map((h)=>({
        board: h.board.map((row)=>row.map((p)=>p?{...p}:null)),
        turn: h.turn,
        san: [...(h.san||[])],
        captured: (h.captured||[]).map((p)=>({...p})),
        lastMove: h.lastMove ? {from:{...h.lastMove.from},to:{...h.lastMove.to}} : null,
        captureChain: h.captureChain ? {from:{...h.captureChain.from},current:{...h.captureChain.current},capturedSquares:[...(h.captureChain.capturedSquares||[])]} : null,
      })),
      turnSnapshot: game.turnSnapshot ? snapshotSnapshot(game.turnSnapshot) : null,
    };
  }
  function snapshotSnapshot(h){
    if(!h) return null;
    return {
      board:h.board.map((row)=>row.map((p)=>p?{...p}:null)),
      turn:h.turn,
      san:[...(h.san||[])],
      captured:(h.captured||[]).map((p)=>({...p})),
      lastMove:h.lastMove ? {from:{...h.lastMove.from},to:{...h.lastMove.to}} : null,
      captureChain:h.captureChain ? {from:{...h.captureChain.from},current:{...h.captureChain.current}} : null,
    };
  }
  function applyTemp(game,move){ const before=snapshot(game); game.makeMove(move); return before; }
  function restoreTemp(game,before){
    game.board=before.board.map((row)=>row.map((p)=>p?{...p}:null));
    game.turn=before.turn;
    game.sanHistory=[...before.san];
    game.captured=before.captured.map((p)=>({...p}));
    game.lastMove=before.lastMove ? {from:{...before.lastMove.from},to:{...before.lastMove.to}} : null;
    game.captureChain=before.captureChain ? {from:{...before.captureChain.from},current:{...before.captureChain.current},capturedSquares:[...(before.captureChain.capturedSquares||[])]} : null;
    game.history=before.history.map((h)=>({
      board:h.board.map((row)=>row.map((p)=>p?{...p}:null)),
      turn:h.turn,
      san:[...h.san],
      captured:h.captured.map((p)=>({...p})),
      lastMove:h.lastMove ? {from:{...h.lastMove.from},to:{...h.lastMove.to}} : null,
      captureChain:h.captureChain ? {from:{...h.captureChain.from},current:{...h.captureChain.current}} : null,
    }));
    game.turnSnapshot=before.turnSnapshot ? snapshotSnapshot(before.turnSnapshot) : null;
  }
  function count(board,color,type=null){ let n=0; for(const row of board) for(const p of row) if(p?.color===color && (!type||p.type===type)) n++; return n; }
  function evaluate(game,root) {
    const opp=root==="w"?"b":"w";
    const values={m:100,K:300};
    let score=0;
    for(let r=0;r<game.size;r++) for(let c=0;c<game.size;c++) {
      const p=game.board[r][c]; if(!p) continue;
      const v=values[p.type] || 0;
      score += p.color===root ? v : -v;
      if(p.type==="m") score += p.color===root ? ((root==="w"?(game.size-1-r):r)*1.5) : 0;
    }
    score += (movesFor(game).length) * (game.turn===root?2:-2);
    const status=game.gameStatus();
    if(status.over) score += status.winner===root ? 100000 : -100000;
    return score;
  }
  function depthFor(game,difficulty){
    if(game.size===12){
      if(difficulty==="easy") return 1;
      if(difficulty==="hard") return 2;
      if(difficulty==="expert") return 3;
      return 2;
    }
    if(difficulty==="easy") return 1;
    if(difficulty==="hard") return game.size===10?3:4;
    if(difficulty==="expert") return game.size===10?4:5;
    return game.size===10?2:3;
  }
  function alphaBeta(game,root,depth,alpha,beta) {
    const status=game.gameStatus();
    if(depth<=0 || status.over) return {score:evaluate(game,root),move:null};
    const moves=movesFor(game);
    if(!moves.length) return {score:evaluate(game,root),move:null};
    const maximizing=game.turn===root;
    let best={score:maximizing?-INF:INF,move:null};
    for(const move of moves){
      const before=applyTemp(game,move);
      const result=alphaBeta(game,root,depth-1,alpha,beta);
      restoreTemp(game,before);
      if(maximizing){
        if(result.score>best.score){best={score:result.score,move};}
        alpha=Math.max(alpha,result.score);
      } else {
        if(result.score<best.score){best={score:result.score,move};}
        beta=Math.min(beta,result.score);
      }
      if(beta<=alpha) break;
    }
    return best;
  }
  function chooseMove(game,difficulty="normal"){
    const moves=movesFor(game); if(!moves.length) return null;
    const depth=depthFor(game,difficulty);
    // Forced captures are already filtered by the engine. In easy mode randomize among legal moves.
    if(difficulty==="easy") return moves[Math.floor(Math.random()*moves.length)];
    const result=alphaBeta(game,game.turn,depth,-INF,INF);
    return result.move || moves[0];
  }
  window.DraughtsAI={chooseMove};
})();
