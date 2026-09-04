import {CONFIG} from "./config.js";

export const COLORS = {
  I:"#4de6f2", O:"#ffd84d", T:"#b86cff", S:"#62e56f",
  Z:"#ff5e6f", J:"#5b82ff", L:"#ff9b45", G:"#69717f"
};

const SHAPES = {
 I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
 O:[[1,1],[1,1]],
 T:[[0,1,0],[1,1,1],[0,0,0]],
 S:[[0,1,1],[1,1,0],[0,0,0]],
 Z:[[1,1,0],[0,1,1],[0,0,0]],
 J:[[1,0,0],[1,1,1],[0,0,0]],
 L:[[0,0,1],[1,1,1],[0,0,0]]
};
const TYPES = Object.keys(SHAPES);

function clone(m){ return m.map(r=>r.slice()); }
function rotateCW(m){ return m[0].map((_,i)=>m.map(r=>r[i]).reverse()); }
function rotateCCW(m){ return m[0].map((_,i)=>m.map(r=>r[r.length-1-i])); }

export class Tetris {
  constructor(callbacks={}){
    this.cb=callbacks;
    this.reset();
  }
  reset(){
    this.board=Array.from({length:CONFIG.BOARD_H},()=>Array(CONFIG.BOARD_W).fill(null));
    this.bag=[]; this.queue=[];
    this.score=0; this.lines=0; this.combo=0; this.maxCombo=0; this.maxAttack=0;
    this.level=1; this.alive=true; this.started=false; this.current=null;
    this.lockStarted=null; this.lockResets=0; this.lastFall=performance.now();
    this.incoming=[]; this.lastActionAt=0; this.hiddenRows=[]; this.lastChance=false;
    this.fillQueue(); this.spawn();
  }
  fillQueue(){
    while(this.queue.length<7){
      if(!this.bag.length){
        this.bag=TYPES.slice();
        for(let i=this.bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];}
      }
      this.queue.push(this.bag.shift());
    }
  }
  spawn(){
    this.fillQueue();
    const type=this.queue.shift(); this.fillQueue();
    const matrix=clone(SHAPES[type]);
    this.current={type,matrix,x:Math.floor((CONFIG.BOARD_W-matrix[0].length)/2),y:-1};
    this.lockStarted=null; this.lockResets=0;
    if(this.collides(this.current.x,this.current.y,this.current.matrix)){
      this.ko("TOP_OUT");
      return false;
    }
    this.cb.onNext?.(this.queue[0]);
    return true;
  }
  collides(x,y,m){
    for(let r=0;r<m.length;r++)for(let c=0;c<m[r].length;c++){
      if(!m[r][c]) continue;
      const bx=x+c, by=y+r;
      if(bx<0||bx>=CONFIG.BOARD_W||by>=CONFIG.BOARD_H) return true;
      if(by>=0 && this.board[by][bx]) return true;
    }
    return false;
  }
  move(dx){
    if(!this.alive||!this.current) return false;
    if(!this.collides(this.current.x+dx,this.current.y,this.current.matrix)){
      this.current.x+=dx; this.resetLockByMove(); return true;
    }
    return false;
  }
  rotate(dir){
    if(!this.alive||!this.current) return false;
    const next=dir>0?rotateCW(this.current.matrix):rotateCCW(this.current.matrix);
    // Guideline-like wall kick feel: simple ordered kick search for Phase 1.
    const kicks=[[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1]];
    for(const [kx,ky] of kicks){
      if(!this.collides(this.current.x+kx,this.current.y+ky,next)){
        this.current.matrix=next; this.current.x+=kx; this.current.y+=ky;
        this.resetLockByMove(); return true;
      }
    }
    return false;
  }
  resetLockByMove(){
    if(this.isGrounded() && this.lockResets<CONFIG.LOCK_RESET_LIMIT){
      this.lockStarted=performance.now(); this.lockResets++;
    }
  }
  isGrounded(){ return this.current && this.collides(this.current.x,this.current.y+1,this.current.matrix); }
  softDrop(){
    if(!this.alive||!this.current) return false;
    if(!this.collides(this.current.x,this.current.y+1,this.current.matrix)){
      this.current.y++;
      this.score += CONFIG.SOFT_DROP_SCORE_PER_CELL;
      this.cb.onScore?.(this.score);
      this.lockStarted=null;
      return true;
    }
    if(this.lockStarted===null)this.lockStarted=performance.now();
    return false;
  }
  hardDrop(){
    if(!this.alive||!this.current) return;
    let d=0; while(!this.collides(this.current.x,this.current.y+1,this.current.matrix)){this.current.y++;d++;}
    this.score += d*CONFIG.HARD_DROP_SCORE_PER_CELL;
    this.cb.onScore?.(this.score);
    this.lock(true);
  }
  stepDown(){
    if(!this.alive||!this.current) return;
    if(!this.collides(this.current.x,this.current.y+1,this.current.matrix)){
      this.current.y++; this.lockStarted=null;
    }else if(this.lockStarted===null){
      this.lockStarted=performance.now();
    }
  }
  tick(now){
    if(!this.started||!this.alive||!this.current) return;
    const speed=CONFIG.SPEEDS_MS[Math.min(this.level-1,CONFIG.SPEEDS_MS.length-1)];
    if(now-this.lastFall>=speed){this.stepDown();this.lastFall=now;}
    if(this.isGrounded()){
      if(this.lockStarted===null)this.lockStarted=now;
      if(now-this.lockStarted>=CONFIG.LOCK_DELAY_MS)this.lock(false);
    }
  }
  lock(fromHardDrop=false){
    if(!this.current||!this.alive)return;
    let above=false;
    for(let r=0;r<this.current.matrix.length;r++)for(let c=0;c<this.current.matrix[r].length;c++){
      if(!this.current.matrix[r][c])continue;
      const x=this.current.x+c,y=this.current.y+r;
      if(y<0){above=true;continue;}
      this.board[y][x]=this.current.type;
    }
    if(above){this.ko("TOP_OUT");return;}
    const cleared=this.clearLines();
    // A LAST CHANCE piece must bring every hidden overflow cell back inside the board.
    if(this.lastChance){
      this.pullHiddenAfterClears(cleared);
      if(this.hiddenRows.some(row=>row.some(Boolean))){
        this.ko("LAST_CHANCE_FAILED"); return;
      }
      this.lastChance=false;
      this.cb.onSurvive?.();
    }
    this.resolvePlacement(cleared);
  }
  clearLines(){
    let n=0;
    for(let r=this.board.length-1;r>=0;r--){
      if(this.board[r].every(Boolean)){
        this.board.splice(r,1);this.board.unshift(Array(CONFIG.BOARD_W).fill(null));n++;r++;
      }
    }
    return n;
  }
  resolvePlacement(cleared){
    let attack=0;
    if(cleared>0){
      this.combo++;
      this.maxCombo=Math.max(this.maxCombo,this.combo);
      const base=CONFIG.ATTACK_BASE[cleared]??0;
      const comboBonus=this.combo>=2 ? (CONFIG.COMBO_BONUS[this.combo] ?? CONFIG.COMBO_BONUS_CAP) : 0;
      attack=base+comboBonus;
      this.lines+=cleared;
      this.score+=(CONFIG.SCORE_LINES[cleared]??0)*this.level;
      this.cb.onClear?.({cleared,combo:this.combo,attack,score:this.score});
    }else{
      this.combo=0;
    }

    // Any attack power first cancels oldest incoming garbage.
    let surplus=attack;
    if(surplus>0){
      for(const packet of this.incoming){
        if(surplus<=0)break;
        const used=Math.min(packet.amount,surplus);
        packet.amount-=used;surplus-=used;
      }
      this.incoming=this.incoming.filter(p=>p.amount>0);
      if(attack>0 && surplus===0)this.cb.onDefense?.({perfect:this.incoming.length===0});
    }
    if(surplus>0){
      this.maxAttack=Math.max(this.maxAttack,surplus);
      this.cb.onAttack?.(surplus);
    }

    // Attack received during the current falling piece counts that piece as turn 1.
    // Therefore decrement all active packets at placement.
    for(const packet of this.incoming) packet.turns--;
    const due=this.incoming.filter(p=>p.turns<=0);
    this.incoming=this.incoming.filter(p=>p.turns>0);
    for(const packet of due) this.applyGarbage(packet);

    this.cb.onStats?.(this.stats());
    if(this.alive)this.spawn();
  }
  receiveAttack(amount, attackId="local"){
    if(!this.alive||amount<=0)return;
    const hole=Math.floor(Math.random()*CONFIG.BOARD_W);
    this.incoming.push({amount,turns:CONFIG.INCOMING_TURNS,hole,attackId});
    this.cb.onIncoming?.(this.incoming);
  }
  applyGarbage(packet){
    let overflow=false;
    for(let i=0;i<packet.amount;i++){
      const removed=this.board.shift();
      if(removed.some(Boolean)){
        this.hiddenRows.push(removed.slice());
        overflow=true;
      }
      const row=Array(CONFIG.BOARD_W).fill("G"); row[packet.hole]=null;
      this.board.push(row);
    }
    this.cb.onGarbageLand?.({amount:packet.amount,attackId:packet.attackId});
    if(overflow){
      this.lastChance=true;
      this.cb.onLastChance?.();
    }
  }
  pullHiddenAfterClears(cleared){
    // Every cleared visible line creates one row of room. Pull oldest hidden rows back down.
    for(let i=0;i<cleared && this.hiddenRows.length;i++){
      const hidden=this.hiddenRows.pop();
      this.board.unshift(hidden);
      this.board.pop();
    }
  }
  setLevel(lv){this.level=Math.max(1,lv);this.cb.onStats?.(this.stats());}
  start(){this.started=true;this.lastFall=performance.now();}
  ko(reason){
    if(!this.alive)return;
    this.alive=false;this.started=false;this.cb.onKO?.({reason,score:this.score});
  }
  snapshot(){
    const view=this.board.map(row=>row.slice());
    if(this.current){for(let r=0;r<this.current.matrix.length;r++)for(let c=0;c<this.current.matrix[r].length;c++){if(!this.current.matrix[r][c])continue;const x=this.current.x+c,y=this.current.y+r;if(y>=0&&y<CONFIG.BOARD_H&&x>=0&&x<CONFIG.BOARD_W&&!view[y][x])view[y][x]=this.current.type;}}
    return view.flat().map(v=>v||".").join("");
  }
  stats(){return {score:this.score,lines:this.lines,combo:this.combo,maxCombo:this.maxCombo,maxAttack:this.maxAttack,level:this.level,incoming:this.incoming.reduce((s,p)=>s+p.amount,0)}}
}
