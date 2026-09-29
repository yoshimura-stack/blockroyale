-- BLOCK ROYALE v0.36. Run in Supabase SQL Editor before deploying the ZIP.
-- Preserves existing RLS, grants, phase constraints, and winner trigger.
begin;
alter table public.matches add column if not exists reset_epoch integer not null default 0;
alter table public.players add column if not exists reset_epoch integer not null default 0;
alter table public.player_states add column if not exists reset_epoch integer not null default 0;
alter table public.attacks add column if not exists reset_epoch integer not null default 0;

create or replace function public.br_guard_session()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare current_epoch integer;
begin
  -- SHARE conflicts with the reset's UPDATE lock. A queued old write cannot
  -- recreate deleted rows after reset commits. Existing clients default to 0.
  select reset_epoch into current_epoch from public.matches
    where id = new.match_id for share;
  if current_epoch is null or new.reset_epoch is distinct from current_epoch then
    raise exception 'BR_STALE_SESSION: reload and READY again' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.match_id is distinct from old.match_id or new.reset_epoch is distinct from old.reset_epoch then
      raise exception 'BR_STALE_SESSION: session cannot be reassigned' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists br_guard_session on public.players;
create trigger br_guard_session before insert or update on public.players
  for each row execute function public.br_guard_session();
drop trigger if exists br_guard_session on public.player_states;
create trigger br_guard_session before insert or update on public.player_states
  for each row execute function public.br_guard_session();
drop trigger if exists br_guard_session on public.attacks;
create trigger br_guard_session before insert or update on public.attacks
  for each row execute function public.br_guard_session();

create or replace function public.br_reset_room(p_match_id uuid, p_expected_epoch integer)
returns public.matches language plpgsql security invoker set search_path = '' as $$
declare room public.matches;
begin
  select * into room from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'Room missing or permission denied' using errcode = '42501';
  end if;
  -- Same request after a lost response, or two hosts resetting concurrently:
  -- return the committed generation without deleting newly joined players.
  if room.reset_epoch > p_expected_epoch then return room; end if;
  if p_expected_epoch is null or room.reset_epoch <> p_expected_epoch then
    raise exception 'Unexpected reset generation';
  end if;
  -- LOBBY is supported by the original phase CHECK/enum. No RESET phase needed.
  update public.matches set phase = 'LOBBY', start_at = null, level = 1,
    battle_no = coalesce(battle_no, 1) + 1, reset_epoch = reset_epoch + 1
    where id = p_match_id returning * into room;
  if not found then raise exception 'Match update denied' using errcode = '42501'; end if;
  delete from public.attacks where match_id = p_match_id;
  delete from public.player_states where match_id = p_match_id;
  delete from public.players where match_id = p_match_id;
  if exists(select 1 from public.attacks where match_id = p_match_id)
    or exists(select 1 from public.player_states where match_id = p_match_id)
    or exists(select 1 from public.players where match_id = p_match_id) then
    raise exception 'Reset deletion denied: check existing DELETE RLS policies' using errcode = '42501';
  end if;
  return room;
end;
$$;
revoke all on function public.br_reset_room(uuid, integer) from public;
grant execute on function public.br_reset_room(uuid, integer) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
