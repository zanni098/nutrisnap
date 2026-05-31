# AI Log — Testing & Walkthrough Session

This log continues `01-build-session.md` and `02-decisions-and-prompts.md`. It
documents the end-to-end testing pass and the recorded walkthrough used for the
contest submission. As with the other logs, this is a faithful narrative of the
AI-driven session.

---

## 1. Goal of this session

With the app built and pushed to the public repo, the remaining work was to
prove it works end-to-end and produce the submission artifacts: a walkthrough
recording and a set of polished mobile screenshots.

## 2. Production build for testing

To avoid the Next.js dev overlay appearing in screenshots/recording, all
testing was done against a **production build**:

```bash
npm run build
PORT=3100 npx next start -p 3100
```

The app was exercised on a 402×874 mobile viewport at 3× DPR.

## 3. Seeding realistic data

The Today screen was kept empty so the walkthrough could show a meal being
logged live, while the previous six days were seeded with realistic meals
(varied meal types, sensible macros, health scores) so History and Insights
have meaningful content. Seeding writes directly to the two `localStorage`
keys the app reads:

- `nutrisnap.meals.v1` — array of `MealEntry`
- `nutrisnap.profile.v1` — `{ name, goals }`

## 4. The four tests (all passed)

1. **Analyze a meal photo with AI and log it.** Ran the "Burger" sample through
   the real Gemini pipeline → got *"Gourmet Egg Burger Meal"*, 984 kcal,
   59P/72C/51F, health 6/10, 95% confidence, 10 detected items. Set it to Lunch
   at 1.5× and logged it; the Today ring updated to 724 kcal left, macro bars
   filled, and the streak advanced to 7 days.
2. **History grouped by day.** Each day shows its total, % of goal, aggregate
   macros, and per-meal cards.
3. **Insights.** KPI row, 7-day calorie bar chart, and macro-distribution bar
   all render from the logged data.
4. **TDEE calculator.** Male / 30 / 175 cm / 75 kg / Moderate / Lose →
   recommended **2130 kcal** with P135 · C265 · F59, offered via
   "Apply these targets".

## 5. Transient-error iteration (observed again)

During one analyze call Gemini returned a transient **503 "model overloaded"**.
This is exactly the case the build session hardened for: the analyze pipeline
retries with exponential backoff and falls back across
`gemini-2.5-flash → gemini-2.0-flash → gemini-flash-latest`. The call recovered
automatically after one retry and returned a valid result, so the live demo did
not break. This confirmed the resilience logic works under real conditions.

## 6. Screenshots

Twelve production screenshots were captured with a Playwright script
(`shots.mjs`) using the same mobile profile: Today (full + scrolled), capture
sheet, two AI results (salad + burger) and the detected-items view, History
(top + scrolled), Insights, Settings, the TDEE calculator result, and the
empty/new-user state.

## 7. Outcome

All core flows verified on a production build. Artifacts produced: annotated
walkthrough recording + 12 mobile screenshots, ready for the contest submission
alongside this repo and its `/ai-logs/`.
