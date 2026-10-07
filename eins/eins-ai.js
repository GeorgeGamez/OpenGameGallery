"use strict";
(function(){
  function chooseColor(hand, side){
    const counts={red:0,yellow:0,green:0,blue:0,pink:0,teal:0,orange:0,purple:0};
    for(const card of hand || []){
      const face=card?.[side];
      if(face?.color && counts[face.color] !== undefined) counts[face.color]++;
    }
    return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  }

  function chooseCard(game, player){
    const hand=game?.hands?.[player] || [];
    const side=game?.side;
    const top=game?.discard?.at(-1);
    if(game?.drawnCardId!==null && game?.drawnCardId!==undefined){
      return hand.find(card=>card?.id===game.drawnCardId && game.canPlay(card,player)) || null;
    }
    const topFace=top?.[side];
    const playable=hand.filter(card => card && game.canPlay(card,player));
    if(!playable.length) return null;
    const priority={wild:0,drawFour:1,drawTwo:2,drawFive:2,drawColor:1,skipEveryone:3,skip:4,reverse:5,flip:6,drawOne:2,number:10};
    const score=face=>{
      if(!face) return 99;
      return (priority[face.type] ?? 8) + (face.color && face.color===topFace?.color ? -2 : 0);
    };
    return playable.sort((a,b)=>score(a[side])-score(b[side]))[0];
  }
  window.EinsAI={chooseColor,chooseCard};
})();
