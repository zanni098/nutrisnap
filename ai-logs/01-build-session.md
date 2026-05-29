# AI Build Log — NutriSnap (AI Calorie Tracker)

This folder documents the AI-assisted development of NutriSnap, built for the
8x Engineer "Build a Cal AI Clone" contest. The work was done with an AI
software engineer (Devin) driving the implementation. Below is a faithful,
chronological log of the conversation, decisions, and iterations.

---

## 1. Kickoff & requirements

**Human prompt:**
> https://8xengineer.com/contests/ai-calorie-tracker/apply — build it. make a
> quality product, help me win 1st place. go through their requirements.
> "Build a Cal AI Clone — AI Calorie Tracker. Snap a photo of any meal and
> instantly get calorie counts, macros, and nutritional breakdowns powered by AI."

**AI plan:**
- Mobile-first web app (the product category is a phone app, so the UI should
  feel like one).
- Core loop: **snap/upload meal photo → AI vision returns items + calories +
  macros → review/edit → log to a daily diary**.
- Supporting screens that make it feel like a real product: Today dashboard
  with a calorie ring + macro bars, History grouped by day, Insights (7-day
  trends + macro split), and a Profile/Goals screen with a TDEE calculator.
- Persistence via `localStorage` so the demo is bulletproof and needs no
  backend database or auth.
- Stack: **Next.js (App Router) + TypeScript + Tailwind v4**, deployed to
  Vercel, public GitHub repo with this `/ai-logs/` folder.

**Decision — AI provider:** asked the human to choose. They picked **Google
Gemini**. Chose `gemini-2.5-flash` as the primary vision model for its strong
multimodal quality, speed, and native structured-JSON (responseSchema) support.

---

## 2. Architecture

```
src/
  app/
    page.tsx            # Today dashboard (calorie ring, macros, meals)
    history/page.tsx    # Past days grouped by date
    insights/page.tsx   # 7-day bar chart + macro distribution + KPIs
    settings/page.tsx   # Name, goal targets, TDEE calculator
    api/analyze/route.ts# POST image -> Gemini -> structured nutrition JSON
  components/
    CaptureProvider.tsx # Global "open camera sheet" context
    CaptureSheet.tsx    # The snap -> analyze -> review -> log flow
    BottomNav.tsx       # Mobile tab bar with centered camera FAB
    ProgressRing.tsx, MacroStat.tsx, MacroPill.tsx, HealthBadge.tsx, MealCard.tsx
  lib/
    gemini.ts           # Server-side Gemini client + JSON schema + retries
    types.ts            # Shared domain types
    nutrition.ts        # Totals, day bucketing, Mifflin-St Jeor TDEE, helpers
    store.ts            # localStorage-backed meals/profile via useSyncExternalStore
    image.ts            # Client-side downscale + thumbnail generation
```

**Key design choices the AI made and why:**
- **Structured output via `responseSchema`** (not free-text parsing) so the
  model returns a typed object: per-item name/quantity/calories/macros, totals,
  a 1–10 health score, a 0–1 confidence, and a one-line tip.
- **Totals reconciled with item sums** server-side (`normalize`) and all values
  rounded and clamped to be non-negative, so the UI never shows garbage.
- **Client-side image downscaling** to ~1024px JPEG before upload (keeps the
  request small/fast) plus a 320px thumbnail stored with the meal.
- **`useSyncExternalStore`** for the localStorage store so every screen stays in
  sync and SSR/hydration is stable (server snapshot = empty, then client
  re-syncs — no hydration mismatch).

---

## 3. Implementation notes & iterations

- **Hydration safety:** a `useMounted()` gate prevents time-dependent UI
  (greeting, streak, date) from rendering differently on server vs client.
- **Lint (Next 16 / React 19):** the new `react-hooks/set-state-in-effect` rule
  flagged the `setMounted(true)` mount pattern. This is the intended, well-known
  pattern for client-only gating, so it's documented and disabled on that line.

### Iteration: Gemini 503 "model overloaded"
First end-to-end API test returned `503 UNAVAILABLE — "This model is currently
experiencing high demand."` This is a transient capacity error, not a code bug.

**Fix:** made `analyzeMealImage` resilient:
- Retry the same model up to 3× with exponential backoff (400ms, 800ms, …).
- Fall back across models: `gemini-2.5-flash → gemini-2.0-flash →
  gemini-flash-latest`.
- Only retry on retryable errors (429/500/503/UNAVAILABLE/RESOURCE_EXHAUSTED);
  surface other errors immediately.

After the fix, the `/api/analyze` endpoint returned a correct breakdown for the
sample burger image:

```
TITLE: Gourmet Beef and Egg Burger
CALS: 1014  P 59  C 82  F 51
HEALTH: 6/10  CONF: 0.9
ITEMS: Burger Bun, Beef Patty, Fried Egg, Cheddar Cheese, Caramelized Onions,
       Pickled Beetroot, Tomato Slices, Lettuce, Ketchup
NOTE: "Enjoy this hearty burger! To boost fiber, consider a whole-wheat bun or
       add more fresh veggies."
```

---

## 4. Quality gates

- `npm run lint` — clean.
- `npm run build` — succeeds; all routes compile (`/`, `/history`, `/insights`,
  `/settings`, `/api/analyze`).
- Manual end-to-end test of the analyze endpoint against real meal photos.

See `02-decisions-and-prompts.md` for the exact model prompt and schema, and the
repo `README.md` for setup + the contest reflection.
