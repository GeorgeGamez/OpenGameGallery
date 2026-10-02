"use strict";

(function(){
  const INF=1e15;
  const WEIGHTS=[
    [120,-20,20,5,5,20,-20,120],
    [-20,-40,-5,-5,-5,-5,-40,-20],
    [20,-5,15,3,3,15,-5,20],
    [5,-5,3,3,3,3,-5,5],
    [5,-5,3,3,3,3,-5,5],
    [20,-5,15,3,3,15,-5,20],
    [-20,-40,-5,-5,-5,-5,-40,-20],
    [120,-20,20,5,5,20,-20,120]
  ];
  function snapshot(game){ return game.clone(); }
  function applyTemp(game,move){ const before=snapshot(game); game.makeMove(move); return before; }
  function restoreTemp(game,before){ game.restore(before); }
  function evaluate(game,root){
    const opp=root==="b"?"w":"b";
    const score=game.score();
    if(score.empty===0 || (game.legalMoves(root).length===0 && game.legalMoves(opp).length===0)){
      if(score[root]>score[opp]) return 100000;
      if(score[root]<score[opp]) return -100000;
      return 0;
    }
    let positional=0;
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(game.board[r][c]) positional+=(game.board[r][c]===root?1:-1)*WEIGHTS[r][c];
    const mobility=game.legalMoves(root).length-game.legalMoves(opp).length;
    const cornerCount=[[0,0],[0,7],[7,0],[7,7]].reduce((n,[r,c])=>n+(game.board[r][c]===root?1:game.board[r][c]===opp?-1:0),0);
    const discDiff=score[root]-score[opp];
    return positional + mobility*8 + cornerCount*45 + discDiff*(score.empty<20?4:1);
  }
  function depthFor(difficulty){ return difficulty==="easy"?1:difficulty==="hard"?4:difficulty==="expert"?5:3; }
  function alphaBeta(game,root,depth,alpha,beta){
    const status=game.gameStatus();
    if(depth<=0||status.over)return{score:evaluate(game,root),move:null};
    let moves=game.legalMoves(game.turn);
    if(!moves.length){
      const before=snapshot(game); game.turn=game.turn==="b"?"w":"b";
      const result=alphaBeta(game,root,depth-1,alpha,beta); restoreTemp(game,before); return result;
    }
    moves=[...moves].sort((a,b)=>WEIGHTS[b.r][b.c]-WEIGHTS[a.r][a.c]);
    const maximizing=game.turn===root;
    let best={score:maximizing?-INF:INF,move:null};
    for(const move of moves){
      const before=applyTemp(game,move);
      const result=alphaBeta(game,root,depth-1,alpha,beta);
      restoreTemp(game,before);
      if(maximizing){if(result.score>best.score)best={score:result.score,move};alpha=Math.max(alpha,result.score);}else{if(result.score<best.score)best={score:result.score,move};beta=Math.min(beta,result.score);}
      if(beta<=alpha)break;
    }
    return best;
  }
  function chooseMove(game,difficulty="normal"){
    const moves=game.legalMoves(game.turn); if(!moves.length)return null;
    if(difficulty==="easy")return moves[Math.floor(Math.random()*moves.length)];
    const searchGame=new game.constructor();
    searchGame.restore(game.clone());
    return alphaBeta(searchGame,game.turn,depthFor(difficulty),-INF,INF).move||moves[0];
  }
  window.ReversiAI={chooseMove};
})();
