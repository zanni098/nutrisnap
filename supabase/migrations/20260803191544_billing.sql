-- Billing state is deliberately NOT columns on profiles. Users need an UPDATE
-- policy on profiles to edit their goals; if plan lived there, that same policy
-- would let them set plan = 'pro'. Preventing that would need a column-level
-- trigger — a load-bearing piece of security a future migration can silently
-- break. Here there is simply no write policy and no write grant to abuse.
create table public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  polar_customer_id      text,
  polar_subscription_id  text unique,
  status                 text not null check (
                           status in ('active', 'canceled', 'revoked',
                                      'past_due', 'incomplete')),
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
-- No INSERT / UPDATE / DELETE policy. Service role only.

create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

create table public.usage_daily (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null default current_date,
  analyses_used int  not null default 0 check (analyses_used >= 0),
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

create policy "usage_select_own" on public.usage_daily
  for select to authenticated using ((select auth.uid()) = user_id);
-- No write policy: only consume/refund_analysis_quota touch this table.

-- Polar retries deliveries. Keying on its event id makes a replay a
-- duplicate-key violation instead of a second month granted for free.
create table public.webhook_events (
  id          text primary key,
  type        text not null,
  payload     jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
-- No policies at all: unreachable from any client key.

-- Object-level privileges, deliberately read-only and mirroring the policies.
-- Billing state and usage counters are written exclusively by the service role,
-- so the absence of INSERT/UPDATE/DELETE here is a second barrier independent
-- of RLS. webhook_events gets no grant whatsoever.
grant select on public.subscriptions to authenticated;
grant select on public.usage_daily   to authenticated;

-- service_role bypasses RLS but NOT object privileges — separate mechanisms.
-- Every write to these tables comes from the Polar webhook or the metering
-- functions running under this role, so without these grants the entire
-- billing path is dead.
grant all on public.subscriptions  to service_role;
grant all on public.usage_daily    to service_role;
grant all on public.webhook_events to service_role;
