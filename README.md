# 🥗 NutriSnap — AI Calorie Tracker

Snap a photo of any meal and instantly get **calorie counts, macros, and a full
nutritional breakdown** — powered by AI vision (Google Gemini).

A polished, mobile-first Cal AI clone built for the
[8x Engineer "Build a Cal AI Clone" contest](https://8xengineer.com/contests/ai-calorie-tracker/apply).

**🔗 Live demo:** https://nutrisnap-mocha-psi.vercel.app

> Tip: open it on your phone (or in your browser's mobile/device view) — and try the
> built-in **Salad / Burger / Breakfast** samples to see the AI analysis without
> needing a photo.

---

## 🤖 Autonomous Wellness Agent — Capstone Layer

> Built for the [**AI Agents: Intensive Vibe Coding Capstone**](https://www.kaggle.com/competitions/vibecoding-agents-capstone-project) (Google × Kaggle). Track: **Agents for Good**.

On top of the photo→macros app sits an **autonomous agent** — a *Proactive Wellness
Critic*. Instead of a passive `upload → numbers → stop` loop, it treats NutriSnap's
features as **tools** and runs a **ReAct (Reason → Act → Observe)** loop that reads
your history, quantifies your trajectory, and **acts on its own** — planning,
approving, warning, or **blocking** a meal, and generating a grocery list to close
nutritional gaps.

**Course concepts demonstrated (≥3 required):**

| Concept | Where |
| --- | --- |
| **Agent / ReAct loop** | [`agent_runtime.py`](./agent_runtime.py) — persona-driven Reason→Act→Observe |
| **Tool registry (Agent skills)** | [`agent/tools.py`](./agent/tools.py) — 5 LLM-callable tools |
| **MCP Server** | [`agent/mcp_server.py`](./agent/mcp_server.py) — same tools over Model Context Protocol |
| **Security / guardrails** | [`agent/guardrails.py`](./agent/guardrails.py) — input/output/loop guards |
| **Memory** | [`agent/memory.py`](./agent/memory.py) — short-term scratchpad + long-term profile |
| **Deployability** | live app on Vercel (link above) |

```bash
# No API key needed — deterministic mock backend.
pip install -r requirements.txt          # optional: only for live Gemini + MCP
python demo_simulation.py                # narrated 4-scenario proof run
python agent_runtime.py "Review my week and optimize my shopping list"
python -m agent.mcp_server               # expose the tools as an MCP server
```

Demo verdicts (reproducible): weekly audit → `PROACTIVE_PLAN` · burger vs declining
week → `BLOCK` · salad → `APPROVE` · non-food image → `BLOCK` (guardrail).

See [`KAGGLE_SUBMISSION.md`](./KAGGLE_SUBMISSION.md) for the full capstone writeup and
[`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md) for the demo-video plan.

---

## ✨ Features

- **📸 Snap or upload** a meal → AI identifies every food item and estimates
  calories + protein/carbs/fat per item, with totals.
- **🎯 Daily dashboard** with an animated calorie ring, remaining-calorie
  counter, and macro progress bars against your goals.
- **✏️ Review before logging** — adjust servings, pick the meal type, and see
  the AI's health score, confidence, and a short nutrition tip.
- **📅 History** of every day, grouped by date with per-day totals and macros.
- **📊 Insights** — 7-day calorie bar chart, average intake, and your macro
  distribution.
- **🧮 Goal calculator** — Mifflin-St Jeor TDEE to set personalized calorie &
  macro targets (lose / maintain / gain).
- **🔥 Streaks**, sample meals to try instantly, graceful empty/loading/error
  states, and offline-friendly local persistence.

## 🛠️ Tech stack

| Layer        | Choice                                            |
| ------------ | ------------------------------------------------- |
| Framework    | Next.js (App Router) + React 19                   |
| Language     | TypeScript                                        |
| Styling      | Tailwind CSS v4                                    |
| AI           | Google Gemini (`@google/genai`), `gemini-2.5-flash` w/ fallbacks |
| Icons / motion | lucide-react, framer-motion                     |
| Persistence  | `localStorage` via `useSyncExternalStore`         |

## 🚀 Getting started

```bash
npm install

# add your Gemini API key (https://aistudio.google.com/app/apikey)
echo "GEMINI_API_KEY=your_key_here" > .env.local

npm run dev   # http://localhost:3000
```

Then open the app on your phone (or use Chrome's device toolbar) and tap the
center **camera** button to snap a meal. No API key? The capture sheet has
**sample meals** you can analyze instantly.

### Scripts

```bash
npm run dev     # start dev server
npm run build   # production build
npm run lint    # eslint
```

## 🧠 How the AI works

`POST /api/analyze` receives a downscaled image, sends it to Gemini with a
strict `responseSchema`, and returns a typed nutrition object (per-item +
totals + health score + confidence + tip). The server reconciles totals,
rounds/clamps values, and retries with model fallback on transient overloads.

See [`ai-logs/`](./ai-logs) for the full build log, prompt, and schema design.

## 📁 Project structure

```
src/app        Today / History / Insights / Settings pages + analyze API
src/components Capture flow, bottom nav, rings, cards, badges
src/lib        Gemini client, nutrition math, localStorage store, image utils
public/samples Sample meal photos for the demo
ai-logs        AI conversation / decision log
```

---

## 📝 Reflection

**What was easy.** Scaffolding with Next.js + Tailwind and getting a clean
mobile shell up was quick. Gemini's structured-output (`responseSchema`) made
the hardest part — turning a photo into reliable, typed nutrition data — almost
declarative: define the schema once and the model fills it in.

**What was difficult.** Two things. (1) Making the numbers *trustworthy*: a raw
model can return totals that don't match item sums or occasional negative
values, so I added a server-side normalization pass that rounds, clamps, and
reconciles totals against the items. (2) Reliability: the first end-to-end call
hit a transient `503 model overloaded`, so I added retries with exponential
backoff and a multi-model fallback chain — the kind of resilience a real product
needs.

**What I learned.** Treating the LLM as a typed function (schema in, validated
object out) is the key to a product that feels solid rather than demo-ware. The
value isn't just "call the API" — it's the layer around it: image downscaling
for speed, defensive normalization for trust, fallbacks for uptime, and a UI
that's honest about confidence. Designing the calorie ring + macro system also
reinforced how much polish lives in empty states, loading states, and small
animations.

---

Built with an AI pair-programmer. See [`ai-logs/`](./ai-logs).
