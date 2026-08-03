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

create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Grant object-level privileges so that RLS policies can take effect.
-- Without these grants the authenticated role is denied before RLS even runs.
grant select, update on public.profiles to authenticated;
