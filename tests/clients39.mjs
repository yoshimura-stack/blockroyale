import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=new URL('../js/',import.meta.url);
const clean=file=>readFileSync(new URL(file,base),'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
const results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS',name);}
const match={id:'TEST',phase:'LOBBY',battle_no:1,reset_epoch:0,start_at:null,winner_id:null};
const baseView=()=>({match:{...match},players:[],boards:{},attacks:[],alive:2,me:{alive:true,last_seq:0}});
function client(file='player.js'){
 const nodes=new Map(),timers=[],calls=[];
 const element=()=>({textContent:'',innerHTML:'',value:'',disabled:false,style:{},width:100,height:200,
  classList:{add(){},remove(){},contains(){return false;}},append(){},replaceChildren(){},getContext(){return {fillRect(){}}}});
 const querySelector=s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);};
 const context=vm.createContext({console,URL,Date,Map,Set,Math,Number,String,Promise,JSON,
  document:{querySelector,createElement:element,addEventListener(){},visibilityState:'visible'},
  CustomEvent:class{},window:{dispatchEvent(){},addEventListener(){},location:{href:'https://local.test/',replace(){}}},
  sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},crypto:{randomUUID},
  CONFIG:{SUPABASE_URL:'https://local.test',OPENING_ATTACK_LOCK_MS:15000,LEVEL_INTERVAL_MS:60000},
  roomCode:'TEST',serverNow:()=>Date.now(),
  unpackPlayers:rows=>(rows||[]).map(([id,player_name,ready,alive,score,rank])=>({id,name:player_name,player_name,ready,alive,score,rank})),
  Free50Client:class{constructor(opts){Object.assign(this,opts);this.identity={id:'me'};}stop(){this.stopped=true;}attack(){}ack(){}},
  createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'local'}}}),signOut:async()=>{},signInWithPassword:async()=>({})}}),
  rpc:async(method,params)=>{calls.push({method,params});return baseView();},
  Tetris:class{constructor(){this.alive=true;this.started=false;this.score=0;this.level=1;this.maxCombo=0;this.maxAttack=0;this.queue=[];this.incoming=[];}
    snapshot(){return '.'.repeat(200);}start(){this.started=true;}receiveAttack(n,id,turns){this.incoming.push({amount:n,attackId:id,turns});}},
  Renderer:class{draw(){}},requestAnimationFrame(){},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},confirm(){return true;}
 });
 vm.runInContext(clean(file),context);return {context,nodes,timers,calls,run:code=>vm.runInContext(code,context)};
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve();}
await test('HOST initial load/F5 only calls VIEW; destructive commands require explicit action',async()=>{
 const c=client('host39.js');await settle();assert.equal(c.calls.length,1);assert.equal(c.calls[0].params.p_action,'VIEW');
});
await test('Missed countdown is recovered from server BATTLE state',async()=>{
 const c=client();const v=baseView();v.match.phase='BATTLE';v.match.start_at=new Date(Date.now()-2000).toISOString();
 c.context.v=v;c.run('joined=true;name="ME"');await c.run('applyView(v,false)');
 assert.equal(c.run('game.started'),true);assert.equal(c.run('currentPhase'),'BATTLE');
});
await test('Refreshing an active PLAYER forfeits, never spawns a fresh board',async()=>{
 const c=client();const v=baseView();v.match.phase='BATTLE';v.match.start_at=new Date(Date.now()-2000).toISOString();c.context.v=v;
 c.run('joined=true');await c.run('applyView(v,true)');assert.equal(c.run('game.started'),false);assert.equal(c.run('capturePacket().state.alive'),false);
});
await test('Loser with higher score sees GAME OVER; only winner_id gets WINNER',async()=>{
 for(const winner of ['other','me',null]){
  const c=client();const v=baseView();v.match.phase='RESULT';v.match.winner_id=winner;
  v.players=[['me','ME',true,winner==='me',1864,winner==='me'?1:2],['other','OTHER',true,winner==='other',1083,winner==='other'?1:2]];
  c.context.v=v;c.run('joined=true');await c.run('applyView(v,false)');await settle();
  assert.equal(c.nodes.get('#resultTitle').textContent,winner==='me'?'🏆 WINNER':'GAME OVER');
  assert.equal(c.nodes.get('#resultScore').textContent,'SCORE 1,864');
  if(winner===null)assert.match(c.nodes.get('#resultWinner').textContent,/優勝者なし/);
 }
});
await test('Incoming attacks deduplicate; RESET stops client; NEXT clears board',async()=>{
 const c=client();c.run('joined=true;currentPhase="BATTLE";sessionEpoch=0;seenBattleNo=1;');
 c.context.a={id:'a',attacker_id:'other',target_id:'me',status:'PENDING',reset_epoch:0,battle_no:1,amount:2,turns_remaining:2};
 c.run('processIncomingAttackRow(a);processIncomingAttackRow(a)');assert.equal(c.run('game.incoming.length'),1);
 let v=baseView();v.match.battle_no=2;c.context.v=v;c.run('game.score=100');await c.run('applyView(v,false)');assert.equal(c.run('game.score'),0);
 v.match.reset_epoch=1;await c.run('applyView(v,false)');assert.equal(c.run('client.stopped'),true);assert.equal(c.run('joined'),false);
});
await test('Garbage landing remains compact and translucent (v0.38 CSS preserved)',async()=>{
 const c=client();c.run('showCombatAlert("landing","Rival",3,0)');assert.equal(c.nodes.get('#combatAlertMain').textContent,'邪魔ブロック 3列 投下！');
 assert.equal(c.timers.at(-1).ms,950);
 const css=readFileSync(new URL('../css/app.css',base),'utf8');assert(css.includes('.combat-alert.garbage-landing'));assert(!clean('player.js').includes('classList.add("landing")'));
});
await test('Transport retries identical sequence/attack IDs and preserves newer ACK changes',async()=>{
 const timers=[];const ctx=vm.createContext({console,Date,Math,Map,Set,JSON,Promise,crypto:{randomUUID},CONFIG:{SUPABASE_URL:'local',ROOM_CODE:'T'},
  setTimeout(fn,ms){timers.push({fn,ms});return 1;},clearTimeout(){},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}}});
 vm.runInContext(clean('free50.js'),ctx);
 const calls=[];let fail=true;ctx.call=async(method,args)=>{calls.push(structuredClone(args));if(fail){fail=false;throw Error('response lost');}return {...baseView(),seq:args.p_data.seq};};
 vm.runInContext(`var t=new Free50Client({capture:()=>({state:{alive:true}}),onView:async()=>{},onError:()=>{},call});t.match=${JSON.stringify(match)};t.running=true;t.attack(3);t.ack('incoming',2,1);`,ctx);
 await vm.runInContext('t.pump()',ctx);vm.runInContext("t.ack('incoming',0,0,'LANDED')",ctx);await vm.runInContext('t.pump()',ctx);
 assert.deepEqual(calls[0],calls[1]);assert.equal(vm.runInContext('t.outgoing.length',ctx),0);assert.equal(vm.runInContext("t.acks.get('incoming').status",ctx),'LANDED');
 assert(timers.every(t=>t.ms>=950));
});
await test('Transport refuses concurrent pump; no game callback causes database fanout',async()=>{
 const source=clean('player.js');assert(!source.includes('supabase.from'));assert(!source.includes('.channel('));assert(!source.includes('setInterval('));
 const ctx=vm.createContext({console,Date,Math,Map,Set,JSON,Promise,crypto:{randomUUID},CONFIG:{SUPABASE_URL:'local',ROOM_CODE:'T'},setTimeout(){},clearTimeout(){},sessionStorage:{getItem(){return null;},setItem(){}}});
 vm.runInContext(clean('free50.js'),ctx);let resolve,calls=0;ctx.call=()=>{calls++;return new Promise(r=>{resolve=r;});};
 vm.runInContext(`var t=new Free50Client({capture:()=>({}),onView:async()=>{},onError:()=>{},call});t.match=${JSON.stringify(match)};t.running=true;`,ctx);
 const pending=vm.runInContext('t.pump()',ctx);await vm.runInContext('t.pump()',ctx);assert.equal(calls,1);resolve(baseView());await pending;
});
await test('Hidden-tab heartbeat advances gravity; NEXT resets visible statistics',async()=>{
 const c=client();c.run('game.started=true;game.tick=()=>{game.score+=1;};matchStartAt=Date.now();capturePacket();');
 assert.equal(c.run('game.score'),1);
 c.nodes.get('#score').textContent='500';c.run('prepareNextBattle({battle_no:2})');
 assert.equal(c.nodes.get('#score').textContent,'0');assert.equal(c.nodes.get('#level').textContent,'1');
});
writeFileSync(new URL('./clients39-results.json',import.meta.url),JSON.stringify({passed:results.length,results},null,2));
