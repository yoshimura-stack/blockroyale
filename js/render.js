import {COLORS} from "./tetris.js";
import {CONFIG} from "./config.js";

export class Renderer{
  constructor(canvas,nextCanvas){
    this.canvas=canvas;this.ctx=canvas.getContext("2d");
    this.next=nextCanvas;this.nctx=nextCanvas.getContext("2d");
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
