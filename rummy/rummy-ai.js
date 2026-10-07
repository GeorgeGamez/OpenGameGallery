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
  function canMeldWithCard(card,pool){
    const sameRank=[...new Map(pool.filter(c=>c.rank===card.rank).map(c=>[c.suit,c])).values()];
    if(sameRank.length>=3)return true;
    const ranks=[...new Set(pool.filter(c=>c.suit===card.suit).map(c=>c.rank))].sort((a,b)=>a-b);
    if(!ranks.includes(card.rank))return false;
    let run=1;
    for(let r=card.rank-1;r>=1&&ranks.includes(r);r--)run++;
    for(let r=card.rank+1;r<=13&&ranks.includes(r);r++)run++;
    return run>=3;
  }
  function chooseDiscardTake(discard,hand){
    for(let i=0;i<discard.length;i++){
      const taken=discard.slice(0,i+1), required=taken[taken.length-1];
      if(canMeldWithCard(required,[...hand,...taken])) return {index:i};
    }
    return null;
  }
  window.RummyAI={chooseDiscard,chooseDiscardTake};
})();
