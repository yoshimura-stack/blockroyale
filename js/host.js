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


async function assignKoRank(playerId){
 const aliveNow=[...players.values()].filter(p=>p.alive).length;
 const rank=Math.max(1,aliveNow+1);
 const player=players.get(playerId);
 if(player)player.rank=rank;
 await supabase.from("players").update({rank}).eq("id",playerId);
}

async function maybeFinishMatch(){
 if(!match||finishingMatch)return;
 if(phase!=="BATTLE")return;

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
 const {data,error}=await supabase.from("players").select("id,player_name,ready,alive,score,rank,max_combo,max_attack").eq("match_id",match.id);
 if(error){console.error(error);return;}
 players.clear();
 for(const p of data||[])players.set(p.id,{id:p.id,name:p.player_name,ready:p.ready,alive:p.alive,score:p.score||0,rank:p.rank??null,maxCombo:p.max_combo||0,maxAttack:p.max_attack||0});
 render();
}
async function init(){
 try{
   match=await getRoom();phase=match.phase;await loadPlayers();
   supabase.channel(`host-${match.id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:`match_id=eq.${match.id}`},payload=>{
      const p=payload.new||payload.old;if(!p)return;
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
 if(!match||!confirm("全プレイヤー・盤面・攻撃履歴を完全リセットしますか？"))return;

 const nextGeneration=(match.battle_no||1)+1;

 // 1) 先に世代番号を更新。PLAYERへ「完全リセット」を通知。
 const {error:matchErr}=await supabase.from("matches")
   .update({
     phase:"LOBBY",
     start_at:null,
     battle_no:nextGeneration,
     level:1
   })
   .eq("id",match.id);

 if(matchErr){
   console.error("reset match",matchErr);
   alert("RESETに失敗しました。");
   return;
 }

 match={...match,phase:"LOBBY",start_at:null,battle_no:nextGeneration,level:1};
 phase="LOBBY";
 render();

 // 2) RealtimeがPLAYERへ届く猶予。
 await new Promise(resolve=>setTimeout(resolve,900));

 const attackDelete=await supabase.from("attacks").delete().eq("match_id",match.id);
 const stateDelete=await supabase.from("player_states").delete().eq("match_id",match.id);
 const playerDelete=await supabase.from("players").delete().eq("match_id",match.id);

 if(attackDelete.error||stateDelete.error||playerDelete.error){
   console.error("reset delete error",{
     attacks:attackDelete.error,
     states:stateDelete.error,
     players:playerDelete.error
   });
 }

 // 3) DBの正しい現在状態をもう一度確定。
 await supabase.from("matches")
   .update({
     phase:"LOBBY",
     start_at:null,
     battle_no:nextGeneration,
     level:1
   })
   .eq("id",match.id);

 players.clear();
 render();
};
render();init();
