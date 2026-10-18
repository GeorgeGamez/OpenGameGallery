(function(){
  "use strict";
  function chooseCard(game, playerIndex){
    const hand=game.hands[playerIndex]||[];
    const playable=hand.filter(c=>game.isPlayable(c,playerIndex));
    if(!playable.length)return null;
    const counts={"♣":0,"♦":0,"♥":0,"♠":0};
    hand.filter(c=>c.rank!==8).forEach(c=>counts[c.suit]++);
    const preferredSuit=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    // Win immediately if possible; otherwise save wild eights while a normal card works.
    const finisher=playable.find(c=>hand.length===1);
    let card=finisher||playable.filter(c=>c.rank!==8).sort((a,b)=>{
      const aKeep=counts[a.suit],bKeep=counts[b.suit];
      return bKeep-aKeep||a.rank-b.rank;
    })[0]||playable.sort((a,b)=>a.rank-b.rank)[0];
    return {cardId:card.id,suit:preferredSuit};
  }
  window.CrazyEightsAI={chooseCard};
})();
