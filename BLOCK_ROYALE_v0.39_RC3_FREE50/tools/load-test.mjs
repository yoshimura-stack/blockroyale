// Node 22+. Optional synthetic backend test. Never uses or resets CONFIG.ROOM_CODE.
// Creates a NEW BR39-LOAD-* room, writes test participants, then resets ONLY that room.
import {CONFIG} from '../public/js/config.js';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const local=process.argv.includes('--local');
if(!local && process.env.BR_RUN_LOAD!=='YES')throw Error('Set BR_RUN_LOAD=YES only during an agreed test window. This generates load on the shared project.');
const base=local?'http://127.0.0.1:8039':CONFIG.SUPABASE_URL;
const count=Number(process.env.BR_LOAD_COUNT||50),seconds=Number(process.env.BR_LOAD_SECONDS||120);
if(!Number.isInteger(count)||count<2||count>50||!Number.isFinite(seconds)||seconds<30||seconds>900)throw Error('Count 2..50, seconds 30..900');
const room=`BR39-LOAD-${Date.now()}`,entry=randomUUID();
const email=local?'host@local.test':process.env.BR_HOST_EMAIL,password=local?'local-only':process.env.BR_HOST_PASSWORD;
if(!email||!password)throw Error('BR_HOST_EMAIL and BR_HOST_PASSWORD are required. Do not put them in source code.');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let requests=0,bytes=0,retries=0,acceptedAttacks=0;const latencies=[];
async function post(path,body,token=CONFIG.SUPABASE_PUBLISHABLE_KEY){
 const t=performance.now();requests++;
 const res=await fetch(base+path,{method:'POST',headers:{apikey:CONFIG.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const raw=await res.text();bytes+=Buffer.byteLength(raw);latencies.push(performance.now()-t);
 const data=JSON.parse(raw);if(!res.ok)throw Error(data.message||data.error_description||`HTTP ${res.status}`);return data;
}
const session=await post('/auth/v1/token?grant_type=password',{email,password});
const rpc=(name,params,token)=>post('/rest/v1/rpc/'+name,params,token);
let view;
const host=action=>rpc('br39_host',{p_room:room,p_action:action,p_epoch:view?.match.reset_epoch??null,p_round:view?.match.battle_no??null,p_entry:entry},session.access_token);
let stop=false;
const participants=Array.from({length:count},(_,i)=>({id:randomUUID(),token:randomUUID()+randomUUID(),name:`LOAD-${String(i+1).padStart(2,'0')}`,seq:0,acks:[],score:0}));
const report={room,count,seconds,target:local?'local-PGlite':'Supabase',note:'Synthetic RPC clients, not 50 real browser/game clients.'};
async function tick(p,extra={}){
 const data={seq:++p.seq,reset_epoch:view.match.reset_epoch,battle_no:view.match.battle_no,full:p.seq%3===1,
  watch:participants.filter(x=>x.id!==p.id).slice(0,4).map(x=>x.id),
  state:{alive:true,score:p.score++,max_combo:0,max_attack:0,board:'.'.repeat(200)},acks:p.acks.splice(0,64),...extra};
 let answer;
 for(let attempt=0;attempt<3;attempt++){
  try{answer=await rpc('br39_tick',{p_id:p.id,p_token:p.token,p_data:data});break;}
  catch(e){if(attempt===2)throw e;retries++;await sleep(1000*2**attempt);}
 }
 acceptedAttacks+=(answer.sent||[]).length;
 p.acks=(answer.attacks||[]).map(a=>({id:a.id,amount:0,turns:0,status:'LANDED'}));return answer;
}
const started=Date.now();let loops=[];
try{
 view=await host('CREATE');
 for(const p of participants){await rpc('br39_join',{p_room:room,p_entry:entry,p_id:p.id,p_token:p.token,p_name:p.name});await sleep(50);}
 view=await host('VIEW');view=await host('START');
 const battleAt=Date.parse(view.match.start_at),end=Date.now()+seconds*1000;
 loops=participants.map(async(p,i)=>{
  await sleep(i*1000/count);
  while(!stop&&Date.now()<end){
   const outgoing=Date.now()>battleAt+16000 && p.seq%20===0?[{id:randomUUID(),amount:2}]:[];
   await tick(p,{outgoing});await sleep(1000);
  }
 });
 const monitor=(async()=>{while(!stop&&Date.now()<end){await host('VIEW');await rpc('br39_observe',{p_room:room,p_entry:entry});await sleep(2000);}})();
 loops.push(monitor);await Promise.all(loops);
 await Promise.all(participants.slice(0,-1).map(p=>tick(p,{state:{alive:false,score:p.score,max_combo:0,max_attack:0,board:'.'.repeat(200)}})));
 view=await host('VIEW');
 if(view.match.phase!=='RESULT'||view.match.winner_id!==participants.at(-1).id||new Set(view.players.map(p=>p[5])).size!==count)throw Error('Result/rank consistency failed');
 if(seconds>=50&&acceptedAttacks===0)throw Error('No attacks exercised');
 report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{
 stop=true;await Promise.allSettled(loops);
 if(view){try{view=await host('VIEW');await host('RESET');report.cleanup='Test room players cleared';}catch(e){report.cleanup=e.message;}}
 const elapsed=(Date.now()-started)/1000;latencies.sort((a,b)=>a-b);
 Object.assign(report,{requests,retries,acceptedAttacks,responseBytes:bytes,elapsedSeconds:elapsed,requestsPerSecond:requests/elapsed,
  p95Ms:latencies[Math.floor(latencies.length*.95)]||0,maxMs:latencies.at(-1)||0,estimatedResponseGBPerHour:bytes/elapsed*3600/1e9});
 const file=`load-report-${room}.json`;writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('Report:',file);
}
