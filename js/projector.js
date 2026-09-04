import {CONFIG} from "./config.js";
import {supabase,getRoom} from "./supabase.js";
const $=s=>document.querySelector(s);
const players=new Map();let match=null,startAt=0,attackUnlockAt=0,phase="LOBBY";
function render(){
 const arr=[...players.values()],alive=arr.filter(p=>p.alive!==false);
 $("#aliveCount").textContent=alive.length;$("#phase").textContent=phase;
 $("#ranking").innerHTML=alive.sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,10).map((p,i)=>`<div class="rank-chip"><b>#${i+1}</b> ${p.name} · ${(p.score||0).toLocaleString()}</div>`).join("");
 if(phase==="LOBBY"){$("#heroText").textContent="LOBBY";$("#timerText").textContent=`READY ${arr.filter(p=>p.ready).length}`;}
}
function renderResult(){
 const arr=[...players.values()];
 const winner=arr.find(p=>p.alive!==false);
 $("#phase").textContent="RESULT";
 $("#aliveCount").textContent=winner?1:0;
 $("#heroText").textContent=winner?`👑 ${winner.name}`:"MATCH OVER";
 $("#timerText").textContent=winner?"WINNER":"NO SURVIVOR";
}

async function loadPlayers(){
 const {data}=await supabase.from("players").select("id,player_name,ready,alive,score").eq("match_id",match.id);
 players.clear();for(const p of data||[])players.set(p.id,{id:p.id,name:p.player_name,ready:p.ready,alive:p.alive,score:p.score||0});render();
}
async function init(){
 match=await getRoom();phase=match.phase;if(match.start_at){startAt=Date.parse(match.start_at);attackUnlockAt=startAt+CONFIG.OPENING_ATTACK_LOCK_MS;}await loadPlayers();
 supabase.channel(`projector-${match.id}`)
  .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:`match_id=eq.${match.id}`},payload=>{
    const p=payload.new||payload.old;if(!p)return;
    if(payload.eventType==="DELETE"){
      players.delete(p.id);
      render();
      return;
    }
    players.set(p.id,{id:p.id,name:p.player_name,ready:p.ready,alive:p.alive,score:p.score||0});
    render();
  })
  .on("postgres_changes",{event:"UPDATE",schema:"public",table:"matches",filter:`id=eq.${match.id}`},payload=>{
    match={...match,...payload.new};phase=match.phase;if(match.start_at){startAt=Date.parse(match.start_at);attackUnlockAt=startAt+CONFIG.OPENING_ATTACK_LOCK_MS;}if(phase==="RESULT")renderResult();else render();
  }).subscribe();
}
function loop(){
 if(startAt&&(phase==="COUNTDOWN"||phase==="BATTLE")){
  const now=Date.now();
  if(now<startAt){$("#heroText").textContent=Math.max(1,Math.ceil((startAt-now)/1000));$("#timerText").textContent="GET READY";}
  else{
   phase="BATTLE";const elapsed=now-startAt;const level=1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS);
   if(now<attackUnlockAt){$("#heroText").textContent="OPENING";$("#timerText").textContent=`ATTACK UNLOCKS IN ${Math.ceil((attackUnlockAt-now)/1000)}`;}
   else{$("#heroText").textContent=`LEVEL ${level}`;$("#timerText").textContent=`${Math.floor(elapsed/60000)}:${String(Math.floor(elapsed/1000)%60).padStart(2,"0")}`;}
  }
 }
 requestAnimationFrame(loop);
}
render();init();loop();
