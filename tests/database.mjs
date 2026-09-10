import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
const p='10000000-0000-0000-0000-000000000001',q='10000000-0000-0000-0000-000000000002';
const tests=[];
async function test(name,fn){await fn();tests.push(name);console.log('PASS',name);}
async function scalar(sql){return Object.values((await db.query(sql)).rows[0])[0];}
await db.exec(`
create role anon;create role authenticated;
create table matches(id uuid primary key, room_code text unique, phase text not null default 'LOBBY' check(phase in ('LOBBY','COUNTDOWN','BATTLE','RESULT')), start_at timestamptz, level integer default 1,battle_no integer default 1);
create table players(id uuid primary key,match_id uuid references matches(id),player_name text,ready boolean default true,alive boolean default true,score integer default 0,rank integer,max_combo integer default 0,max_attack integer default 0,updated_at timestamptz default now());
create table player_states(player_id uuid primary key references players(id),match_id uuid references matches(id),board jsonb);
create table attacks(id uuid primary key,match_id uuid references matches(id),attacker_id uuid references players(id),target_id uuid references players(id));
insert into matches(id,room_code) values('${a}','A'),('${b}','B');
grant usage on schema public to anon,authenticated;
grant select,insert,update,delete on all tables in schema public to anon,authenticated;
`);
await test('v0.35 RESET phase fails against original four-phase CHECK',async()=>{
 await assert.rejects(db.exec(`update matches set phase='RESET' where id='${a}'`),e=>e.code==='23514');
});
await db.exec(readFileSync('../supabase_v021_match_finish.sql','utf8'));
const migration=readFileSync('../supabase_v036_session_reset.sql','utf8');
await test('migration applies twice without destroying existing data',async()=>{await db.exec(migration);await db.exec(migration);assert.equal(await scalar('select count(*) from matches'),2);});
await db.exec(`set role anon`);
async function join(id,room,epoch){await db.exec(`insert into players(id,match_id,reset_epoch,player_name) values('${id}','${room}',${epoch},'TEST');insert into player_states(player_id,match_id,reset_epoch) values('${id}','${room}',${epoch});`);}
await join(p,a,0);await join(q,b,0);
await db.exec(`insert into attacks values('20000000-0000-0000-0000-000000000001','${a}','${p}','${p}',0);`);
await test('anon RPC atomically clears all three tables and resets match',async()=>{
 await db.exec(`update matches set phase='BATTLE',level=8,start_at=now() where id='${a}';select br_reset_room('${a}',0);`);
 const row=(await db.query(`select * from matches where id='${a}'`)).rows[0];
 assert.equal(row.phase,'LOBBY');assert.equal(row.start_at,null);assert.equal(row.level,1);assert.equal(row.reset_epoch,1);
 for(const table of ['players','player_states','attacks'])assert.equal(await scalar(`select count(*) from ${table} where match_id='${a}'`),0);
});
await test('different room membership survives',async()=>assert.equal(await scalar(`select count(*) from players where match_id='${b}'`),1));
await test('old and v0.35 default-epoch player writes are rejected',async()=>{
 await assert.rejects(join(p,a,0),/BR_STALE_SESSION/);
 await assert.rejects(db.exec(`insert into players(id,match_id) values('${p}','${a}')`),/BR_STALE_SESSION/);
});
await join(p,a,1);
await test('old board/attack upserts are rejected after new READY',async()=>{
 await assert.rejects(db.exec(`insert into player_states(player_id,match_id,reset_epoch) values('${p}','${a}',0) on conflict(player_id) do update set board='[]'`),/BR_STALE_SESSION/);
 await assert.rejects(db.exec(`insert into attacks values('20000000-0000-0000-0000-000000000001','${a}','${p}','${p}',0)`),/BR_STALE_SESSION/);
});
await test('duplicate reset request does not delete new participants',async()=>{await db.exec(`select br_reset_room('${a}',0)`);assert.equal(await scalar(`select count(*) from players where match_id='${a}'`),1);});
await test('NEXT BATTLE keeps session valid',async()=>{await db.exec(`update matches set battle_no=battle_no+1,phase='LOBBY' where id='${a}';update players set score=10 where id='${p}'`);assert.equal(await scalar(`select reset_epoch from matches where id='${a}'`),1);});
await test('RLS deletion failure rolls back phase, generation and deletions',async()=>{
 await db.exec(`reset role;alter table players enable row level security;create policy read_players on players for select using(true);create policy write_players on players for update using(true);set role anon;`);
 await assert.rejects(db.exec(`select br_reset_room('${a}',1)`),/deletion denied/);
 assert.equal(await scalar(`select reset_epoch from matches where id='${a}'`),1);
 assert.equal(await scalar(`select count(*) from player_states where match_id='${a}'`),1);
 await db.exec('reset role;alter table players disable row level security;set role anon;');
});
await test('existing v0.21 KO winner trigger remains functional',async()=>{
 const r='10000000-0000-0000-0000-000000000003';await join(r,a,1);
 await db.exec(`update matches set phase='BATTLE' where id='${a}';update players set alive=false where id='${p}'`);
 assert.equal(await scalar(`select phase from matches where id='${a}'`),'RESULT');
 assert.equal(await scalar(`select rank from players where id='${r}'`),1);
});
await test('reset succeeds after RESULT and schema migration can be rerun',async()=>{
 await db.exec(`select br_reset_room('${a}',1);reset role;`);await db.exec(migration);
 assert.equal(await scalar(`select reset_epoch from matches where id='${a}'`),2);
});
console.log(`${tests.length} database tests passed. Local schema fixture; production RLS/schema not accessed.`);
await db.close();
