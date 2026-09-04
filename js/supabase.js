import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } }
  }
);

export async function getRoom(){
  const {data,error}=await supabase.from("matches").select("*").eq("room_code",CONFIG.ROOM_CODE).single();
  if(error) throw error;
  return data;
}

export const compactBoardToJson = snapshot => snapshot ? snapshot.split("") : [];
export const jsonBoardToCompact = board => Array.isArray(board) ? board.join("") : (typeof board==="string" ? board : "");


let serverOffsetMs = 0;
let serverClockReady = false;

export function serverNow(){
  return Date.now() + serverOffsetMs;
}

export async function syncServerClock(){
  const t0 = Date.now();
  const {data,error} = await supabase.rpc("server_now_ms");
  const t1 = Date.now();

  if(error){
    console.warn("server clock fallback to client clock", error);
    return {ok:false, offsetMs:serverOffsetMs};
  }

  const serverMs = Number(data);
  if(!Number.isFinite(serverMs)){
    console.warn("server clock returned invalid value", data);
    return {ok:false, offsetMs:serverOffsetMs};
  }

  // Midpoint estimate compensates for request latency.
  serverOffsetMs = serverMs - ((t0 + t1) / 2);
  serverClockReady = true;
  return {ok:true, offsetMs:serverOffsetMs};
}

export function isServerClockReady(){
  return serverClockReady;
}
