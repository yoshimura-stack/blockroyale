import {emit,onMessage} from "./bus.js";
const $=s=>document.querySelector(s);
const players=new Map();
let phase="LOBBY";

function render(){
 const arr=[...players.values()];
 $("#readyCount").textContent=arr.filter(p=>p.ready).length;
 $("#aliveCount").textContent=arr.filter(p=>p.alive).length;
 $("#phase").textContent=phase;
 $("#players").innerHTML=arr.sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="player-row"><span>${p.name}</span><b>${p.alive===false?"K.O.":(p.score||0).toLocaleString()}</b></div>`).join("");
 emit("alive-count",{count:arr.filter(p=>p.alive).length});
}
function chooseRandomTarget(from){
 const alive=[...players.values()].filter(p=>p.alive && p.id!==from);
 return alive.length?alive[Math.floor(Math.random()*alive.length)]:null;
}
onMessage(msg=>{
 const p=msg.payload||{};
 if(msg.type==="join"){players.set(p.id,{...players.get(p.id),...p});render();}
 if(msg.type==="player-state"){players.set(p.id,{...players.get(p.id),...p,ready:true});render();}
 if(msg.type==="ko"){const old=players.get(p.id)||p;players.set(p.id,{...old,...p,alive:false});render();}
 if(msg.type==="attack-request"){
   const target=chooseRandomTarget(p.from);
   if(target)emit("attack-deliver",{to:target.id,toName:target.name,from:p.from,fromName:p.fromName,amount:p.amount,attackId:p.attackId});
 }
});
$("#startBtn").onclick=()=>{
 if(!players.size)return alert("READYプレイヤーがまだいません。");
 phase="COUNTDOWN";render();
 const startAt=Date.now()+4000;
 for(const [id,p] of players)players.set(id,{...p,alive:true,score:0});
 emit("match-start",{startAt});setTimeout(()=>{phase="BATTLE";render()},4000);
};
$("#nextBtn").onclick=()=>{phase="LOBBY";for(const [id,p] of players)players.set(id,{...p,alive:true,score:0});emit("next-battle",{});render();};
$("#resetBtn").onclick=()=>{if(confirm("全画面をリセットしますか？")){players.clear();phase="LOBBY";emit("reset",{});render();}};
render();
