# NutriSnap Wellness Agent — 5-Minute Demo Video Script

**Target: ≤ 5:00 · Public on YouTube · Attach to Kaggle Media Gallery**
Rubric this video scores against: *YouTube Video (10 pts)* + carries *Antigravity / Deployability / Security* concept evidence.

> Format: screen recording with voiceover. Keep each beat tight — aim for the
> timestamps below. Record at 1080p. Put the strongest moment (the BLOCK) before
> the 3-minute mark in case a judge stops early.

---

### 0:00 – 0:30 · Hook + Problem
**Show:** the live app (`nutrisnap-mocha-psi.vercel.app`) on a phone frame; snap a sample meal → macros appear.
**Say:**
> "This is NutriSnap — snap a meal, get calories and macros. But a tracker like this is *passive*: it hands you numbers and stops. Nobody's watching whether you're actually on track, and nobody stops a bad choice before you make it. So I built an autonomous agent layer on top of it — a **Proactive Wellness Critic**."

### 0:30 – 1:15 · Solution + Architecture (the "what")
**Show:** a simple architecture slide — `LLM (Gemini / mock)` → `ReAct loop` → `Tool Registry` → `[parse_food_image · fetch_logged_macros · calculate_trajectory · generate_wellness_plan · log_meal]`, with `Guardrails` wrapping the tools and `Memory` beside the loop.
**Say:**
> "The agent treats NutriSnap's own features as **tools**. It runs a ReAct loop under a strict persona: never judge a meal before reading the user's history. It has short-term memory for the reasoning trace and long-term memory for dietary trends — so the user never re-enters context."

### 1:15 – 2:30 · Live Demo #1 — Autonomous intervention (THE MONEY SHOT)
**Show:** terminal running `python demo_simulation.py`. Let Scenario 1 (weekly audit → `PROACTIVE_PLAN`) scroll, then focus on **Scenario 2**: submitting the cheeseburger.
**Say:**
> "No prompt, no question — the agent reads my week on its own, sees protein running 82 grams a day under goal and meal quality declining, and generates a corrective plan plus a grocery list. Now watch this: I try to log a cheeseburger. The agent reads the trajectory, sees I'm already trending down, and **BLOCKS it** — it refuses to log the meal and tells me why. A passive tracker would have just recorded it."
**Show:** the `"verdict": "BLOCK"` JSON + the reasoning line on screen.

### 2:30 – 3:15 · Live Demo #2 — Fairness + Security guardrails
**Show:** Scenario 3 (salad → `APPROVE`) then Scenario 4 (non-food image → `BLOCK`).
**Say:**
> "It's not reflexively harsh — the same critic **approves** a genuine salad, because the decision comes from data, not a bias. And it's safe: feed it a non-food image and the **guardrails reject it before any nutrition data is fabricated**. Input guards, output clamping, a tool whitelist, and an iteration budget bound what the agent can do."

### 3:15 – 4:00 · MCP + Skills + Deployability (concept coverage)
**Show:** run `python -m agent.mcp_server` (or show `agent/mcp_server.py` + the tool list); then cut back to the deployed Vercel app.
**Say:**
> "The same tools are also published as an **MCP server**, so any MCP client — Claude Desktop, the Agents CLI, Gemini — can call NutriSnap's tools directly. The underlying product is already **deployed** on Vercel, and the whole agent runs locally with a single command."

### 4:00 – 4:40 · Impact + Track
**Show:** the run-summary table (`PROACTIVE_PLAN / BLOCK / APPROVE / BLOCK`).
**Say:**
> "This is an **Agents for Good** submission. It turns a wall of numbers into an agent that plans, intervenes at the decision moment, and hands you the next step — the exact behavior-change loop a passive tracker can't provide. One persona-driven agent that plans, blocks, approves, and refuses — without ever being asked."

### 4:40 – 5:00 · Close
**Show:** GitHub repo + live-demo URL on screen.
**Say:**
> "Code, writeup, and live demo are linked below. Thanks for watching."

---

## Shot list / assets to capture
- [ ] Phone-frame clip of the live app analyzing a sample meal (cover-image candidate).
- [ ] Architecture slide (one image — reuse in the Media Gallery).
- [ ] Terminal recording of `python demo_simulation.py` (full, clean run).
- [ ] Terminal recording of `python -m agent.mcp_server` tool list.
- [ ] End card with repo URL + live URL.

## Concept-coverage checklist (say/show at least 3 — this script hits 5)
- [x] Agent / ReAct loop (Demo #1)
- [x] Security features / guardrails (Demo #2)
- [x] MCP Server (3:15 beat)
- [x] Agent skills / tool registry + CLI (throughout)
- [x] Deployability (Vercel, 3:15 beat)
