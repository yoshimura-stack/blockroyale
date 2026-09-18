import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();let passed=0;
const first='fixture-first-code',second='fixture-second-code',uid=randomUUID(),room='RC2-TEST';
const call=async(fn,args)=>Object.values((await db.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args)).rows[0])[0];
const host=(action,view=null,entry=null,code=room)=>call('br39_host',[code,action,view?.match?.reset_epoch??null,view?.match?.battle_no??null,entry]);
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
await db.exec(`create role anon;create role authenticated;create schema auth;
alter default privileges in schema public grant execute on functions to anon,authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
await db.exec(readFileSync(new URL('../supabase/migrations/20260917033647_free50.sql',import.meta.url),'utf8'));
await db.query('insert into br39.hosts values($1)',[uid]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
let v=await host('CREATE',null,first),before=v.match;
const update=readFileSync(new URL('../supabase/migrations/20260917063330_room_entry_management.sql',import.meta.url),'utf8');
await test('RC2 migration is repeatable and preserves existing rooms',async()=>{
 await db.exec(update);await db.exec(update);v=await host('VIEW');assert.deepEqual(v.match,before);
});
await test('Missing room and host authorization are explicit',async()=>{
 const x=await host('VIEW',null,null,'MISSING');assert.equal(x.host_authorized,true);assert.equal(x.room_exists,false);assert.equal(x.match,null);
 await db.query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(host('VIEW'),/HOST_ONLY/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('CREATE cannot silently overwrite or silently accept an existing room',async()=>{
 await assert.rejects(host('CREATE',null,second),/既に存在/);
 const x=await call('br39_observe',[room,first]);assert.equal(x.match.id,room);
 await assert.rejects(call('br39_observe',[room,second]),/INVALID_ENTRY/);
 const created=await host('CREATE',null,first,'OTHER');assert.equal(created.action_result,'CREATED');
});
await test('Empty-room rotation accepts only valid code/current epoch; old code is rejected',async()=>{
 await assert.rejects(host('CHANGE_ENTRY_CODE',v,null),/12〜160/);
 await assert.rejects(host('CHANGE_ENTRY_CODE',v,'short'),/12〜160/);
 const old=v;v=await host('CHANGE_ENTRY_CODE',v,second);assert.equal(v.action_result,'ENTRY_CHANGED');assert.equal(v.match.reset_epoch,1);
 await assert.rejects(host('CHANGE_ENTRY_CODE',old,first),/状態が変わり/);
 await assert.rejects(call('br39_observe',[room,first]),/INVALID_ENTRY/);
 assert.equal((await call('br39_observe',[room,second])).match.reset_epoch,1);
});
const players=[0,1].map(i=>({id:randomUUID(),token:randomUUID()+randomUUID(),name:`TEST${i+1}`}));
await test('Two JOINs match HOST READY count; populated-room rotation is rejected',async()=>{
 for(const p of players)await call('br39_join',[room,second,p.id,p.token,p.name]);
 v=await host('VIEW');assert.equal(v.players.filter(p=>p[2]).length,2);
 await assert.rejects(host('CHANGE_ENTRY_CODE',v,first),/参加者0人/);
});
await test('START, HOST reload, result, NEXT and RESET preserve intended room/code lifecycle',async()=>{
 v=await host('START',v);assert.equal(v.match.phase,'COUNTDOWN');assert(Date.parse(v.match.start_at)-Number(v.server_ms)>7000);
 const start=v.match;assert.deepEqual((await host('VIEW')).match,start);
 await assert.rejects(host('CHANGE_ENTRY_CODE',v,first),/参加者0人/);
 await db.query("update br39.rooms set start_at=clock_timestamp()-interval '1 second' where code=$1",[room]);
 const p=players[1];v=await call('br39_tick',[p.id,p.token,{seq:1,reset_epoch:v.match.reset_epoch,battle_no:v.match.battle_no,full:true,state:{alive:false,board:'.'.repeat(200)}}]);
 assert.equal(v.match.winner_id,players[0].id);v=await host('NEXT',v);assert.equal(v.players.filter(p=>p[2]&&p[3]).length,2);
 const old=v;v=await host('RESET',v);assert.equal(v.players.length,0);assert.equal(v.match.phase,'LOBBY');
 assert.equal((await host('RESET',old)).action_result,'STALE');
 assert.equal((await call('br39_observe',[room,second])).match.phase,'LOBBY');
 assert.equal((await host('VIEW',null,null,'OTHER')).room_exists,true);
});
console.log(`${passed} entry-management scenarios passed`);await db.close();
