import {CONFIG} from "./config.js";
import {Tetris} from "./tetris.js";
import {Renderer} from "./render.js";
import {emit,onMessage} from "./bus.js";

const $=s=>document.querySelector(s);
const board=$("#board"), next=$("#nextCanvas");
const renderer=new Renderer(board,next);
const id=crypto.randomUUID();
let name="", matchStartAt=0, attackUnlockAt=0, currentPhase="LOBBY", placement=0;
let softDropHeld=false, lastSoftDropAt=0;
let game;
const peers=new Map();
let lastAttackTargetId=null,lastAttackerId=null,lastPeerRenderAt=0;

function fx(text){const el=$("#centerFx");el.innerHTML=text;el.classList.remove("show");void el.offsetWidth;el.classList.add("show")}
function updateIncoming(){
  const total=game.incoming.reduce((s,p)=>s+p.amount,0);
  $("#incomingAmount").textContent=total;
  const min=game.incoming.length?Math.min(...game.incoming.map(p=>p.turns)):null;
  $("#incomingTurns").textContent=min===null?"SAFE":`${Math.max(0,min)} TURN`;
}

const MINI_COLORS={I:"#4de6f2",O:"#ffd84d",T:"#b86cff",S:"#62e56f",Z:"#ff5e6f",J:"#5b82ff",L:"#ff9b45",G:"#69717f"};
function drawMini(sel,snap){const cv=$(sel),c=cv.getContext("2d"),W=10,H=20,cw=cv.width/W,ch=cv.height/H;c.fillStyle="#05070a";c.fillRect(0,0,cv.width,cv.height);if(!snap||snap.length<200)return;for(let i=0;i<200;i++){const v=snap[i];if(v===".")continue;c.fillStyle=MINI_COLORS[v]||"#77808e";c.fillRect((i%W)*cw+.5,Math.floor(i/W)*ch+.5,cw-1,ch-1)}}
function rankedAlive(){const map=new Map([...peers].filter(([_,p])=>p.alive!==false));map.set(id,{id,name,alive:game?.alive!==false,score:game?.score||0,snapshot:game?.snapshot?.()||""});return [...map.values()].sort((a,b)=>(b.score||0)-(a.score||0)||String(a.name).localeCompare(String(b.name)))}
function rankOf(pid){const a=rankedAlive(),i=a.findIndex(p=>p.id===pid);return i<0?null:i+1}
function fillMini(pre,p,empty){$(`#${pre}Name`).textContent=p?.name||empty;$(`#${pre}Rank`).textContent=p?(p.alive===false?"K.O.":`#${rankOf(p.id)}`):"—";$(`#${pre}Score`).textContent=p?`SCORE ${(p.score||0).toLocaleString()}`:"SCORE —";drawMini(`#${pre}Board`,p?.snapshot||"")}
function renderPeerHUD(){const a=rankedAlive(),i=a.findIndex(p=>p.id===id);fillMini("rivalUp",i>0?a[i-1]:null,"NO UPPER RIVAL");fillMini("rivalDown",i>=0&&i<a.length-1?a[i+1]:null,"NO LOWER RIVAL");fillMini("target",lastAttackTargetId?peers.get(lastAttackTargetId):null,"NO TARGET");fillMini("attacker",lastAttackerId?peers.get(lastAttackerId):null,"NO ATTACKER")}
function flashCard(sel){const el=$(sel);el.classList.remove("hit");void el.offsetWidth;el.classList.add("hit")}

function callbacks(){
 return {
  onNext:t=>renderer.drawNext(t),
  onScore:s=>$("#score").textContent=s.toLocaleString(),
  onStats:s=>{ $("#score").textContent=s.score.toLocaleString();$("#level").textContent=s.level;$("#maxCombo").textContent=s.maxCombo;$("#maxAttack").textContent=s.maxAttack;updateIncoming();sendState();},
  onClear:({cleared,combo,attack})=>{
    const labels={1:"SINGLE",2:"DOUBLE",3:"TRIPLE",4:"4-LINE"};
    let text=labels[cleared]||"CLEAR";
    if(combo>=2)text+=`<br><span>${combo} COMBO</span>`;
    if(attack>0)text+=`<br><span>ATTACK ×${attack}</span>`;
    fx(text); $("#comboText").textContent=combo>=2?`🔥 ${combo} COMBO`:"—";
  },
  onAttack:amount=>{
    if(Date.now()<attackUnlockAt){fx("ATTACK LOCKED");return;}
    game.maxAttack=Math.max(game.maxAttack,amount);
    emit("attack-request",{from:id,fromName:name,amount,attackId:crypto.randomUUID()});
  },
  onIncoming:()=>{updateIncoming();fx("⚠ INCOMING");},
  onDefense:({perfect})=>fx(perfect?"PERFECT DEFENSE!":"BLOCK!"),
  onLastChance:()=>{fx("LAST CHANCE<br><span>ONE MOVE</span>");$("#statusText").textContent="LAST CHANCE";},
  onSurvive:()=>{fx("SURVIVE!");$("#statusText").textContent="BATTLE";},
  onKO:({reason,score})=>{fx("K.O.");$("#statusText").textContent="K.O.";emit("ko",{id,name,score,reason,at:Date.now()});sendState();}
 };
}
function newGame(){game=new Tetris(callbacks());renderer.draw(game);updateIncoming();lastAttackTargetId=null;lastAttackerId=null;$("#targetEvent").textContent="NO TARGET";$("#attackerEvent").textContent="NO ATTACKER";renderPeerHUD()}
newGame();

$("#joinBtn").onclick=()=>{
 name=$("#nameInput").value.trim()||`PLAYER-${id.slice(0,4).toUpperCase()}`;
 $("#playerNameLabel").textContent=name;$("#overlay").classList.add("hidden");
 emit("join",{id,name,ready:true,score:0,alive:true});
 $("#statusText").textContent="READY";
};

function startMatch(startAt){
 newGame();matchStartAt=startAt;attackUnlockAt=startAt+CONFIG.OPENING_ATTACK_LOCK_MS;currentPhase="COUNTDOWN";
 const countdown=()=>{
  const d=startAt-Date.now();
  if(d>0){fx(Math.ceil(d/1000));requestAnimationFrame(countdown);}
  else{
   game.start();currentPhase="BATTLE";$("#statusText").textContent="OPENING";
   fx("GO!");sendState();
  }
 };countdown();
}
onMessage(msg=>{
 const p=msg.payload||{};
 if(msg.type==="match-start")startMatch(p.startAt);
 if(msg.type==="reset"){location.reload();}
 if(msg.type==="next-battle"){newGame();currentPhase="LOBBY";$("#statusText").textContent="READY";emit("join",{id,name,ready:true,score:0,alive:true});}
 if(msg.type==="player-state" && p.id!==id){peers.set(p.id,{...peers.get(p.id),...p});renderPeerHUD();}
 if(msg.type==="join" && p.id!==id){peers.set(p.id,{...peers.get(p.id),...p});renderPeerHUD();}
 if(msg.type==="ko" && p.id!==id){peers.set(p.id,{...peers.get(p.id),...p,alive:false});renderPeerHUD();}
 if(msg.type==="attack-routed" && p.toSender===id){lastAttackTargetId=p.targetId;$("#targetEvent").textContent=`YOU → ${p.targetName} ×${p.amount}`;flashCard("#targetCard");renderPeerHUD();}
 if(msg.type==="attack-deliver" && p.to===id && game.alive){lastAttackerId=p.from;$("#attackerEvent").textContent=`${p.fromName} → YOU ×${p.amount}`;flashCard("#attackerCard");game.receiveAttack(p.amount,p.attackId);updateIncoming();renderPeerHUD();}
 if(msg.type==="alive-count")$("#alive").textContent=p.count;
});

function sendState(){
 if(!name||!game)return;
 emit("player-state",{id,name,alive:game.alive,score:game.score,level:game.level,maxCombo:game.maxCombo,maxAttack:game.maxAttack,snapshot:game.snapshot()});
}
window.addEventListener("keydown",e=>{
 if(!game.started||!game.alive)return;
 let handled=true;
 if(e.key==="a"||e.key==="A")game.move(-1);
 else if(e.key==="d"||e.key==="D")game.move(1);
 else if(e.key==="ArrowLeft")game.rotate(-1);
 else if(e.key==="ArrowRight")game.rotate(1);
 else if(e.key==="s"||e.key==="S")game.hardDrop();
 else if(e.key==="ArrowDown"){
   softDropHeld=true;
   // Give immediate feedback on the first key press.
   if(!e.repeat)game.softDrop();
 }
 else handled=false;
 if(handled){e.preventDefault();renderer.draw(game);}
},{passive:false});

window.addEventListener("keyup",e=>{
 if(e.key==="ArrowDown"){
   softDropHeld=false;
   e.preventDefault();
 }
},{passive:false});

window.addEventListener("blur",()=>{softDropHeld=false;});

function loop(now){
 if(game){
  if(game.started&&game.alive){
   const elapsed=Math.max(0,Date.now()-matchStartAt);
   const lv=1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS);
   if(lv!==game.level){game.setLevel(lv);fx(`SPEED UP<br><span>LEVEL ${lv}</span>`);}
   if(Date.now()<attackUnlockAt){$("#statusText").textContent=`OPENING ${Math.ceil((attackUnlockAt-Date.now())/1000)}`;}
   else if($("#statusText").textContent.startsWith("OPENING")){ $("#statusText").textContent="BATTLE";fx("ATTACK UNLOCKED");}
   if(softDropHeld && now-lastSoftDropAt>=CONFIG.SOFT_DROP_MS){
     game.softDrop();
     lastSoftDropAt=now;
   }
   game.tick(now);
  }
  renderer.draw(game);
  if(now-lastPeerRenderAt>500){renderPeerHUD();lastPeerRenderAt=now;}
 }
 requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(sendState,500);
