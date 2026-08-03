# NutriSnap Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Postgres foundation for NutriSnap's subscription tier — schema, row-level security, and an atomic metering function — with a test suite that proves the security and concurrency claims rather than asserting them in comments.

**Architecture:** Supabase Postgres with RLS owning data isolation for every table, and a single `SECURITY DEFINER` function owning quota metering. That function is executable only by the service role, takes the user id explicitly, and performs its check-and-increment in one atomic statement so concurrent requests cannot over-spend a quota. Billing state lives in its own table with no client write policy, so privilege escalation is absent from the schema rather than blocked by a trigger.

**Tech Stack:** Supabase CLI (local Postgres), SQL migrations, Vitest, `@supabase/supabase-js`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-03-nutrisnap-subscription-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/config.toml` | Local stack config; enables anonymous sign-ins |
| `supabase/migrations/*_profiles.sql` | `profiles` table, RLS, new-user trigger |
| `supabase/migrations/*_meals.sql` | `meals` table, RLS, indexes |
| `supabase/migrations/*_billing.sql` | `subscriptions`, `usage_daily`, `webhook_events` + RLS |
| `supabase/migrations/*_quota_functions.sql` | `consume_analysis_quota`, `refund_analysis_quota`, grants |
| `supabase/migrations/*_storage.sql` | `meal-photos` bucket and its policies |
| `tests/helpers/supabase.ts` | Test clients: service-role and freshly signed-in anonymous users |
| `tests/db/rls.test.ts` | Proves cross-user isolation and non-writable billing tables |
| `tests/db/quota.test.ts` | Proves limit enforcement and concurrency safety |
| `.github/workflows/ci.yml` | Lint, typecheck, and the DB suite against a real Postgres |

---

## Task 1: Initialize the local Supabase stack

**Files:**
- Create: `supabase/config.toml` (generated)
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev supabase vitest dotenv
npm install @supabase/supabase-js
```

- [ ] **Step 2: Initialize Supabase**

```bash
npx supabase init
```

Expected: creates `supabase/config.toml` and `supabase/.gitignore`.

- [ ] **Step 3: Enable anonymous sign-ins**

The spec's anonymous-first auth requires this flag. In `supabase/config.toml`, find the `[auth]` section and set:

```toml
[auth]
enable_anonymous_sign_ins = true
```

- [ ] **Step 4: Start the stack**

```bash
npx supabase start
```

Expected: prints `API URL`, `anon key`, and `service_role key`. First run pulls Docker images and takes several minutes.

- [ ] **Step 5: Capture local credentials**

```bash
npx supabase status -o env > .env.test
```

Then confirm `.env.test` contains `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` values.

Note the CLI calls the endpoint **`API_URL`**, not `SUPABASE_URL`. Verified against CLI
2.111.0. Every consumer of this file must use that exact name — a helper defaulting to
`process.env.SUPABASE_URL` silently falls back to a hardcoded localhost URL and appears to
work right up until it doesn't.

- [ ] **Step 6: Ignore local artifacts**

Append to `.gitignore`:

```
.env.test
supabase/.branches
supabase/.temp
```

- [ ] **Step 7: Add test scripts**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"db:reset": "supabase db reset"
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json supabase .gitignore
git commit -m "chore: initialize local Supabase stack with anonymous sign-ins"
```

---

## Task 2: Test harness

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/helpers/supabase.ts`
- Create: `tests/db/smoke.test.ts`

- [ ] **Step 1: Write the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB tests share one Postgres instance; run files serially to keep
    // per-test user fixtures from interleaving unpredictably.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 2: Write the test helpers**

Create `tests/helpers/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// `supabase status -o env` emits API_URL / ANON_KEY / SERVICE_ROLE_KEY.
// Fail loudly rather than defaulting: a silent localhost fallback turns a
// misconfigured environment into a confusing test failure much later.
const URL = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  throw new Error(
    "Missing API_URL / ANON_KEY / SERVICE_ROLE_KEY. " +
      "Run: npx supabase status -o env > .env.test",
  );
}

/** Bypasses RLS. Use for setup, assertions, and calling service-only RPCs. */
export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export interface TestUser {
  client: SupabaseClient;
  id: string;
}

/** Creates a fresh anonymous user and returns a client authenticated as them. */
export async function anonUser(): Promise<TestUser> {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, id: data.user!.id };
}
```

- [ ] **Step 3: Write the smoke test**

Create `tests/db/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { anonUser, serviceClient } from "../helpers/supabase";

describe("local stack", () => {
  it("creates an anonymous user with a real auth row", async () => {
    const user = await anonUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);

    const svc = serviceClient();
    const { data, error } = await svc.auth.admin.getUserById(user.id);
    expect(error).toBeNull();
    expect(data.user?.is_anonymous).toBe(true);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npm test`
Expected: PASS. If it fails on missing keys, re-run `npx supabase status -o env > .env.test`.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/
git commit -m "test: add Supabase test harness with anonymous user fixture"
```

---

## Task 3: Profiles table

**Files:**
- Create: `supabase/migrations/<timestamp>_profiles.sql`
- Create: `tests/db/rls.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/rls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { anonUser } from "../helpers/supabase";

describe("profiles RLS", () => {
  it("auto-creates a profile row for every new user", async () => {
    const a = await anonUser();
    const { data, error } = await a.client
      .from("profiles")
      .select("id, goal_calories")
      .eq("id", a.id)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(a.id);
    expect(data?.goal_calories).toBe(2000);
  });

  it("hides other users' profiles", async () => {
    const a = await anonUser();
    const b = await anonUser();

    const { data } = await b.client.from("profiles").select("id").eq("id", a.id);
    expect(data).toEqual([]);
  });

  it("rejects updates to another user's profile", async () => {
    const a = await anonUser();
    const b = await anonUser();

    const { data } = await b.client
      .from("profiles")
      .update({ display_name: "hacked" })
      .eq("id", a.id)
      .select();

    // RLS filters the row out, so nothing is updated.
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: FAIL — relation "public.profiles" does not exist.

- [ ] **Step 3: Create the migration**

```bash
npx supabase migration new profiles
```

Write into the generated `supabase/migrations/<timestamp>_profiles.sql`:

```sql
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
```

- [ ] **Step 4: Apply and run the tests**

```bash
npx supabase db reset
npx vitest run tests/db/rls.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations tests/db/rls.test.ts
git commit -m "feat(db): profiles table with RLS and auto-provisioning trigger"
```

---

## Task 4: Meals table

**Files:**
- Create: `supabase/migrations/<timestamp>_meals.sql`
- Modify: `tests/db/rls.test.ts`
- Modify: `tests/helpers/supabase.ts`

- [ ] **Step 1: Add a meal fixture helper**

Append to `tests/helpers/supabase.ts`:

```ts
/** Inserts one meal owned by the given user and returns its id. */
export async function seedMeal(user: TestUser, title = "Test meal"): Promise<string> {
  const { data, error } = await user.client
    .from("meals")
    .insert({
      user_id: user.id,
      meal_type: "lunch",
      title,
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 20,
      items: [{ name: "rice", quantity: "1 cup", calories: 200, protein: 4, carbs: 44, fat: 0 }],
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}
```

- [ ] **Step 2: Write the failing tests**

First update the existing import at the top of `tests/db/rls.test.ts` — do not add a
second import from the same module, which duplicates the specifier and trips lint:

```ts
import { anonUser, seedMeal } from "../helpers/supabase";
```

Then append to the same file:

```ts
describe("meals RLS", () => {
  it("lets a user read back their own meal", async () => {
    const a = await anonUser();
    const id = await seedMeal(a, "My lunch");

    const { data, error } = await a.client
      .from("meals")
      .select("id, title")
      .eq("id", id)
      .single();

    expect(error).toBeNull();
    expect(data?.title).toBe("My lunch");
  });

  it("hides one user's meals from another", async () => {
    const a = await anonUser();
    const b = await anonUser();
    await seedMeal(a, "Private lunch");

    const { data } = await b.client.from("meals").select("id");
    expect(data).toEqual([]);
  });

  it("rejects inserting a meal owned by someone else", async () => {
    const a = await anonUser();
    const b = await anonUser();

    const { error } = await b.client.from("meals").insert({
      user_id: a.id,
      meal_type: "dinner",
      title: "Forged",
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    });

    expect(error).not.toBeNull();
  });

  it("rejects deleting another user's meal", async () => {
    const a = await anonUser();
    const b = await anonUser();
    const id = await seedMeal(a);

    await b.client.from("meals").delete().eq("id", id);

    const { data } = await a.client.from("meals").select("id").eq("id", id);
    expect(data).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: FAIL — relation "public.meals" does not exist.

- [ ] **Step 4: Create the migration**

```bash
npx supabase migration new meals
```

Write into the generated file:

```sql
create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack');

create table public.meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  meal_type    public.meal_type not null,
  servings     numeric(5,2) not null default 1 check (servings > 0),
  title        text not null,
  description  text not null default '',
  items        jsonb not null default '[]'::jsonb,
  calories     numeric(8,2) not null default 0 check (calories >= 0),
  protein      numeric(8,2) not null default 0 check (protein  >= 0),
  carbs        numeric(8,2) not null default 0 check (carbs    >= 0),
  fat          numeric(8,2) not null default 0 check (fat      >= 0),
  health_score int check (health_score between 1 and 10),
  confidence   numeric(3,2) check (confidence between 0 and 1),
  notes        text not null default '',
  image_path   text
);

-- The diary is always read newest-first, scoped to one user.
create index meals_user_created_idx on public.meals (user_id, created_at desc);

alter table public.meals enable row level security;

create policy "meals_select_own" on public.meals
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "meals_insert_own" on public.meals
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "meals_update_own" on public.meals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "meals_delete_own" on public.meals
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger meals_touch_updated_at
  before update on public.meals
  for each row execute function public.touch_updated_at();
```

- [ ] **Step 5: Apply and run**

```bash
npx supabase db reset
npx vitest run tests/db/rls.test.ts
```

Expected: all seven tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/
git commit -m "feat(db): meals table with per-user RLS on all four operations"
```

---

## Task 5: Billing tables

**Files:**
- Create: `supabase/migrations/<timestamp>_billing.sql`
- Modify: `tests/db/rls.test.ts`

- [ ] **Step 1: Write the failing tests**

Again update the existing import line rather than adding a new one:

```ts
import { anonUser, seedMeal, serviceClient } from "../helpers/supabase";
```

Then append to `tests/db/rls.test.ts`:

```ts
describe("billing tables are not client-writable", () => {
  it("rejects a user granting themselves a subscription", async () => {
    const a = await anonUser();

    const { error } = await a.client.from("subscriptions").insert({
      user_id: a.id,
      status: "active",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(error).not.toBeNull();
  });

  it("lets a user read their own subscription written by the service role", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "active",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const { data, error } = await a.client
      .from("subscriptions")
      .select("plan, status")
      .single();

    expect(error).toBeNull();
    expect(data?.plan).toBe("pro");
  });

  it("rejects a user upgrading an existing subscription row", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "canceled",
      plan: "free",
      current_period_end: new Date(Date.now() - 1000).toISOString(),
    });

    await a.client.from("subscriptions").update({ plan: "pro" }).eq("user_id", a.id);

    const { data } = await svc
      .from("subscriptions")
      .select("plan")
      .eq("user_id", a.id)
      .single();

    expect(data?.plan).toBe("free");
  });

  it("rejects writing usage counters directly", async () => {
    const a = await anonUser();

    const { error } = await a.client
      .from("usage_daily")
      .insert({ user_id: a.id, day: "2026-08-03", analyses_used: 0 });

    expect(error).not.toBeNull();
  });

  it("hides webhook events entirely", async () => {
    const a = await anonUser();
    const { data } = await a.client.from("webhook_events").select("id");
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: FAIL — relation "public.subscriptions" does not exist.

- [ ] **Step 3: Create the migration**

```bash
npx supabase migration new billing
```

Write into the generated file:

```sql
-- Billing state is deliberately NOT on profiles. Users need an UPDATE policy
-- on profiles to edit their goals; if plan lived there, that same policy would
-- let them set plan = 'pro'. Here there is simply no write policy to abuse.
create table public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  polar_customer_id      text,
  polar_subscription_id  text unique,
  status                 text not null,
  plan                   text not null default 'free',
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
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase db reset
npx vitest run tests/db/rls.test.ts
```

Expected: all twelve tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations tests/db/rls.test.ts
git commit -m "feat(db): billing tables with no client write policies"
```

---

## Task 6: The metering function

This is the centerpiece. The concurrency test in Step 1 is the single most important test in the repository.

**Files:**
- Create: `supabase/migrations/<timestamp>_quota_functions.sql`
- Create: `tests/db/quota.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/db/quota.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { anonUser, serviceClient } from "../helpers/supabase";

const FREE_LIMIT = 3;

interface QuotaResult {
  allowed: boolean;
  used: number;
  quota: number;
}

async function consume(userId: string): Promise<QuotaResult> {
  const svc = serviceClient();
  const { data, error } = await svc.rpc("consume_analysis_quota", {
    p_user_id: userId,
  });
  if (error) throw error;
  return (data as QuotaResult[])[0];
}

describe("consume_analysis_quota", () => {
  it("allows the first call and reports usage", async () => {
    const a = await anonUser();
    const r = await consume(a.id);

    expect(r.allowed).toBe(true);
    expect(r.used).toBe(1);
    expect(r.quota).toBe(FREE_LIMIT);
  });

  it("blocks the call after the limit is reached", async () => {
    const a = await anonUser();
    for (let i = 0; i < FREE_LIMIT; i++) await consume(a.id);

    const r = await consume(a.id);
    expect(r.allowed).toBe(false);
    expect(r.used).toBe(FREE_LIMIT);
  });

  // The reason the check and increment are a single statement.
  it("allows exactly the limit under concurrent load", async () => {
    const a = await anonUser();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => consume(a.id)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(FREE_LIMIT);

    const svc = serviceClient();
    const { data } = await svc
      .from("usage_daily")
      .select("analyses_used")
      .eq("user_id", a.id)
      .single();

    expect(data?.analyses_used).toBe(FREE_LIMIT);
  });

  it("does not meter an active subscriber", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "active",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    for (let i = 0; i < 10; i++) {
      expect((await consume(a.id)).allowed).toBe(true);
    }

    const { data } = await svc
      .from("usage_daily")
      .select("analyses_used")
      .eq("user_id", a.id);

    expect(data).toEqual([]);
  });

  // Cancelling is not the same as losing access.
  it("still serves a canceled subscriber inside their paid period", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "canceled",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect((await consume(a.id)).allowed).toBe(true);
    expect((await consume(a.id)).quota).toBe(-1);
  });

  it("meters a canceled subscriber once their period has ended", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "canceled",
      plan: "pro",
      current_period_end: new Date(Date.now() - 86_400_000).toISOString(),
    });

    expect((await consume(a.id)).quota).toBe(FREE_LIMIT);
  });

  // Refunds and chargebacks cut access immediately.
  it("meters a revoked subscriber even inside the paid period", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "revoked",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect((await consume(a.id)).quota).toBe(FREE_LIMIT);
  });

  it("is not callable by an ordinary user", async () => {
    const a = await anonUser();
    const { error } = await a.client.rpc("consume_analysis_quota", {
      p_user_id: a.id,
    });
    expect(error).not.toBeNull();
  });
});

describe("refund_analysis_quota", () => {
  it("returns a consumed analysis to the pool", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await consume(a.id);
    await consume(a.id);
    await svc.rpc("refund_analysis_quota", { p_user_id: a.id });

    expect((await consume(a.id)).used).toBe(2);
  });

  it("never drops below zero", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await consume(a.id);
    for (let i = 0; i < 5; i++) {
      await svc.rpc("refund_analysis_quota", { p_user_id: a.id });
    }

    const { data } = await svc
      .from("usage_daily")
      .select("analyses_used")
      .eq("user_id", a.id)
      .single();

    expect(data?.analyses_used).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db/quota.test.ts`
Expected: FAIL — could not find function `consume_analysis_quota`.

- [ ] **Step 3: Create the migration**

```bash
npx supabase migration new quota_functions
```

Write into the generated file:

```sql
-- The daily free limit is a constant INSIDE this function, never a parameter.
-- As an argument, any caller able to reach the RPC could pass 999999.
create function public.consume_analysis_quota(p_user_id uuid)
returns table (allowed boolean, used int, quota int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit  int := 3;
  v_active boolean;
  v_used   int;
begin
  -- 'canceled' still counts while the paid period runs; 'revoked' (refund or
  -- chargeback) does not, regardless of period end.
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

-- Returns a consumed analysis when every Gemini model failed, so an outage
-- does not burn the user's daily allowance.
create function public.refund_analysis_quota(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usage_daily
     set analyses_used = greatest(analyses_used - 1, 0)
   where user_id = p_user_id and day = current_date;
end $$;

-- Reachable only from the server holding the service key.
revoke execute on function public.consume_analysis_quota(uuid) from public, anon, authenticated;
revoke execute on function public.refund_analysis_quota(uuid)  from public, anon, authenticated;
grant  execute on function public.consume_analysis_quota(uuid) to service_role;
grant  execute on function public.refund_analysis_quota(uuid)  to service_role;
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase db reset
npx vitest run tests/db/quota.test.ts
```

Expected: all eleven tests PASS. If the concurrency test reports 10 allowed instead of 3, the check and increment have been split into separate statements — re-read Step 3.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests across both files PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/db/quota.test.ts
git commit -m "feat(db): atomic quota metering, service-role only

Check and increment happen in a single INSERT ... ON CONFLICT so
concurrent requests cannot over-spend the daily limit. Covered by a
test firing 10 parallel calls against a limit of 3."
```

---

## Task 7: Meal photo storage

**Files:**
- Create: `supabase/migrations/<timestamp>_storage.sql`
- Create: `tests/db/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/storage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { anonUser } from "../helpers/supabase";

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("meal-photos bucket", () => {
  it("lets a user upload into their own folder", async () => {
    const a = await anonUser();
    const { error } = await a.client.storage
      .from("meal-photos")
      .upload(`${a.id}/meal-1.png`, PNG);

    expect(error).toBeNull();
  });

  it("rejects uploading into another user's folder", async () => {
    const a = await anonUser();
    const b = await anonUser();

    const { error } = await b.client.storage
      .from("meal-photos")
      .upload(`${a.id}/forged.png`, PNG);

    expect(error).not.toBeNull();
  });

  it("rejects downloading another user's photo", async () => {
    const a = await anonUser();
    const b = await anonUser();
    await a.client.storage.from("meal-photos").upload(`${a.id}/private.png`, PNG);

    const { error } = await b.client.storage
      .from("meal-photos")
      .download(`${a.id}/private.png`);

    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db/storage.test.ts`
Expected: FAIL — bucket not found.

- [ ] **Step 3: Create the migration**

```bash
npx supabase migration new storage
```

Write into the generated file:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos', 'meal-photos', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp']
);

-- Objects are keyed {user_id}/{meal_id}.webp, so the first path segment is
-- the owner. storage.foldername() returns that segment array.
create policy "meal_photos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal_photos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase db reset
npx vitest run tests/db/storage.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations tests/db/storage.test.ts
git commit -m "feat(db): private meal-photos bucket scoped by user folder"
```

---

## Task 8: Anonymous account cleanup

Every curious visitor leaves an anonymous row behind. Without this, that is a permanent leak.

**Files:**
- Create: `supabase/migrations/<timestamp>_cleanup.sql`
- Create: `tests/db/cleanup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/cleanup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { anonUser, seedMeal, serviceClient } from "../helpers/supabase";

/** Backdates a user's auth row so the cleanup function considers it stale. */
async function backdate(userId: string, days: number) {
  const svc = serviceClient();
  const { error } = await svc.rpc("test_backdate_user", {
    p_user_id: userId,
    p_days: days,
  });
  if (error) throw error;
}

describe("purge_stale_anonymous_users", () => {
  it("deletes empty anonymous accounts older than 30 days", async () => {
    const a = await anonUser();
    await backdate(a.id, 40);

    const svc = serviceClient();
    await svc.rpc("purge_stale_anonymous_users");

    const { data } = await svc.auth.admin.getUserById(a.id);
    expect(data.user).toBeNull();
  });

  it("keeps anonymous accounts that have meals", async () => {
    const a = await anonUser();
    await seedMeal(a);
    await backdate(a.id, 40);

    const svc = serviceClient();
    await svc.rpc("purge_stale_anonymous_users");

    const { data } = await svc.auth.admin.getUserById(a.id);
    expect(data.user).not.toBeNull();
  });

  it("keeps recent empty anonymous accounts", async () => {
    const a = await anonUser();

    const svc = serviceClient();
    await svc.rpc("purge_stale_anonymous_users");

    const { data } = await svc.auth.admin.getUserById(a.id);
    expect(data.user).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db/cleanup.test.ts`
Expected: FAIL — could not find function `purge_stale_anonymous_users`.

- [ ] **Step 3: Create the migration**

```bash
npx supabase migration new cleanup
```

Write into the generated file:

```sql
create function public.purge_stale_anonymous_users()
returns integer
language plpgsql
security definer
set search_path = public
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

revoke execute on function public.purge_stale_anonymous_users() from public, anon, authenticated;
grant  execute on function public.purge_stale_anonymous_users() to service_role;

-- Test-only helper: ages a user so the purge can be exercised without waiting
-- 30 days. Service role only, and harmless if it ships.
create function public.test_backdate_user(p_user_id uuid, p_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users
     set created_at = now() - (p_days || ' days')::interval
   where id = p_user_id;
end $$;

revoke execute on function public.test_backdate_user(uuid, int) from public, anon, authenticated;
grant  execute on function public.test_backdate_user(uuid, int) to service_role;
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase db reset
npx vitest run tests/db/cleanup.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 5: Schedule it in production**

Not part of the local migration. Once the project is linked to hosted Supabase, enable the `pg_cron` extension in the dashboard and schedule:

```sql
select cron.schedule(
  'purge-stale-anon-users', '0 3 * * *',
  $$ select public.purge_stale_anonymous_users(); $$
);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/db/cleanup.test.ts
git commit -m "feat(db): purge stale empty anonymous accounts"
```

---

## Task 9: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Start Supabase
        run: supabase start

      - name: Export local credentials
        run: supabase status -o env > .env.test

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Database tests
        run: npm test
```

- [ ] **Step 2: Verify locally first**

```bash
npm run lint
npx tsc --noEmit
npm test
```

Expected: all three clean. Fix anything failing before pushing — a red first CI run on a public repo is exactly what this plan exists to avoid.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck, and database suite against real Postgres"
git push
```

- [ ] **Step 4: Confirm the run is green**

```bash
gh run watch
```

Expected: success. The badge-worthy outcome is a public repo where RLS isolation and quota atomicity are verified on every push.

---

## Done when

- `npm test` passes: 12 RLS tests, 11 quota tests, 3 storage tests, 3 cleanup tests.
- `npx supabase db reset` applies all six migrations cleanly from scratch.
- CI is green on `main`.
- A user cannot, from any client key: read another user's meals, write their own subscription, write a usage counter, or call either quota function.
- Ten concurrent analyses against a limit of three grant exactly three.

## Deliberately not in this plan

The spec lists webhook idempotency as testing priority 3. The `webhook_events` table and
its primary key ship here (Task 5), but the idempotency behaviour itself — a replayed
Polar event returning 200 without granting a second month — is a property of the route
handler, so its test belongs with Plan 4. This is a sequencing decision, not an omission.

Plan 2 (auth + TanStack Query data layer) builds directly on this.
