import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
function client(file,{reload=false,roomOverride={},rpcError=null}={}){
 const room={id:'room',reset_epoch:0,battle_no:1,phase:'LOBBY',...roomOverride};
 const nodes=new Map(),timers=[],intervals=[],events=[],calls=[],alerts=[];
 const element=()=>({textContent:'',innerHTML:'',value:'',disabled:false,style:{},width:100,height:200,
  classList:{add(){},remove(){},contains(){return false;}},getContext(){return {fillRect(){},clearRect(){}}}});
 const querySelector=key=>{if(!nodes.has(key))nodes.set(key,element());return nodes.get(key);};
 const query=table=>{
  const filters=[];let action='select',payload;
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},in(){return q;},neq(){return q;},order(){return q;},single(){return q;},maybeSingle(){return q;},
   update(p){action='update';payload=p;return q;},upsert(p){action='upsert';payload=p;return q;},insert(p){action='insert';payload=p;return q;},delete(){action='delete';return q;},
   then(resolve,reject){calls.push({table,action,payload,filters});return Promise.resolve({data:table==='matches'?{...room}:[],error:null,count:0}).then(resolve,reject);}};
  return q;
 };
 const supabase={from:query,channel(){const ch={on(type,filter,fn){events.push({type,filter,fn});return ch;},subscribe(){return ch;}};return ch;},
  async rpc(name,args){calls.push({rpc:name,args});if(rpcError)return {error:rpcError};room.reset_epoch++;room.phase='LOBBY';return {data:{...room}};}};
 let replaced=0;
 const context=vm.createContext({console,URL,Date,Map,Set,Math,Number,String,Promise,
  document:{querySelector,addEventListener(){},visibilityState:'visible'},
  window:{addEventListener(){},location:{href:'https://example.test/player',replace(){replaced++;}}},
  sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},crypto:{randomUUID(){return 'player-id';}},
  CONFIG:{OPENING_ATTACK_LOCK_MS:15000,SNAPSHOT_INTERVAL_MS:500},supabase,
  performance:{getEntriesByType(){return [{type:reload?'reload':'navigate'}];}},
  getRoom:async()=>({...room}),syncServerClock:async()=>{},serverNow:()=>Date.now(),
  compactBoardToJson:()=>[],jsonBoardToCompact:()=>'',
  Tetris:class {constructor(){this.alive=true;this.started=false;this.score=0;this.level=1;this.queue=[];this.incoming=[];}snapshot(){return '';}start(){this.started=true;}},
  Renderer:class{draw(){}},requestAnimationFrame(){},setInterval(fn){intervals.push(fn);},
  setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},
  alert(message){alerts.push(message);},confirm(){return true;}
 });
 const clean=path=>readFileSync(path,'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
 vm.runInContext(clean('../js/session.js'),context);
 vm.runInContext(clean('../js/'+file),context);
 return {context,room,nodes,timers,intervals,events,calls,alerts,replaced:()=>replaced,run:code=>vm.runInContext(code,context)};
}
async function settle(){for(let i=0;i<30;i++)await Promise.resolve();}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
await test('HOST F5 invokes atomic reset exactly once and shows empty LOBBY',async()=>{
 const c=client('host.js',{reload:true});await settle();assert.equal(c.calls.filter(x=>x.rpc).length,1);assert.equal(c.nodes.get('#phase').textContent,'LOBBY');assert.equal(c.nodes.get('#readyCount').textContent,0);
});
await test('opening HOST normally does not erase the room',async()=>{
 const c=client('host.js');await settle();assert.equal(c.calls.filter(x=>x.rpc).length,0);
});
await test('EMERGENCY RESET uses same RPC and re-enables controls',async()=>{
 const c=client('host.js');await settle();await c.nodes.get('#resetBtn').onclick();assert.equal(c.calls.filter(x=>x.rpc).length,1);assert.equal(c.nodes.get('#resetBtn').disabled,false);
});
await test('RESET permission failure surfaces original code and preserves generation',async()=>{
 const c=client('host.js',{rpcError:{code:'42501',message:'permission denied'}});await settle();await c.nodes.get('#resetBtn').onclick();assert.match(c.alerts[0],/42501/);assert.equal(c.run('match.reset_epoch'),0);
});
await test('missing migration blocks destructive HOST reload',async()=>{
 const c=client('host.js',{reload:true,roomOverride:{reset_epoch:undefined}});await settle();assert.equal(c.calls.filter(x=>x.rpc).length,0);assert.match(c.alerts[0],/supabase_v036/);
});
await test('PLAYER polling catches RESET without Realtime, stops writes and reloads',async()=>{
 const c=client('player.js');c.run('match={id:"room",reset_epoch:0,battle_no:1};sessionEpoch=0;joined=true;name="TEST";seenBattleNo=1;');
 c.room.reset_epoch=1;await c.run('syncMatchTruth()');assert.equal(c.run('joined'),false);assert.equal(c.run('emergencyReloading'),true);
 const count=c.calls.length;await c.run('sendState()');assert.equal(c.calls.length,count);c.timers.at(-1)();assert.equal(c.replaced(),1);
});
await test('NEXT BATTLE preserves PLAYER membership and clears game state',async()=>{
 const c=client('player.js');c.run('match={id:"room",reset_epoch:0,battle_no:1};sessionEpoch=0;joined=true;name="TEST";seenBattleNo=1;game.score=500;currentPhase="RESULT";');
 c.room.battle_no=2;await c.run('syncMatchTruth()');assert.equal(c.run('joined'),true);assert.equal(c.run('game.score'),0);assert.equal(c.run('emergencyReloading'),false);
});
await test('late PLAYER countdown cannot restart after reset',async()=>{
 const c=client('player.js');c.run('joined=true;emergencyReloading=true;startMatch(Date.now()-100);');assert.equal(c.run('game.started'),false);
});
await test('PROJECTOR polling clears stale players and timer without DELETE delivery',async()=>{
 const c=client('projector.js');await settle();c.run('players.set("old",{name:"OLD",alive:true,ready:true});startAt=123;phase="BATTLE";');
 c.room.reset_epoch=1;c.room.start_at=null;await c.run('healProjector()');assert.equal(c.run('players.size'),0);assert.equal(c.run('startAt'),0);assert.equal(c.nodes.get('#heroText').textContent,'LOBBY');
});
await test('stale HOST Realtime event cannot restore prior session player',async()=>{
 const c=client('host.js');await settle();c.run('applyMatch({...match,reset_epoch:1})');
 const handler=c.events.find(e=>e.filter.table==='players').fn;handler({eventType:'INSERT',new:{id:'old',reset_epoch:0}});assert.equal(c.run('players.size'),0);
});
console.log(`${passed} client tests passed (mock DOM/network; no live Realtime connection).`);
