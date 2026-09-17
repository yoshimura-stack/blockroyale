import {createClient} from './vendor/supabase.js';
import {CONFIG} from './config.js';
import {rpc,roomCode,unpackPlayers} from './free50.js';
const $=s=>document.querySelector(s);
const auth=createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,storage:sessionStorage,storageKey:'br39-host-auth',autoRefreshToken:true,detectSessionInUrl:false}
});
let view=null,busy=false,timer;
$('#hostRoom').textContent=roomCode;
function render(){
 const players=unpackPlayers(view?.players);
 $('#readyCount').textContent=players.filter(p=>p.ready).length;
 $('#aliveCount').textContent=view?.alive||0;$('#phase').textContent=view?.match.phase||'—';
 $('#players').replaceChildren(...players.sort((a,b)=>(a.rank??999)-(b.rank??999)||b.score-a.score).map(p=>{
  const row=document.createElement('div');row.className='player-row';
  const name=document.createElement('span'),status=document.createElement('b');
  name.textContent=p.name;status.textContent=!p.ready?'未接続':!p.alive?`K.O. #${p.rank}`:p.score.toLocaleString();
  row.append(name,status);return row;
 }));
 $('#startBtn').disabled=busy||view?.match.phase!=='LOBBY';
 $('#nextBtn').disabled=busy||view?.match.phase!=='RESULT';
 $('#resetBtn').disabled=busy||!view;
}
async function act(action){
 if(busy)return;busy=true;clearTimeout(timer);render();
 try{
  const {data:{session},error}=await auth.auth.getSession();
  if(error)throw error;
  if(!session)throw new Error('HOSTアカウントでログインしてください');
  view=await rpc('br39_host',{p_room:roomCode,p_action:action,p_epoch:view?.match.reset_epoch??null,
    p_round:view?.match.battle_no??null,p_entry:action==='CREATE'?$('#newEntry').value:null},session.access_token);
  $('#hostStatus').textContent='接続中';
 }catch(error){$('#hostStatus').textContent=error.message;}
 finally{busy=false;render();timer=setTimeout(()=>act('VIEW'),2000);}
}
$('#loginForm').onsubmit=async e=>{
 e.preventDefault();$('#loginBtn').disabled=true;
 try{
  const {error}=await auth.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
  if(error)throw error;$('#password').value='';await act('VIEW');
 }catch(error){$('#hostStatus').textContent=error.message;}
 finally{$('#loginBtn').disabled=false;}
};
$('#createBtn').onclick=()=>act('CREATE');
$('#startBtn').onclick=()=>act('START');
$('#nextBtn').onclick=()=>act('NEXT');
$('#resetBtn').onclick=()=>{if(confirm(`${roomCode} の全員を退室させてリセットします。実行しますか？`))act('RESET');};
$('#logoutBtn').onclick=async()=>{await auth.auth.signOut({scope:'local'});view=null;render();};
render();act('VIEW');
