import {CONFIG} from './config.js';

export const roomCode = CONFIG.ROOM_CODE;
let offset = 0;
export const serverNow = () => Date.now() + offset;
export async function rpc(method, params, accessToken = CONFIG.SUPABASE_PUBLISHABLE_KEY) {
  const started = Date.now();
  const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${method}`, {
    method:'POST', headers:{apikey:CONFIG.SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json'},
    body:JSON.stringify(params), signal:AbortSignal.timeout(12000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  if (Number.isFinite(Number(data.server_ms))) offset = Number(data.server_ms) - (started + Date.now()) / 2;
  return data;
}
export const unpackPlayers = rows => (rows || []).map(([id,player_name,ready,alive,score,rank,max_combo,max_attack]) =>
  ({id,player_name,name:player_name,ready,alive,score,rank,max_combo,max_attack}));

// One immutable packet is retried after a lost response. Never overlap requests.
export class Free50Client {
  constructor({capture,onView,onError,storage=sessionStorage,call=rpc}) {
    Object.assign(this,{capture,onView,onError,storage,call});
    this.key=`br39:${CONFIG.SUPABASE_URL}:${roomCode}`;
    try { this.identity=JSON.parse(storage.getItem(this.key)); } catch {}
    if (!this.identity?.id || !this.identity?.token) {
      this.identity={id:crypto.randomUUID(),token:crypto.randomUUID()+crypto.randomUUID()};
      storage.setItem(this.key,JSON.stringify(this.identity));
    }
    this.outgoing=[];this.acks=new Map();this.seq=0;this.failures=0;this.lastFull=0;
  }
  async join(entry,name) {
    // A duplicated tab must not operate the same participant concurrently.
    if (globalThis.navigator?.locks && !this.hasLock) {
      await new Promise((resolve,reject)=>{
        navigator.locks.request(this.key+this.identity.id,{ifAvailable:true},async lock=>{
          if(!lock){reject(new Error('同じ参加者のタブが既に開いています。元のタブを使ってください。'));return;}
          this.hasLock=true;resolve();
          await new Promise(done=>{this.releaseLock=done;});
        }).catch(reject);
      });
    }
    const view=await this.call('br39_join',{p_room:roomCode,p_entry:entry,p_name:name,
      p_id:this.identity.id,p_token:this.identity.token});
    this.match=view.match;this.seq=view.me?.last_seq||0;
    await this.onView(view,true);
    this.running=true;this.timer=setTimeout(()=>this.pump(),Math.random()*1000);
    return view;
  }
  attack(amount){this.outgoing.push({id:crypto.randomUUID(),amount});}
  ack(id,amount,turns,status='PENDING') {
    if(id && id!=='local')this.acks.set(id,{id,amount,turns,status});
  }
  stop(clear=false){
    this.running=false;clearTimeout(this.timer);this.releaseLock?.();this.hasLock=false;
    if(clear)this.storage.removeItem(this.key);
  }
  async pump(){
    if(!this.running||this.busy)return;
    this.busy=true;
    try {
      if(!this.pending){
        const full=Date.now()-this.lastFull>=3000 || this.match.phase==='RESULT';
        this.pending={...this.capture(),reset_epoch:this.match.reset_epoch,battle_no:this.match.battle_no,
          seq:++this.seq,full,outgoing:this.outgoing.slice(0,8),acks:[...this.acks.values()].slice(0,64)};
      }
      const packet=this.pending;
      const view=await this.call('br39_tick',{p_id:this.identity.id,p_token:this.identity.token,p_data:packet});
      const changed=view.match.reset_epoch!==this.match.reset_epoch||view.match.battle_no!==this.match.battle_no;
      this.match=view.match;
      if(changed){this.outgoing=[];this.acks.clear();this.seq=view.me?.last_seq||0;this.lastFull=0;}
      else {
        this.outgoing=this.outgoing.filter(a=>!packet.outgoing.some(b=>b.id===a.id));
        for(const a of packet.acks)if(this.acks.get(a.id)===a)this.acks.delete(a.id);
        if(packet.full)this.lastFull=Date.now();
      }
      this.pending=null;this.failures=0;
      await this.onView(view,false);
    } catch(error) {
      this.failures++;
      if(error.message.includes('SESSION_GONE'))this.stop(true);
      this.onError(error,this.failures);
    } finally {
      this.busy=false;
      if(this.running){
        const active=['COUNTDOWN','BATTLE'].includes(this.match.phase);
        const delay=this.failures?Math.min(4000,1000*2**Math.min(2,this.failures-1)):(active?1000:3000);
        this.timer=setTimeout(()=>this.pump(),delay*(0.95+Math.random()*0.1));
      }
    }
  }
}
