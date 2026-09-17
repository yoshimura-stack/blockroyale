-- v0.39 FREE50 RC1. Additive: never reads or changes the legacy game tables.
begin;
create schema if not exists br39;
revoke all on schema br39 from public, anon, authenticated;
create table if not exists br39.hosts(user_id uuid primary key);
create table if not exists br39.rooms(
 code text primary key check(length(code) between 3 and 40),
 entry_hash text not null, phase text not null default 'LOBBY',
 reset_epoch integer not null default 0, battle_no integer not null default 1,
 start_at timestamptz, winner_id uuid, sweep_at timestamptz not null default now()
);
create table if not exists br39.players(
 id uuid primary key, room text not null references br39.rooms(code), token_hash text not null,
 player_name text not null check(length(player_name) between 1 and 24),
 ready boolean not null default true, alive boolean not null default true,
 score integer not null default 0, rank integer, max_combo integer not null default 0,
 max_attack integer not null default 0, board text not null default '',
 last_seen timestamptz not null default now(), last_seq bigint not null default 0,
 reset_epoch integer not null, battle_no integer not null, reason text
);
create index if not exists br39_players_room on br39.players(room);
create table if not exists br39.attacks(
 id uuid primary key, room text not null references br39.rooms(code),
 attacker_id uuid not null references br39.players(id) on delete cascade,
 target_id uuid not null references br39.players(id) on delete cascade,
 amount integer not null, turns_remaining integer not null default 2,
 status text not null default 'PENDING', battle_no integer not null,
 created_at timestamptz not null default now()
);
create index if not exists br39_attacks_target on br39.attacks(target_id,status);
alter table br39.hosts enable row level security;
alter table br39.rooms enable row level security;
alter table br39.players enable row level security;
alter table br39.attacks enable row level security;
revoke all on all tables in schema br39 from public, anon, authenticated;

-- All RPCs lock the room FIRST. No triggers write back into locked players.
create or replace function br39.finish(p_room text) returns void
language plpgsql set search_path='' as $$
declare n integer; total integer; winner uuid;
begin
 if not exists(select 1 from br39.rooms where code=p_room and phase in ('COUNTDOWN','BATTLE') and start_at<=clock_timestamp()) then return; end if;
 select count(*),count(*) filter(where alive) into total,n from br39.players where room=p_room;
 if total<2 or n>1 then return; end if;
 if n=1 then
  select id into winner from br39.players where room=p_room and alive;
  update br39.players set rank=1 where id=winner;
 end if;
 update br39.rooms set phase='RESULT',winner_id=winner where code=p_room;
end $$;

create or replace function br39.sweep(p_room text) returns void
language plpgsql set search_path='' as $$
declare r br39.rooms; p record; n integer;
begin
 select * into r from br39.rooms where code=p_room;
 if r.sweep_at>clock_timestamp()-interval '5 seconds' then return; end if;
 update br39.rooms set sweep_at=clock_timestamp() where code=p_room;
 if r.phase='LOBBY' then
  update br39.players set ready=false where room=p_room and last_seen<clock_timestamp()-interval '45 seconds';
 elsif r.phase in ('COUNTDOWN','BATTLE') then
  select count(*) into n from br39.players where room=p_room and alive;
  for p in select id from br39.players where room=p_room and alive and last_seen<clock_timestamp()-interval '45 seconds' order by last_seen,id loop
   update br39.players set alive=false,rank=n,reason='DISCONNECTED' where id=p.id;
   n:=n-1;
  end loop;
  perform br39.finish(p_room);
 end if;
end $$;

create or replace function br39.view(p_room text,p_player uuid default null,p_full boolean default true,p_watch uuid[] default '{}') returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'server_ms',floor(extract(epoch from statement_timestamp())*1000),
  'match',(select jsonb_build_object('id',code,'phase',phase,'reset_epoch',reset_epoch,'battle_no',battle_no,'start_at',start_at,'winner_id',winner_id,'level',1) from br39.rooms where code=p_room),
  'me',(select jsonb_build_object('id',id,'alive',alive,'ready',ready,'rank',rank,'reason',reason,'last_seq',last_seq) from br39.players where id=p_player and room=p_room),
  'alive',(select count(*) from br39.players where room=p_room and alive),
  'players',case when p_full then coalesce((select jsonb_agg(jsonb_build_array(id,player_name,ready,alive,score,rank,max_combo,max_attack)) from br39.players where room=p_room),'[]'::jsonb) else null end,
  'boards',case when p_full then coalesce((select jsonb_object_agg(id,board) from br39.players where room=p_room and id=any(p_watch[1:4])),'{}'::jsonb) else null end,
  'attacks',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'attacker_id',a.attacker_id,'target_id',a.target_id,'amount',a.amount,'turns_remaining',a.turns_remaining,'status',a.status,'battle_no',a.battle_no,'reset_epoch',r.reset_epoch) order by a.created_at,a.id) from br39.attacks a join br39.rooms r on r.code=a.room where a.room=p_room and a.target_id=p_player and a.status='PENDING' and a.battle_no=r.battle_no),'[]'::jsonb)
 );
$$;

-- SECURITY DEFINER APIs intentionally access private tables; no direct grants.
-- Participants authenticate a 244-bit random bearer capability; HOST uses Auth UID.
create or replace function public.br39_join(p_room text,p_entry text,p_id uuid,p_token text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r br39.rooms; p br39.players;
begin
 if p_token is null or p_name is null or length(p_token)<64 or length(p_token)>160 or p_id is null or length(btrim(p_name)) not between 1 and 24 then raise exception 'INVALID_ENTRY'; end if;
 select * into r from br39.rooms where code=p_room;
 if not found or r.entry_hash is distinct from encode(sha256(convert_to(p_entry,'UTF8')),'hex') then raise exception '入室コードを確認してください' using errcode='42501'; end if;
 select * into r from br39.rooms where code=p_room for update;
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

create or replace function public.br39_tick(p_id uuid,p_token text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p br39.players; r br39.rooms; s bigint; item jsonb; dest uuid; n integer; aids uuid[]:='{}'; watches uuid[]:='{}';
begin
 if p_data is null or octet_length(p_data::text)>16000 then raise exception 'INVALID_PACKET'; end if;
 select * into p from br39.players where id=p_id;
 if not found or p.token_hash is distinct from encode(sha256(convert_to(p_token,'UTF8')),'hex') then raise exception 'SESSION_GONE' using errcode='42501'; end if;
 select * into r from br39.rooms where code=p.room for update;
 -- Re-read after room lock: another request may have advanced the round/reset.
 select * into p from br39.players where id=p_id;
 if not found then raise exception 'SESSION_GONE' using errcode='42501'; end if;
 perform br39.sweep(p.room);
 select * into r from br39.rooms where code=p.room;
 select * into p from br39.players where id=p_id;
 if (p_data->>'reset_epoch')::integer is distinct from r.reset_epoch or (p_data->>'battle_no')::integer is distinct from r.battle_no then return br39.view(p.room,p_id); end if;
 s:=(p_data->>'seq')::bigint;
 if s is null or s<1 then raise exception 'INVALID_SEQUENCE'; end if;
 if s>p.last_seq then
  update br39.players set last_seq=s,last_seen=clock_timestamp(),ready=case when r.phase='LOBBY' then true else ready end where id=p_id;
  if r.phase in ('COUNTDOWN','BATTLE') and r.start_at<=clock_timestamp() and p.alive then
   if r.phase='COUNTDOWN' then update br39.rooms set phase='BATTLE' where code=p.room; end if;
   if p_data ? 'state' then
    item:=p_data->'state';
    if length(coalesce(item->>'board',''))<>200 or (item->>'board') !~ '^[.IOTSZJLG]+$' then raise exception 'INVALID_BOARD'; end if;
    update br39.players set score=greatest(score,least(100000000,greatest(0,coalesce((item->>'score')::integer,0)))),
      max_combo=greatest(max_combo,least(1000,greatest(0,coalesce((item->>'max_combo')::integer,0)))),
      max_attack=greatest(max_attack,least(100,greatest(0,coalesce((item->>'max_attack')::integer,0)))),board=item->>'board' where id=p_id;
    if item->>'alive'='false' then
     select count(*) into n from br39.players where room=p.room and alive;
     update br39.players set alive=false,rank=n,reason='KO' where id=p_id;
     perform br39.finish(p.room);
    end if;
   end if;
   -- Attack amounts follow the existing client game engine; this is not an anti-cheat server.
   if exists(select 1 from br39.players where id=p_id and alive) and exists(select 1 from br39.rooms where code=p.room and phase='BATTLE' and start_at<=clock_timestamp()-interval '15 seconds') then
    if jsonb_array_length(coalesce(p_data->'outgoing','[]'))>8 then raise exception 'TOO_MANY_ATTACKS'; end if;
    for item in select value from jsonb_array_elements(coalesce(p_data->'outgoing','[]')) loop
     if (item->>'amount')::integer not between 1 and 100 then raise exception 'INVALID_ATTACK'; end if;
     if not exists(select 1 from br39.attacks where id=(item->>'id')::uuid) then
      select id into dest from br39.players where room=p.room and alive and id<>p_id order by random() limit 1;
      if dest is not null then insert into br39.attacks(id,room,attacker_id,target_id,amount,battle_no) values((item->>'id')::uuid,p.room,p_id,dest,(item->>'amount')::integer,r.battle_no); end if;
     end if;
     aids:=array_append(aids,(item->>'id')::uuid);
    end loop;
   end if;
  end if;
  if jsonb_array_length(coalesce(p_data->'acks','[]'))>64 then raise exception 'TOO_MANY_ACKS'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_data->'acks','[]')) loop
   if item->>'status' not in ('PENDING','CANCELLED','LANDED') then raise exception 'INVALID_STATUS'; end if;
   update br39.attacks set amount=least(amount,greatest(0,(item->>'amount')::integer)),
    turns_remaining=least(turns_remaining,greatest(0,(item->>'turns')::integer)),status=item->>'status'
    where id=(item->>'id')::uuid and target_id=p_id and room=p.room and battle_no=r.battle_no and status='PENDING';
  end loop;
 end if;
 select coalesce(array_agg(value::uuid),'{}') into watches from (select value from jsonb_array_elements_text(coalesce(p_data->'watch','[]')) limit 4) w;
 return br39.view(p.room,p_id,coalesce((p_data->>'full')::boolean,false),watches)||jsonb_build_object('seq',s,'sent',coalesce((select jsonb_agg(jsonb_build_object('id',id,'target_id',target_id,'amount',amount)) from br39.attacks where attacker_id=p_id and id in (select (value->>'id')::uuid from jsonb_array_elements(coalesce(p_data->'outgoing','[]')))),'[]'));
end $$;

create or replace function public.br39_observe(p_room text,p_entry text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r br39.rooms;
begin
 select * into r from br39.rooms where code=p_room;
 if not found or r.entry_hash is distinct from encode(sha256(convert_to(p_entry,'UTF8')),'hex') then raise exception 'INVALID_ENTRY' using errcode='42501'; end if;
 perform 1 from br39.rooms where code=p_room for update;
 perform br39.sweep(p_room);
 return br39.view(p_room);
end $$;

create or replace function public.br39_host(p_room text,p_action text,p_epoch integer default null,p_round integer default null,p_entry text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r br39.rooms;
begin
 if auth.uid() is null or not exists(select 1 from br39.hosts where user_id=auth.uid()) then raise exception 'HOST_ONLY' using errcode='42501'; end if;
 if p_action='CREATE' then
  if p_entry is null or length(p_entry) not between 12 and 160 then raise exception '入室コードは12〜160文字にしてください'; end if;
  insert into br39.rooms(code,entry_hash) values(p_room,encode(sha256(convert_to(p_entry,'UTF8')),'hex')) on conflict(code) do nothing;
 end if;
 select * into r from br39.rooms where code=p_room for update;
 if not found then raise exception '先に部屋を作成してください'; end if;
 if p_action in ('START','NEXT','RESET') then
  if p_epoch is distinct from r.reset_epoch or p_round is distinct from r.battle_no then return br39.view(p_room); end if;
 end if;
 if p_action='START' then
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
 return br39.view(p_room);
end $$;

revoke all on all functions in schema br39 from public,anon,authenticated;
revoke all on function public.br39_join(text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.br39_tick(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.br39_observe(text,text) from public,anon,authenticated;
revoke all on function public.br39_host(text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.br39_join(text,text,uuid,text,text),public.br39_tick(uuid,text,jsonb),public.br39_observe(text,text) to anon,authenticated;
grant execute on function public.br39_host(text,text,integer,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
