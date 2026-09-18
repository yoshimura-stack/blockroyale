import {createClient} from './vendor/supabase.js';
import {CONFIG} from './config.js';
import {rpc,roomCode,unpackPlayers} from './free50.js';
const $=s=>document.querySelector(s);
const auth=createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_PUBLISHABLE_KEY,{
 auth:{persistSession:true,storage:sessionStorage,storageKey:'br39-host-auth',autoRefreshToken:true,detectSessionInUrl:false}
});
let view=null,session=null,busy=false,flight=null,timer,generation=0,authorized=false,authDenied=false;
$('#hostRoom').textContent=roomCode;
function message(text,error=false){$('#hostStatus').textContent=text;$('#hostStatus').classList.toggle('is-error',error);}
function render(){
 const players=unpackPlayers(view?.players),exists=!!view?.room_exists,phase=view?.match?.phase;
 $('#hostAuthStatus').textContent=session?(authorized?'HOSTログイン済み（主催者権限確認済み）':authDenied?'ログイン済み・主催者権限がありません':'ログイン済み・主催者権限を確認中'):'HOST未ログイン';
 $('#readyCount').textContent=players.filter(p=>p.ready).length;
 $('#aliveCount').textContent=view?.alive||0;$('#phase').textContent=phase||'—';
 $('#players').replaceChildren(...players.sort((a,b)=>(a.rank??999)-(b.rank??999)||b.score-a.score).map(p=>{
  const row=document.createElement('div');row.className='player-row';
  const name=document.createElement('span'),status=document.createElement('b');
  name.textContent=p.name;status.textContent=!p.ready?'未接続':!p.alive?`K.O. #${p.rank}`:p.score.toLocaleString();
  row.append(name,status);return row;
 }));
 $('#startBtn').disabled=busy||!authorized||phase!=='LOBBY';
 $('#nextBtn').disabled=busy||!authorized||phase!=='RESULT';
 $('#resetBtn').disabled=busy||!authorized||!exists;
 $('#createBtn').disabled=busy||!authorized||exists;
 $('#changeEntryBtn').disabled=busy||!authorized||!exists||phase!=='LOBBY'||players.length>0;
 $('#logoutBtn').disabled=busy||!session;
 $('#newEntry').disabled=busy||!authorized;
 $('#loginBtn').disabled=busy;
}
function act(action){
 if(flight)return action==='VIEW'?flight:flight.then(()=>act(action));
 const epoch=generation;
 busy=true;clearTimeout(timer);render();
 flight=(async()=>{
  try{
   const result=await auth.auth.getSession();if(result.error)throw result.error;
   if(epoch!==generation)return;
   session=result.data.session;
   if(!session){authorized=false;view=null;$('#roomStatus').textContent='ROOM未接続';return;}
   const data=await rpc('br39_host',{p_room:roomCode,p_action:action,p_epoch:view?.match?.reset_epoch??null,
     p_round:view?.match?.battle_no??null,p_entry:['CREATE','CHANGE_ENTRY_CODE'].includes(action)?$('#newEntry').value:null},session.access_token);
   if(epoch!==generation)return;
   if(data.api_version!==2)throw new Error('RC2のDB更新が必要です。追加SQLを実行してください。');
   view=data;authorized=true;authDenied=false;
   $('#roomStatus').textContent=data.room_exists?'ROOM接続済み・部屋作成済み':'部屋未作成 — 入室コードを入力して新規作成してください';
   // Polling must not erase the result of the operator's last action.
   if(data.action_result==='STALE')message('部屋の状態が変わったため操作しませんでした。現在の表示を確認してください。',true);
   else if(action==='CREATE')message('部屋を作成しました。入力した入室コードでPLAYERが参加できます。');
   else if(action==='CHANGE_ENTRY_CODE')message('入室コードを変更しました。新しいコードを参加者に伝えてください。');
   else if(action!=='VIEW')message(({START:'開始を受け付けました。8秒後にスタートします。',NEXT:'次の試合を準備しました。',RESET:'全員を退室させてリセットしました。入室コードは維持されています。'})[action]);
  }catch(error){
   if(epoch!==generation)return;
   if(error.message==='HOST_ONLY'){authorized=false;authDenied=true;view=null;}
   if(action==='VIEW')$('#roomStatus').textContent=`ROOM接続を確認してください：${error.message}`;
   else message(error.message,true);
  }finally{
   busy=false;flight=null;render();
   if(epoch===generation&&session)timer=setTimeout(()=>act('VIEW'),2000);
  }
 })();return flight;
}
$('#loginForm').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;clearTimeout(timer);render();
 try{
  const {data,error}=await auth.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
  if(error)throw error;session=data.session;authorized=false;authDenied=false;$('#password').value='';message('ログインしました。');
 }catch(error){message(error.message,true);}
 finally{busy=false;render();await act('VIEW');}
};
$('#showEntry').onchange=()=>{$('#newEntry').type=$('#showEntry').checked?'text':'password';};
$('#createBtn').onclick=()=>act('CREATE');
$('#changeEntryBtn').onclick=()=>{
 if(confirm('空のLOBBYの入室コードを変更します。古いコードでは入室できなくなります。変更しますか？'))act('CHANGE_ENTRY_CODE');
};
$('#startBtn').onclick=()=>act('START');$('#nextBtn').onclick=()=>act('NEXT');
$('#resetBtn').onclick=()=>{if(confirm(`${roomCode} の全員を退室させてリセットします。実行しますか？`))act('RESET');};
$('#logoutBtn').onclick=async()=>{
 if(busy)return;generation++;clearTimeout(timer);session=null;authorized=false;view=null;render();
 const {error}=await auth.auth.signOut({scope:'local'});
 $('#roomStatus').textContent='ROOM未接続';message(error?error.message:'ログアウトしました。',!!error);
};
render();act('VIEW');
