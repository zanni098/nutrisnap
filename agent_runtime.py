"""NutriSnap Wellness Agent runtime — the Proactive Wellness Critic.

Entry point for the autonomous agent layer built on top of NutriSnap.
Runs a ReAct (Reason -> Act -> Observe) loop in which a persona-driven
LLM invokes the registered tools (vision parsing, diary reads, trajectory
math, plan generation) and terminates with a structured JSON intervention.

Backends:
    live  — Gemini via google-genai when GEMINI_API_KEY / GOOGLE_API_KEY is set
    mock  — deterministic offline policy (no key, no network) for demos

Usage:
    python agent_runtime.py "Review my week and optimize my shopping list"
    python agent_runtime.py "Should I eat this?" --image public/samples/burger.jpg
    python agent_runtime.py --seed   # (re)seed the 7-day demo history
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from agent import data_store, guardrails, llm_client
from agent.memory import LongTermProfile, ShortTermMemory
from agent.tools import execute_tool, tool_declarations

PERSONA_PROMPT = """You are the Proactive Wellness Critic — an autonomous nutrition
auditor embedded in the NutriSnap food-logging app. You are rigorous, evidence-first,
and constructively blunt.

Operating rules:
1. NEVER judge a meal or issue advice before reading the user's historical logs
   (fetch_logged_macros) and quantifying their trajectory (calculate_trajectory).
2. If a new meal image is provided, analyze it with parse_food_image and weigh it
   against the weekly trajectory, not in isolation.
3. Intervene proactively: flag macro deficits (>15% under goal), calorie surpluses,
   and declining health-score trends even when the user did not ask.
4. BLOCK a meal only when it is clearly harmful in context (healthScore <= {low_score}
   AND it worsens an already-negative trajectory, or it consumes more than
   {budget_pct:.0%} of the remaining daily calorie budget). Otherwise WARN or APPROVE.
5. Non-food images must be rejected outright — never fabricate nutrition data.
6. Every run ends with ONE structured JSON intervention. No free-form essays.

Long-term memory about this user:
{memory_block}

Available tools:
{tools_block}

Respond with JSON only. On each turn either:
  {{"thought": "...", "action": "<tool name>", "action_input": {{...}}}}
or, when you have enough evidence:
  {{"thought": "...", "final": true}}
"""

INTERVENTION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "verdict": {"type": "STRING",
                    "enum": ["APPROVE", "WARN", "BLOCK", "PROACTIVE_PLAN"]},
        "reasoning": {"type": "STRING"},
        "mealAssessment": {"type": "STRING"},
        "deficits": {"type": "ARRAY", "items": {"type": "STRING"}},
        "correctiveActions": {"type": "ARRAY", "items": {"type": "STRING"}},
        "groceryList": {"type": "ARRAY", "items": {"type": "STRING"}},
        "nextCheckin": {"type": "STRING"},
    },
    "required": ["verdict", "reasoning", "deficits", "correctiveActions",
                 "groceryList", "nextCheckin"],
}


class WellnessAgent:
    """Persona-driven ReAct agent over the NutriSnap tool registry."""

    def __init__(self, verbose: bool = True) -> None:
        self.verbose = verbose
        self.long_term = LongTermProfile()
        self.mode = "live" if llm_client.live_available() else "mock"
        self._gemini = llm_client.GeminiClient() if self.mode == "live" else None
        self._mock = llm_client.MockLLM() if self.mode == "mock" else None

    # ------------------------------------------------------------------ io
    def _say(self, label: str, text: str) -> None:
        if self.verbose:
            print(f"  [{label}] {text}")

    def _system_prompt(self) -> str:
        tools = "\n".join(f"- {t['name']}: {t['description']}"
                          for t in tool_declarations())
        return PERSONA_PROMPT.format(
            low_score=guardrails.LOW_HEALTH_SCORE,
            budget_pct=guardrails.CALORIE_BUDGET_BLOCK_PCT,
            memory_block=self.long_term.context_block(),
            tools_block=tools,
        )

    # ------------------------------------------------------------ react core
    def _next_step(self, goal: str, memory: ShortTermMemory,
                   image_path: str | None) -> dict[str, Any]:
        if self.mode == "mock":
            return self._mock.next_step(goal, memory.as_transcript(), image_path)
        prompt = (f"GOAL: {goal}\n"
                  f"PENDING IMAGE: {image_path or 'none'}\n\n"
                  f"Scratchpad so far:\n{memory.as_transcript() or '(empty)'}\n\n"
                  "Return your next ReAct step as JSON.")
        raw = self._gemini.generate_json(self._system_prompt(), [prompt])
        return llm_client.parse_react_json(raw)

    def run(self, goal: str, image_path: str | None = None) -> dict[str, Any]:
        """Execute one full agent episode; returns the structured intervention."""
        memory = ShortTermMemory()
        observations: dict[str, Any] = {}
        print(f"\n=== Wellness Agent run ({self.mode} mode) ===")
        print(f"GOAL: {goal}" + (f"  |  IMAGE: {image_path}" if image_path else ""))

        for iteration in range(guardrails.MAX_REACT_ITERATIONS):
            step = self._next_step(goal, memory, image_path)
            self._say("thought", step.get("thought", ""))
            memory.add("thought", step.get("thought", ""))

            if step.get("final"):
                intervention = self._final_intervention(goal, memory, observations)
                self._record(intervention, observations)
                return intervention

            action = step.get("action", "")
            arguments = step.get("action_input") or {}
            self._say("action", f"{action}({json.dumps(arguments)})")
            try:
                result = execute_tool(action, arguments)
            except guardrails.GuardrailViolation as violation:
                # A tripped guardrail is itself a terminal intervention.
                intervention = self._blocked_by_guardrail(str(violation))
                self._record(intervention, observations)
                return intervention

            observations[action] = result
            memory.add("action", {"tool": action, "input": arguments})
            memory.add("observation", result)
            self._say("observation", json.dumps(result, default=str)[:220] + " ...")

        intervention = self._final_intervention(goal, memory, observations)
        intervention["reasoning"] += " (iteration budget reached)"
        self._record(intervention, observations)
        return intervention

    # ------------------------------------------------------------- verdicts
    def _final_intervention(self, goal: str, memory: ShortTermMemory,
                            observations: dict[str, Any]) -> dict[str, Any]:
        if self.mode == "live":
            prompt = (f"GOAL: {goal}\n\nFull scratchpad:\n{memory.as_transcript()}\n\n"
                      "Issue the final structured intervention now.")
            return self._gemini.generate_json(self._system_prompt(), [prompt],
                                              response_schema=INTERVENTION_SCHEMA)
        return self._deterministic_intervention(observations)

    def _deterministic_intervention(self, obs: dict[str, Any]) -> dict[str, Any]:
        """Mock-mode verdict: same decision thresholds the persona prompt encodes."""
        trajectory = obs.get("calculate_trajectory", {})
        plan = obs.get("generate_wellness_plan", {})
        analysis = obs.get("parse_food_image")

        deficits = trajectory.get("deficits", [])
        declining = trajectory.get("healthScoreTrend", {}).get("declining", False)
        verdict, assessment = "PROACTIVE_PLAN", ""

        if analysis is not None:
            if analysis.get("isNonFood"):
                verdict = "BLOCK"
                assessment = "Image rejected: no food detected. Nothing was logged."
            elif (analysis["healthScore"] <= guardrails.LOW_HEALTH_SCORE and declining):
                verdict = "BLOCK"
                assessment = (f"'{analysis['title']}' scores {analysis['healthScore']}/10 "
                              f"({analysis['calories']} kcal) while your health trend is "
                              "already declining — logging it was withheld.")
            elif analysis["healthScore"] <= guardrails.LOW_HEALTH_SCORE:
                verdict = "WARN"
                assessment = (f"'{analysis['title']}' is a low-quality choice "
                              f"({analysis['healthScore']}/10); logged with a warning.")
            else:
                verdict = "APPROVE"
                assessment = (f"'{analysis['title']}' fits your goals "
                              f"({analysis['healthScore']}/10) — approved and logged.")

        deltas = trajectory.get("deltasVsGoals", {})
        reason_parts = []
        if deficits:
            gaps = ", ".join(f"{d} ({deltas.get(d, 0):+d}g/day vs goal)" for d in deficits)
            reason_parts.append(f"7-day audit shows sustained deficits: {gaps}.")
        if declining:
            trend = trajectory["healthScoreTrend"]
            reason_parts.append(f"Meal quality is declining (avg health score "
                                f"{trend['earlyAvg']} -> {trend['lateAvg']}).")
        if deltas.get("calories", 0) > 0:
            reason_parts.append(f"Calories average {deltas['calories']:+d}/day over goal.")
        if not reason_parts:
            reason_parts.append("Weekly trajectory is within targets.")

        return {
            "verdict": verdict,
            "reasoning": " ".join(reason_parts),
            "mealAssessment": assessment,
            "deficits": deficits,
            "correctiveActions": plan.get("correctiveActions", []),
            "groceryList": plan.get("groceryList", []),
            "nextCheckin": "Tomorrow after dinner — I will re-audit the trajectory.",
        }

    def _blocked_by_guardrail(self, reason: str) -> dict[str, Any]:
        return {
            "verdict": "BLOCK",
            "reasoning": f"Runtime guardrail tripped: {reason}",
            "mealAssessment": "Input rejected before any nutrition data was produced.",
            "deficits": [],
            "correctiveActions": ["Resubmit a clear photo of an actual meal."],
            "groceryList": [],
            "nextCheckin": "Immediately after a valid submission.",
        }

    def _record(self, intervention: dict[str, Any], obs: dict[str, Any]) -> None:
        """Persist trend + verdict into long-term memory for future runs."""
        trajectory = obs.get("calculate_trajectory", {})
        if trajectory.get("deficits"):
            self.long_term.record_trend(
                "Deficits observed: " + ", ".join(trajectory["deficits"]))
        self.long_term.record_intervention(
            intervention["verdict"], intervention["reasoning"][:160])


def print_intervention(intervention: dict[str, Any]) -> None:
    print("\n--- STRUCTURED INTERVENTION ---")
    print(json.dumps(intervention, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NutriSnap Proactive Wellness Critic")
    parser.add_argument("goal", nargs="?",
                        default="Audit my week and correct my trajectory.")
    parser.add_argument("--image", help="Path to a new meal photo to evaluate")
    parser.add_argument("--seed", action="store_true",
                        help="Force-reseed the 7-day demo history")
    parser.add_argument("--quiet", action="store_true", help="Hide ReAct trace")
    args = parser.parse_args(argv)

    written = data_store.seed_demo_history(force=args.seed)
    if written:
        print(f"Seeded {written} demo meal entries.")

    agent = WellnessAgent(verbose=not args.quiet)
    intervention = agent.run(args.goal, image_path=args.image)
    print_intervention(intervention)
    return 0


if __name__ == "__main__":
    sys.exit(main())
