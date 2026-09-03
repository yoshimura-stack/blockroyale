import {CONFIG} from "./config.js";
const channel = ("BroadcastChannel" in window) ? new BroadcastChannel(CONFIG.CHANNEL) : null;
export function emit(type, payload={}) {
  const msg = {type,payload,at:Date.now()};
  channel?.postMessage(msg);
  window.dispatchEvent(new CustomEvent("br-local",{detail:msg}));
}
export function onMessage(fn){
  channel && (channel.onmessage = e => fn(e.data));
  window.addEventListener("br-local", e => fn(e.detail));
}
