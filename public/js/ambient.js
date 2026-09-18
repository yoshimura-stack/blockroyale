const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.createElement("canvas");
canvas.className = "ambient-canvas";
canvas.setAttribute("aria-hidden","true");
document.body.prepend(canvas);

const ctx = canvas.getContext("2d", {alpha:true});
let w=0,h=0,dpr=1;
let stars=[];
let pulses=[];
let intensity=0.46;
let targetIntensity=0.46;
let hueShift=0;
let last=performance.now();

function rand(a,b){return a+Math.random()*(b-a)}

function rebuild(){
  dpr=Math.min(devicePixelRatio||1,1.5);
  w=innerWidth; h=innerHeight;
  canvas.width=Math.max(1,Math.floor(w*dpr));
  canvas.height=Math.max(1,Math.floor(h*dpr));
  canvas.style.width=w+"px";
  canvas.style.height=h+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const count=Math.max(36,Math.min(100,Math.floor((w*h)/18000)));
  stars=Array.from({length:count},()=>({
    x:Math.random()*w,
    y:Math.random()*h,
    z:rand(.25,1),
    r:rand(.35,1.45),
    drift:rand(.4,1.5)
  }));
}
addEventListener("resize",rebuild,{passive:true});
rebuild();

function pulse(kind="clear",power=1){
  pulses.push({kind,power:Math.max(.4,Math.min(6,power)),age:0});
  targetIntensity=Math.min(.95,.32+power*.08);
  hueShift += kind==="incoming" ? -9 : kind==="attack" ? 7 : kind==="winner" ? 18 : 3;
}
window.BR_VISUAL_PULSE = pulse;
window.addEventListener("br:visual",e=>pulse(e.detail?.kind,e.detail?.power||1));

function drawNebula(t){
  const cx=w*.52 + Math.sin(t*.00012)*w*.08;
  const cy=h*.40 + Math.cos(t*.0001)*h*.05;

  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.max(w,h)*.62);
  const warm=Math.max(0,Math.min(1,intensity-.2));
  g.addColorStop(0,`rgba(${38+warm*48},${55+warm*24},${92+warm*20},${.12+intensity*.1})`);
  g.addColorStop(.38,`rgba(34,22,72,${.08+intensity*.07})`);
  g.addColorStop(.72,`rgba(7,23,46,${.07+intensity*.05})`);
  g.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=g;
  ctx.fillRect(0,0,w,h);

  const g2=ctx.createRadialGradient(w*.14,h*.28,0,w*.14,h*.28,Math.max(w,h)*.42);
  g2.addColorStop(0,`rgba(38,130,164,${.055+intensity*.035})`);
  g2.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=g2;
  ctx.fillRect(0,0,w,h);
}

function drawGrid(t){
  const horizon=h*.56;
  ctx.save();
  ctx.globalAlpha=.14+intensity*.065;
  ctx.strokeStyle="rgba(108,196,255,.9)";
  ctx.lineWidth=.7;

  for(let i=0;i<18;i++){
    const p=i/17;
    const y=horizon + (h-horizon)*Math.pow(p,2.15);
    ctx.beginPath();
    ctx.moveTo(0,y);
    ctx.lineTo(w,y);
    ctx.stroke();
  }
  const vanX=w*.5 + Math.sin(t*.00008)*w*.018;
  for(let i=-14;i<=14;i++){
    const x=vanX+i*w*.065;
    ctx.beginPath();
    ctx.moveTo(vanX,horizon);
    ctx.lineTo(x,h);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStars(dt){
  ctx.save();
  for(const s of stars){
    s.y += dt*.006*s.drift*s.z;
    s.x += Math.sin((s.y+s.x)*.004)*dt*.00045*s.z;
    if(s.y>h+4){s.y=-4;s.x=Math.random()*w}
    const a=.27+.60*s.z;
    ctx.fillStyle=`rgba(190,225,255,${a})`;
    ctx.beginPath();
    ctx.arc(s.x,s.y,s.r*s.z,0,Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOrbits(t){
  ctx.save();
  ctx.translate(w*.5,h*.43);
  ctx.rotate(Math.sin(t*.00007)*.08);
  ctx.globalAlpha=.12+intensity*.06;
  ctx.strokeStyle="rgba(230,198,108,.9)";
  ctx.lineWidth=1;
  for(let i=0;i<3;i++){
    ctx.beginPath();
    ctx.ellipse(0,0,w*(.25+i*.055),h*(.08+i*.022),-.28+i*.16,0,Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPulses(dt){
  pulses=pulses.filter(p=>{
    p.age += dt;
    const life=900 + p.power*80;
    if(p.age>life)return false;
    const q=p.age/life;
    const radius=(Math.min(w,h)*(.10+p.power*.018)) + q*Math.min(w,h)*.48;
    const alpha=(1-q)*(.14+p.power*.018);
    ctx.save();
    ctx.lineWidth=Math.max(1,3*(1-q));
    ctx.strokeStyle=p.kind==="incoming"
      ? `rgba(255,76,108,${alpha})`
      : p.kind==="winner"
      ? `rgba(244,204,105,${alpha*1.3})`
      : `rgba(100,210,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(w*.5,h*.47,radius,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
    return true;
  });
}

function frame(now){
  const dt=Math.min(40,now-last); last=now;
  intensity += (targetIntensity-intensity)*.035;
  targetIntensity += (.46-targetIntensity)*.012;

  ctx.clearRect(0,0,w,h);
  drawNebula(now);
  drawStars(dt);
  drawOrbits(now);
  drawGrid(now);
  drawPulses(dt);

  if(!reduceMotion) requestAnimationFrame(frame);
}
if(reduceMotion){
  frame(performance.now());
}else{
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange",()=>{
  last=performance.now();
});
