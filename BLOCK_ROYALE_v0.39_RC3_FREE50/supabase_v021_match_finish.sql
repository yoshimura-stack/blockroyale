-- BLOCK ROYALE V0.21
-- Server-authoritative K.O. ranking + winner / match finish.
-- Run once in Supabase SQL Editor for block-royale.

create or replace function public.br_finalize_on_ko()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_alive integer;
  v_match_phase text;
  v_start_at timestamptz;
  v_winner uuid;
begin
  -- Only react when this player actually changes ALIVE -> K.O.
  if old.alive is distinct from true or new.alive is distinct from false then
    return new;
  end if;

  select phase, start_at
    into v_match_phase, v_start_at
  from public.matches
  where id = new.match_id;

  -- A host tab can be background-throttled and leave phase at COUNTDOWN.
  -- Once start_at has passed, COUNTDOWN is treated as an active battle.
  if not (
    v_match_phase = 'BATTLE'
    or (v_match_phase = 'COUNTDOWN' and v_start_at is not null and v_start_at <= now())
  ) then
    return new;
  end if;

  select count(*)
    into v_total
  from public.players
  where match_id = new.match_id;

  if v_total < 2 then
    return new;
  end if;

  select count(*)
    into v_alive
  from public.players
  where match_id = new.match_id
    and alive = true;

  -- K.O. order determines placement.
  update public.players
     set rank = v_alive + 1
   where id = new.id;

  -- Exactly one survivor = winner.
  if v_alive = 1 then
    select id
      into v_winner
    from public.players
    where match_id = new.match_id
      and alive = true
    limit 1;

    update public.players
       set rank = 1
     where id = v_winner;

    update public.matches
       set phase = 'RESULT'
     where id = new.match_id
       and phase <> 'RESULT';

  -- Defensive fallback: if all clients somehow K.O. before RESULT propagates,
  -- choose the highest SCORE among the best remaining rank.
  elsif v_alive = 0 then
    select id
      into v_winner
    from public.players
    where match_id = new.match_id
    order by
      case when rank is null then 999999 else rank end asc,
      score desc,
      updated_at asc
    limit 1;

    if v_winner is not null then
      update public.players set rank = 1 where id = v_winner;
    end if;

    update public.matches
       set phase = 'RESULT'
     where id = new.match_id
       and phase <> 'RESULT';
  end if;

  return new;
end;
$$;

drop trigger if exists br_finalize_on_ko_trigger on public.players;

create trigger br_finalize_on_ko_trigger
after update of alive on public.players
for each row
execute function public.br_finalize_on_ko();

-- Make sure browser clients can receive the server-side updates through Realtime.
-- (Tables are already in supabase_realtime from the initial setup.)

-- Quick check after installation:
-- select tgname from pg_trigger where tgname = 'br_finalize_on_ko_trigger';
