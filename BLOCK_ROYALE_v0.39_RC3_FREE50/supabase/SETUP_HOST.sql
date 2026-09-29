-- Run AFTER the v0.39 migration. Replace the placeholder with the UUID of
-- your existing HOST account in Supabase Authentication > Users.
-- This grants that account HOST control over ALL br39 rooms in this project.
-- No password, service_role key, or participant credential belongs here.
do $$
declare host_id uuid := 'REPLACE_WITH_HOST_AUTH_USER_UUID';
begin
 if not exists(select 1 from auth.users where id=host_id) then
  raise exception 'AuthenticationのUsersに存在するUUIDを指定してください';
 end if;
 insert into br39.hosts(user_id) values(host_id) on conflict do nothing;
end $$;
