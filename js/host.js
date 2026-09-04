import {supabase,getRoom} from "./supabase.js";
const $=s=>document.querySelector(s);
const players=new Map();let match=null,phase="LOBBY",finishingMatch=false;

function render(){
 const arr=[...players.values()];
 $("#readyCount").textContent=arr.filter(p=>p.ready).length;
 $("#aliveCount").textContent=arr.filter(p=>p.alive).length;
 $("#phase").textContent=phase;
 $("#players").innerHTML=arr.sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="player-row"><span>${p.name}</span><b>${p.alive===false?"K.O.":(p.score||0).toLocaleString()}</b></div>`).join("");
}

async function maybeFinishMatch(){
 if(!match||finishingMatch)return;
 if(phase!=="BATTLE")return;

 const arr=[...players.values()];
 if(arr.length<2)return;

 const alive=arr.filter(p=>p.alive);
 if(alive.length>1)return;

 finishingMatch=true;

 // Winner exists when exactly one player remains alive.
 const winner=alive[0]||null;
 if(winner){
   await supabase.from("players").update({rank:1}).eq("id",winner.id);
 }

 const {error}=await supabase.from("matches")
   .update({phase:"RESULT"})
   .eq("id",match.id);

 if(error){
   console.error("finish match",error);
   finishingMatch=false;
   return;
 }

 phase="RESULT";
 render();
}

async function loadPlayers(){
 const {data,error}=await supabase.from("players").select("id,player_name,ready,alive,score,max_combo,max_attack").eq("match_id",match.id);
 if(error){console.error(error);return;}
 players.clear();
 for(const p of data||[])players.set(p.id,{id:p.id,name:p.player_name,ready:p.ready,alive:p.alive,score:p.score||0,maxCombo:p.max_combo||0,maxAttack:p.max_attack||0});
 render();
}
async function init(){
 try{
   match=await getRoom();phase=match.phase;await loadPlayers();
   supabase.channel(`host-${match.id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:`match_id=eq.${match.id}`},payload=>{
      const p=payload.new||payload.old;if(!p)return;
      players.set(p.id,{id:p.id,name:p.player_name,ready:p.ready,alive:p.alive,score:p.score||0,maxCombo:p.max_combo||0,maxAttack:p.max_attack||0});render();maybeFinishMatch();
    })
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"matches",filter:`id=eq.${match.id}`},payload=>{
      match={...match,...payload.new};phase=match.phase;render();
    }).subscribe();
 }catch(err){console.error(err);alert("Supabase接続に失敗しました。");}
}
$("#startBtn").onclick=async()=>{
 finishingMatch=false;
 if(!match)return;
 if(![...players.values()].some(p=>p.ready))return alert("READYプレイヤーがまだいません。");
 const startAt=new Date(Date.now()+4000).toISOString();
 await supabase.from("players").update({alive:true,score:0,rank:null,max_combo:0,max_attack:0}).eq("match_id",match.id);
 await supabase.from("matches").update({phase:"COUNTDOWN",start_at:startAt,level:1}).eq("id",match.id);
 setTimeout(()=>supabase.from("matches").update({phase:"BATTLE"}).eq("id",match.id),4000);
};
$("#nextBtn").onclick=async()=>{
 finishingMatch=false;
 if(!match)return;
 await supabase.from("players").update({ready:true,alive:true,score:0,rank:null,max_combo:0,max_attack:0}).eq("match_id",match.id);
 await supabase.from("attacks").delete().eq("match_id",match.id);
 await supabase.from("matches").update({phase:"LOBBY",start_at:null,battle_no:(match.battle_no||1)+1,level:1}).eq("id",match.id);
};
$("#resetBtn").onclick=async()=>{
 finishingMatch=false;
 if(!match||!confirm("BLOCK-001のテストデータをリセットしますか？"))return;
 await supabase.from("attacks").delete().eq("match_id",match.id);
 await supabase.from("player_states").delete().eq("match_id",match.id);
 await supabase.from("players").delete().eq("match_id",match.id);
 await supabase.from("matches").update({phase:"LOBBY",start_at:null,battle_no:1,level:1}).eq("id",match.id);
 players.clear();phase="LOBBY";render();
};
render();init();
