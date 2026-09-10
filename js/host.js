import {requireSessionSchema,resetRoom,resetError} from "./session.js";
import {supabase,getRoom,serverNow,syncServerClock} from "./supabase.js";
const $=s=>document.querySelector(s);
const players=new Map();let match=null,phase="LOBBY",finishingMatch=false,resetting=false,startTimer=null;

function render(){
 const arr=[...players.values()];
 $("#readyCount").textContent=arr.filter(p=>p.ready).length;
 $("#aliveCount").textContent=arr.filter(p=>p.alive).length;
 $("#phase").textContent=phase;
 $("#players").innerHTML=arr.sort((a,b)=>(b.score||0)-(a.score||0)).map(p=>`<div class="player-row"><span>${p.name}</span><b>${p.alive===false?"K.O.":(p.score||0).toLocaleString()}</b></div>`).join("");
}


async function assignKoRank(playerId){
 const aliveNow=[...players.values()].filter(p=>p.alive).length;
 const rank=Math.max(1,aliveNow+1);
 const player=players.get(playerId);
 if(player)player.rank=rank;
 await supabase.from("players").update({rank}).eq("id",playerId);
}

async function maybeFinishMatch(){
 if(!match||finishingMatch||resetting)return;
 const room={...match};
 const effectiveBattle =
   phase==="BATTLE" ||
   (phase==="COUNTDOWN" && match.start_at && Date.parse(match.start_at)<=serverNow());
 if(!effectiveBattle)return;

 const arr=[...players.values()];
 if(arr.length<2)return;

 const alive=arr.filter(p=>p.alive);
 if(alive.length>1)return;

 finishingMatch=true;

 // Normal case: one survivor remains.
 if(alive.length===1){
   alive[0].rank=1;
   await supabase.from("players").update({rank:1}).eq("id",alive[0].id);
 }

 // Edge case: everybody is K.O.
 // The most recently surviving player receives rank 1 via KO rank assignment.
 // If no rank 1 exists due to simultaneous updates, use highest SCORE as deterministic fallback.
 if(alive.length===0){
   let winner=arr.find(p=>p.rank===1);
   if(!winner){
     winner=[...arr].sort((a,b)=>(b.score||0)-(a.score||0))[0]||null;
     if(winner){
       winner.rank=1;
       await supabase.from("players").update({rank:1}).eq("id",winner.id);
     }
   }
 }

 const {error}=await supabase.from("matches")
   .update({phase:"RESULT"})
   .eq("id",room.id).eq("reset_epoch",room.reset_epoch).eq("battle_no",room.battle_no)
   .in("phase",["COUNTDOWN","BATTLE"]);

 if(error){
   console.error("finish match",error);
   finishingMatch=false;
   return;
 }

 if(match.reset_epoch!==room.reset_epoch||match.battle_no!==room.battle_no||resetting)return;
 phase="RESULT";
 render();
}
async function loadPlayers(){
 const epoch=match.reset_epoch;
 const {data,error}=await supabase.from("players").select("id,player_name,ready,alive,score,rank,max_combo,max_attack").eq("match_id",match.id).eq("reset_epoch",epoch);
 if(error){console.error(error);return;}
 if(epoch!==match.reset_epoch)return;
 players.clear();
 for(const p of data||[])players.set(p.id,{id:p.id,name:p.player_name,ready:p.ready,alive:p.alive,score:p.score||0,rank:p.rank??null,maxCombo:p.max_combo||0,maxAttack:p.max_attack||0});
 render();
}
async function init(){
 try{
   setBusy(true);
   await syncServerClock();match=requireSessionSchema(await getRoom());
   if(performance.getEntriesByType("navigation")[0]?.type==="reload"){
     match=await resetRoom(match);
   }
   phase=match.phase;await loadPlayers();setBusy(false);
   supabase.channel(`host-${match.id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:`match_id=eq.${match.id}`},payload=>{
      const p=payload.eventType==="DELETE"?payload.old:payload.new;if(!p||resetting)return;
      if(payload.eventType!=="DELETE"&&p.reset_epoch!==match.reset_epoch)return;
      if(payload.eventType==="DELETE"){
        players.delete(p.id);
        render();
        return;
      }

      const previous=players.get(p.id);
      players.set(p.id,{
        id:p.id,name:p.player_name,ready:p.ready,alive:p.alive,
        score:p.score||0,rank:p.rank??previous?.rank??null,
        maxCombo:p.max_combo||0,maxAttack:p.max_attack||0
      });

      const justKo=previous?.alive===true && p.alive===false;
      render();

      if(justKo){
        assignKoRank(p.id).then(()=>maybeFinishMatch());
      }else{
        maybeFinishMatch();
      }
    })
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"matches",filter:`id=eq.${match.id}`},payload=>{
      applyMatch(payload.new);
    }).subscribe();
 }catch(err){console.error(err);alert(resetError(err));}
}
function setBusy(value){
 resetting=value;
 for(const selector of ["#startBtn","#nextBtn","#resetBtn"])$(selector).disabled=value;
}
function applyMatch(next){
 if(match&&next.reset_epoch<match.reset_epoch)return;
 if(match&&next.reset_epoch!==match.reset_epoch){
   clearTimeout(startTimer);finishingMatch=false;players.clear();
 }
 match={...match,...next};phase=match.phase;render();
}
async function checked(query){const {data,error}=await query;if(error)throw error;return data;}
async function action(fn){
 if(!match||resetting)return;
 setBusy(true);
 try{await fn();}catch(error){console.error(error);alert(resetError(error));}
 finally{setBusy(false);await healHost();}
}
$("#startBtn").onclick=()=>action(async()=>{
 finishingMatch=false;
 await loadPlayers();
 if(![...players.values()].some(p=>p.ready))return alert("READYプレイヤーがまだいません。");
 await syncServerClock();
 const room={...match},startAtMs=serverNow()+4000;
 await checked(supabase.from("players").update({alive:true,score:0,rank:null,max_combo:0,max_attack:0}).eq("match_id",room.id).eq("reset_epoch",room.reset_epoch));
 const rows=await checked(supabase.from("matches").update({phase:"COUNTDOWN",start_at:new Date(startAtMs).toISOString(),level:1}).eq("id",room.id).eq("reset_epoch",room.reset_epoch).select());
 if(!rows?.length)throw new Error("セッションが更新されました。もう一度操作してください。");
 applyMatch(rows[0]);clearTimeout(startTimer);
 startTimer=setTimeout(async()=>{
   try{await checked(supabase.from("matches").update({phase:"BATTLE"}).eq("id",room.id).eq("reset_epoch",room.reset_epoch).eq("phase","COUNTDOWN").eq("start_at",new Date(startAtMs).toISOString()));}
   catch(error){console.error("start battle",error);}
 },Math.max(0,startAtMs-serverNow()));
});
$("#nextBtn").onclick=()=>action(async()=>{
 finishingMatch=false;clearTimeout(startTimer);
 const room={...match};
 await checked(supabase.from("players").update({ready:true,alive:true,score:0,rank:null,max_combo:0,max_attack:0}).eq("match_id",room.id).eq("reset_epoch",room.reset_epoch));
 await checked(supabase.from("attacks").delete().eq("match_id",room.id).eq("reset_epoch",room.reset_epoch));
 const rows=await checked(supabase.from("matches").update({phase:"LOBBY",start_at:null,battle_no:(room.battle_no||1)+1,level:1}).eq("id",room.id).eq("reset_epoch",room.reset_epoch).select());
 if(!rows?.length)throw new Error("セッションが更新されました。");
 applyMatch(rows[0]);
});
$("#resetBtn").onclick=()=>{
 if(resetting||!match||!confirm("全プレイヤー・盤面・スコア・攻撃履歴を完全リセットしますか？"))return;
 return action(async()=>{
   clearTimeout(startTimer);finishingMatch=false;
   applyMatch(await resetRoom(match));
 });
};
let healing=false;
async function healHost(){
 if(!match||resetting||healing)return;
 healing=true;
 try{applyMatch(requireSessionSchema(await getRoom()));await loadPlayers();}
 catch(error){console.error("host self-heal",error);}
 finally{healing=false;}
}
setInterval(healHost,1000);
window.addEventListener("focus",healHost);
render();init();
