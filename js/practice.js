import {CONFIG} from "./config.js";
import {Tetris} from "./tetris.js";
import {Renderer} from "./render.js";

const $ = s => document.querySelector(s);

const board = $("#practiceBoard");
const next = $("#practiceNext");
const renderer = new Renderer(board, next);

let game = null;
let running = false;
let softDropHeld = false;
let lastSoftDropAt = 0;
let startAt = 0;
let countdownTimer = null;

const BEST_KEY = "block_royale_practice_best_v1";

function getBest(){
  return Number(localStorage.getItem(BEST_KEY) || 0);
}
function setBest(score){
  const best = Math.max(getBest(), Number(score)||0);
  localStorage.setItem(BEST_KEY, String(best));
  $("#practiceBest").textContent = best.toLocaleString();
  return best;
}
function setStatus(text){
  $("#practiceStatus").textContent = text;
}
function updateStats(stats){
  $("#practiceScore").textContent = (stats.score||0).toLocaleString();
  $("#practiceLevel").textContent = stats.level||1;
  $("#practiceLines").textContent = stats.lines||0;
  $("#practiceCombo").textContent = stats.maxCombo||0;
  $("#practiceBest").textContent = getBest().toLocaleString();
}
function makeGame(){
  game = new Tetris({
    clock:()=>Date.now(),
    levelAt:ts=>{
      if(!startAt)return 1;
      return 1 + Math.floor(Math.max(0, ts-startAt)/CONFIG.LEVEL_INTERVAL_MS);
    },
    onNext:type=>renderer.drawNext(type),
    onScore:()=>updateStats(game.stats()),
    onClear:()=>updateStats(game.stats()),
    onStats:stats=>updateStats(stats),
    onKO:({score})=>{
      running=false;
      softDropHeld=false;
      setStatus("K.O.");
      const best=setBest(score);
      $("#practiceResultScore").textContent=`SCORE ${Number(score||0).toLocaleString()}`;
      $("#practiceResultBest").textContent=`BEST ${best.toLocaleString()}`;
      $("#practiceKo").classList.remove("hidden");
    }
  });
  updateStats(game.stats());
  renderer.draw(game);
}
function resetPractice(){
  running=false;
  softDropHeld=false;
  lastSoftDropAt=0;
  clearInterval(countdownTimer);
  countdownTimer=null;

  if(game){
    game.started=false;
    game.alive=false;
  }

  $("#practiceKo").classList.add("hidden");
  $("#practiceCountdown").classList.add("hidden");
  $("#practiceOverlay").classList.remove("hidden");

  setStatus("READY");
  startAt=0;
  makeGame();
}
function startPractice(){
  if(running)return;

  softDropHeld=false;
  lastSoftDropAt=0;
  clearInterval(countdownTimer);
  countdownTimer=null;

  if(game){
    game.started=false;
  }

  $("#practiceOverlay").classList.add("hidden");
  $("#practiceKo").classList.add("hidden");

  makeGame();
  setStatus("COUNTDOWN");

  const countdown=$("#practiceCountdown");
  countdown.classList.remove("hidden");
  let n=3;
  countdown.textContent=String(n);

  countdownTimer=setInterval(()=>{
    n--;
    if(n>0){
      countdown.textContent=String(n);
      return;
    }
    if(n===0){
      countdown.textContent="START";
      startAt=Date.now();
      game.start(startAt);
      running=true;
      setStatus("PLAY");
      return;
    }
    clearInterval(countdownTimer);
    countdown.classList.add("hidden");
  },700);
}
function loop(){
  const now=Date.now();
  if(game && running && game.alive){
    const elapsed=Math.max(0,now-startAt);
    const lv=1+Math.floor(elapsed/CONFIG.LEVEL_INTERVAL_MS);
    if(lv!==game.level)game.setLevel(lv);

    if(softDropHeld && now-lastSoftDropAt>=CONFIG.SOFT_DROP_MS){
      game.softDrop();
      lastSoftDropAt=now;
    }
    game.tick(now);
    renderer.draw(game);
    updateStats(game.stats());
  }else if(game){
    renderer.draw(game);
  }
  requestAnimationFrame(loop);
}
function keydown(e){
  const key=e.key.toLowerCase();
  const handled=["a","d","s","arrowleft","arrowright","arrowdown"].includes(key);
  if(handled)e.preventDefault();
  if(!running||!game?.alive)return;

  if(key==="a")game.move(-1);
  else if(key==="d")game.move(1);
  else if(key==="arrowleft")game.rotate(-1);
  else if(key==="arrowright")game.rotate(1);
  else if(key==="s"||key==="arrowdown"){
    softDropHeld=true;
    if(Date.now()-lastSoftDropAt>=CONFIG.SOFT_DROP_MS){
      game.softDrop();
      lastSoftDropAt=Date.now();
    }
  }
  renderer.draw(game);
}
function keyup(e){
  const key=e.key.toLowerCase();
  if(key==="s"||key==="arrowdown")softDropHeld=false;
}

document.addEventListener("keydown",keydown,{passive:false});
document.addEventListener("keyup",keyup);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden"){
    softDropHeld=false;
  }else if(running&&game?.alive){
    game.tick(Date.now());
    renderer.draw(game);
  }
});
window.addEventListener("blur",()=>{softDropHeld=false;});

$("#startPracticeBtn").addEventListener("click",startPractice);
$("#retryPracticeBtn").addEventListener("click",startPractice);
$("#restartBtn").addEventListener("click",resetPractice);

$("#practiceBest").textContent=getBest().toLocaleString();
makeGame();
loop();
