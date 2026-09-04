import {CONFIG} from "./config.js";
import {Tetris} from "./tetris.js";
import {Renderer} from "./render.js";
import {supabase,getRoom,compactBoardToJson,jsonBoardToCompact} from "./supabase.js";

const $=s=>document.querySelector(s);
const board=$("#board"), next=$("#nextCanvas");
const renderer=new Renderer(board,next);
const id=sessionStorage.getItem("br-player-id")||crypto.randomUUID();sessionStorage.setItem("br-player-id",id);
let name="", matchStartAt=0, attackUnlockAt=0, currentPhase="LOBBY", placement=0;
let softDropHeld=false, lastSoftDropAt=0;
let game;
const peers=new Map();
let match=null, onlineReady=false;
const processedAttackIds=new Set();
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
 match=await getRoom();
 await upsertPlayerRow(); await upsertStateRow(); await loadPeers(); await refreshAliveCount();

 supabase.channel(`match-${match.id}`)
  .on("postgres_changes",{event:"UPDATE",schema:"public",table:"matches",filter:`id=eq.${match.id}`},payload=>{
    match={...match,...payload.new};
    if(match.phase==="COUNTDOWN"&&match.start_at){
      const startAt=Date.parse(match.start_at);
      if(currentPhase!=="COUNTDOWN"&&!game.started)startMatch(startAt);
    }
    if(match.phase==="LOBBY"&&currentPhase!=="LOBBY"){
      currentPhase="LOBBY";newGame();$("#statusText").textContent="READY";
    }
  }).subscribe();

 supabase.channel(`players-${match.id}`)
  .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:`match_id=eq.${match.id}`},async payload=>{
    const row=payload.new||payload.old;if(!row||row.id===id)return;
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
    const a=payload.new;if(!a||processedAttackIds.has(a.id)||!game.alive)return;
    processedAttackIds.add(a.id);
    lastAttackerId=a.attacker_id;
    const attacker=peers.get(a.attacker_id);
    $("#attackerEvent").textContent=`${attacker?.name||"PLAYER"} → YOU ×${a.amount}`;
    flashCard("#attackerCard");
    game.receiveAttack(a.amount,a.id);updateIncoming();renderPeerHUD();
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
 $("#targetEvent").textContent=`YOU → ${target.player_name} ×${amount}`;flashCard("#targetCard");renderPeerHUD();
}
async function markKO(reason,score){
 if(!match)return;
 await supabase.from("players").update({alive:false,score,max_combo:game.maxCombo,max_attack:game.maxAttack}).eq("id",id);
 await upsertStateRow();
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
  onAttack:amount=>{ if(Date.now()<attackUnlockAt){fx("ATTACK LOCKED");return;} game.maxAttack=Math.max(game.maxAttack,amount); requestAttack(amount); },
  onIncoming:()=>{updateIncoming();fx("⚠ INCOMING");},
  onDefense:({perfect})=>fx(perfect?"PERFECT DEFENSE!":"BLOCK!"),
  onLastChance:()=>{fx("LAST CHANCE<br><span>ONE MOVE</span>");$("#statusText").textContent="LAST CHANCE";},
  onSurvive:()=>{fx("SURVIVE!");$("#statusText").textContent="BATTLE";},
  onKO:({reason,score})=>{fx("K.O.");$("#statusText").textContent="K.O.";markKO(reason,score);sendState();});sendState();}
 };
}
function newGame(){game=new Tetris(callbacks());renderer.draw(game);updateIncoming();lastAttackTargetId=null;lastAttackerId=null;$("#targetEvent").textContent="NO TARGET";$("#attackerEvent").textContent="NO ATTACKER";renderPeerHUD()}
newGame();

$("#joinBtn").onclick=async()=>{
 name=$("#nameInput").value.trim()||`PLAYER-${id.slice(0,4).toUpperCase()}`;
 $("#playerNameLabel").textContent=name;$("#overlay").classList.add("hidden");$("#statusText").textContent="READY";
 try{
   if(!onlineReady)await subscribeOnline();
   else{await upsertPlayerRow();await upsertStateRow();}
 }catch(err){
   console.error(err);alert("Supabase接続に失敗しました。");
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
  const d=startAt-Date.now();
  if(d>0){
    const n=Math.max(1,Math.ceil(d/1000));
    if(n!==lastShown){showCountdown(String(n),false);lastShown=n;}
    requestAnimationFrame(countdown);
  }else{
   showCountdown("START!",true);
   game.start();currentPhase="BATTLE";$("#statusText").textContent="OPENING";
   setTimeout(()=>hideCountdown(),850);
   sendState();
  }
 };
 countdown();
}
// Supabase Realtime handles online events.

function sendState(){
 if(!name||!game||!match)return;
 upsertPlayerRow();upsertStateRow();
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
setInterval(sendState,CONFIG.SNAPSHOT_INTERVAL_MS);
