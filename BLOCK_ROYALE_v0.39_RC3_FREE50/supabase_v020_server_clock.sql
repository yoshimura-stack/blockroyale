-- BLOCK ROYALE V0.20
-- Shared server clock used by HOST / PLAYER / PROJECTOR.
-- Run once in the block-royale Supabase SQL Editor.

create or replace function public.server_now_ms()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

revoke all on function public.server_now_ms() from public;
grant execute on function public.server_now_ms() to anon;

-- Optional quick test:
-- select public.server_now_ms();
