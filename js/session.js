import {supabase} from './supabase.js';

export function requireSessionSchema(room){
  if(!Number.isInteger(room?.reset_epoch)){
    throw new Error('先に supabase_v036_session_reset.sql をSupabase SQL Editorで実行してください。');
  }
  return room;
}

export async function resetRoom(room){
  requireSessionSchema(room);
  // Retry only concurrency failures. Keep the expected epoch unchanged.
  for(let attempt=0;attempt<3;attempt++){
    const {data,error}=await supabase.rpc('br_reset_room',{
      p_match_id:room.id,p_expected_epoch:room.reset_epoch
    });
    if(!error)return requireSessionSchema(Array.isArray(data)?data[0]:data);
    if(!['40P01','40001'].includes(error.code)||attempt===2)throw error;
  }
}

export function resetError(error){
  return `リセットを完了できませんでした。\n${error?.code||''} ${error?.message||error}\n${error?.details||''}\n追加SQLの適用と、matchesのUPDATE・3テーブルのDELETE権限を確認してください。`;
}
