-- The daily free limit is a constant INSIDE this function, never a parameter.
-- As an argument, any caller able to reach the RPC could pass 999999.
--
-- search_path = '' (not 'public'): with an explicit search_path that omits
-- pg_temp, Postgres still searches pg_temp BEFORE pg_catalog for relation
-- names. Any authenticated user can create temp tables, so an unqualified
-- reference inside a SECURITY DEFINER function could be shadowed by an
-- attacker-controlled temp table executing as postgres. Every name below is
-- schema-qualified accordingly.
create function public.consume_analysis_quota(p_user_id uuid)
returns table (allowed boolean, used int, quota int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit  int := 3;
  v_active boolean;
  v_used   int;
begin
  -- 'canceled' still counts while the paid period runs — cancelling is not the
  -- same as losing access, and checking status = 'active' alone would cut off a
  -- paid-up user the moment they clicked cancel. 'revoked' (refund or
  -- chargeback) is excluded, so it ends access immediately regardless of period.
  select true into v_active
    from public.subscriptions
   where user_id = p_user_id
     and status in ('active', 'canceled')
     and current_period_end > now();

  if v_active then
    return query select true, 0, -1;
    return;
  end if;

  -- Check and increment in ONE statement. Concurrent callers serialize on the
  -- row lock, so there is no read-then-write window to exploit. When the WHERE
  -- fails the user is already at the limit and RETURNING yields no row.
  insert into public.usage_daily (user_id, day, analyses_used)
  values (p_user_id, current_date, 1)
  on conflict (user_id, day) do update
     set analyses_used = usage_daily.analyses_used + 1
   where usage_daily.analyses_used < v_limit
  returning usage_daily.analyses_used into v_used;

  if v_used is null then
    select ud.analyses_used into v_used
      from public.usage_daily ud
     where ud.user_id = p_user_id and ud.day = current_date;
    return query select false, coalesce(v_used, v_limit), v_limit;
  end if;

  return query select true, v_used, v_limit;
end $$;

-- Returns a consumed analysis when every Gemini model failed, so a provider
-- outage does not burn the user's daily allowance through no fault of theirs.
create function public.refund_analysis_quota(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.usage_daily
     set analyses_used = greatest(analyses_used - 1, 0)
   where user_id = p_user_id and day = current_date;
end $$;

-- Reachable only from the server holding the service key. This is why the
-- functions take p_user_id explicitly: there is no auth.uid() on a
-- service-role connection.
revoke execute on function public.consume_analysis_quota(uuid) from public, anon, authenticated;
revoke execute on function public.refund_analysis_quota(uuid)  from public, anon, authenticated;
grant  execute on function public.consume_analysis_quota(uuid) to service_role;
grant  execute on function public.refund_analysis_quota(uuid)  to service_role;
