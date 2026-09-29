-- v0.39 RC2: explicit creation and authenticated entry rotation, empty LOBBY only.
-- No legacy data or HOST allowlist changes. Entry codes are never stored in source.
begin;
create or replace function public.br39_host(p_room text,p_action text,p_epoch integer default null,p_round integer default null,p_entry text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r br39.rooms; outcome text := 'VIEW';
begin
 if auth.uid() is null or not exists(select 1 from br39.hosts where user_id=auth.uid()) then raise exception 'HOST_ONLY' using errcode='42501'; end if;
 if p_action='CREATE' then
  if p_entry is null or length(p_entry) not between 12 and 160 then raise exception '入室コードは12〜160文字にしてください'; end if;
  insert into br39.rooms(code,entry_hash) values(p_room,encode(sha256(convert_to(p_entry,'UTF8')),'hex')) on conflict(code) do nothing returning * into r;
  if not found then raise exception 'この部屋は既に存在します。入力した入室コードは変更されていません。「入室コードを変更」を使ってください'; end if;
  outcome:='CREATED';
 end if;
 select * into r from br39.rooms where code=p_room for update;
 if not found then
  if p_action='VIEW' then return jsonb_build_object('api_version',2,'host_authorized',true,'room_exists',false,'match',null,'players','[]'::jsonb,'alive',0,'server_ms',floor(extract(epoch from clock_timestamp())*1000)); end if;
  raise exception '部屋が未作成です。先に部屋を作成してください';
 end if;
 if p_action in ('START','NEXT','RESET') then
  if p_epoch is distinct from r.reset_epoch or p_round is distinct from r.battle_no then return br39.view(p_room)||jsonb_build_object('api_version',2,'host_authorized',true,'room_exists',true,'action_result','STALE'); end if;
 end if;
 if p_action='CHANGE_ENTRY_CODE' then
  if p_epoch is distinct from r.reset_epoch or p_round is distinct from r.battle_no then raise exception '部屋の状態が変わりました。表示を更新してからやり直してください'; end if;
  if r.phase<>'LOBBY' or exists(select 1 from br39.players where room=p_room) then raise exception '入室コードの変更はLOBBYかつ参加者0人のときだけ可能です'; end if;
  if p_entry is null or length(p_entry) not between 12 and 160 then raise exception '入室コードは12〜160文字にしてください'; end if;
  update br39.rooms set entry_hash=encode(sha256(convert_to(p_entry,'UTF8')),'hex'),reset_epoch=reset_epoch+1 where code=p_room;
  outcome:='ENTRY_CHANGED';
 elsif p_action='START' then
  if r.phase<>'LOBBY' then raise exception 'LOBBY_ONLY'; end if;
  update br39.players set ready=false where room=p_room and last_seen<clock_timestamp()-interval '10 seconds';
  if exists(select 1 from br39.players where room=p_room and not ready) then raise exception '未接続の参加者がいます。復帰またはRESET後に再入室してください'; end if;
  if (select count(*) from br39.players where room=p_room and ready)<2 then raise exception '2人以上のREADYが必要です'; end if;
  update br39.rooms set phase='COUNTDOWN',start_at=clock_timestamp()+interval '8 seconds',winner_id=null where code=p_room;
 elsif p_action='NEXT' then
  if r.phase<>'RESULT' then raise exception 'RESULT_ONLY'; end if;
  delete from br39.attacks where room=p_room;
  delete from br39.players where room=p_room and last_seen<clock_timestamp()-interval '45 seconds';
  update br39.players set alive=true,ready=true,score=0,rank=null,max_combo=0,max_attack=0,board='',reason=null,battle_no=r.battle_no+1,last_seq=0 where room=p_room;
  update br39.rooms set phase='LOBBY',start_at=null,battle_no=battle_no+1,winner_id=null where code=p_room;
 elsif p_action='RESET' then
  delete from br39.attacks where room=p_room;
  delete from br39.players where room=p_room;
  update br39.rooms set phase='LOBBY',start_at=null,reset_epoch=reset_epoch+1,battle_no=battle_no+1,winner_id=null where code=p_room;
 elsif p_action not in ('VIEW','CREATE') then raise exception 'INVALID_ACTION';
 end if;
 perform br39.sweep(p_room);
 return br39.view(p_room)||jsonb_build_object('api_version',2,'host_authorized',true,'room_exists',true,'action_result',outcome);
end $$;

create or replace function public.br39_join(p_room text,p_entry text,p_id uuid,p_token text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r br39.rooms; p br39.players;
begin
 if p_token is null or p_name is null or length(p_token)<64 or length(p_token)>160 or p_id is null or length(btrim(p_name)) not between 1 and 24 then raise exception 'INVALID_ENTRY'; end if;
 select * into r from br39.rooms where code=p_room for update;
 if not found or r.entry_hash is distinct from encode(sha256(convert_to(p_entry,'UTF8')),'hex') then raise exception '入室コードを確認してください' using errcode='42501'; end if;
 perform br39.sweep(p_room);
 select * into p from br39.players where id=p_id;
 if found then
  if p.room is distinct from p_room or p.token_hash is distinct from encode(sha256(convert_to(p_token,'UTF8')),'hex') then raise exception 'INVALID_SESSION' using errcode='42501'; end if;
  -- Idempotent join retry must not reset an active player.
  return br39.view(p_room,p_id);
 end if;
 if r.phase<>'LOBBY' then raise exception '対戦中です。次のLOBBYまでお待ちください'; end if;
 if (select count(*) from br39.players where room=p_room)>=50 then raise exception '定員50人です'; end if;
 insert into br39.players(id,room,token_hash,player_name,reset_epoch,battle_no) values(p_id,p_room,encode(sha256(convert_to(p_token,'UTF8')),'hex'),btrim(p_name),r.reset_epoch,r.battle_no);
 return br39.view(p_room,p_id);
end $$;

create or replace function public.br39_observe(p_room text,p_entry text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r br39.rooms;
begin
 select * into r from br39.rooms where code=p_room for update;
 if not found or r.entry_hash is distinct from encode(sha256(convert_to(p_entry,'UTF8')),'hex') then raise exception 'INVALID_ENTRY' using errcode='42501'; end if;
 perform br39.sweep(p_room);
 return br39.view(p_room);
end $$;
revoke all on function public.br39_host(text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.br39_host(text,text,integer,integer,text) to authenticated;
revoke all on function public.br39_join(text,text,uuid,text,text),public.br39_observe(text,text) from public,anon,authenticated;
grant execute on function public.br39_join(text,text,uuid,text,text),public.br39_observe(text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
