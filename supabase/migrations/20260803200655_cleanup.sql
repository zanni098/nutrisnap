-- Anonymous-first auth means every curious visitor leaves an auth.users row
-- behind. Without a purge that is a permanent, slowly-growing leak.
--
-- Only accounts with no meals are removed: having logged a meal is the signal
-- that someone actually used the product and might come back to it.
create function public.purge_stale_anonymous_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '30 days'
       and not exists (select 1 from public.meals m where m.user_id = u.id)
    returning 1
  )
  select count(*) into v_deleted from doomed;

  return v_deleted;
end $$;

-- Test-only helper: ages a user so the purge can be exercised without waiting
-- 30 days. Service role only, so it is unreachable from any client key.
create function public.test_backdate_user(p_user_id uuid, p_days int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
     set created_at = now() - (p_days || ' days')::interval
   where id = p_user_id;
end $$;

revoke execute on function public.purge_stale_anonymous_users() from public, anon, authenticated;
revoke execute on function public.test_backdate_user(uuid, int)  from public, anon, authenticated;
grant  execute on function public.purge_stale_anonymous_users() to service_role;
grant  execute on function public.test_backdate_user(uuid, int)  to service_role;
