import {normalizeEntryCode,bindEntryCode} from './entry-code.js';
import {createClient} from './vendor/supabase.js';
import {CONFIG} from './config.js';
import {rpc,roomCode,unpackPlayers} from './free50.js';

const $=selector=>document.querySelector(selector);
const entryInput=$('#newEntry');
bindEntryCode(entryInput);
const auth=createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,storage:sessionStorage,storageKey:'br39-host-auth',autoRefreshToken:true,detectSessionInUrl:false}
});
const state={view:null,session:null,authorized:false,authDenied:false,requestRunning:false,generation:0};
let timer=null,flight=null;
$('#hostRoom').textContent=roomCode;

function showMessage(text,error=false){
  $('#hostStatus').textContent=text||'';
  $('#hostStatus').classList.toggle('is-error',error);
}

// DB同期領域だけを更新する。フォームのDOM・値・focus・selectionには触れない。
function renderSyncedState(){
  const players=unpackPlayers(state.view?.players);
  const roomExists=Boolean(state.view?.room_exists);
  const phase=state.view?.match?.phase;
  $('#hostAuthStatus').textContent=state.session
    ? state.authorized?'HOSTログイン済み（主催者権限確認済み）'
      : state.authDenied?'ログイン済み・主催者権限がありません':'ログイン済み・主催者権限を確認中'
    : 'HOST未ログイン';
  $('#roomStatus').textContent=roomExists
    ? 'ROOM接続済み・部屋作成済み（既存ROOMへ復帰）'
    : state.authorized?'部屋未作成 — 入室コードを入力して新規作成してください':'ROOM未接続';
  $('#readyCount').textContent=players.filter(player=>player.ready).length;
  $('#aliveCount').textContent=state.view?.alive||0;
  $('#phase').textContent=phase||'—';
  $('#players').replaceChildren(...players.sort((a,b)=>(a.rank??999)-(b.rank??999)||b.score-a.score).map(player=>{
    const row=document.createElement('div');row.className='player-row';
    const name=document.createElement('span'),status=document.createElement('b');
    name.textContent=player.name;
    status.textContent=!player.ready?'未接続':!player.alive?`K.O. #${player.rank}`:player.score.toLocaleString();
    row.append(name,status);return row;
  }));
  $('#createBtn').hidden=roomExists;
  $('#createBtn').disabled=state.requestRunning||!state.authorized||roomExists;
  $('#changeEntryBtn').hidden=!roomExists;
  $('#changeEntryBtn').disabled=state.requestRunning||!state.authorized||phase!=='LOBBY'||players.length>0;
  $('#startBtn').disabled=state.requestRunning||!state.authorized||phase!=='LOBBY'||players.filter(player=>player.ready).length<1;
  $('#nextBtn').disabled=state.requestRunning||!state.authorized||phase!=='RESULT';
  $('#resetBtn').disabled=state.requestRunning||!state.authorized||!roomExists;
  $('#logoutBtn').disabled=state.requestRunning||!state.session;
  $('#loginBtn').disabled=state.requestRunning;
}

function validateEntry(){
  entryInput.value=normalizeEntryCode(entryInput.value);
  if(entryInput.value.length>=12&&entryInput.value.length<=160)return true;
  showMessage(`保存していません。入室コードは12〜160文字です（現在${entryInput.value.length}文字）。以前のコードが引き続き有効です。`,true);
  entryInput.focus();return false;
}

function schedulePoll(epoch){
  clearTimeout(timer);
  if(epoch===state.generation&&state.session)timer=setTimeout(()=>request('VIEW'),2000);
}

function request(action){
  if(['CREATE','CHANGE_ENTRY_CODE'].includes(action)&&!validateEntry())return Promise.resolve();
  if(flight)return action==='VIEW'?flight:flight.then(()=>request(action));
  const epoch=state.generation;
  state.requestRunning=true;clearTimeout(timer);renderSyncedState();
  flight=(async()=>{
    try{
      const result=await auth.auth.getSession();if(result.error)throw result.error;
      if(epoch!==state.generation)return;
      state.session=result.data.session;
      if(!state.session){state.authorized=false;state.view=null;return;}
      const data=await rpc('br39_host',{
        p_room:roomCode,p_action:action,p_epoch:state.view?.match?.reset_epoch??null,
        p_round:state.view?.match?.battle_no??null,
        p_entry:['CREATE','CHANGE_ENTRY_CODE'].includes(action)?normalizeEntryCode(entryInput.value):null
      },state.session.access_token);
      if(epoch!==state.generation)return;
      if(data.api_version!==2)throw new Error('RC2以降のDB更新が必要です。追加SQLを実行してください。');
      state.view=data;state.authorized=true;state.authDenied=false;
      if(data.action_result==='STALE')showMessage('部屋の状態が変わったため操作しませんでした。現在の表示を確認してください。',true);
      else if(action==='CREATE')showMessage('部屋を作成しました。入力した入室コードでPLAYERが参加できます。');
      else if(action==='CHANGE_ENTRY_CODE')showMessage('入室コードを変更しました。新しいコードを参加者に伝えてください。');
      else if(action!=='VIEW')showMessage({START:'開始を受け付けました。8秒後にスタートします。',NEXT:'次の試合を準備しました。',RESET:'全員を退室させてリセットしました。入室コードは維持されています。'}[action]);
    }catch(error){
      if(epoch!==state.generation)return;
      if(error.message==='HOST_ONLY'){state.authorized=false;state.authDenied=true;state.view=null;}
      if(action==='VIEW')$('#roomStatus').textContent=`ROOM接続を確認してください：${error.message}`;
      else showMessage(error.message,true);
    }finally{
      state.requestRunning=false;flight=null;renderSyncedState();schedulePoll(epoch);
    }
  })();return flight;
}
const act=request;

$('#loginForm').onsubmit=async event=>{
  event.preventDefault();if(state.requestRunning)return;
  state.requestRunning=true;clearTimeout(timer);renderSyncedState();
  try{
    const {data,error}=await auth.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(error)throw error;
    state.session=data.session;state.authorized=false;state.authDenied=false;$('#password').value='';showMessage('ログインしました。');
  }catch(error){showMessage(error.message,true);}
  finally{state.requestRunning=false;renderSyncedState();await request('VIEW');}
};
$('#showEntry').onchange=()=>{entryInput.type=$('#showEntry').checked?'text':'password';entryInput.focus();};
$('#createBtn').onclick=()=>request('CREATE');
$('#changeEntryBtn').onclick=()=>{if(confirm('空のLOBBYの入室コードを変更します。古いコードでは入室できなくなります。変更しますか？'))request('CHANGE_ENTRY_CODE');};
$('#startBtn').onclick=()=>request('START');
$('#nextBtn').onclick=()=>request('NEXT');
$('#resetBtn').onclick=()=>{if(confirm(`${roomCode} の全員を退室させてリセットします。実行しますか？`))request('RESET');};
$('#logoutBtn').onclick=async()=>{
  if(state.requestRunning)return;
  state.generation++;clearTimeout(timer);state.session=null;state.authorized=false;state.view=null;renderSyncedState();
  const {error}=await auth.auth.signOut({scope:'local'});
  showMessage(error?error.message:'ログアウトしました。',Boolean(error));
};
renderSyncedState();request('VIEW');
