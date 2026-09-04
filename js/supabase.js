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
