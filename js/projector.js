import {CONFIG} from "./config.js";
import {onMessage} from "./bus.js";
const $=s=>document.querySelector(s);
const players=new Map();
let startAt=0, attackUnlockAt=0, phase="LOBBY";

function render(){
 const arr=[...players.values()];
 const alive=arr.filter(p=>p.alive!==false);
 $("#aliveCount").textContent=alive.length;
 $("#phase").textContent=phase;
 $("#ranking").innerHTML=alive.sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,10).map((p,i)=>`<div class="rank-chip"><b>#${i+1}</b> ${p.name} · ${(p.score||0).toLocaleString()}</div>`).join("");
 if(phase==="LOBBY"){ $("#heroText").textContent="LOBBY";$("#timerText").textContent=`READY ${arr.length}`;}
}
onMessage(msg=>{
 const p=msg.payload||{};
 if(msg.type==="join"||msg.type==="player-state"){players.set(p.id,{...players.get(p.id),...p});render();}
 if(msg.type==="ko"){players.set(p.id,{...players.get(p.id),...p,alive:false});$("#heroText").textContent=`K.O. ${p.name}`;setTimeout(render,900);render();}
 if(msg.type==="match-start"){startAt=p.startAt;attackUnlockAt=startAt+CONFIG.OPENING_ATTACK_LOCK_MS;phase="COUNTDOWN";render();}
 if(msg.type==="next-battle"){phase="LOBBY";players.clear();render();}
 if(msg.type==="reset"){players.clear();phase="LOBBY";render();}
});
function loop(){
 if(startAt){
  const now=Date.now();
  if(now<startAt){$("#heroText").textContent=Math.max(1,Math.ceil((startAt-now)/1000));$("#timerText").textContent="GET READY";}
  else{
   phase="BATTLE";
   const elapsed=now-startAt;
   const level=1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS);
   if(now<attackUnlockAt){$("#heroText").textContent="OPENING";$("#timerText").textContent=`ATTACK UNLOCKS IN ${Math.ceil((attackUnlockAt-now)/1000)}`;}
   else{$("#heroText").textContent=`LEVEL ${level}`;$("#timerText").textContent=`${Math.floor(elapsed/60000)}:${String(Math.floor(elapsed/1000)%60).padStart(2,"0")}`;}
  }
 }
 requestAnimationFrame(loop);
}
render();loop();
