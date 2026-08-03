create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack');

create table public.meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  meal_type    public.meal_type not null,
  servings     numeric(5,2) not null default 1 check (servings > 0),
  title        text not null check (length(title) <= 200),
  description  text not null default '' check (length(description) <= 2000),
  items        jsonb not null default '[]'::jsonb,
  calories     numeric(8,2) not null default 0 check (calories >= 0),
  protein      numeric(8,2) not null default 0 check (protein  >= 0),
  carbs        numeric(8,2) not null default 0 check (carbs    >= 0),
  fat          numeric(8,2) not null default 0 check (fat      >= 0),
  health_score int check (health_score between 1 and 10),
  confidence   numeric(3,2) check (confidence between 0 and 1),
  notes        text not null default '' check (length(notes) <= 2000),
  image_path   text
);

-- The diary is always read newest-first, scoped to one user.
create index meals_user_created_idx on public.meals (user_id, created_at desc);

alter table public.meals enable row level security;

create policy "meals_select_own" on public.meals
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "meals_insert_own" on public.meals
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- with check is what stops a meal being reassigned to another user. using
-- alone gates which rows you may touch, not what you may turn them into.
create policy "meals_update_own" on public.meals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "meals_delete_own" on public.meals
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger meals_touch_updated_at
  before update on public.meals
  for each row execute function public.touch_updated_at();

-- Object-level privileges. Without these, Postgres denies with 42501 before
-- RLS is ever evaluated. Scoped to exactly the policied operations, so the
-- grant is a second barrier independent of RLS.
--
-- UPDATE is column-scoped deliberately. RLS policies cannot restrict columns;
-- only grants can. A table-wide update grant would let a client backdate
-- created_at, which meals_user_created_idx orders on and which any streak or
-- daily-total logic reads. user_id is likewise excluded, so reassignment is
-- blocked by the grant as well as by the policy's with check.
grant select, insert, delete on public.meals to authenticated;
grant update (meal_type, servings, title, description, notes, items,
              calories, protein, carbs, fat, health_score, confidence,
              image_path)
  on public.meals to authenticated;

-- service_role bypasses RLS but NOT object privileges — those are separate
-- mechanisms. Without this grant the trusted server identity cannot read or
-- write the table at all, which breaks server-side routes and any test using
-- serviceClient() as an RLS-independent witness.
grant all on public.meals to service_role;
