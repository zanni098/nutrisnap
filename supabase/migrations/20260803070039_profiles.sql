create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default '',
  goal_calories int  not null default 2000 check (goal_calories > 0),
  goal_protein  int  not null default 150  check (goal_protein  >= 0),
  goal_carbs    int  not null default 200  check (goal_carbs    >= 0),
  goal_fat      int  not null default 65   check (goal_fat      >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- (select auth.uid()) is wrapped in a subquery so Postgres evaluates it once
-- per statement instead of once per row.
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No INSERT or DELETE policy: rows are created by trigger and removed by
-- the cascade from auth.users.

-- search_path = '' (not 'public'). With an explicit search_path that omits
-- pg_temp, Postgres still searches pg_temp BEFORE pg_catalog for relation
-- names. Any authenticated user can create temp tables, so an unqualified
-- reference inside a SECURITY DEFINER function can be shadowed by an
-- attacker-controlled temp table running as postgres. Harmless on a trigger
-- function, fatal on the caller-invoked RPCs in a later task — so set the
-- safe template here, where it gets copied from.
create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Idempotent: this fires on EVERY auth.users insert and shares that
  -- transaction, so any error aborts user creation and surfaces as an opaque
  -- auth 500. on conflict costs nothing and removes that failure mode.
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Grant object-level privileges so that RLS policies can take effect.
-- Without these grants the authenticated role is denied before RLS even runs.
-- UPDATE is column-scoped: RLS policies cannot restrict which columns a client
-- may write, only grants can. Scoping to the mutable fields prevents a client
-- from writing created_at, updated_at, or id even if they bypass RLS.
grant select on public.profiles to authenticated;
grant update (display_name, goal_calories, goal_protein, goal_carbs, goal_fat)
  on public.profiles to authenticated;

-- Backfill: anonymous users already exist from earlier tasks' test runs, and
-- without this the "never a window without a profile" invariant is false for
-- them on any database that has not been reset.
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- service_role bypasses RLS but NOT object privileges — those are separate
-- mechanisms. Without this grant the trusted server identity cannot read or
-- write the table at all.
grant all on public.profiles to service_role;
