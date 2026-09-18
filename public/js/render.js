import {COLORS} from "./tetris.js";
import {CONFIG} from "./config.js";

export class Renderer{
  constructor(canvas,nextCanvas){
    this.canvas=canvas;this.ctx=canvas.getContext("2d");
    this.next=nextCanvas;this.nctx=nextCanvas.getContext("2d");
    this.clearFx=[];
  }
  draw(game){
    const c=this.ctx,w=this.canvas.width,h=this.canvas.height;
    c.clearRect(0,0,w,h);
    const cw=w/CONFIG.BOARD_W,ch=h/CONFIG.BOARD_H;
    c.fillStyle="#05070a";c.fillRect(0,0,w,h);
    c.strokeStyle="rgba(255,255,255,.045)";c.lineWidth=1;
    for(let x=0;x<=CONFIG.BOARD_W;x++){c.beginPath();c.moveTo(x*cw,0);c.lineTo(x*cw,h);c.stroke()}
    for(let y=0;y<=CONFIG.BOARD_H;y++){c.beginPath();c.moveTo(0,y*ch);c.lineTo(w,y*ch);c.stroke()}
    game.board.forEach((row,y)=>row.forEach((t,x)=>t&&this.block(c,x*cw,y*ch,cw,ch,COLORS[t])));
    if(game.current){
      // ghost piece
      let gy=game.current.y;
      while(!game.collides(game.current.x,gy+1,game.current.matrix))gy++;
      this.piece(c,game.current,gy,cw,ch,true);
      this.piece(c,game.current,game.current.y,cw,ch,false);
    }
    this.drawClearFx(c,w,h,cw,ch);
  }
  triggerLineClear(rows=[],power=1){
    const now=performance.now();
    const safeRows=Array.isArray(rows)&&rows.length ? rows.slice() : [CONFIG.BOARD_H-1];
    this.clearFx.push({rows:safeRows,power:Math.max(1,Math.min(4,power||1)),start:now,seed:Math.random()*1000});
  }
  drawClearFx(c,w,h,cw,ch){
    if(!this.clearFx.length)return;
    const now=performance.now();
    this.clearFx=this.clearFx.filter(fx=>{
      const age=now-fx.start;
      const life=520+fx.power*70;
      if(age>=life)return false;
      const q=age/life;
      const burst=Math.sin(Math.min(1,q*2.15)*Math.PI);
      c.save();
      c.globalCompositeOperation="screen";
      for(const row of fx.rows){
        const y=row*ch;
        // instant white-gold core
        const coreAlpha=Math.max(0,1-q*4.6);
        if(coreAlpha>0){
          const core=c.createLinearGradient(0,y,w,y);
          core.addColorStop(0,`rgba(70,200,255,${coreAlpha*.25})`);
          core.addColorStop(.18,`rgba(255,255,255,${coreAlpha*.92})`);
          core.addColorStop(.5,`rgba(255,236,164,${coreAlpha})`);
          core.addColorStop(.82,`rgba(255,255,255,${coreAlpha*.92})`);
          core.addColorStop(1,`rgba(70,200,255,${coreAlpha*.25})`);
          c.fillStyle=core;c.fillRect(0,y,w,ch);
        }
        // fast horizontal scan / slash
        const sweepQ=Math.min(1,Math.max(0,(q-.04)/.42));
        if(sweepQ<1){
          const sx=(-.22+sweepQ*1.44)*w;
          const grad=c.createLinearGradient(sx-w*.13,y,sx+w*.13,y);
          grad.addColorStop(0,"rgba(255,255,255,0)");
          grad.addColorStop(.35,`rgba(86,218,255,${.22*(1-q)})`);
          grad.addColorStop(.5,`rgba(255,255,255,${.98*(1-q*.55)})`);
          grad.addColorStop(.64,`rgba(255,207,84,${.7*(1-q)})`);
          grad.addColorStop(1,"rgba(255,255,255,0)");
          c.fillStyle=grad;c.fillRect(0,y-ch*.12,w,ch*1.24);
        }
        // lingering cyan/gold rails
        const railA=(1-q)*.72;
        c.fillStyle=`rgba(92,215,255,${railA})`;c.fillRect(0,y+ch*.10,w,Math.max(1,ch*.055));
        c.fillStyle=`rgba(255,198,70,${railA*.72})`;c.fillRect(0,y+ch*.84,w,Math.max(1,ch*.045));
        // sparks moving away from the centre
        const sparks=12+fx.power*6;
        for(let i=0;i<sparks;i++){
          const side=i%2?-1:1;
          const n=(i+1)/(sparks+1);
          const speed=(.18+n*.48)*w;
          const px=w*.5 + side*(q*speed);
          const py=y+ch*(.18+((i*37+fx.seed)%64)/100);
          const r=Math.max(.7,(1-q)*(1.2+fx.power*.55));
          c.fillStyle=i%3===0?`rgba(255,205,88,${(1-q)*.95})`:`rgba(132,229,255,${(1-q)*.9})`;
          c.beginPath();c.arc(px,py,r,0,Math.PI*2);c.fill();
        }
      }
      // board-wide bloom, stronger for multi-line clears
      const bloomA=burst*(.035+fx.power*.022)*(1-q*.55);
      const bloom=c.createRadialGradient(w*.5,h*.52,0,w*.5,h*.52,w*.72);
      bloom.addColorStop(0,`rgba(255,244,190,${bloomA*1.8})`);
      bloom.addColorStop(.36,`rgba(75,203,255,${bloomA})`);
      bloom.addColorStop(1,"rgba(0,0,0,0)");
      c.fillStyle=bloom;c.fillRect(0,0,w,h);
      c.restore();
      return true;
    });
  }

  block(c,x,y,w,h,color,ghost=false){
    c.save();c.globalAlpha=ghost?.18:1;
    c.fillStyle=color;c.fillRect(x+2,y+2,w-4,h-4);
    const g=c.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,"rgba(255,255,255,.42)");g.addColorStop(.45,"rgba(255,255,255,.05)");g.addColorStop(1,"rgba(0,0,0,.35)");
    c.fillStyle=g;c.fillRect(x+2,y+2,w-4,h-4);
    c.strokeStyle="rgba(255,255,255,.28)";c.strokeRect(x+2.5,y+2.5,w-5,h-5);c.restore();
  }
  piece(c,p,y,cw,ch,ghost){
    p.matrix.forEach((row,r)=>row.forEach((v,col)=>{if(v && y+r>=0)this.block(c,(p.x+col)*cw,(y+r)*ch,cw,ch,COLORS[p.type],ghost)}));
  }
  drawNext(type){
    const c=this.nctx,w=this.next.width,h=this.next.height;c.clearRect(0,0,w,h);c.fillStyle="#080b10";c.fillRect(0,0,w,h);
    if(!type)return;
    // Mini shapes duplicated intentionally to keep renderer independent.
    const S={I:[[1,1,1,1]],O:[[1,1],[1,1]],T:[[0,1,0],[1,1,1]],S:[[0,1,1],[1,1,0]],Z:[[1,1,0],[0,1,1]],J:[[1,0,0],[1,1,1]],L:[[0,0,1],[1,1,1]]}[type];
    const cell=28, ox=(w-S[0].length*cell)/2, oy=(h-S.length*cell)/2;
    S.forEach((row,r)=>row.forEach((v,col)=>v&&this.block(c,ox+col*cell,oy+r*cell,cell,cell,COLORS[type])));
  }
}
