import {CONFIG} from "./config.js";
import {Tetris} from "./tetris.js";
import {Renderer} from "./render.js";
import {Free50Client,unpackPlayers,serverNow,roomCode} from "./free50.js";

const $=s=>document.querySelector(s);
const board=$("#board"), next=$("#nextCanvas");
const renderer=new Renderer(board,next);
const client=new Free50Client({capture:capturePacket,onView:applyView,onError:networkError});
const id=client.identity.id;
let roster=[],resumedForfeit=false;
document.querySelector('#roomLabel').textContent=roomCode;
let name="", matchStartAt=0, attackUnlockAt=0, currentPhase="LOBBY", placement=0;
let softDropHeld=false, lastSoftDropAt=0;
let game;
const peers=new Map();
let match=null, onlineReady=false, joined=false, seenBattleNo=null;
const processedAttackIds=new Set();
const processingAttackIds=new Set();
const attackSourceById=new Map();
const incomingTurnNotice=new Map();
let lastAttackTargetId=null,lastAttackerId=null,lastPeerRenderAt=0;
let lastAttackAmount=0,lastIncomingAmount=0;

function fx(text){const el=$("#centerFx");el.innerHTML=text;el.classList.remove("show");void el.offsetWidth;el.classList.add("show")}
function updateIncoming(){
  // Incoming attacks are intentionally communicated on the center board.
  // The former right-side attack pool is now used for the live #1 player panel.
  renderLeaderPanel();
}

function renderLeaderPanel(){
  const nameEl=$("#leaderName"), scoreEl=$("#leaderScore"), gapEl=$("#leaderGap");
  if(!nameEl||!scoreEl||!gapEl)return;
  const ranking=rankedPlayers().filter(p=>p.alive!==false);
  if(!ranking.length){
    nameEl.textContent="—"; scoreEl.textContent="SCORE —"; gapEl.textContent="対戦終了"; return;
  }
  const leader=ranking[0];
  const myScore=game?.score||0;
  const leaderScore=leader.score||0;
  nameEl.textContent=leader.id===id?`${leader.name||name||"あなた"}（あなた）`:(leader.name||"PLAYER");
  scoreEl.textContent=`SCORE ${leaderScore.toLocaleString()}`;
  if(leader.id===id){
    gapEl.textContent="あなたが現在1位！";
  }else{
    gapEl.textContent=`1位まで あと ${Math.max(0,leaderScore-myScore).toLocaleString()} POINT`;
  }
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
function renderPeerHUD(){const a=rankedPlayers(),i=a.findIndex(p=>p.id===id);fillMini("rivalUp",i>0?a[i-1]:null,"該当なし");fillMini("rivalDown",i>=0&&i<a.length-1?a[i+1]:null,"該当なし");fillMini("target",lastAttackTargetId?peers.get(lastAttackTargetId):null,"まだ攻撃していません");fillMini("attacker",lastAttackerId?peers.get(lastAttackerId):null,"まだ攻撃を受けていません");renderLeaderPanel()}
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
let sessionEpoch=null;

function forceEmergencyResetReload(){
 if(emergencyReloading)return;
 emergencyReloading=true;
 client.stop(true);

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

function prepareNextBattle(nextMatch){
 match={...match,...nextMatch};seenBattleNo=match.battle_no;
 currentPhase="LOBBY";softDropHeld=false;
 processedAttackIds.clear();processingAttackIds.clear();attackSourceById.clear();incomingTurnNotice.clear();
 hideCountdown();hideResultOverlay();
 $("#battleToast").classList.add("hidden");$("#combatAlert").classList.add("hidden");
 clearPeerHUD();newGame();$("#statusText").textContent=joined?"READY":"LOBBY";
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
 $("#combatAlert").classList.add("hidden");
 incomingTurnNotice.clear();
 $("#centerFx").classList.remove("show");
 $("#centerFx").innerHTML="";

 if(nextMatch)match={...match,...nextMatch};
 seenBattleNo=match?.battle_no??seenBattleNo;
}

async function fetchFinalPlayers(){return roster;}

async function showResultOverlay(){
 const battle=match?.battle_no;
 const rows=await fetchFinalPlayers();
 if(emergencyReloading||battle!==match?.battle_no||currentPhase!=="RESULT"||!rows.length)return;

 const sorted=[...rows].sort((a,b)=>{
   const ar=a.rank??9999, br=b.rank??9999;
   if(ar!==br)return ar-br;
   return (b.score||0)-(a.score||0);
 });

 const winner=sorted.find(p=>p.id===match.winner_id);
 const me=rows.find(p=>p.id===id);
 const overlay=$("#resultOverlay");

 overlay.classList.remove("hidden","loser");

 // The headline describes this player's result, not the shared winner.
 const isWinner=winner?.id===id;
 $("#resultKicker").textContent=isWinner?"BLOCK ROYALE":"対戦結果";
 $("#resultTitle").textContent=isWinner?"🏆 WINNER":"GAME OVER";
 $("#resultName").textContent=me?.player_name||name||"PLAYER";
 $("#resultScore").textContent=`SCORE ${(me?.score||0).toLocaleString()}`;
 $("#statusText").textContent=isWinner?"WINNER":(me?.alive===false?"K.O.":"RESULT");
 if(isWinner){
   $("#resultRank").textContent="あなたが優勝！ 👑";
   $("#resultWinner").textContent="";
   visualPulse("winner",5);
 }else{
   overlay.classList.add("loser");
   $("#resultRank").textContent=me?.rank?`あなたの順位 #${me.rank}`:"試合終了";
   $("#resultWinner").textContent=winner?`優勝：${winner.player_name}`:"優勝者なし（全員離脱）";
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

 // Wait for DB result rows instead of declaring victory from local alive.
 $("#statusText").textContent="RESULT";
 hideCountdown();
 $("#battleToast").classList.add("hidden");
 $("#combatAlert").classList.add("hidden");

 showResultOverlay();
}
function capturePacket(){
 // requestAnimationFrame pauses in a hidden tab. Heartbeats still advance gravity.
 if(game.started&&game.alive){
   const now=serverNow(),level=1+Math.floor(Math.max(0,now-matchStartAt)/CONFIG.LEVEL_INTERVAL_MS);
   if(game.level!==level)game.setLevel(level);
   game.tick(now);
 }
 const ranked=rankedPlayers(),index=ranked.findIndex(p=>p.id===id);
 const watch=[ranked[index-1]?.id,ranked[index+1]?.id,lastAttackTargetId,lastAttackerId].filter(Boolean);
 return {state:{board:game.snapshot(),score:game.score,alive:game.alive,
   max_combo:game.maxCombo,max_attack:game.maxAttack},watch:[...new Set(watch)].slice(0,4)};
}
function networkError(error,count){
 if(error.message.includes('SESSION_GONE')){forceEmergencyResetReload();return;}
 $('#connectionStatus').textContent=`通信を再試行中 (${count}) — 45秒以上途切れると失格になります`;
}
async function applyView(view,initial){
 $('#connectionStatus').textContent='接続中';
 if(sessionEpoch!==null && view.match.reset_epoch!==sessionEpoch){forceEmergencyResetReload();return;}
 const changed=seenBattleNo!==null && view.match.battle_no!==seenBattleNo;
 if(changed){resumedForfeit=false;prepareNextBattle(view.match);}
 match=view.match;sessionEpoch=match.reset_epoch;seenBattleNo=match.battle_no;
 if(view.players){
   roster=unpackPlayers(view.players);
   const old=new Map(peers);peers.clear();
   for(const p of roster)if(p.id!==id)peers.set(p.id,{...p,snapshot:view.boards?.[p.id]??old.get(p.id)?.snapshot??''});
 }
 $('#alive').textContent=view.alive;
 if(initial && ['COUNTDOWN','BATTLE'].includes(match.phase)){
   // Refresh cannot restore a lost local board fairly. Keep identity and forfeit.
   resumedForfeit=true;game.alive=false;game.started=false;
   $('#connectionStatus').textContent='対戦中にページが再読み込みされました。この試合は失格となり、次の試合から参加できます。';
 }
 if(view.me?.alive===false){game.alive=false;game.started=false;hideCountdown();$('#statusText').textContent='K.O.';}
 if(match.phase==='RESULT'){
   if(view.players)handleMatchResult();
   else {game.started=false;currentPhase='RESULT';client.lastFull=0;}
 }else if(['COUNTDOWN','BATTLE'].includes(match.phase) && !resumedForfeit && view.me?.alive && currentPhase==='LOBBY'){
   startMatch(Date.parse(match.start_at));
 }else if(match.phase==='LOBBY'){$('#statusText').textContent='READY';}
 for(const sent of view.sent||[]){
   lastAttackTargetId=sent.target_id;lastAttackAmount=sent.amount;
   const target=peers.get(sent.target_id)?.name||'プレイヤー';
   $('#targetEvent').textContent=`${target} へ攻撃 / 邪魔ブロック ${sent.amount}列`;
   showBattleToast('outgoing',target,sent.amount);flashCard('#targetCard');
 }
 if(currentPhase==='BATTLE')for(const a of view.attacks||[])processIncomingAttackRow(a);
 renderPeerHUD();
}
function updateAttackPersistence(packet){client.ack(packet.attackId,packet.amount,packet.turns);}
function resolveAttackPersistence(attackId,status){client.ack(attackId,0,0,status);}
function processIncomingAttackRow(a){
 if(!joined||a.reset_epoch!==sessionEpoch||a.battle_no!==seenBattleNo||a.target_id!==id||a.status!=='PENDING'||!game.alive||processedAttackIds.has(a.id))return;
 processedAttackIds.add(a.id);lastAttackerId=a.attacker_id;
 const attackerName=peers.get(a.attacker_id)?.name||'プレイヤー';
 attackSourceById.set(a.id,attackerName);
 $('#attackerEvent').textContent=`${attackerName} から ${a.amount}列の攻撃`;
 showBattleToast('incoming',attackerName,a.amount);flashCard('#attackerCard');
 game.receiveAttack(a.amount,a.id,a.turns_remaining);
}
function requestAttack(amount){if(joined&&game.alive&&amount>0)client.attack(amount);}
function markKO(){} // The next batched packet commits K.O. and the final score atomically.

let combatAlertTimer=null;

function showCombatAlert(kind,playerName,amount,turns=null){
 const box=$("#combatAlert");
 const kicker=$("#combatAlertKicker");
 const nameEl=$("#combatAlertName");
 const main=$("#combatAlertMain");
 const sub=$("#combatAlertSub");

 clearTimeout(combatAlertTimer);
 box.classList.remove("hidden","pop","outgoing","incoming","garbage-landing");
 void box.offsetWidth;

 const safeName=playerName||"プレイヤー";
 nameEl.textContent=safeName;

 if(kind==="outgoing"){
   box.classList.add("outgoing");
   kicker.textContent="攻撃したプレイヤー";
   main.textContent=`${safeName} へ攻撃！`;
   sub.textContent=`邪魔ブロック ${amount}列を送信`;
 }else if(kind==="landing"){
   box.classList.add("garbage-landing");
   kicker.textContent="攻撃してきたプレイヤー";
   main.textContent=`邪魔ブロック ${amount}列 投下！`;
   sub.textContent="";
 }else{
   box.classList.add("incoming");
   kicker.textContent="攻撃してきたプレイヤー";
   main.textContent=`${safeName} から攻撃！`;

   if(turns<=1){
     sub.textContent=`あと1ターンで邪魔ブロック ${amount}列`;
   }else{
     sub.textContent=`あと${turns}ターンで邪魔ブロック ${amount}列`;
   }
 }

 box.classList.add("pop");

 // Incoming countdown is intentionally held longer than a normal FX.
 const ms = kind==="incoming" ? 1700 : kind==="landing" ? 950 : 1500;
 combatAlertTimer=setTimeout(()=>{
   box.classList.add("hidden");
   box.classList.remove("pop","outgoing","incoming","garbage-landing");
 },ms);
}

function showIncomingCountdown(packets){
 if(!packets?.length)return;

 // Oldest incoming packet has priority in the center notice.
 const packet=packets[0];
 const attackerName=attackSourceById.get(packet.attackId)||"プレイヤー";
 const prev=incomingTurnNotice.get(packet.attackId);

 if(prev===packet.turns)return;
 incomingTurnNotice.set(packet.attackId,packet.turns);

 showCombatAlert("incoming",attackerName,packet.amount,packet.turns);
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
function visualPulse(kind,power=1){
 window.dispatchEvent(new CustomEvent("br:visual",{detail:{kind,power}}));
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
  onClear:({cleared,combo,attack,rows=[]})=>{
    const labels={1:"1ライン消去",2:"2ライン消去",3:"3ライン消去",4:"4ライン消去"};
    let text=labels[cleared]||"CLEAR";
    if(combo>=2)text+=`<br><span>${combo} コンボ</span>`;
    if(attack>0)text+=`<br><span>攻撃 ${attack}列</span>`;
    fx(text);
    renderer.triggerLineClear(rows,cleared);
    const frame=document.getElementById("boardFrame");
    if(frame){
      frame.classList.remove("line-impact-1","line-impact-2","line-impact-3","line-impact-4");
      void frame.offsetWidth;
      frame.classList.add(`line-impact-${Math.max(1,Math.min(4,cleared))}`);
      setTimeout(()=>frame.classList.remove(`line-impact-${Math.max(1,Math.min(4,cleared))}`),620);
    }
    visualPulse("clear",Math.max(1,cleared+(combo>=2?1:0)));
    $("#comboText").textContent=combo>=2?`🔥 ${combo} コンボ`:"—";
  },
  onAttack:amount=>{
    if(serverNow()<attackUnlockAt){
      fx("攻撃準備中");
      return;
    }
    game.maxAttack=Math.max(game.maxAttack,amount);
    visualPulse("attack",Math.max(1,amount));
    requestAttack(amount);
  },
  onIncoming:packets=>{
    updateIncoming();
    showIncomingCountdown(packets);
    visualPulse("incoming",Math.max(1,packets?.[0]?.amount||1));
  },
  onGarbageLand:({amount,attackId})=>{
    const attackerName=attackSourceById.get(attackId)||"プレイヤー";
    showCombatAlert("landing",attackerName,amount,0);
    visualPulse("incoming",Math.max(2,amount+1));
    showBattleToast("landing",attackerName,amount);
    resolveAttackPersistence(attackId,"LANDED");
    incomingTurnNotice.delete(attackId);
    attackSourceById.delete(attackId);
  },
  onIncomingSync:packets=>{
    for(const packet of packets)updateAttackPersistence(packet);
    showIncomingCountdown(packets);
  },
  onIncomingResolved:({attackId,status})=>{
    resolveAttackPersistence(attackId,status);
    incomingTurnNotice.delete(attackId);
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
function newGame(){game=new Tetris(callbacks());renderer.draw(game);updateIncoming();lastAttackTargetId=null;lastAttackerId=null;$("#score").textContent="0";$("#level").textContent="1";$("#maxCombo").textContent="0";$("#maxAttack").textContent="0";$("#comboText").textContent="—";$("#targetEvent").textContent="まだ攻撃していません";$("#attackerEvent").textContent="まだ攻撃を受けていません";renderPeerHUD()}
newGame();

$('#joinBtn').onclick=async()=>{
 if(emergencyReloading||$('#joinBtn').disabled)return;
 $('#joinBtn').disabled=true;
 $('#entryError').textContent='';$('#entryError').hidden=true;
 name=$('#nameInput').value.trim()||`PLAYER-${id.slice(0,4).toUpperCase()}`;
 $('#playerNameLabel').textContent=name;
 try{
   joined=true;
   const view=await client.join($('#entryCode').value,name);
   name=unpackPlayers(view.players).find(p=>p.id===id)?.name||name;
   $('#playerNameLabel').textContent=name;
   $('#overlay').classList.add('hidden');
 }catch(error){joined=false;$('#connectionStatus').textContent=error.message;$('#entryError').textContent=error.message;$('#entryError').hidden=false;}
 finally{$('#joinBtn').disabled=false;}
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
 const countdownGame=game;
 const countdown=()=>{
  if(emergencyReloading||!joined||!game.alive||currentPhase!=="COUNTDOWN"||game!==countdownGame)return;
  const d=startAt-serverNow();
  if(d>0){
    const n=Math.max(1,Math.ceil(d/1000));
    if(n!==lastShown){showCountdown(String(n),false);lastShown=n;}
    requestAnimationFrame(countdown);
  }else{
   showCountdown("START!",true);
   game.start(startAt);currentPhase="BATTLE";$("#statusText").textContent="OPENING";
   setTimeout(()=>hideCountdown(),850);
   sendState();
  }
 };
 countdown();
}
// Network cadence is controlled only by Free50Client; gameplay callbacks never send.
function sendState(){}
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
document.addEventListener('visibilitychange',()=>{softDropHeld=false;});
