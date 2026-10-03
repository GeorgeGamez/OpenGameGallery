"use strict";
(function(){
 function chooseColor(hand,side){const counts={red:0,yellow:0,green:0,blue:0,pink:0,teal:0,orange:0,purple:0};for(const c of hand){const face=c[side];if(face.color&&counts[face.color]!==undefined)counts[face.color]++}return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]}
 function chooseCard(game,player){const hand=game.hands[player],side=game.side,top=game.discard.at(-1),face=top?.[side];const playable=hand.filter(c=>game.canPlay(c,player));if(!playable.length)return null;return playable.sort((a,b)=>{const af=a[side],bf=b[side];const score=c=>({wild:0,drawFour:1,drawTwo:2,drawFive:2,drawColor:1,skipEveryone:3,skip:4,reverse:5,flip:6,drawOne:2,number:10}[c[side].type]||8)+(c[side].color===face?.color?-2:0);return score(af)-score(bf)})[0]}
 window.EinsAI={chooseColor,chooseCard};
})();