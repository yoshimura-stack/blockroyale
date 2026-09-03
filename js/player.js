import {CONFIG} from "./config.js";
import {Tetris} from "./tetris.js";
import {Renderer} from "./render.js";
import {emit,onMessage} from "./bus.js";

const $=s=>document.querySelector(s);
const board=$("#board"), next=$("#nextCanvas");
const renderer=new Renderer(board,next);
const id=crypto.randomUUID();
let name="", matchStartAt=0, attackUnlockAt=0, currentPhase="LOBBY", placement=0;
let game;

function fx(text){const el=$("#centerFx");el.innerHTML=text;el.classList.remove("show");void el.offsetWidth;el.classList.add("show")}
function updateIncoming(){
  const total=game.incoming.reduce((s,p)=>s+p.amount,0);
  $("#incomingAmount").textContent=total;
  const min=game.incoming.length?Math.min(...game.incoming.map(p=>p.turns)):null;
  $("#incomingTurns").textContent=min===null?"SAFE":`${Math.max(0,min)} TURN`;
}
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
function newGame(){game=new Tetris(callbacks());renderer.draw(game);updateIncoming()}
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
 if(msg.type==="attack-deliver" && p.to===id && game.alive){game.receiveAttack(p.amount,p.attackId);updateIncoming();}
 if(msg.type==="alive-count")$("#alive").textContent=p.count;
});

function sendState(){
 if(!name||!game)return;
 emit("player-state",{id,name,alive:game.alive,score:game.score,level:game.level,maxCombo:game.maxCombo,maxAttack:game.maxAttack});
}
window.addEventListener("keydown",e=>{
 if(!game.started||!game.alive)return;
 let handled=true;
 if(e.key==="a"||e.key==="A")game.move(-1);
 else if(e.key==="d"||e.key==="D")game.move(1);
 else if(e.key==="ArrowLeft")game.rotate(-1);
 else if(e.key==="ArrowRight")game.rotate(1);
 else if(e.key==="s"||e.key==="S"||e.key==="ArrowDown")game.hardDrop();
 else handled=false;
 if(handled){e.preventDefault();renderer.draw(game);}
},{passive:false});

function loop(now){
 if(game){
  if(game.started&&game.alive){
   const elapsed=Math.max(0,Date.now()-matchStartAt);
   const lv=1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS);
   if(lv!==game.level){game.setLevel(lv);fx(`SPEED UP<br><span>LEVEL ${lv}</span>`);}
   if(Date.now()<attackUnlockAt){$("#statusText").textContent=`OPENING ${Math.ceil((attackUnlockAt-Date.now())/1000)}`;}
   else if($("#statusText").textContent.startsWith("OPENING")){ $("#statusText").textContent="BATTLE";fx("ATTACK UNLOCKED");}
   game.tick(now);
  }
  renderer.draw(game);
 }
 requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(sendState,1000);
