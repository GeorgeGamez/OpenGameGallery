(function(){
  "use strict";
  const points = c => c.suit === "♥" ? 1 : c.suit === "♠" && c.rank === 12 ? 13 : 0;
  function choosePass(hand){
    const sorted=[...hand].sort((a,b)=>{
      const av=(a.suit==="♠"&&a.rank===12?100:0)+(a.suit==="♠"?a.rank*2:0)+(a.suit==="♥"?a.rank:0)+(a.rank===1?5:0);
      const bv=(b.suit==="♠"&&b.rank===12?100:0)+(b.suit==="♠"?b.rank*2:0)+(b.suit==="♥"?b.rank:0)+(b.rank===1?5:0);
      return bv-av;
    });
    return sorted.slice(0,3).map(c=>c.id);
  }
  function choosePlay(game, playerIndex){
    const legal=game.legalCards(playerIndex); if(!legal.length)return null;
    const trick=game.trick; const leadSuit=trick.length?trick[0].card.suit:null;
    const currentWinning=game.winningPlayIndex();
    const pointsInTrick=trick.reduce((n,p)=>n+points(p.card),0);
    const scored=legal.map(card=>{
      const follows=leadSuit===null||card.suit===leadSuit;
      const isLead=trick.length===0;
      let value=0;
      if(points(card)) value+=points(card)*8;
      if(card.suit==="♠"&&card.rank===12)value+=80;
      if(isLead){
        if(card.suit==="♥"&&!game.heartsBroken)value+=35;
        value+=card.rank*0.15;
      }else{
        const candidate=[...trick,{player:playerIndex,card}];
        const winner=game.winningPlayIndex(candidate);
        const wins=winner===candidate.length-1;
        if(pointsInTrick>0&&wins)value-=28;
        else if(!pointsInTrick&&wins)value+=card.rank*0.3;
        if(!follows)value-=points(card)*2;
      }
      // Prefer discarding high cards from suits that are already short.
      const suitCount=game.hands[playerIndex].filter(c=>c.suit===card.suit).length;
      if(suitCount===1&&card.suit!=="♥")value-=card.rank*0.2;
      return {card,value};
    }).sort((a,b)=>a.value-b.value);
    return scored[0].card.id;
  }
  window.HeartsAI={choosePass,choosePlay};
})();
