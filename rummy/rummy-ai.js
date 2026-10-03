"use strict";
(function(){
  function usefulness(card, hand) {
    let score=0;
    for(const other of hand){if(other.id===card.id)continue;
      if(other.rank===card.rank) score+=3;
      if(other.suit===card.suit && Math.abs(other.rank-card.rank)<=2) score+=Math.abs(other.rank-card.rank)===1?3:1;
    }
    return score;
  }
  function chooseDiscard(hand){return [...hand].sort((a,b)=>usefulness(a,hand)-usefulness(b,hand)||b.rank-a.rank)[0];}
  window.RummyAI={chooseDiscard};
})();
