# NutriSnap Wellness Agent — Proactive Wellness Critic

**AI Agents: Intensive Vibe Coding Capstone Project**
Built on top of [NutriSnap](https://github.com/zanni098/nutrisnap) · Live app: https://nutrisnap-mocha-psi.vercel.app

---

## Project Title

**NutriSnap Wellness Agent — a Proactive Wellness Critic that turns a passive calorie tracker into an autonomous nutrition auditor.**

---

## Problem Statement

Photo-based calorie trackers are **reactive**. The interaction is a dead-end loop: the user uploads a meal photo, the app returns macros, and nothing happens next. The burden of *interpretation* — "Am I under on protein this week? Is my meal quality slipping? Should I actually eat this?" — is dumped back on the user, exactly the cognitive work they downloaded the app to avoid.

The result is well-known: people log food diligently for a week, get a wall of numbers they don't act on, and quit. The data exists; the **agency** does not. Nobody is watching the trajectory, nobody intervenes before a bad choice, and nobody plans the next grocery run from the deficits that are sitting right there in the log.

**The gap: the app can *see* food, but it cannot *reason, decide, or act* on the user's behalf.**

---

## Solution Description

The Wellness Agent adds an **autonomous agent layer** on top of NutriSnap's existing vision-logging features. Instead of `photo -> macros -> stop`, it runs a persona-driven **ReAct (Reason → Act → Observe) loop** that treats the app's own capabilities as a tool registry and drives itself to a decision.

Given a high-level goal (or *no* goal at all), the agent:

1. **Reads** the user's real nutrition history through a tool (`fetch_logged_macros`).
2. **Quantifies** intake versus goals and detects deficits + declining quality trends (`calculate_trajectory`).
3. **Evaluates** any new meal photo *in the context of that trajectory*, not in isolation (`parse_food_image`).
4. **Reflects** and emits exactly one **structured JSON intervention** — `APPROVE`, `WARN`, `BLOCK`, or a `PROACTIVE_PLAN` with a corrective action list and a ready-to-shop grocery list (`generate_wellness_plan`).

The agent persona is a strict **"Proactive Wellness Critic"**: evidence-first (never judges a meal before reading the logs), constructively blunt, and biased toward *acting* — it flags deficits and blocks harmful choices even when the user never asked.

### Architecture (maps directly to the course rubric)

| Course pattern | Implementation |
|---|---|
| **Tool Registry** (Google ADK / Antigravity style) | `agent/tools.py` wraps NutriSnap's vision + logging features as five LLM-callable tools with JSON-schema declarations: `parse_food_image`, `fetch_logged_macros`, `calculate_trajectory`, `generate_wellness_plan`, `log_meal`. |
| **Agent Persona + ReAct loop** | `agent_runtime.py` — a `WellnessAgent` that runs a bounded Reason→Act→Observe loop under the Proactive Wellness Critic system prompt, terminating in a schema-constrained JSON verdict. |
| **Security & Guardrails** (safety modules) | `agent/guardrails.py` — three layers: **input guards** (reject non-food / invalid files before any tool runs), **output guards** (clamp model output to physically plausible macro ranges), **loop guards** (tool whitelist + iteration budget so autonomy is bounded). |
| **Memory management** | `agent/memory.py` — short-term ReAct scratchpad *plus* a persistent long-term profile (dietary trends, preferences, past verdicts) so the user never re-states context across sessions. |
| **Local-first execution** | Runs fully offline on a deterministic **mock backend** (no key, no network) for reproducible demos, and identically against **live Google Gemini** (`google-genai`, `gemini-2.5-flash` + fallbacks) when `GEMINI_API_KEY` is set. |

The Python agent shares the **exact data schema** as the deployed Next.js app (`nutrisnap.meals.v1` / `nutrisnap.profile.v1`), so a real exported log and the agent are fully interchangeable — the agent operates on the same food data the live app produces.

---

## Key Features

- **Proactive, unprompted auditing** — the agent reviews the week and surfaces a protein deficit + declining meal-quality trend with *no* user request, then generates a muscle-recovery grocery list from the gaps it found.
- **Autonomous interception** — submit a cheeseburger against an already-declining week and the agent **BLOCKS** it with a contextual reason, withholding the log rather than passively recording it.
- **Evidence-based, not reflexively harsh** — the same critic **APPROVES** a genuinely balanced meal (grilled chicken salad, 9/10), proving decisions come from data, not a hardcoded bias.
- **Hard safety guardrails** — non-food and invalid images are rejected *before any nutrition data is fabricated*; model output is clamped to plausible ranges; the ReAct loop can only call whitelisted tools and is iteration-bounded.
- **Persistent memory** — trends and past interventions are written to long-term state and re-injected into the system prompt, so the agent stays consistent across runs.
- **Dual backend** — deterministic mock for stable demos; live Gemini for production, with retry + model-fallback reliability mirroring the app's own layer.
- **Structured, machine-consumable output** — every run ends in a strict JSON intervention (`verdict`, `reasoning`, `deficits`, `correctiveActions`, `groceryList`, `nextCheckin`), ready for a UI or downstream automation.

---

## Impact

- **Turns data into agency.** The log stops being a graveyard of numbers and becomes something a tireless auditor acts on — the single biggest reason food-tracking retention collapses.
- **Intervenes at the decision moment**, not in a weekly summary the user ignores. Blocking a bad choice *before* it's logged is the behavior-change lever a passive tracker structurally cannot pull.
- **Closes the loop to action.** Deficits automatically become a corrective plan and a grocery list — the user's *next* step is handed to them, not left as homework.
- **Demonstrates a reusable pattern.** "Wrap an existing app's features as a tool registry, put a persona-driven ReAct loop with guardrails on top, add memory" generalizes far beyond nutrition — it's the template for making any reactive CRUD app agentic.
- **Reproducible and safe to evaluate.** The entire capstone runs offline and deterministically (`python demo_simulation.py`), so graders see identical output every time with zero setup or API cost.

---

## Run it

```bash
# From the repo root. No API key needed — runs on the deterministic mock backend.
python demo_simulation.py            # full narrated 4-scenario proof run
python demo_simulation.py --quiet    # verdicts only

# Drive the agent directly:
python agent_runtime.py "Review my week and optimize my shopping list for muscle recovery"
python agent_runtime.py "Should I eat this?" --image public/samples/burger.jpg
python agent_runtime.py --seed       # (re)seed the 7-day demo history

# Run identically against live Gemini instead of mock:
export GEMINI_API_KEY=...            # (Windows: set GEMINI_API_KEY=...)
python agent_runtime.py "Audit my week"
```

### Demo run summary (mock backend, fully reproducible)

| Scenario | Input | Verdict |
|---|---|---|
| Autonomous weekly audit | *(no image, no ask)* | `PROACTIVE_PLAN` — protein −82 g/day, quality 5.8 → 3.3, grocery list generated |
| Imbalanced meal | `burger.jpg` vs declining week | `BLOCK` — withheld with contextual reason |
| Healthy meal | `salad.jpg` | `APPROVE` — 9/10, logged |
| Non-food image | invalid/receipt image | `BLOCK` — rejected before any data fabricated |

---

## Repository layout (agent layer)

```
nutrisnap/
├── agent_runtime.py          # entry point: WellnessAgent ReAct loop + persona + CLI
├── demo_simulation.py        # narrated 4-scenario proof run (this submission's media)
├── KAGGLE_SUBMISSION.md       # this document
└── agent/
    ├── tools.py              # LLM-callable tool registry (ADK-style declarations)
    ├── guardrails.py         # input / output / loop safety guards
    ├── memory.py             # short-term scratchpad + long-term profile state
    ├── llm_client.py         # Gemini client (retry+fallback) + deterministic MockLLM
    └── data_store.py         # JSON bridge to the app's localStorage schema + demo seed
```
