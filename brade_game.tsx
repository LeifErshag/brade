import { useState, useEffect, useRef } from "react";

// ── i18n ──────────────────────────────────────────────────────────────────────
const LANG = {
  en: {
    title:"Bräde", subtitle:"Swedish Tables",
    white:"White", black:"Black", bar:"Bar", off:"Off",
    toggle:"Svenska", roll:"Roll Dice", pass:"Pass Turn",
    newGame:"New Game", rematch:"Rematch", undo:"Undo",
    yourTurn:(p)=>`${p}'s turn`, noMoves:"No legal moves - pass turn", rolled:"Rolled",
    wins:(p,w,m)=>`${p} wins by ${w}${m?" with Monk":""}!`,
    winTypes:{forced_jan:"Forced Jan",jan:"Jan",single_crown:"Single Crown",
      double_crown:"Double Crown",staircase:"Staircase",tower:"Tower",bear_off:"Bearing Off"},
    monk:"Monk", points:"pts", score:"Score", thinking:"Thinking...",
    vsHuman:"vs Human", vsAI:"vs AI",
    playAs:"Play as", difficulty:"Difficulty",
    beginner:"Beginner", journeyman:"Journeyman", master:"Master",
    startGame:"Start Game", matchLength:"Match length",
    aiLabel:(d)=>d==="beginner"?"Beginner AI":d==="journeyman"?"Journeyman AI":"Master AI",
    moveLog:"Move Log", rules:"Rules", close:"Close",
    random:"Random opponent",
    rulesText:`BRÄDE — RULES SUMMARY

SETUP
Each player stacks all 15 checkers on the opponent's home point (far right on opponent's side). Both players move counter-clockwise.

MOVEMENT
Roll two dice and move one or two checkers. A combined move must touch down on an intermediate point. Doubles = four moves. You must use both dice if possible; if only one is possible, use the larger.

CLOSING POINTS (BAND)
On your own side (Q3+Q4): any point may be closed (2+ checkers).
On the opponent's side (Q1+Q2): only the HEAD (starting point) and the HUK (last point of Q2) may be closed.

HITTING
A lone checker (blot) is hit when the opponent lands on it — sent to the bar. Checkers on the bar must re-enter in Q1 before any other move. You cannot re-enter on your own home point if it is occupied.

FIVE-PRIME
Five consecutive closed points = a prime. To pass, you must first place a checker in front of the prime, then roll a 6.

FORCING
If opponent has a prime of 6+ points, you may force (land on) any point in it, sending all checkers there to the bar.
If your bar checkers exceed accessible points in your Q1, you may force closed Q1 points.
Exception: if you have only 1 checker left, forcing is disabled.

BEARING OFF
Once all checkers are in Q4, bear off from the backmost point only. A die that overshoots still bears off. You must advance checkers if you cannot bear off.

WIN CONDITIONS & SCORING
Forced Jan .............. 6 pts
Jan ..................... 4 pts
Handsome game + Monk .... 3 pts
Handsome game ........... 2 pts
Bear off + Monk ......... 2 pts
Bear off ................ 1 pt

HANDSOME GAMES
Single crown: 3 checkers on each of the last 5 points.
Double crown: 5 checkers on each of the last 3 points.
Staircase: 7 on last, 5 on 2nd-last, 3 on 3rd-last.
Tower: all 15 on the last point.

MONK: opponent has checkers on the bar when you win.
JAN: opponent cannot re-enter all bar checkers.
JUNKER: player who cannot move at all — must pass.`,
    rulesTextSv: null,
    logMove:(from,to,die,color,force)=>{
      const f=from==="bar"?"Bar":from;
      const t=to==="off"?"Off":to;
      return `${color==="white"?"●":"○"} ${f}→${t} (${die})${force?" FORCE":""}`;
    },
  },
  sv: {
    title:"Bräde", subtitle:"Svenskt Brädspel",
    white:"Vit", black:"Svart", bar:"Baren", off:"Av",
    toggle:"English", roll:"Slå tärning", pass:"Passa",
    newGame:"Nytt spel", rematch:"Spela igen", undo:"Ångra",
    yourTurn:(p)=>`${p}s tur`, noMoves:"Inga lagliga drag - passa", rolled:"Slog",
    wins:(p,w,m)=>`${p} vinner på ${w}${m?" med Munk":""}!`,
    winTypes:{forced_jan:"Tvingad jan",jan:"Jan",single_crown:"Enkla kronan",
      double_crown:"Dubbla kronan",staircase:"Trappan",tower:"Tornet",bear_off:"Bär av"},
    monk:"Munk", points:"p", score:"Poäng", thinking:"Tänker...",
    vsHuman:"mot Människa", vsAI:"mot Dator",
    playAs:"Spela som", difficulty:"Svårighetsgrad",
    beginner:"Nybörjare", journeyman:"Gesäll", master:"Mästare",
    startGame:"Starta", matchLength:"Matchlängd",
    aiLabel:(d)=>d==="beginner"?"Nybörjar-AI":d==="journeyman"?"Gesäll-AI":"Mästar-AI",
    moveLog:"Draglogg", rules:"Regler", close:"Stäng",
    random:"Slumpmotståndare",
    rulesText:`BRÄDE — REGELSAMMANFATTNING

UPPSTART
Varje spelare staplar alla 15 pjäser på motståndarens hempunkt (längst till höger på motståndarens sida). Båda spelarna rör sig moturs.

FÖRFLYTTNING
Slå två tärningar och flytta en eller två pjäser. En kombinerad flytt måste landa på en mellanpunkt. Dubbletter = fyra drag. Du måste använda båda tärningarna om möjligt; annars den större.

ATT LÄGGA BAND
På din egen sida (K3+K4): vilken punkt som helst får ha band (2+ pjäser).
På motståndarens sida (K1+K2): endast HUKET (startpunkten) och HUKENS GRANNE (sista punkten i K2) får ha band.

TRÄFF
En ensam pjäs (singel) träffas när motståndaren landar på den — skickas till baren. Pjäser på baren måste återinföras i K1 innan andra drag. Du kan inte återinföra på din hempunkt om den är belagd.

FEMRAD
Fem sammanhängande stängda punkter = en rad. För att passera måste du först placera en pjäs framför raden, sedan slå en 6:a.

TVINGA
Om motståndaren har en rad på 6+ punkter, kan du tvinga (landa på) vilken punkt som helst i den.
Om dina barpjäser överstiger tillgängliga punkter i din K1, kan du tvinga stängda K1-punkter.
Undantag: om du bara har 1 pjäs kvar är tvingande inaktiverat.

BÄRANDE AV
När alla pjäser är i K4, bär av från den bakre punkten. En tärning som overshoots bär ändå av. Du måste flytta pjäser om du inte kan bära av.

VINSTSÄTT & POÄNG
Tvingad jan ............. 6 p
Jan ..................... 4 p
Vackert spel + Munk ..... 3 p
Vackert spel ............ 2 p
Bär av + Munk ........... 2 p
Bär av .................. 1 p

VACKRA SPEL
Enkla kronan: 3 pjäser på var och en av de sista 5 punkterna.
Dubbla kronan: 5 pjäser på var och en av de sista 3 punkterna.
Trappan: 7 på sista, 5 på näst sista, 3 på tredje sista.
Tornet: alla 15 på sista punkten.

MUNK: motståndaren har pjäser på baren när du vinner.
JAN: motståndaren kan inte återinföra alla barpjäser.
JUNKER: spelare som inte kan röra sig alls — måste passa.`,
    logMove:(from,to,die,color,force)=>{
      const f=from==="bar"?"Bar":from;
      const t=to==="off"?"Av":to;
      return `${color==="white"?"●":"○"} ${f}→${t} (${die})${force?" TVINGA":""}`;
    },
  }
};

const WIN_POINTS={forced_jan:6,jan:4,single_crown:2,double_crown:2,staircase:2,tower:2,bear_off:1};
function winScore(type,monk){
  const base=WIN_POINTS[type]||1;
  return (monk&&type!=="jan"&&type!=="forced_jan")?base+1:base;
}

// ── Game logic (same as before) ───────────────────────────────────────────────
const TOP_PTS=[13,14,15,16,17,18,19,20,21,22,23,24];
const BOT_PTS=[12,11,10,9,8,7,6,5,4,3,2,1];
function isTop(pt){return TOP_PTS.includes(pt);}
function dir(c){return c==="white"?-1:1;}
function opp(c){return c==="white"?"black":"white";}
function inQ4(c,pt){return c==="white"?pt>=1&&pt<=6:pt>=19&&pt<=24;}
function allInQ4(pts,c){for(let p=1;p<=24;p++)if(pts[p][c]>0&&!inQ4(c,p))return false;return true;}

function getDefenderPrimes(pts,mover){
  const owner=opp(mover);
  const seq=mover==="white"?Array.from({length:24},(_,i)=>24-i):Array.from({length:24},(_,i)=>i+1);
  const primes=[];let run=0,ri=0;
  for(let i=0;i<seq.length;i++){
    const pt=seq[i],closed=pts[pt][owner]>=2&&pts[pt][mover]===0;
    if(closed){if(run===0)ri=i;run++;}
    else{if(run>=2)primes.push({pts_list:seq.slice(ri,i),length:run});run=0;}
  }
  if(run>=2)primes.push({pts_list:seq.slice(seq.length-run),length:run});
  return primes;
}

function getForceablePoints(pts,bar,off,mover){
  const o=opp(mover);
  let mc=bar[mover];for(let p=1;p<=24;p++)mc+=pts[p][mover];
  if(mc<=1)return new Set();
  const forceable=new Set();
  const primes=getDefenderPrimes(pts,mover);
  if(primes.some(pr=>pr.length>5))primes.filter(pr=>pr.length>5).forEach(pr=>pr.pts_list.forEach(p=>forceable.add(p)));
  const q1=mover==="white"?[19,20,21,22,23,24]:[1,2,3,4,5,6];
  const accessible=q1.filter(p=>pts[p][mover]===0||pts[p][o]===1).length;
  if(bar[mover]>0&&bar[mover]>accessible)q1.forEach(p=>{if(pts[p][o]>=2)forceable.add(p);});
  return forceable;
}

function canClose(color,pt){
  if(color==="white")return!(pt>=13&&pt<=24)||(pt===24||pt===13);
  return!(pt>=1&&pt<=12)||(pt===1||pt===12);
}
function isHuk(color,pt){return color==="white"?pt===13:pt===12;}
function wouldClose(pts,color,pt){return pts[pt][color]>=1&&pts[pt][opp(color)]===0;}
function barEntryPt(color,die){return color==="white"?25-die:die;}
function canLandOn(pts,color,pt,forceable){
  if(pt<1||pt>24)return false;
  if(pts[pt][opp(color)]>=2)return forceable.has(pt);
  return true;
}
function applyLargestDie(moves,dice){
  if(moves.length>0&&dice.length===2&&dice[0]!==dice[1]){
    const hi=Math.max(...dice),lo=Math.min(...dice);
    const hh=moves.some(m=>m.die===hi),hl=moves.some(m=>m.die===lo);
    if(hh&&!hl)return moves.filter(m=>m.die===hi);
    if(!hh&&hl)return moves.filter(m=>m.die===lo);
  }
  return moves;
}

function genNormalMoves(state){
  const{pts,bar,off,dice,turn:color}=state;
  const o=opp(color),moves=[],tried=new Set();
  const uDice=[...new Set(dice)];
  const forceable=getForceablePoints(pts,bar,off,color);
  const homePoint=color==="white"?24:1;
  if(bar[color]>0){
    uDice.forEach(die=>{
      const to=barEntryPt(color,die);
      const key=`bar-${to}-${die}`;
      if(tried.has(key))return;tried.add(key);
      if(!canLandOn(pts,color,to,forceable))return;
      if(pts[to][o]<2&&wouldClose(pts,color,to)&&!canClose(color,to))return;
      if(to===homePoint&&pts[to][color]>0)return;
      moves.push({from:"bar",to,die,force:forceable.has(to)&&pts[to][o]>=2});
    });
    return applyLargestDie(moves,dice);
  }
  for(let pt=1;pt<=24;pt++){
    if(pts[pt][color]<=0)continue;
    uDice.forEach(die=>{
      const to=pt+dir(color)*die;
      const key=`${pt}-${to}-${die}`;
      if(tried.has(key))return;tried.add(key);
      if(!canLandOn(pts,color,to,forceable))return;
      if(pts[to][o]<2&&wouldClose(pts,color,to)&&!canClose(color,to))return;
      moves.push({from:pt,to,die,force:forceable.has(to)&&pts[to][o]>=2});
    });
  }
  return applyLargestDie(moves,dice);
}

function backmostPt(pts,color){
  if(color==="white"){for(let p=6;p>=1;p--)if(pts[p][color]>0)return p;}
  else{for(let p=19;p<=24;p++)if(pts[p][color]>0)return p;}
  return null;
}
function distToExit(color,pt){return color==="white"?pt:25-pt;}

function genBearOffMoves(state){
  const{pts,bar,dice,turn:color}=state;
  if(bar[color]>0||!allInQ4(pts,color))return[];
  const moves=[],tried=new Set(),uDice=[...new Set(dice)];
  const bm=backmostPt(pts,color);if(!bm)return[];
  const o=opp(color);
  uDice.forEach(die=>{
    const dist=distToExit(color,bm);
    if(die>=dist){
      const key=`${bm}-off-${die}`;
      if(!tried.has(key)){tried.add(key);moves.push({from:bm,to:"off",die,force:false});}
    } else {
      const q4=color==="white"?[6,5,4,3,2,1]:[19,20,21,22,23,24];
      for(const from of q4){
        if(pts[from][color]<=0)continue;
        const to=from+dir(color)*die;
        if(!inQ4(color,to))continue;
        if(pts[to][o]>=2)continue;
        const key=`${from}-${to}-${die}`;
        if(!tried.has(key)){tried.add(key);moves.push({from,to,die,force:false});}
      }
    }
  });
  return applyLargestDie(moves,dice);
}

function genMoves(state){
  if(allInQ4(state.pts,state.turn)&&state.bar[state.turn]===0)return genBearOffMoves(state);
  return genNormalMoves(state);
}

function checkHandsome(pts,off,color){
  if((off[color]||0)>0)return null;
  const q4=color==="white"?[1,2,3,4,5,6]:[19,20,21,22,23,24];
  if(q4.reduce((s,p)=>s+pts[p][color],0)!==15)return null;
  const last=color==="white"?1:24;
  if(pts[last][color]===15)return"tower";
  const p2=color==="white"?2:23,p3=color==="white"?3:22;
  if(pts[last][color]===7&&pts[p2][color]===5&&pts[p3][color]===3)return"staircase";
  if(pts[last][color]===5&&pts[p2][color]===5&&pts[p3][color]===5)return"double_crown";
  const last5=color==="white"?[1,2,3,4,5]:[20,21,22,23,24];
  if(last5.every(p=>pts[p][color]===3))return"single_crown";
  return null;
}

function checkJan(pts,bar,winner,wasForce){
  const loser=opp(winner);
  if(bar[loser]===0)return null;
  const q1=loser==="white"?[19,20,21,22,23,24]:[1,2,3,4,5,6];
  const accessible=q1.filter(p=>{
    if(pts[p][loser]>=1)return false;
    if(pts[p][winner]>=2)return false;
    return true;
  }).length;
  if(bar[loser]>accessible)return wasForce?"forced_jan":"jan";
  return null;
}

function applyMoveToState(state,move){
  const s={...state,pts:state.pts.map(p=>({...p})),bar:{...state.bar},off:{...state.off},
    dice:[...state.dice],score:{...state.score},legalMoves:[],selected:null};
  const color=s.turn,o=opp(color);
  const wasForce=!!move.force;
  if(move.from==="bar"){if(s.bar[color]>0)s.bar[color]--;}
  else if(move.from!=="off"&&move.from!==null){if(s.pts[move.from][color]>0)s.pts[move.from][color]--;}
  if(move.to==="off"){
    s.off[color]=(s.off[color]||0)+1;
  } else {
    if(wasForce||(s.pts[move.to][o]===1)){s.bar[o]+=s.pts[move.to][o];s.pts[move.to][o]=0;}
    s.pts[move.to][color]++;
  }
  const dieIdx=s.dice.indexOf(move.die);
  if(dieIdx>=0)s.dice.splice(dieIdx,1);
  const h=checkHandsome(s.pts,s.off,color);
  if(h){const monk=s.bar[o]>0,sc=winScore(h,monk);
    return{...s,gameOver:true,winner:color,winType:h,monk,score:{...s.score,[color]:s.score[color]+sc},message:""};}
  const jt=checkJan(s.pts,s.bar,color,wasForce);
  if(jt){const sc=winScore(jt,false);
    return{...s,gameOver:true,winner:color,winType:jt,monk:false,score:{...s.score,[color]:s.score[color]+sc},message:""};}
  if((s.off[color]||0)===15){const monk=s.bar[o]>0,sc=winScore("bear_off",monk);
    return{...s,gameOver:true,winner:color,winType:"bear_off",monk,score:{...s.score,[color]:s.score[color]+sc},message:""};}
  const next=genMoves(s);
  if(s.dice.length===0||next.length===0){s.turn=o;s.dice=[];s.rolled=false;s.legalMoves=[];s.message="";}
  else{s.legalMoves=next;s.message=s.dice.join(" · ");}
  return s;
}

function rollDice(){
  const d1=Math.ceil(Math.random()*6),d2=Math.ceil(Math.random()*6);
  return d1===d2?[d1,d1,d1,d1]:[d1,d2];
}
function initState(score={white:0,black:0}){
  const pts=Array.from({length:25},()=>({white:0,black:0}));
  pts[24].white=15;pts[1].black=15;
  return{pts,bar:{white:0,black:0},off:{white:0,black:0},
    turn:"white",dice:[],rolled:false,selected:null,legalMoves:[],message:"",
    gameOver:false,winner:null,winType:null,monk:false,score};
}

// ── AI ────────────────────────────────────────────────────────────────────────
function scorePosition(pts,bar,off,color){
  const o=opp(color);let score=0;
  let myPips=0,oppPips=0;
  for(let p=1;p<=24;p++){
    if(pts[p][color]>0)myPips+=pts[p][color]*(color==="white"?p:25-p);
    if(pts[p][o]>0)oppPips+=pts[p][o]*(o==="white"?p:25-p);
  }
  myPips+=bar[color]*25;oppPips+=bar[o]*25;
  score+=(oppPips-myPips)*2;
  for(let p=1;p<=24;p++){
    if(pts[p][color]>=2){score+=3;if(isHuk(color,p))score+=12;}
    if(pts[p][o]>=2)score-=2;
  }
  for(let p=1;p<=24;p++){
    if(pts[p][color]===1)score-=4;
    if(pts[p][o]===1)score+=3;
  }
  score-=bar[color]*8;score+=bar[o]*8;
  getDefenderPrimes(pts,o).forEach(pr=>score+=pr.length*pr.length*2);
  const q1o=o==="white"?[19,20,21,22,23,24]:[1,2,3,4,5,6];
  const acc=q1o.filter(p=>pts[p][o]===0||pts[p][color]>=1).length;
  if(bar[o]>acc)score+=50*(bar[o]-acc);
  score+=(off[color]||0)*10-(off[o]||0)*10;
  return score;
}
function aiBeginner(moves){return moves[Math.floor(Math.random()*moves.length)];}
function aiJourneyman(state){
  const moves=state.legalMoves;if(!moves.length)return null;
  let best=null,bestScore=-Infinity;
  for(const m of moves){const ns=applyMoveToState(state,m);const sc=scorePosition(ns.pts,ns.bar,ns.off,state.turn);if(sc>bestScore){bestScore=sc;best=m;}}
  return best;
}
function aiMaster(state){
  const moves=state.legalMoves;if(!moves.length)return null;
  let best=null,bestScore=-Infinity;
  for(const m of moves){
    let ns=applyMoveToState(state,m);let iter=0;
    while(!ns.gameOver&&ns.turn===state.turn&&ns.dice.length>0&&ns.legalMoves.length>0&&iter<4){
      let fb=null,fsc=-Infinity;
      for(const fm of ns.legalMoves){const fns=applyMoveToState(ns,fm);const s=scorePosition(fns.pts,fns.bar,fns.off,state.turn);if(s>fsc){fsc=s;fb=fm;}}
      if(!fb)break;ns=applyMoveToState(ns,fb);iter++;
    }
    const sc=scorePosition(ns.pts,ns.bar,ns.off,state.turn);
    if(sc>bestScore){bestScore=sc;best=m;}
  }
  return best;
}
function pickAiMove(state,difficulty){
  const moves=state.legalMoves;if(!moves.length)return null;
  if(difficulty==="beginner")return aiBeginner(moves);
  if(difficulty==="journeyman")return aiJourneyman(state);
  return aiMaster(state);
}

// ── SVG ───────────────────────────────────────────────────────────────────────
const W=800,H=500,MARGIN=28,BAR_W=40;
const BOARD_W=W-2*MARGIN,BOARD_H=H-2*MARGIN;
const HALF_W=(BOARD_W-BAR_W)/2;
const PT_W=HALF_W/6,PT_H=BOARD_H*0.43;
const CR=Math.min(PT_W*0.42,17);
const BG="#c8934a",FRAME="#6b3a10",INNER="#8b4e18";
const TD="#5c2e08",TL="#e8b86d",BAR_C="#7a4418",BAR_S="#5c3010";
const LEGAL="rgba(80,255,140,0.5)",SEL="rgba(255,255,255,0.22)",HINT="rgba(255,255,255,0.08)";
const FORCE_COL="rgba(255,120,50,0.55)",PRIME5_COL="rgba(255,200,50,0.25)";

function ptCX(pt){
  const col=isTop(pt)?TOP_PTS.indexOf(pt):BOT_PTS.indexOf(pt);
  const side=col<6?"left":"right";
  return MARGIN+(side==="right"?HALF_W+BAR_W:0)+(col%6)*PT_W+PT_W/2;
}
function triPts(pt){
  const col=isTop(pt)?TOP_PTS.indexOf(pt):BOT_PTS.indexOf(pt);
  const side=col<6?"left":"right";
  const bx=MARGIN+(side==="right"?HALF_W+BAR_W:0)+(col%6)*PT_W;
  if(isTop(pt))return `${bx},${MARGIN} ${bx+PT_W},${MARGIN} ${bx+PT_W/2},${MARGIN+PT_H}`;
  return `${bx},${MARGIN+BOARD_H} ${bx+PT_W},${MARGIN+BOARD_H} ${bx+PT_W/2},${MARGIN+BOARD_H-PT_H}`;
}
function checkerY(pt,i,n){
  const sp=Math.min(CR*2.1,(PT_H-CR*2.5)/Math.max(n-1,1));
  return isTop(pt)?MARGIN+CR+6+i*sp:MARGIN+BOARD_H-CR-6-i*sp;
}
function ptCenter(pt){
  if(pt==="bar-white")return{x:MARGIN+HALF_W+BAR_W/2,y:MARGIN+BOARD_H*0.25};
  if(pt==="bar-black")return{x:MARGIN+HALF_W+BAR_W/2,y:MARGIN+BOARD_H*0.75};
  if(pt==="off-white")return{x:W-MARGIN/2,y:MARGIN+BOARD_H*0.25};
  if(pt==="off-black")return{x:W-MARGIN/2,y:MARGIN+BOARD_H*0.75};
  return{x:ptCX(pt),y:isTop(pt)?MARGIN+CR+6:MARGIN+BOARD_H-CR-6};
}

function AnimChecker({color,fromPt,toPt,onDone}){
  const startKey=fromPt==="bar"?`bar-${color}`:fromPt;
  const endKey=toPt==="off"?`off-${color}`:toPt;
  const start=ptCenter(startKey),target=ptCenter(endKey);
  const [pos,setPos]=useState(start);
  const onDoneRef=useRef(onDone);onDoneRef.current=onDone;
  useEffect(()=>{
    const dur=350,t0=performance.now();let raf,finished=false;
    function step(now){
      const t=Math.min((now-t0)/dur,1);
      const ease=t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
      setPos({x:start.x+(target.x-start.x)*ease,y:start.y+(target.y-start.y)*ease});
      if(t<1){raf=requestAnimationFrame(step);}
      else if(!finished){finished=true;setTimeout(()=>onDoneRef.current(),0);}
    }
    raf=requestAnimationFrame(step);
    return()=>{cancelAnimationFrame(raf);finished=true;};
  },[]);
  const fill=color==="white"?"#f5edd0":"#2a1800";
  const stroke=color==="white"?"#c8a050":"#6b3a10";
  return (
    <g style={{pointerEvents:"none"}}>
      <circle cx={pos.x} cy={pos.y} r={CR*1.1} fill={fill} stroke={stroke} strokeWidth="2.5" opacity="0.95"/>
      <circle cx={pos.x} cy={pos.y} r={CR*0.62} fill="none" stroke={stroke} strokeWidth="0.7" opacity="0.4"/>
      <ellipse cx={pos.x-CR*0.27} cy={pos.y-CR*0.27} rx={CR*0.24} ry={CR*0.17} fill={color==="white"?"#ffffffcc":"#ffffff33"}/>
    </g>
  );
}

function OffTray({color,n,glowing,onClick}){
  const fill=color==="white"?"#f5edd0":"#2a1800";
  const stroke=color==="white"?"#c8a050":"#6b3a10";
  const x=W-MARGIN+5,w=MARGIN-9,isW=color==="white";
  const ty=isW?MARGIN:MARGIN+BOARD_H/2+5,th=BOARD_H/2-5;
  const y0=isW?MARGIN+4:MARGIN+BOARD_H/2+8,maxH=BOARD_H/2-14;
  const sp=Math.min(CR*1.5,maxH/Math.max(n,1));
  const circles=[];
  for(let i=0;i<Math.min(n,15);i++){
    const cy=isW?y0+i*sp+CR:y0+maxH-i*sp-CR;
    circles.push(<circle key={i} cx={x+w/2} cy={cy} r={Math.min(CR*0.7,w/2-1)} fill={fill} stroke={stroke} strokeWidth="1.5" style={{pointerEvents:"none"}}/>);
  }
  return (
    <g onClick={glowing?onClick:undefined} style={{cursor:glowing?"pointer":"default"}}>
      <rect x={W-MARGIN+3} y={ty} width={MARGIN-6} height={th} rx={3} fill={BAR_C}
        stroke={glowing?"rgba(80,255,140,0.9)":"none"} strokeWidth="2"/>
      {circles}
      {n>0&&<text x={x+w/2} y={isW?y0+maxH-4:y0+4} textAnchor="middle" fontSize="10"
        fill={isW?"#e8b86d":"#f5edd0"} fontWeight="bold"
        dominantBaseline={isW?"auto":"hanging"} style={{pointerEvents:"none"}}>{n}</text>}
      <rect x={W-MARGIN+3} y={ty} width={MARGIN-6} height={th} rx={3} fill="transparent"/>
    </g>
  );
}

function DieFace({val,color,shake}){
  const dotMap={1:[[50,50]],2:[[25,25],[75,75]],3:[[25,25],[50,50],[75,75]],
    4:[[25,25],[75,25],[25,75],[75,75]],5:[[25,25],[75,25],[50,50],[25,75],[75,75]],
    6:[[25,22],[75,22],[25,50],[75,50],[25,78],[75,78]]};
  const dots=dotMap[val]||[];
  const df=color==="white"?"#f5edd0":"#2a1800";
  const ds=color==="white"?"#c8a050":"#6b3a10";
  const dd=color==="white"?"#2a1800":"#e8b86d";
  return (
    <div style={{display:"inline-block",animation:shake?"shake 0.4s ease":"none"}}>
      <svg width={44} height={44}>
        <rect x={2} y={2} width={40} height={40} rx={7} fill={df} stroke={ds} strokeWidth="2"/>
        {dots.map(([dx,dy],i) => (
          <circle key={i} cx={dx*0.4+2} cy={dy*0.4+2} r={3.5} fill={dd}/>
        ))}
      </svg>
    </div>
  );
}

function DiceRow({gs,animDice}){
  const whiteDice=gs.turn==="white"?gs.dice:(animDice?.color==="white"?animDice.values:[]);
  const blackDice=gs.turn==="black"?gs.dice:(animDice?.color==="black"?animDice.values:[]);
  return (
    <div style={{display:"flex",gap:24,alignItems:"center",justifyContent:"center",minWidth:300}}>
      <div style={{display:"flex",gap:5,alignItems:"center"}}>
        {whiteDice.length>0?whiteDice.map((d,i) => <DieFace key={i} val={d} color="white" shake={!!(animDice?.color==="white")}/>)
          :<span style={{color:"#3a1a00",fontSize:20,letterSpacing:4}}>··</span>}
      </div>
      <div style={{display:"flex",gap:5,alignItems:"center"}}>
        {blackDice.length>0?blackDice.map((d,i) => <DieFace key={i} val={d} color="black" shake={!!(animDice?.color==="black")}/>)
          :<span style={{color:"#3a1a00",fontSize:20,letterSpacing:4}}>··</span>}
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({title,onClose,children}){
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:200}}
      onClick={onClose}>
      <div style={{background:"#1a0800",border:"1px solid #8a6030",borderRadius:12,
        padding:"24px",maxWidth:560,width:"90%",maxHeight:"80vh",display:"flex",
        flexDirection:"column",gap:12}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{color:"#e8b86d",fontSize:18,fontWeight:"bold"}}>{title}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#a07840",
            fontSize:20,cursor:"pointer",padding:"0 4px"}}>✕</button>
        </div>
        <div style={{overflowY:"auto",flex:1}}>{children}</div>
      </div>
    </div>
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function SetupScreen({onStart,lang,setLang,score}){
  const T=LANG[lang];
  const [mode,setMode]=useState("human");
  const [humanColor,setHumanColor]=useState("white");
  const [difficulty,setDifficulty]=useState("journeyman");
  const [matchLen,setMatchLen]=useState(5);
  const [showRules,setShowRules]=useState(false);
  function btn(active,onClick,label){
    return (
      <button onClick={onClick} style={{background:active?"#8a5020":"#3a1a00",
        color:active?"#e8b86d":"#a07840",border:`1px solid ${active?"#c8a050":"#5a3010"}`,
        borderRadius:6,padding:"7px 18px",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif"}}>
        {label}
      </button>
    );
  }
  const randomDiff=()=>{const d=["beginner","journeyman","master"];return d[Math.floor(Math.random()*d.length)];};
  return (
    <div style={{background:"#2a1400",minHeight:"100vh",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",gap:20}}>
      {showRules&&(
        <Modal title={T.rules} onClose={()=>setShowRules(false)}>
          <pre style={{color:"#c8a050",fontSize:12,lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"Georgia,serif"}}>{T.rulesText}</pre>
        </Modal>
      )}
      <div style={{textAlign:"center"}}>
        <div style={{color:"#e8b86d",fontSize:42,fontWeight:"bold",letterSpacing:4}}>{T.title}</div>
        <div style={{color:"#a07840",fontSize:15,marginTop:4}}>{T.subtitle}</div>
        {score&&(score.white>0||score.black>0)&&(
          <div style={{color:"#6a4020",fontSize:13,marginTop:6}}>
            {T.score}: {T.white} {score.white} – {score.black} {T.black}
          </div>
        )}
      </div>
      <div style={{background:"#1a0a00",border:"1px solid #5a3010",borderRadius:12,
        padding:"28px 36px",display:"flex",flexDirection:"column",gap:18,minWidth:360}}>
        <div>
          <div style={{color:"#c8a050",fontSize:11,marginBottom:8,letterSpacing:1}}>MODE</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {btn(mode==="human",()=>setMode("human"),T.vsHuman)}
            {btn(mode==="ai",()=>setMode("ai"),T.vsAI)}
            {btn(mode==="random",()=>setMode("random"),T.random)}
          </div>
        </div>
        {mode==="ai"&&(
          <>
            <div>
              <div style={{color:"#c8a050",fontSize:11,marginBottom:8,letterSpacing:1}}>{T.playAs.toUpperCase()}</div>
              <div style={{display:"flex",gap:8}}>
                {btn(humanColor==="white",()=>setHumanColor("white"),T.white)}
                {btn(humanColor==="black",()=>setHumanColor("black"),T.black)}
              </div>
            </div>
            <div>
              <div style={{color:"#c8a050",fontSize:11,marginBottom:8,letterSpacing:1}}>{T.difficulty.toUpperCase()}</div>
              <div style={{display:"flex",gap:8}}>
                {btn(difficulty==="beginner",()=>setDifficulty("beginner"),T.beginner)}
                {btn(difficulty==="journeyman",()=>setDifficulty("journeyman"),T.journeyman)}
                {btn(difficulty==="master",()=>setDifficulty("master"),T.master)}
              </div>
            </div>
          </>
        )}
        <div>
          <div style={{color:"#c8a050",fontSize:11,marginBottom:8,letterSpacing:1}}>{T.matchLength.toUpperCase()}</div>
          <div style={{display:"flex",gap:8}}>
            {[1,3,5,7].map(n=>btn(matchLen===n,()=>setMatchLen(n),n===1?"1":n+" "+T.points))}
          </div>
        </div>
        <button onClick={()=>{
          const d=mode==="random"?randomDiff():difficulty;
          const hc=mode==="random"?(Math.random()<0.5?"white":"black"):humanColor;
          onStart({mode:mode==="random"?"ai":mode,humanColor:mode==="human"?null:hc,difficulty:d,matchLen});
        }} style={{background:"#6b3a10",color:"#e8b86d",border:"1px solid #a06030",borderRadius:8,
          padding:"11px",cursor:"pointer",fontSize:15,fontFamily:"Georgia,serif",letterSpacing:1,marginTop:4}}>
          {T.startGame}
        </button>
      </div>
      <div style={{display:"flex",gap:16}}>
        <button onClick={()=>setShowRules(true)}
          style={{background:"transparent",color:"#6a4020",border:"none",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif"}}>
          {T.rules}
        </button>
        <button onClick={()=>setLang(l=>l==="sv"?"en":"sv")}
          style={{background:"transparent",color:"#6a4020",border:"none",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif"}}>
          {T.toggle}
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Brade(){
  const [lang,setLang]=useState("sv");
  const [config,setConfig]=useState(null);
  const [gs,setGs]=useState(null);
  const [anim,setAnim]=useState(null);
  const [animDice,setAnimDice]=useState(null);
  const [score,setScore]=useState({white:0,black:0});
  const [moveLog,setMoveLog]=useState([]);
  const [showLog,setShowLog]=useState(false);
  const [showRules,setShowRules]=useState(false);
  const [history,setHistory]=useState([]); // for undo
  const logRef=useRef(null);
  const T=LANG[lang];

  function startGame(cfg){
    setConfig(cfg);setGs(initState(score));setAnim(null);setAnimDice(null);
    setMoveLog([]);setHistory([]);
  }

  function addLog(move,color){
    const entry=T.logMove(move.from,move.to,move.die,color,move.force);
    setMoveLog(l=>[...l,entry]);
    setTimeout(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },50);
  }

  const isHumanTurn=!!(config&&gs&&!gs.gameOver&&(config.mode==="human"||(gs.turn===config.humanColor)));

  // AI turn
  useEffect(()=>{
    if(!gs||!config||gs.gameOver||gs.rolled||anim)return;
    if(config.mode!=="ai"||gs.turn===config.humanColor)return;
    const aiColor=gs.turn;
    const t1=setTimeout(()=>{
      const dice=rollDice();
      const rolled={...gs,dice:[...dice],rolled:true,selected:null};
      rolled.legalMoves=genMoves(rolled);
      setAnimDice({color:aiColor,values:[...dice]});
      setGs(rolled);
      let state=rolled;
      function execNext(){
        if(state.gameOver||state.dice.length===0||state.legalMoves.length===0||state.turn!==aiColor){
          if(!state.gameOver)state={...state,turn:opp(aiColor),dice:[],rolled:false,legalMoves:[],message:""};
          setGs(state);setAnimDice(null);return;
        }
        const mv=pickAiMove(state,config.difficulty);
        if(!mv){state={...state,turn:opp(aiColor),dice:[],rolled:false,legalMoves:[],message:""};setGs(state);setAnimDice(null);return;}
        addLog(mv,aiColor);
        setAnim({color:aiColor,from:mv.from,to:mv.to,onDone:()=>{
          setAnim(null);state=applyMoveToState(state,mv);setGs(state);setTimeout(execNext,250);
        }});
      }
      setTimeout(execNext,600);
    },700);
    return()=>clearTimeout(t1);
  },[gs?.turn,gs?.rolled,gs?.gameOver,anim]);

  // Match win check
  useEffect(()=>{
    if(!gs||!config||!gs.gameOver)return;
    // nothing extra needed; overlay handles it
  },[gs?.gameOver]);

  if(!config||!gs){
    return <SetupScreen onStart={startGame} lang={lang} setLang={setLang} score={score}/>;
  }

  const color=gs.turn,o=opp(color);
  const matchWinner=gs.score.white>=(config.matchLen||5)?"white":gs.score.black>=(config.matchLen||5)?"black":null;

  function doMove(mv){
    if(!mv)return;
    setHistory(h=>[...h,gs]);
    addLog(mv,color);
    setAnim({color,from:mv.from,to:mv.to,onDone:()=>{setAnim(null);setGs(applyMoveToState(gs,mv));}});
  }
  function handleRoll(){
    if(gs.rolled||gs.gameOver||!isHumanTurn)return;
    const dice=rollDice();
    setAnimDice({color,values:[...dice]});
    setTimeout(()=>setAnimDice(null),600);
    const ns={...gs,dice:[...dice],rolled:true,selected:null};
    ns.legalMoves=genMoves(ns);
    ns.message=ns.legalMoves.length===0?T.noMoves:`${T.rolled}: ${dice.join(" · ")}`;
    setGs(ns);
  }
  function handlePass(){
    if(gs.gameOver||!isHumanTurn)return;
    setGs(s=>({...s,turn:opp(s.turn),dice:[],rolled:false,selected:null,legalMoves:[],message:""}));
  }
  function handleUndo(){
    if(history.length===0)return;
    const prev=history[history.length-1];
    setGs(prev);setHistory(h=>h.slice(0,-1));
    setMoveLog(l=>l.slice(0,-1));setAnim(null);
  }
  function handlePtClick(pt){
    if(!gs.rolled||gs.gameOver||!isHumanTurn||anim)return;
    if(gs.selected!==null){
      const mv=gs.legalMoves.find(m=>m.from===gs.selected&&m.to===pt);
      if(mv){doMove(mv);return;}
    }
    if(gs.bar[color]===0&&gs.pts[pt][color]>0&&gs.legalMoves.some(m=>m.from===pt))
      setGs(s=>({...s,selected:pt}));
    else setGs(s=>({...s,selected:null}));
  }
  function handleBarClick(){
    if(!gs.rolled||gs.bar[color]===0||gs.gameOver||!isHumanTurn||anim)return;
    if(gs.legalMoves.some(m=>m.from==="bar"))setGs(s=>({...s,selected:"bar"}));
  }
  function handleOffClick(){
    if(!gs.rolled||gs.gameOver||!isHumanTurn||anim)return;
    let mv=null;
    if(gs.selected!==null)mv=gs.legalMoves.find(m=>m.from===gs.selected&&m.to==="off");
    if(!mv)mv=gs.legalMoves.find(m=>m.to==="off");
    if(mv)doMove(mv);
  }
  function newGame(keep){
    const sc=keep?gs.score:{white:0,black:0};
    setScore(sc);setConfig(null);setGs(null);setAnim(null);setAnimDice(null);setMoveLog([]);setHistory([]);
  }
  function rematch(){
    setGs(initState(gs.score));setScore(gs.score);setAnim(null);setAnimDice(null);setMoveLog([]);setHistory([]);
  }

  const legalDests=gs.selected!=null?gs.legalMoves.filter(m=>m.from===gs.selected).map(m=>m.to):[];
  const forceDests=gs.selected!=null?gs.legalMoves.filter(m=>m.from===gs.selected&&m.force).map(m=>m.to):[];
  const selectablePts=new Set(gs.legalMoves.map(m=>m.from).filter(f=>f!=="bar"&&f!=="off"));
  const canBearOff=isHumanTurn&&(legalDests.includes("off")||gs.legalMoves.some(m=>m.to==="off"));
  const forceablePts=gs.rolled&&!gs.gameOver?getForceablePoints(gs.pts,gs.bar,gs.off,color):new Set();
  const prime5Pts=new Set();
  if(gs.rolled&&!gs.gameOver)
    getDefenderPrimes(gs.pts,color).filter(pr=>pr.length===5).forEach(pr=>pr.pts_list.forEach(p=>prime5Pts.add(p)));

  const elems=[];
  for(let pt=1;pt<=24;pt++){
    const col=isTop(pt)?TOP_PTS.indexOf(pt):BOT_PTS.indexOf(pt);
    const dark=isTop(pt)?(col%2===0):(col%2===1);
    elems.push(<polygon key={`tri${pt}`} points={triPts(pt)} fill={dark?TD:TL} opacity="0.88"/>);
  }
  for(let pt=1;pt<=24;pt++){
    if(prime5Pts.has(pt))elems.push(<polygon key={`p5${pt}`} points={triPts(pt)} fill={PRIME5_COL} style={{pointerEvents:"none"}}/>);
    if(forceablePts.has(pt))elems.push(<polygon key={`fc${pt}`} points={triPts(pt)} fill={FORCE_COL} style={{pointerEvents:"none"}}/>);
  }
  for(let pt=1;pt<=24;pt++){
    const isLegal=legalDests.includes(pt),isForce=forceDests.includes(pt);
    const isSel=gs.selected===pt,isHint=selectablePts.has(pt)&&!isSel&&isHumanTurn;
    if(isLegal||isSel||isHint)
      elems.push(<polygon key={`ov${pt}`} points={triPts(pt)}
        fill={isForce?"rgba(255,120,50,0.65)":isLegal?LEGAL:isSel?SEL:HINT}
        stroke={isSel?"rgba(255,255,255,0.7)":isForce?"rgba(255,120,50,0.9)":isLegal?"rgba(80,255,140,0.8)":"none"}
        strokeWidth="1.5" style={{pointerEvents:"none"}}/>);
  }
  for(let pt=1;pt<=24;pt++){
    ["white","black"].forEach(c=>{
      const n=gs.pts[pt][c];if(!n)return;
      const fill=c==="white"?"#f5edd0":"#2a1800";
      const stroke=c==="white"?"#c8a050":"#6b3a10";
      for(let i=0;i<n;i++){
        const cx2=ptCX(pt),cy=checkerY(pt,i,n);
        elems.push(
          <g key={`ck${c}${pt}${i}`} style={{pointerEvents:"none"}}>
            <circle cx={cx2} cy={cy} r={CR} fill={fill} stroke={stroke} strokeWidth="2"/>
            <circle cx={cx2} cy={cy} r={CR*0.62} fill="none" stroke={stroke} strokeWidth="0.7" opacity="0.4"/>
            <ellipse cx={cx2-CR*0.27} cy={cy-CR*0.27} rx={CR*0.24} ry={CR*0.17} fill={c==="white"?"#ffffffcc":"#ffffff33"}/>
            {n>5&&i===n-1&&(
              <text x={cx2} y={cy+1} textAnchor="middle" dominantBaseline="middle"
                fontSize={CR*0.9} fill={c==="white"?"#6b3a10":"#e8b86d"} fontWeight="bold">{n}</text>
            )}
          </g>
        );
      }
    });
  }
  for(let pt=1;pt<=24;pt++){
    elems.push(<polygon key={`ca${pt}`} points={triPts(pt)} fill="transparent"
      style={{cursor:gs.rolled&&!gs.gameOver&&isHumanTurn&&!anim?"pointer":"default"}}
      onClick={()=>handlePtClick(pt)}/>);
  }
  ["white","black"].forEach(c=>{
    const n=gs.bar[c];if(!n)return;
    const onTop=c==="white";
    const fill=c==="white"?"#f5edd0":"#2a1800";
    const stroke=c==="white"?"#c8a050":"#6b3a10";
    const bySec=onTop?MARGIN+2:MARGIN+BOARD_H/2+8,bhSec=BOARD_H/2-10;
    const isBarSel=gs.selected==="bar"&&color===c;
    const canSel=gs.rolled&&c===color&&gs.legalMoves.some(m=>m.from==="bar")&&isHumanTurn;
    if(isBarSel)elems.push(<rect key={`bsel${c}`} x={MARGIN+HALF_W} y={bySec} width={BAR_W} height={bhSec} rx={4} fill={SEL} stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" style={{pointerEvents:"none"}}/>);
    else if(canSel)elems.push(<rect key={`bsh${c}`} x={MARGIN+HALF_W} y={bySec} width={BAR_W} height={bhSec} rx={4} fill={HINT} stroke="rgba(255,255,255,0.3)" strokeWidth="1" style={{pointerEvents:"none"}}/>);
    for(let i=0;i<Math.min(n,4);i++){
      const bcy=onTop?MARGIN+CR+6+i*CR*2.2:MARGIN+BOARD_H-CR-6-i*CR*2.2;
      elems.push(
        <g key={`bck${c}${i}`} style={{pointerEvents:"none"}}>
          <circle cx={MARGIN+HALF_W+BAR_W/2} cy={bcy} r={CR} fill={fill} stroke={stroke} strokeWidth="2"/>
          <circle cx={MARGIN+HALF_W+BAR_W/2} cy={bcy} r={CR*0.62} fill="none" stroke={stroke} strokeWidth="0.7" opacity="0.4"/>
        </g>
      );
    }
    if(n>4)elems.push(<text key={`bcnt${c}`} x={MARGIN+HALF_W+BAR_W/2}
      y={onTop?MARGIN+BOARD_H/2-14:MARGIN+BOARD_H/2+18}
      textAnchor="middle" fontSize="12" fill={fill} fontWeight="bold" style={{pointerEvents:"none"}}>{n}</text>);
    elems.push(<rect key={`bca${c}`} x={MARGIN+HALF_W} y={bySec} width={BAR_W} height={bhSec}
      fill="transparent" style={{cursor:canSel?"pointer":"default"}}
      onClick={()=>c===color&&handleBarClick()}/>);
  });

  const isAITurn=config.mode==="ai"&&gs.turn!==config.humanColor;
  const turnLabel=isAITurn?T.thinking:T.yourTurn(color==="white"?T.white:T.black);
  const winnerName=gs.winner?(gs.winner==="white"?T.white:T.black):"";
  const winTypeName=gs.winType?T.winTypes[gs.winType]:"";
  const winPts=gs.winType?winScore(gs.winType,gs.monk):0;

  return (
    <div style={{background:"#2a1400",minHeight:"100vh",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",padding:"12px",gap:6}}>
      <style>{`@keyframes shake{0%{transform:rotate(0)}20%{transform:rotate(-12deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(8deg)}100%{transform:rotate(0)}}`}</style>

      {showLog&&(
        <Modal title={T.moveLog} onClose={()=>setShowLog(false)}>
          <div ref={logRef} style={{maxHeight:300,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
            {moveLog.length===0
              ? <span style={{color:"#5a3010",fontSize:13}}>—</span>
              : moveLog.map((entry,i) => (
                <div key={i} style={{color:entry.startsWith("●")?"#f5edd0":"#c8a050",
                  fontSize:12,fontFamily:"monospace",padding:"2px 0",
                  borderBottom:"1px solid #3a1a00"}}>{entry}</div>
              ))}
          </div>
        </Modal>
      )}
      {showRules&&(
        <Modal title={T.rules} onClose={()=>setShowRules(false)}>
          <pre style={{color:"#c8a050",fontSize:12,lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"Georgia,serif"}}>{T.rulesText}</pre>
        </Modal>
      )}

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:W,maxWidth:"100%"}}>
        <div>
          <div style={{color:"#e8b86d",fontSize:22,fontWeight:"bold",letterSpacing:2}}>{T.title}</div>
          <div style={{color:"#6a4020",fontSize:11}}>{config.mode==="ai"?T.aiLabel(config.difficulty):T.vsHuman} · {T.matchLength} {config.matchLen}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",gap:5,fontSize:13,color:"#a07840",alignItems:"center"}}>
            <span style={{color:"#f5edd0"}}>{T.white} {gs.score.white}</span>
            <span style={{color:"#5a3010"}}>–</span>
            <span style={{color:"#c8a050"}}>{gs.score.black} {T.black}</span>
            <span style={{color:"#5a3010",fontSize:11}}>/ {config.matchLen}</span>
          </div>
          {!gs.gameOver&&(
            <div style={{color:isAITurn?"#a07840":color==="white"?"#f5edd0":"#c8a050",
              fontSize:12,background:"#3a1a00",padding:"3px 10px",borderRadius:6,
              border:`1px solid ${isAITurn?"#5a3010":color==="white"?"#c8a050":"#5a3010"}`,
              minWidth:110,textAlign:"center"}}>
              {turnLabel}
            </div>
          )}
          <button onClick={()=>setShowLog(s=>!s)} style={{background:"#3a1a00",color:"#a07840",
            border:"1px solid #5a3010",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif"}}>
            {T.moveLog}
          </button>
          <button onClick={()=>setShowRules(s=>!s)} style={{background:"#3a1a00",color:"#a07840",
            border:"1px solid #5a3010",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif"}}>
            {T.rules}
          </button>
          <button onClick={()=>newGame(false)} style={{background:"#6b3a10",color:"#e8b86d",
            border:"1px solid #a06030",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif"}}>
            {T.newGame}
          </button>
          <button onClick={()=>setLang(l=>l==="sv"?"en":"sv")} style={{background:"#3a1a00",color:"#a07840",
            border:"1px solid #5a3010",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif"}}>
            {T.toggle}
          </button>
        </div>
      </div>

      {/* Board */}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        style={{maxWidth:"100%",display:"block",borderRadius:10,boxShadow:"0 8px 40px #00000099"}}>
        <rect x={0} y={0} width={W} height={H} rx={12} fill={FRAME}/>
        <rect x={8} y={8} width={W-16} height={H-16} rx={8} fill={INNER}/>
        <rect x={MARGIN} y={MARGIN} width={BOARD_W} height={BOARD_H} fill={BG}/>
        {[0.15,0.35,0.55,0.75,0.9].map((t,i) => (
          <line key={i} x1={MARGIN} y1={MARGIN+BOARD_H*t} x2={MARGIN+BOARD_W}
            y2={MARGIN+BOARD_H*t} stroke="#b07830" strokeWidth="0.5" opacity="0.25"/>
        ))}
        <rect x={MARGIN} y={MARGIN+BOARD_H/2-4} width={BOARD_W} height={8} fill={BAR_S} opacity="0.5"/>
        <rect x={MARGIN+HALF_W} y={MARGIN+2} width={BAR_W} height={BOARD_H/2-10} rx={4} fill={BAR_C}/>
        <rect x={MARGIN+HALF_W+3} y={MARGIN+4} width={BAR_W-6} height={BOARD_H/2-14} rx={3} fill={INNER} opacity="0.6"/>
        <rect x={MARGIN+HALF_W} y={MARGIN+BOARD_H/2+8} width={BAR_W} height={BOARD_H/2-10} rx={4} fill={BAR_C}/>
        <rect x={MARGIN+HALF_W+3} y={MARGIN+BOARD_H/2+10} width={BAR_W-6} height={BOARD_H/2-14} rx={3} fill={INNER} opacity="0.6"/>
        {elems}
        {anim&&<AnimChecker color={anim.color} fromPt={anim.from} toPt={anim.to} onDone={anim.onDone}/>}
        <OffTray color="white" n={gs.off.white||0} glowing={canBearOff&&color==="white"&&!anim} onClick={handleOffClick}/>
        <OffTray color="black" n={gs.off.black||0} glowing={canBearOff&&color==="black"&&!anim} onClick={handleOffClick}/>
        <rect x={MARGIN} y={MARGIN} width={BOARD_W} height={BOARD_H} fill="none" stroke={FRAME} strokeWidth="2.5"/>
      </svg>

      {/* Controls */}
      <div style={{display:"flex",alignItems:"center",gap:12,width:W,maxWidth:"100%",justifyContent:"space-between"}}>
        <DiceRow gs={gs} animDice={animDice}/>
        <div style={{color:"#a07840",fontSize:12,flex:1,textAlign:"center"}}>{gs.message}</div>
        <div style={{display:"flex",gap:6}}>
          {config.mode==="human"&&history.length>0&&!gs.gameOver&&(
            <button onClick={handleUndo} style={{background:"#3a1a00",color:"#a07840",
              border:"1px solid #5a3010",borderRadius:6,padding:"6px 14px",cursor:"pointer",
              fontSize:12,fontFamily:"Georgia,serif"}}>{T.undo}</button>
          )}
          {!gs.gameOver&&!gs.rolled&&isHumanTurn&&(
            <button onClick={handleRoll} style={{background:"#6b3a10",color:"#e8b86d",
              border:"1px solid #a06030",borderRadius:6,padding:"6px 16px",cursor:"pointer",
              fontSize:13,fontFamily:"Georgia,serif"}}>{T.roll}</button>
          )}
          {!gs.gameOver&&gs.rolled&&isHumanTurn&&!anim&&(
            <button onClick={handlePass} style={{background:"#3a1a00",color:"#a07840",
              border:"1px solid #5a3010",borderRadius:6,padding:"6px 16px",cursor:"pointer",
              fontSize:13,fontFamily:"Georgia,serif"}}>{T.pass}</button>
          )}
        </div>
      </div>

      {/* Game over overlay */}
      {gs.gameOver&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
          <div style={{background:"#1a0800",border:"2px solid #8a6030",borderRadius:14,
            padding:"36px 52px",textAlign:"center",fontFamily:"Georgia,serif",minWidth:340}}>
            {matchWinner?(
              <>
                <div style={{color:"#e8b86d",fontSize:30,fontWeight:"bold",marginBottom:8}}>
                  {T.wins(matchWinner==="white"?T.white:T.black,winTypeName,gs.monk)}
                </div>
                {gs.monk&&<div style={{color:"#c8a050",fontSize:14,marginBottom:4}}>+ {T.monk}</div>}
                <div style={{color:"#f5edd0",fontSize:20,marginBottom:4}}>{winPts} {T.points}</div>
                <div style={{color:"#c8a050",fontSize:16,marginBottom:20}}>
                  {T.score}: {T.white} {gs.score.white} – {gs.score.black} {T.black}
                </div>
              </>
            ):(
              <>
                <div style={{color:"#e8b86d",fontSize:26,fontWeight:"bold",marginBottom:6}}>
                  {T.wins(winnerName,winTypeName,gs.monk)}
                </div>
                {gs.monk&&<div style={{color:"#c8a050",fontSize:14,marginBottom:4}}>+ {T.monk}</div>}
                <div style={{color:"#f5edd0",fontSize:20,marginBottom:4}}>{winPts} {T.points}</div>
                <div style={{color:"#a07840",fontSize:13,marginBottom:22}}>
                  {T.score}: {T.white} {gs.score.white} – {gs.score.black} {T.black} / {config.matchLen}
                </div>
              </>
            )}
            <div style={{display:"flex",gap:12,justifyContent:"center"}}>
              {!matchWinner&&(
                <button onClick={rematch} style={{background:"#6b3a10",color:"#e8b86d",
                  border:"1px solid #a06030",borderRadius:6,padding:"9px 24px",cursor:"pointer",
                  fontSize:14,fontFamily:"Georgia,serif"}}>{T.rematch}</button>
              )}
              <button onClick={()=>newGame(false)} style={{background:"#3a1a00",color:"#a07840",
                border:"1px solid #5a3010",borderRadius:6,padding:"9px 24px",cursor:"pointer",
                fontSize:14,fontFamily:"Georgia,serif"}}>{T.newGame}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
