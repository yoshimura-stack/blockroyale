import {CONFIG} from './config.js';
import {rpc,roomCode,unpackPlayers,serverNow} from './free50.js';
const $=s=>document.querySelector(s);
let view=null,entry='',running=false;
$('#observerRoom').textContent=roomCode;
$('#observerForm').onsubmit=e=>{e.preventDefault();entry=$('#observerEntry').value;if(!running){running=true;poll();}};
async function poll(){
 try{
  view=await rpc('br39_observe',{p_room:roomCode,p_entry:entry});
  $('#observerStatus').textContent='接続中';$('#aliveCount').textContent=view.alive;
  $('#phase').textContent=view.match.phase;
  const rows=unpackPlayers(view.players);
  const ranked=rows.sort((a,b)=>Number(b.alive)-Number(a.alive)||b.score-a.score);
  $('#ranking').replaceChildren(...ranked.slice(0,10).map((p,i)=>{
   const row=document.createElement('div');row.className='rank-chip';
   row.textContent=`#${view.match.phase==='RESULT'?p.rank??'—':i+1} ${p.name} · ${p.score.toLocaleString()}${p.alive?'':' K.O.'}`;return row;
  }));
  if(view.match.phase==='RESULT'){
   const winner=rows.find(p=>p.id===view.match.winner_id);
   $('#heroText').textContent=winner?`🏆 WINNER ${winner.name}`:'優勝者なし';
   $('#timerText').textContent=winner?`SCORE ${winner.score.toLocaleString()}`:'';
  }else if(view.match.phase==='LOBBY'){
   $('#heroText').textContent='LOBBY';$('#timerText').textContent=`READY ${rows.filter(p=>p.ready).length}`;
  }
 }catch(error){$('#observerStatus').textContent=`接続を確認してください：${error.message}`;}
 finally{setTimeout(poll,2000);}
}
function frame(){
 const m=view?.match;
 if(m?.start_at&&['COUNTDOWN','BATTLE'].includes(m.phase)){
  const elapsed=serverNow()-Date.parse(m.start_at);
  $('#heroText').textContent=elapsed<0?Math.ceil(-elapsed/1000):`LEVEL ${1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS)}`;
  $('#timerText').textContent=elapsed<0?'GET READY':`${Math.floor(elapsed/60000)}:${String(Math.floor(elapsed/1000)%60).padStart(2,'0')}`;
 }
 requestAnimationFrame(frame);
}
frame();
