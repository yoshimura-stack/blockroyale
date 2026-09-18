import {PGlite} from '@electric-sql/pglite';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();const results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS',name);}
const sql=readFileSync(new URL('../supabase/migrations/20260917033647_free50.sql',import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create schema auth;
alter default privileges in schema public grant execute on functions to anon,authenticated;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public to anon,authenticated;
create table public.legacy_sentinel(v text);insert into public.legacy_sentinel values('untouched');`);
await db.exec(sql);
await db.exec(readFileSync(new URL('../supabase/migrations/20260917063330_room_entry_management.sql',import.meta.url),'utf8'));
const host=randomUUID(),entry='a-test-code-123456',room='TEST39';
async function admin(q,args=[]){await db.exec('reset role');return db.query(q,args);}
async function as(role,method,args){
 await db.exec(`set role ${role}`);
 const params=args.map((_,i)=>`$${i+1}`).join(',');
 return (await db.query(`select public.${method}(${params}) as result`,args)).rows[0].result;
}
async function hostCall(action,view=null,code=room){return as('authenticated','br39_host',[code,action,view?.match.reset_epoch??null,view?.match.battle_no??null,entry]);}
await test('Host auth allowlist and private tables are enforced',async()=>{
 await assert.rejects(hostCall('CREATE'),/HOST_ONLY/);
 await db.exec('set role anon');await assert.rejects(db.query('select * from br39.players'),/permission denied/);
 await assert.rejects(as('anon','br39_host',[room,'VIEW',null,null,null]),/permission denied/);
 await admin('insert into br39.hosts values($1)',[host]);
 await admin("select set_config('request.jwt.claim.sub',$1,false)",[host]);
});
let v=await hostCall('CREATE');const ids=Array.from({length:51},()=>randomUUID());const tokens=ids.map(()=>randomUUID()+randomUUID());
const join=(i,code=entry)=>as('anon','br39_join',[room,code,ids[i],tokens[i],`PLAYER-${i}`]);
const tick=(i,data,token=tokens[i])=>as('anon','br39_tick',[ids[i],token,data]);
const packet=(seq,extra={})=>({seq,reset_epoch:0,battle_no:1,full:true,...extra});
const state=(alive=true,score=0)=>({alive,score,board:'.'.repeat(200),max_combo:0,max_attack:0});
await test('Null/wrong secrets cannot bypass entry or session authentication',async()=>{
 await assert.rejects(join(0,null));await assert.rejects(join(0,'wrong'));
 await join(0);await assert.rejects(tick(0,packet(1),null),/SESSION_GONE/);
 await assert.rejects(as('anon','br39_observe',[room,null]),/INVALID_ENTRY/);
 await assert.rejects(as('anon','br39_join',[room,entry,ids[0],null,'name']),/INVALID_ENTRY/);
});
await test('Exactly 50 participants, idempotent READY, no hashes exposed',async()=>{
 for(let i=1;i<50;i++)await join(i);
 v=await join(0);assert.equal(v.players.length,50);
 await assert.rejects(join(50),/定員50人/);
 assert(!JSON.stringify(v).includes('token_hash'));assert(!JSON.stringify(v).includes(tokens[0]));
});
await test('VIEW does not reset; START creates 8s server countdown',async()=>{
 const before=v;v=await hostCall('VIEW');assert.equal(v.players.length,50);assert.deepEqual(v.match,before.match);
 v=await hostCall('START',v);assert.equal(v.match.phase,'COUNTDOWN');
 assert(Date.parse(v.match.start_at)-Number(v.server_ms)>7000);
 await admin("update br39.rooms set start_at=clock_timestamp()-interval '20 seconds' where code=$1",[room]);
});
const attack=randomUUID();
await test('Duplicate/lost-response retry delivers one attack; unauthorized acknowledgements ignored',async()=>{
 const data=packet(1,{state:state(),outgoing:[{id:attack,amount:3}]});
 const first=await tick(0,data);const again=await tick(0,data);
 assert.equal(first.sent.length,1);assert.deepEqual(first.sent,again.sent);
 assert.equal((await admin('select count(*)::int as n from br39.attacks')).rows[0].n,1);
 const target=ids.indexOf(first.sent[0].target_id);
 await tick(0,packet(2,{acks:[{id:attack,amount:0,turns:0,status:'LANDED'}]}));
 assert.equal((await admin('select status from br39.attacks')).rows[0].status,'PENDING');
 await tick(target,packet(1,{acks:[{id:attack,amount:2,turns:1,status:'PENDING'}]}));
 await tick(target,packet(2,{acks:[{id:attack,amount:0,turns:0,status:'LANDED'}]}));
 assert.equal((await admin('select status from br39.attacks')).rows[0].status,'LANDED');
});
await test('50 queued K.O. reports leave exactly one server-selected winner; stale alive cannot resurrect',async()=>{
 // PGlite serializes queries; this verifies ordering/idempotency, not server concurrency capacity.
 for(let i=0;i<49;i++)await tick(i,packet(10,{state:state(false,i*10)}));
 v=await tick(49,packet(10,{state:state(true,1)}));
 assert.equal(v.match.phase,'RESULT');assert.equal(v.match.winner_id,ids[49]);
 assert.equal(v.players.filter(p=>p[5]===1).length,1);
 assert.equal(new Set(v.players.map(p=>p[5])).size,50);
 await tick(0,packet(11,{state:state(true,999)}));
 assert.equal((await admin('select alive from br39.players where id=$1',[ids[0]])).rows[0].alive,false);
});
await test('NEXT invalidates previous round packets; RESET is idempotent and invalidates capabilities',async()=>{
 v=await hostCall('NEXT',v);assert.equal(v.match.battle_no,2);assert.equal(v.match.phase,'LOBBY');
 let stale=await tick(0,packet(500,{state:state(false,999)}));assert.equal(stale.me.alive,true);assert.equal(stale.me.last_seq,0);
 const before=v;v=await hostCall('RESET',before);const twice=await hostCall('RESET',before);
 assert.equal(v.match.reset_epoch,1);assert.equal(twice.match.reset_epoch,1);assert.equal(v.players.length,0);
 await assert.rejects(tick(0,packet(501)),/SESSION_GONE/);
});
await test('Disconnected player expires after 45 seconds; all disconnected means no winner',async()=>{
 await join(0);await join(1);v=await hostCall('VIEW');v=await hostCall('START',v);
 await admin("update br39.rooms set start_at=clock_timestamp()-interval '60 seconds',sweep_at=clock_timestamp()-interval '10 seconds' where code=$1",[room]);
 await admin("update br39.players set last_seen=clock_timestamp()-interval '50 seconds' where room=$1",[room]);
 v=await hostCall('VIEW');assert.equal(v.match.phase,'RESULT');assert.equal(v.match.winner_id,null);assert.equal(v.alive,0);
});
await test('Legacy data remains unchanged',async()=>assert.equal((await admin('select v from legacy_sentinel')).rows[0].v,'untouched'));
writeFileSync(new URL('./database39-results.json',import.meta.url),JSON.stringify({passed:results.length,results},null,2));
await db.close();
