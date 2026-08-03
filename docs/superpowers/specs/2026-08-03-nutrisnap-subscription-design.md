# NutriSnap — Subscription SaaS Design

**Date:** 2026-08-03
**Status:** Approved, ready for implementation planning

## Goal

Convert NutriSnap from a localStorage-only demo into a real subscription product: Supabase
auth and Postgres as the source of truth, Polar for billing, and a metered free tier that
gates the expensive operation (Gemini vision calls).

The secondary goal shapes several decisions below: this is a portfolio piece intended to
withstand inspection by a senior engineer. Where two options are equally correct, prefer
the one whose reasoning is legible from the code.

## Decisions

| Decision | Choice |
|---|---|
| Timeline | No deadline — build it properly |
| Free/paid line | Metered AI analyses + cloud sync |
| Price | $4/month |
| Auth | Anonymous-first, link identity later |
| Offline | localStorage as read-through cache; Postgres authoritative |
| Hosting | Vercel (unchanged) |
| Enforcement | RLS owns isolation; a `SECURITY DEFINER` RPC owns metering |
| Client data layer | TanStack Query + `persistQueryClient` |

### Free vs Pro

| | Free | Pro ($4/mo) |
|---|---|---|
| AI meal analyses | 3 per day | Unlimited |
| Manual logging, dashboard, history, insights | Yes | Yes |
| Cross-device sync | Yes, once an identity is linked | Yes |
| Meal photo storage | No (local thumbnail only) | Yes |
| Weekly Wellness Agent digest | No | Yes |

**Sync is not a paid feature.** Anonymous-first auth means every user — free or paid —
already has real rows in Postgres, so their data is "in the cloud" from the first tap.
Signing in on a second device is then a consequence of having linked an identity, not of
having paid. Attempting to gate it would mean deliberately refusing to serve rows the user
owns and RLS already permits, which is both hostile and trivially inconsistent.

The genuinely sellable things are the ones that cost real money to provide or represent
real additional work: unmetered Gemini calls, photo storage, and the agent digest.

## Architecture

### Why enforcement is split

Data isolation and billing entitlement have different failure modes and belong in
different places.

Isolation is absolute and independent of billing: a user must never read another user's
meals, subscription state, or usage, regardless of plan. That is expressed as RLS and is
always on.

Entitlement is a metering decision that must be race-safe and must not go stale. It lives
in one `SECURITY DEFINER` function callable only by the service role. Plan status is read
fresh from Postgres on every request rather than carried in a JWT claim, so a revoked
subscription takes effect on the next request instead of the next token refresh.

## Data model

```
profiles          id (PK -> auth.users), display_name,
                  goal_calories, goal_protein, goal_carbs, goal_fat,
                  created_at, updated_at

meals             id (PK), user_id (-> auth.users), created_at, updated_at,
                  meal_type, servings, title, description,
                  items (jsonb), calories, protein, carbs, fat,
                  health_score, confidence, notes, image_path

subscriptions     user_id (PK -> auth.users), polar_customer_id,
                  polar_subscription_id, status, plan,
                  current_period_end, updated_at

usage_daily       (user_id, day) PK, analyses_used

webhook_events    id (PK, Polar event id), type, payload (jsonb), received_at
```

`meals.items` stays `jsonb`. Food items are always read as a unit with their parent meal
and are never queried individually, so normalizing them would add a join for no benefit.

### Billing state is a separate table

`subscriptions` is deliberately not columns on `profiles`.

Users must be able to edit their own display name and calorie goals, which requires an RLS
`UPDATE` policy on `profiles`. If `plan` lived there, that same policy would permit
`update profiles set plan = 'pro'`. Preventing that would require a column-level trigger —
a load-bearing piece of security that a future migration can silently break.

Splitting the table means `subscriptions` has **no INSERT, UPDATE, or DELETE policy for
authenticated users at all**. Privilege escalation is absent from the schema rather than
blocked by a rule someone must maintain.

`usage_daily` follows the same principle: `SELECT` only, so the UI can render
"2 of 3 analyses used today". All writes happen inside the metering function.

`webhook_events` exists for idempotency. Polar retries deliveries, and a retried
`subscription.created` must not grant a second month. Its primary key is Polar's own event
id, so a replay is a duplicate-key violation rather than a bug.

### RLS policies

| Table | authenticated user may |
|---|---|
| `profiles` | SELECT, UPDATE own row |
| `meals` | SELECT, INSERT, UPDATE, DELETE own rows |
| `subscriptions` | SELECT own row only |
| `usage_daily` | SELECT own rows only |
| `webhook_events` | nothing |

A trigger on `auth.users` inserts the `profiles` row at signup, so there is no window in
which an authenticated user has no profile.

### Storage

Bucket `meal-photos`, objects keyed `{user_id}/{meal_id}.webp`. The storage policy matches
the first path segment against `auth.uid()`. Photos are a Pro feature; free users retain
the existing local data-URL thumbnail and never touch the bucket.

### Anonymous users

Supabase anonymous sign-in creates a genuine `auth.users` row with `is_anonymous = true`.
Every policy above applies unchanged — no special-casing required.

Two consequences:

- **Anonymous users cannot subscribe.** Polar requires a real email for receipts and
  dunning, so checkout is gated behind identity linking.
- **Abandoned anonymous rows accumulate.** A scheduled job deletes anonymous users with no
  meals older than 30 days. Without it this is a slow, permanent leak.

## Metering

```sql
create function consume_analysis_quota(p_user_id uuid)
returns table (allowed boolean, used int, quota int)
language plpgsql security definer set search_path = public as $$
declare
  v_limit  int := 3;          -- server-side constant, NOT a parameter
  v_active boolean;
  v_used   int;
begin
  select true into v_active from subscriptions
   where user_id = p_user_id
     and status in ('active', 'canceled')   -- canceled = not renewing, still paid through
     and current_period_end > now();        -- revoked/refunded ends access immediately

  if v_active then
    return query select true, 0, -1;    -- pro: unmetered
    return;
  end if;

  insert into usage_daily (user_id, day, analyses_used)
  values (p_user_id, current_date, 1)
  on conflict (user_id, day) do update
     set analyses_used = usage_daily.analyses_used + 1
   where usage_daily.analyses_used < v_limit
  returning analyses_used into v_used;

  if v_used is null then                -- WHERE failed => already at limit
    select analyses_used into v_used
      from usage_daily where user_id = p_user_id and day = current_date;
    return query select false, v_used, v_limit;
  end if;
  return query select true, v_used, v_limit;
end $$;
```

A companion `refund_analysis_quota(p_user_id)` decrements the same counter, floored at
zero.

Three properties this design depends on:

1. **The limit is a constant, not an argument.** As a parameter, any caller could pass
   `999999` and mint unlimited analyses.
2. **EXECUTE is granted to `service_role` only**, revoked from `authenticated` and
   `public`. The browser cannot reach this function. That is why it takes `p_user_id`
   explicitly — there is no `auth.uid()` on a service-role connection.
3. **Check and increment are one statement.** Concurrent requests serialize on the row
   lock, leaving no read-then-write window. The naive three-step version (select, compare
   in JS, update) hands a free analysis to anyone who double-taps.

## Request flows

### Analyze

```
client -> POST /api/analyze (Bearer JWT + image)
          |- verify JWT server-side -> user_id            (401 if absent)
          |- consume_analysis_quota(user_id)
          |     `- not allowed -> 402 {used, quota}       -> upgrade sheet
          |- Gemini call (existing fallback chain + backoff preserved)
          |     `- all models fail -> refund_analysis_quota -> 503
          `- normalization pass (existing) -> 200
```

Quota is consumed **before** the model call and refunded if every model fails. Consuming
after success would allow twenty parallel requests against a quota of three. Omitting the
refund would let a Gemini outage burn a user's daily allowance through no fault of their
own.

### Checkout

`POST /api/checkout` creates a Polar checkout session server-side with
`external_customer_id` set to the Supabase user id. That single field is the entire
identity bridge; the webhook uses it to locate the user with no email matching or lookup
table.

### Webhook

`POST /api/webhooks/polar`:

1. Read the **raw** body via `await req.text()`. Verifying a signature over re-serialized
   JSON fails intermittently.
2. Verify the HMAC signature; reject with 401 before parsing.
3. Insert into `webhook_events` keyed by Polar's event id. On duplicate key, return 200
   immediately — that is a retry.
4. Upsert `subscriptions` from the payload.

Handled: `subscription.created`, `.updated`, `.active`, `.canceled`, `.revoked`.

Cancellation sets `status = 'canceled'` but preserves `current_period_end`, so a
cancelling user keeps access through the period they already paid for. This is why the
metering function accepts both `'active'` and `'canceled'` and relies on
`current_period_end > now()` to draw the actual line — checking `status = 'active'` alone
would cut off a paid-up user the moment they clicked cancel.

`revoked` is deliberately excluded from that list: it signals a refund or chargeback, where
access should end immediately regardless of the period end date.

### Anonymous to linked account

Linking an identity preserves `auth.users.id`. All `meals` rows already reference that id,
so the diary carries over with zero migration code.

**Email collision edge case.** If the user links an email that already has an account,
Supabase rejects it and the user holds an anonymous session full of unmergeable meals.
Detect the conflict and present an explicit choice — "sign in and discard these N meals"
or "keep these and use a different email". Never surface the raw error; silent data loss
here would be the worst bug in the app.

## Client layer

Components keep consuming `useMeals()` and `useProfile()` with unchanged signatures. Only
the internals change.

```
useMeals()       -> useQuery(['meals'])        + optimistic add/update/delete mutations
useProfile()     -> useQuery(['profile'])      + setGoals/setName mutations
useEntitlement() -> useQuery(['subscription','usage'])   // new, powers paywall UI
```

TanStack Query with `persistQueryClient` over a localStorage persister provides the agreed
behavior — instant paint from cache, server authoritative, revalidate on reconnect — with
optimistic mutations and rollback included. Conflict rule is last-write-wins on
`updated_at`.

### Agent refactor

`src/lib/agent.ts` currently reads the diary from local storage directly. It must instead
take meals as an injected argument. This makes the agent pure and therefore testable
against fixture data with no browser or database, and restores the lockstep with the
Python reference in `wellness-agent/` that the README claims.

### Migrating existing local data

Users of the current app have meals under `nutrisnap.meals.v1`. On first authenticated
load, if local meals exist and the server has none, prompt: "Import N meals from this
device?"

Explicit, never silent. A background import that duplicates a diary cannot be undone from
the client.

### Paywall surfaces

- `/pricing` — free vs Pro comparison and checkout button
- Upgrade sheet triggered by a 402, showing `used / quota`
- Quota pill on the Today screen ("2 of 3 today"), hidden for subscribers
- Settings billing section: current plan, renewal date, Polar portal link

## Error handling

| Failure | Behavior |
|---|---|
| Not authenticated | 401 -> create anonymous session silently, retry once |
| Quota exhausted | 402 with `{used, quota}` -> upgrade sheet, no error toast |
| All Gemini models fail | Quota refunded, 503, retry affordance |
| Offline write | Optimistic, queued, rolled back with toast on final failure |
| Invalid webhook signature | 401, body unparsed, logged |
| Webhook replay | 200 immediately on duplicate key |
| Email collision on link | Explicit choice dialog; never a raw error |

## Testing

The repository currently has no tests and no test script. For a deliverable whose purpose
is demonstrating engineering judgment, this is the most significant gap.

Priority order:

1. **Quota race test.** Fire 10 parallel analyze requests against a limit of 3; assert
   exactly 3 succeed and `analyses_used = 3`. This proves atomicity rather than asserting
   it in a comment.
2. **RLS isolation tests.** User A cannot read, update, or delete user B's meals.
   `subscriptions` and `usage_daily` reject client writes.
3. **Webhook idempotency.** The same event id delivered twice yields one subscription row.
4. **Pure logic units.** Nutrition math, the normalization pass, agent verdicts against
   fixture weeks.
5. **One Playwright path.** Anonymous -> analyze -> hit quota -> upgrade sheet.

Vitest for units; integration tests against a local `supabase start`; GitHub Actions
running lint, typecheck, and the full suite. Green CI on a public repo is part of the
deliverable.

## File layout

```
supabase/migrations/*.sql            schema, RLS, quota + refund functions
src/lib/supabase/{client,server}.ts
src/lib/queries/{meals,profile,entitlement}.ts
src/lib/store.ts                     thin wrapper, signatures preserved
src/lib/agent.ts                     refactored to accept injected meals
src/app/api/checkout/route.ts
src/app/api/webhooks/polar/route.ts
src/app/pricing/page.tsx
src/components/{UpgradeSheet,QuotaPill,AuthSheet}.tsx
tests/                               unit + integration + e2e
```

Per project coding standards, files stay in the 200–400 line range, 800 maximum.

## Environment

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      server only
POLAR_ACCESS_TOKEN             server only
POLAR_WEBHOOK_SECRET           server only
POLAR_PRODUCT_ID
GEMINI_API_KEY                 server only, existing
```

The service-role key and both Polar secrets must never carry a `NEXT_PUBLIC_` prefix.

## Out of scope

Deferred deliberately, recorded so they are not mistaken for oversights:

- Full bidirectional offline sync (outbox queue, tombstones, conflict resolution).
  Rejected as disproportionate risk; last-write-wins is sufficient here.
- Capacitor iOS/Android builds.
- Barcode scanning.
- Push-notification delivery of agent digests. The digest is in scope; push delivery is
  not — it will surface in-app.
- Team or family plans. Single-seat subscriptions only.
