import {CONFIG} from "./config.js";
import {Tetris} from "./tetris.js";
import {Renderer} from "./render.js";
import {supabase,getRoom,compactBoardToJson,jsonBoardToCompact,serverNow,syncServerClock} from "./supabase.js";

const $=s=>document.querySelector(s);
const board=$("#board"), next=$("#nextCanvas");
const renderer=new Renderer(board,next);
const id=sessionStorage.getItem("br-player-id")||crypto.randomUUID();sessionStorage.setItem("br-player-id",id);
let name="", matchStartAt=0, attackUnlockAt=0, currentPhase="LOBBY", placement=0;
let softDropHeld=false, lastSoftDropAt=0;
let game;
const peers=new Map();
let match=null, onlineReady=false, joined=false, seenBattleNo=null;
const processedAttackIds=new Set();
const processingAttackIds=new Set();
const attackSourceById=new Map();
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
function rankedPlayers(){
 const map=new Map(peers);
 map.set(id,{
   id,
   name,
   alive:game?.alive!==false,
   score:game?.score||0,
   snapshot:game?.snapshot?.()||""
 });
 return [...map.values()].sort((a,b)=>{
   // Alive players always rank above K.O. players.
   if((a.alive!==false)!==(b.alive!==false)) return a.alive!==false ? -1 : 1;
   // Within the same status, higher score is shown higher for the live HUD.
   return (b.score||0)-(a.score||0)||String(a.name).localeCompare(String(b.name));
 });
}
function rankOf(pid){const a=rankedPlayers(),i=a.findIndex(p=>p.id===pid);return i<0?null:i+1}
function fillMini(pre,p,empty){$(`#${pre}Name`).textContent=p?.name||empty;$(`#${pre}Rank`).textContent=p?(p.alive===false?"K.O.":`#${rankOf(p.id)}`):"—";$(`#${pre}Score`).textContent=p?`SCORE ${(p.score||0).toLocaleString()}`:"SCORE —";drawMini(`#${pre}Board`,p?.snapshot||"")}
function renderPeerHUD(){const a=rankedPlayers(),i=a.findIndex(p=>p.id===id);fillMini("rivalUp",i>0?a[i-1]:null,"該当なし");fillMini("rivalDown",i>=0&&i<a.length-1?a[i+1]:null,"該当なし");fillMini("target",lastAttackTargetId?peers.get(lastAttackTargetId):null,"まだ攻撃していません");fillMini("attacker",lastAttackerId?peers.get(lastAttackerId):null,"まだ攻撃を受けていません")}
function flashCard(sel){const el=$(sel);el.classList.remove("hit");void el.offsetWidth;el.classList.add("hit")}




function clearPeerHUD(){
 peers.clear();
 lastAttackTargetId=null;
 lastAttackerId=null;
 lastAttackAmount=0;
 lastIncomingAmount=0;
 $("#targetEvent").textContent="まだ攻撃していません";
 $("#attackerEvent").textContent="まだ攻撃を受けていません";
 renderPeerHUD();
}

let emergencyReloading=false;

function forceEmergencyResetReload(){
 if(emergencyReloading)return;
 emergencyReloading=true;

 // Stop everything immediately before reload.
 joined=false;
 softDropHeld=false;
 if(game){
   game.started=false;
   game.alive=false;
 }

 hideCountdown();
 hideResultOverlay();
 $("#battleToast").classList.add("hidden");
 $("#statusText").textContent="RESET";

 // Emergency reset is intentionally a hard reset.
 // A fresh page guarantees SCORE / LEVEL / board / NEXT / local caches are gone.
 setTimeout(()=>{
   const url=new URL(window.location.href);
   url.searchParams.set("_reset",String(Date.now()));
   window.location.replace(url.toString());
 },120);
}

function handleEmergencyReset(nextMatch){
 joined=false;
 name="";
 currentPhase="LOBBY";
 softDropHeld=false;
 lastSoftDropAt=0;

 processedAttackIds.clear();
 attackSourceById.clear();

 if(game){
   game.started=false;
   game.alive=true;
 }

 clearPeerHUD();
 newGame();

 $("#playerNameLabel").textContent="PLAYER";
 $("#nameInput").value="";
 $("#statusText").textContent="LOBBY";
 $("#score").textContent="0";
 $("#level").textContent="1";
 $("#alive").textContent="0";

 // 強制的にPLAYER ENTRYへ戻す
 $("#overlay").classList.remove("hidden");
 $("#overlay").style.display="";
 hideCountdown();
 hideResultOverlay();
 $("#battleToast").classList.add("hidden");
 $("#centerFx").classList.remove("show");
 $("#centerFx").innerHTML="";

 if(nextMatch)match={...match,...nextMatch};
 seenBattleNo=match?.battle_no??seenBattleNo;
}

async function fetchFinalPlayers(){
 if(!match)return [];
 const {data,error}=await supabase
   .from("players")
   .select("id,player_name,alive,score,rank,max_combo,max_attack")
   .eq("match_id",match.id);
 if(error){
   console.error("final players",error);
   return [];
 }
 return data||[];
}

async function showResultOverlay(){
 const rows=await fetchFinalPlayers();
 if(!rows.length)return;

 const sorted=[...rows].sort((a,b)=>{
   const ar=a.rank??9999, br=b.rank??9999;
   if(ar!==br)return ar-br;
   return (b.score||0)-(a.score||0);
 });

 const winner=sorted.find(p=>p.rank===1)||sorted[0];
 const me=rows.find(p=>p.id===id);
 const overlay=$("#resultOverlay");

 overlay.classList.remove("hidden","loser");

 // Every PLAYER screen shows the SAME winner as the main event.
 $("#resultKicker").textContent="BLOCK ROYALE";
 $("#resultTitle").textContent="🏆 WINNER";
 $("#resultName").textContent=winner?.player_name||"PLAYER";
 $("#resultScore").textContent=`SCORE ${(winner?.score||0).toLocaleString()}`;

 if(winner?.id===id){
   $("#resultRank").textContent="あなたが優勝！ 👑";
 }else{
   overlay.classList.add("loser");
   $("#resultRank").textContent=me?.rank
     ? `あなたの順位 #${me.rank}`
     : "試合終了";
 }
}
function hideResultOverlay(){
 $("#resultOverlay").classList.add("hidden");
 $("#resultOverlay").classList.remove("loser");
}

function handleMatchResult(){
 if(!game)return;

 game.started=false;
 softDropHeld=false;
 currentPhase="RESULT";

 // Stop all gameplay immediately on every client.
 if(game.alive){
   $("#statusText").textContent="WINNER";
 }else{
   $("#statusText").textContent="K.O.";
 }

 hideCountdown();
 $("#battleToast").classList.add("hidden");
 showResultOverlay();
}
async function syncOwnPlayerTruth(){
 if(!match||!joined)return;

 const {data,error}=await supabase
   .from("players")
   .select("id")
   .eq("id",id)
   .maybeSingle();

 if(error){
   console.error("player self-heal",error);
   return;
 }

 // Emergency Reset removes the PLAYER row entirely.
 // NEXT BATTLE keeps it, so this cleanly distinguishes the two operations.
 if(!data){
   forceEmergencyResetReload();
 }
}

async function syncMatchTruth(){
 if(!match)return;

 const {data,error}=await supabase
   .from("matches")
   .select("id,phase,battle_no,start_at,level")
   .eq("id",match.id)
   .single();

 if(error){
   console.error("match self-heal",error);
   return;
 }

 const generationChanged=
   seenBattleNo!==null &&
   data.battle_no!==seenBattleNo;

 if(data.phase==="RESET"){
   forceEmergencyResetReload();
   return;
 }

 if(generationChanged && data.phase==="LOBBY"){
   handleEmergencyReset(data);
   return;
 }

 match={...match,...data};
 seenBattleNo=data.battle_no;

 if(data.phase==="RESULT"&&currentPhase!=="RESULT"){
   handleMatchResult();
 }
}

async function upsertPlayerRow(){
 if(!match||!name)return;
 const payload={id,match_id:match.id,player_name:name,ready:true,alive:game?.alive!==false,score:game?.score||0,max_combo:game?.maxCombo||0,max_attack:game?.maxAttack||0};
 const {error}=await supabase.from("players").upsert(payload,{onConflict:"id"});
 if(error)console.error("players upsert",error);
}
async function upsertStateRow(){
 if(!match||!name||!game)return;
 const payload={player_id:id,match_id:match.id,board:compactBoardToJson(game.snapshot()),next_piece:game.queue?.[0]||null,score:game.score||0,level:game.level||1,combo:game.combo||0,incoming_garbage:game.incoming.reduce((s,p)=>s+p.amount,0)};
 const {error}=await supabase.from("player_states").upsert(payload,{onConflict:"player_id"});
 if(error)console.error("state upsert",error);
}

async function updateAttackPersistence(packet){
 if(!match||!packet?.attackId||packet.attackId==="local")return;
 await supabase.from("attacks").update({
   amount:packet.amount,
   turns_remaining:packet.turns
 }).eq("id",packet.attackId).eq("target_id",id).eq("status","PENDING");
}

async function resolveAttackPersistence(attackId,status){
 if(!match||!attackId||attackId==="local")return;
 await supabase.from("attacks").update({
   status,
   processed_at:new Date(serverNow()).toISOString()
 }).eq("id",attackId).eq("target_id",id);
}

async function processIncomingAttackRow(a){
 if(!a||a.target_id!==id||a.status!=="PENDING"||!game?.alive)return;
 if(processedAttackIds.has(a.id)||processingAttackIds.has(a.id))return;

 processingAttackIds.add(a.id);
 try{
   const attacker=peers.get(a.attacker_id);
   let attackerName=attacker?.name;

   if(!attackerName){
     const {data}=await supabase.from("players")
       .select("player_name")
       .eq("id",a.attacker_id)
       .maybeSingle();
     attackerName=data?.player_name||"プレイヤー";
   }

   processedAttackIds.add(a.id);
   lastAttackerId=a.attacker_id;
   attackSourceById.set(a.id,attackerName);

   $("#attackerEvent").textContent=`${attackerName} から ${a.amount}列の攻撃`;
   showBattleToast("incoming",attackerName,a.amount);
   flashCard("#attackerCard");

   game.receiveAttack(
     a.amount,
     a.id,
     Number.isFinite(Number(a.turns_remaining)) ? Number(a.turns_remaining) : CONFIG.INCOMING_TURNS
   );
   updateIncoming();
   renderPeerHUD();
 }finally{
   processingAttackIds.delete(a.id);
 }
}

async function syncPendingAttacks(){
 if(!match||!joined||!game?.alive)return;

 const {data,error}=await supabase.from("attacks")
   .select("id,match_id,attacker_id,target_id,amount,turns_remaining,status,created_at")
   .eq("match_id",match.id)
   .eq("target_id",id)
   .eq("status","PENDING")
   .order("created_at",{ascending:true});

 if(error){
   console.error("pending attack self-heal",error);
   return;
 }

 for(const a of data||[]){
   await processIncomingAttackRow(a);
 }
}

async function catchUpToNow(showFx=false){
 if(!game?.started||!game.alive||currentPhase!=="BATTLE")return;

 const now=serverNow();
 const elapsed=Math.max(0,now-matchStartAt);
 const lv=1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS);

 if(lv!==game.level){
   game.setLevel(lv);
 }

 if(showFx)fx("時間同期中…");
 game.tick(now);
 renderer.draw(game);
 updateIncoming();
 sendState();

 if(showFx&&game.alive){
   setTimeout(()=>fx("現在時刻に同期"),120);
 }
}

async function loadPeers(){
 if(!match)return;
 const {data,error}=await supabase.from("players").select("id,player_name,alive,score,max_combo,max_attack,player_states(board,level,combo,incoming_garbage)").eq("match_id",match.id);
 if(error){console.error("loadPeers",error);return;}
 peers.clear();
 for(const row of data||[]){
   if(row.id===id)continue;
   const st=Array.isArray(row.player_states)?row.player_states[0]:row.player_states;
   peers.set(row.id,{id:row.id,name:row.player_name,alive:row.alive,score:row.score||0,maxCombo:row.max_combo||0,maxAttack:row.max_attack||0,snapshot:jsonBoardToCompact(st?.board)});
 }
 renderPeerHUD();
}
async function refreshAliveCount(){
 if(!match)return;
 const {count,error}=await supabase.from("players").select("id",{count:"exact",head:true}).eq("match_id",match.id).eq("alive",true);
 if(!error)$("#alive").textContent=count??0;
}
async function subscribeOnline(){
 await syncServerClock();
 match=await getRoom();
 seenBattleNo=match.battle_no;
 await upsertPlayerRow(); await upsertStateRow(); await loadPeers(); await refreshAliveCount();

 supabase.channel(`match-${match.id}`)
  .on("postgres_changes",{event:"UPDATE",schema:"public",table:"matches",filter:`id=eq.${match.id}`},payload=>{
    const incoming=payload.new;
    const battleChanged=seenBattleNo!==null && incoming.battle_no!==seenBattleNo;
    match={...match,...incoming};

    if(match.phase==="RESET"){
      forceEmergencyResetReload();
      return;
    }

    if(battleChanged && match.phase==="LOBBY"){
      handleEmergencyReset(incoming);
      return;
    }

    seenBattleNo=match.battle_no;

    if(match.phase==="COUNTDOWN"&&match.start_at){
      const startAt=Date.parse(match.start_at);
      if(joined&&currentPhase!=="COUNTDOWN"&&!game.started)startMatch(startAt);
    }
    if(match.phase==="RESULT"&&currentPhase!=="RESULT"){
      handleMatchResult();
    }
    if(match.phase==="LOBBY"&&currentPhase!=="LOBBY"){
      currentPhase="LOBBY";
      hideResultOverlay();
      newGame();
      $("#statusText").textContent=joined?"READY":"LOBBY";
    }
  }).subscribe();

 supabase.channel(`players-${match.id}`)
  .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:`match_id=eq.${match.id}`},async payload=>{
    const row=payload.new||payload.old;
    if(!row)return;

    // EMERGENCY RESET deletes this player's own row.
    // Do NOT ignore self DELETE: it is the most reliable reset signal.
    if(payload.eventType==="DELETE" && row.id===id){
      forceEmergencyResetReload();
      return;
    }

    if(row.id===id)return;

    if(payload.eventType==="DELETE"){
      peers.delete(row.id);
      if(lastAttackTargetId===row.id)lastAttackTargetId=null;
      if(lastAttackerId===row.id)lastAttackerId=null;
      renderPeerHUD();
      await refreshAliveCount();
      return;
    }
    const prev=peers.get(row.id)||{};
    peers.set(row.id,{...prev,id:row.id,name:row.player_name??prev.name,alive:row.alive??prev.alive,score:row.score??prev.score,maxCombo:row.max_combo??prev.maxCombo,maxAttack:row.max_attack??prev.maxAttack});
    renderPeerHUD(); await refreshAliveCount();
  }).subscribe();

 supabase.channel(`states-${match.id}`)
  .on("postgres_changes",{event:"*",schema:"public",table:"player_states",filter:`match_id=eq.${match.id}`},payload=>{
    const row=payload.new;if(!row||row.player_id===id)return;
    const prev=peers.get(row.player_id)||{id:row.player_id,name:"PLAYER"};
    peers.set(row.player_id,{...prev,snapshot:jsonBoardToCompact(row.board),score:row.score??prev.score});
    renderPeerHUD();
  }).subscribe();

 supabase.channel(`attacks-${id}`)
  .on("postgres_changes",{event:"INSERT",schema:"public",table:"attacks",filter:`target_id=eq.${id}`},payload=>{
    processIncomingAttackRow(payload.new);
  }).subscribe();

 onlineReady=true;
}
async function requestAttack(amount){
 if(!match||amount<=0)return;
 const {data:alive,error}=await supabase.from("players").select("id,player_name").eq("match_id",match.id).eq("alive",true).neq("id",id);
 if(error||!alive?.length)return;
 const target=alive[Math.floor(Math.random()*alive.length)];
 const {error:insertErr}=await supabase.from("attacks").insert({match_id:match.id,attacker_id:id,target_id:target.id,amount,turns_remaining:2,status:"PENDING"});
 if(insertErr){console.error("attack insert",insertErr);return;}
 lastAttackTargetId=target.id;lastAttackAmount=amount;
 const prev=peers.get(target.id)||{id:target.id,name:target.player_name,alive:true,score:0,snapshot:""};
 peers.set(target.id,{...prev,name:target.player_name});
 $("#targetEvent").textContent=`${target.player_name} へ攻撃 / 邪魔ブロック ${amount}列`;

 // Make the target unmistakable in the CENTER of the board.
 // This deliberately replaces the generic "Nライン消去 / 攻撃N列" FX.
 fx(`⚔ 攻撃！<br><strong>${target.player_name}</strong><br><span>邪魔ブロック ${amount}列</span>`);
 showBattleToast("outgoing",target.player_name,amount);

 flashCard("#targetCard");
 renderPeerHUD();
}
async function markKO(reason,score){
 if(!match)return;
 await supabase.from("players").update({alive:false,score,max_combo:game.maxCombo,max_attack:game.maxAttack}).eq("id",id);
 await upsertStateRow();
}


let battleToastTimer=null;

function showBattleToast(kind,playerName,amount){
 const toast=$("#battleToast");
 const label=$("#battleToastLabel");
 const main=$("#battleToastMain");
 const sub=$("#battleToastSub");

 clearTimeout(battleToastTimer);
 toast.classList.remove("hidden","show","outgoing","incoming");
 void toast.offsetWidth;

 if(kind==="outgoing"){
   toast.classList.add("outgoing");
   label.textContent="攻撃成功！";
   main.textContent=`${playerName||"プレイヤー"} へ攻撃`;
   sub.textContent=`邪魔ブロック ${amount}列を送信`;
 }else if(kind==="landing"){
   toast.classList.add("incoming");
   label.textContent="攻撃してきたプレイヤー";
   main.textContent=playerName||"プレイヤー";
   sub.textContent=`邪魔ブロック ${amount}列投下`;
 }else{
   toast.classList.add("incoming");
   label.textContent="攻撃してきたプレイヤー";
   main.textContent=playerName||"プレイヤー";
   sub.textContent=`邪魔ブロック ${amount}列が接近中`;
 }

 toast.classList.add("show");

 battleToastTimer=setTimeout(()=>{
   toast.classList.add("hidden");
   toast.classList.remove("show","outgoing","incoming");
 },1650);
}
function callbacks(){
 return {
  clock:()=>serverNow(),
  levelAt:ts=>Math.max(1,1+Math.floor(Math.max(0,ts-matchStartAt)/CONFIG.LEVEL_INTERVAL_MS)),
  onNext:t=>renderer.drawNext(t),
  onScore:s=>$("#score").textContent=s.toLocaleString(),
  onStats:s=>{
    $("#score").textContent=s.score.toLocaleString();
    $("#level").textContent=s.level;
    $("#maxCombo").textContent=s.maxCombo;
    $("#maxAttack").textContent=s.maxAttack;
    updateIncoming();
    sendState();
  },
  onClear:({cleared,combo,attack})=>{
    const labels={1:"1ライン消去",2:"2ライン消去",3:"3ライン消去",4:"4ライン消去"};
    let text=labels[cleared]||"CLEAR";
    if(combo>=2)text+=`<br><span>${combo} コンボ</span>`;
    if(attack>0)text+=`<br><span>攻撃 ${attack}列</span>`;
    fx(text);
    $("#comboText").textContent=combo>=2?`🔥 ${combo} コンボ`:"—";
  },
  onAttack:amount=>{
    if(Date.now()<attackUnlockAt){
      fx("攻撃準備中");
      return;
    }
    game.maxAttack=Math.max(game.maxAttack,amount);
    requestAttack(amount);
  },
  onIncoming:()=>{
    updateIncoming();
    fx("⚠ 攻撃接近");
  },
  onGarbageLand:({amount,attackId})=>{
    const attackerName=attackSourceById.get(attackId)||"プレイヤー";
    showBattleToast("landing",attackerName,amount);
    fx(`邪魔ブロック<br><span>${amount}列 投下</span>`);
    resolveAttackPersistence(attackId,"LANDED");
    attackSourceById.delete(attackId);
  },
  onIncomingSync:packets=>{
    for(const packet of packets)updateAttackPersistence(packet);
  },
  onIncomingResolved:({attackId,status})=>{
    resolveAttackPersistence(attackId,status);
    attackSourceById.delete(attackId);
  },
  onDefense:({perfect})=>fx(perfect?"完全相殺！":"相殺！"),
  onLastChance:()=>{
    fx("ラストチャンス<br><span>あと1手</span>");
    $("#statusText").textContent="LAST CHANCE";
  },
  onSurvive:()=>{
    fx("生存！");
    $("#statusText").textContent="BATTLE";
  },
  onKO:({reason,score})=>{
    fx("K.O.");
    $("#statusText").textContent="K.O.";
    markKO(reason,score);
    sendState();
  }
 };
}
function newGame(){game=new Tetris(callbacks());renderer.draw(game);updateIncoming();lastAttackTargetId=null;lastAttackerId=null;$("#targetEvent").textContent="まだ攻撃していません";$("#attackerEvent").textContent="まだ攻撃を受けていません";renderPeerHUD()}
newGame();

$("#joinBtn").onclick=async()=>{
 name=$("#nameInput").value.trim()||`PLAYER-${id.slice(0,4).toUpperCase()}`;
 $("#playerNameLabel").textContent=name;
 $("#statusText").textContent="CONNECTING";

 try{
   if(!onlineReady){
     await subscribeOnline();
   }else{
     await upsertPlayerRow();
     await upsertStateRow();
   }
   joined=true;
   seenBattleNo=match?.battle_no??seenBattleNo;
   $("#overlay").classList.add("hidden");
   $("#statusText").textContent="READY";
 }catch(err){
   console.error("READY / Supabase error:",err);
   $("#statusText").textContent="ERROR";
   alert(`Supabase接続に失敗しました。\n${err?.message||err}`);
 }
};
function showCountdown(value, go=false){
 const overlay=$("#countdownOverlay");
 const num=$("#countdownNumber");
 const eyebrow=$("#countdownEyebrow");
 const sub=$("#countdownSub");
 overlay.classList.remove("hidden","go");
 if(go)overlay.classList.add("go");
 eyebrow.textContent=go?"BLOCK ROYALE":"GET READY";
 sub.textContent=go?"BATTLE START":"BATTLE STARTS";
 num.textContent=value;
 num.classList.remove("pulse");
 void num.offsetWidth;
 num.classList.add("pulse");
}
function hideCountdown(){
 $("#countdownOverlay").classList.add("hidden");
}

function startMatch(startAt){
 newGame();matchStartAt=startAt;attackUnlockAt=startAt+CONFIG.OPENING_ATTACK_LOCK_MS;currentPhase="COUNTDOWN";
 let lastShown=null;
 const countdown=()=>{
  const d=startAt-serverNow();
  if(d>0){
    const n=Math.max(1,Math.ceil(d/1000));
    if(n!==lastShown){showCountdown(String(n),false);lastShown=n;}
    requestAnimationFrame(countdown);
  }else{
   showCountdown("START!",true);
   game.start(serverNow());currentPhase="BATTLE";$("#statusText").textContent="OPENING";
   setTimeout(()=>hideCountdown(),850);
   sendState();
  }
 };
 countdown();
}
// Supabase Realtime handles online events.

function sendState(){
 if(!joined||!name||!game||!match)return;
 upsertPlayerRow();
 upsertStateRow();
}
window.addEventListener("keydown",e=>{
 if(!game.started||!game.alive)return;
 let handled=true;
 if(e.key==="a"||e.key==="A")game.move(-1);
 else if(e.key==="d"||e.key==="D")game.move(1);
 else if(e.key==="ArrowLeft")game.rotate(-1);
 else if(e.key==="ArrowRight")game.rotate(1);
 else if(e.key==="s"||e.key==="S"||e.key==="ArrowDown"){
   softDropHeld=true;
   // S / ↓ are both Soft Drop. Give immediate feedback on first press.
   if(!e.repeat)game.softDrop();
 }
 else handled=false;
 if(handled){e.preventDefault();renderer.draw(game);}
},{passive:false});

window.addEventListener("keyup",e=>{
 if(e.key==="ArrowDown"||e.key==="s"||e.key==="S"){
   softDropHeld=false;
   e.preventDefault();
 }
},{passive:false});

window.addEventListener("blur",()=>{softDropHeld=false;});

function loop(){
 if(game){
  const now=serverNow();

  if(game.started&&game.alive){
   const elapsed=Math.max(0,now-matchStartAt);
   const lv=1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS);

   if(lv!==game.level){
     game.setLevel(lv);
     fx(`スピードアップ<br><span>LEVEL ${lv}</span>`);
   }

   if(now<attackUnlockAt){
     $("#statusText").textContent=`攻撃準備 ${Math.ceil((attackUnlockAt-now)/1000)}`;
   }else if(
     $("#statusText").textContent.startsWith("OPENING") ||
     $("#statusText").textContent.startsWith("攻撃準備")
   ){
     $("#statusText").textContent="対戦中";
     fx("攻撃解禁！");
   }

   if(softDropHeld && now-lastSoftDropAt>=CONFIG.SOFT_DROP_MS){
     game.softDrop();
     lastSoftDropAt=now;
   }

   // tick() catches up all gravity/lock events missed while hidden/minimized.
   game.tick(now);
  }

  renderer.draw(game);
  if(now-lastPeerRenderAt>500){
    renderPeerHUD();
    lastPeerRenderAt=now;
  }
 }
 requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(sendState,CONFIG.SNAPSHOT_INTERVAL_MS);
setInterval(()=>{ if(match)syncMatchTruth(); },1000);
setInterval(()=>{ if(match&&joined)syncOwnPlayerTruth(); },1000);

setInterval(()=>{ if(match&&joined)syncPendingAttacks(); },2000);

async function recoverFromBackground(){
 if(!joined||!match)return;

 softDropHeld=false;

 await syncServerClock();
 await syncMatchTruth();
 await syncOwnPlayerTruth();

 if(!joined)return;

 await loadPeers();
 await syncPendingAttacks();

 if(match?.phase==="COUNTDOWN"&&match.start_at&&currentPhase!=="COUNTDOWN"&&!game.started){
   startMatch(Date.parse(match.start_at));
   return;
 }

 if((match?.phase==="BATTLE"||currentPhase==="BATTLE")&&game?.started&&game.alive){
   currentPhase="BATTLE";
   await catchUpToNow(true);
 }
}

document.addEventListener("visibilitychange",()=>{
 if(document.visibilityState==="visible"){
   recoverFromBackground();
 }else{
   softDropHeld=false;
 }
});

window.addEventListener("focus",()=>recoverFromBackground());
window.addEventListener("pageshow",()=>recoverFromBackground());

// Periodically re-sync client/server clock drift while foreground.
setInterval(()=>{ if(document.visibilityState==="visible")syncServerClock(); },30000);

