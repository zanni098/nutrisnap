"""demo_simulation.py — narrated proof run for the NutriSnap Wellness Agent.

A self-contained, offline (mock-mode) demonstration that drives the SAME
``WellnessAgent`` shipped in ``agent_runtime.py`` through four scenarios that
together prove the capstone thesis: the agent is *autonomous and proactive*,
not a passive photo->macros endpoint.

    1. PROACTIVE AUDIT   — no prompt, no image. The agent reads the week,
                           reflects on deficits, and self-generates a
                           corrective plan + grocery list.
    2. INTERVENTION      — an imbalanced meal (cheeseburger) is submitted
                           against an already-declining week. The agent
                           BLOCKS it and course-corrects.
    3. APPROVAL          — a genuinely good meal (salad) is APPROVED, proving
                           the critic is evidence-based, not reflexively harsh.
    4. GUARDRAIL         — a non-food image is rejected before any nutrition
                           data is fabricated (course safety module).

Run:
    python demo_simulation.py            # full narrated run
    python demo_simulation.py --quiet    # verdicts only (no ReAct trace)

No API key required — everything runs on the deterministic mock backend, so
the output is stable and safe to screen-record for the Kaggle writeup. Set
GEMINI_API_KEY to run the identical flow against live Gemini instead.
"""

from __future__ import annotations

import argparse
import base64
import json
import tempfile
from pathlib import Path
from typing import Any

from agent import data_store, llm_client
from agent_runtime import WellnessAgent, print_intervention

SAMPLES = Path(__file__).parent / "public" / "samples"

# A valid 1x1 PNG whose filename matches no food keyword -> the vision tool
# returns the "no food detected" sentinel, exercising the semantic guardrail.
_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9"
    "QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _banner(index: int, title: str, subtitle: str) -> None:
    print("\n" + "=" * 74)
    print(f"  SCENARIO {index} — {title}")
    print(f"  {subtitle}")
    print("=" * 74)


def _run(agent: WellnessAgent, goal: str, image_path: str | None,
         show_full: bool) -> dict[str, Any]:
    """Execute one scenario and surface the verdict for the summary table."""
    intervention = agent.run(goal, image_path=image_path)
    if show_full:
        print_intervention(intervention)
    else:
        print(f"  -> VERDICT: {intervention['verdict']}")
        # mealAssessment carries the meal-specific block/approve rationale;
        # fall back to the weekly reasoning for the no-image audit scenario.
        print(f"     {intervention.get('mealAssessment') or intervention['reasoning']}")
    return intervention


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NutriSnap Wellness Agent demo")
    parser.add_argument("--quiet", action="store_true",
                        help="Hide the ReAct reasoning trace")
    args = parser.parse_args(argv)
    verbose = not args.quiet

    mode = "live (Gemini)" if llm_client.live_available() else "mock (offline)"
    print("\n" + "#" * 74)
    print("#  NutriSnap — Proactive Wellness Critic :: DEMO SIMULATION")
    print(f"#  Backend: {mode}")
    print("#" * 74)

    # Deterministic starting point: a week where protein chronically undershoots
    # the goal and meal quality visibly declines day over day.
    written = data_store.seed_demo_history(force=True)
    print(f"\nSeeded a fixed {written}-meal demo week "
          "(protein deficit + declining health scores).")

    results: list[tuple[str, dict[str, Any]]] = []

    # --- 1. Proactive, unprompted trajectory correction ---------------------
    _banner(1, "AUTONOMOUS WEEKLY AUDIT",
            "No image, no specific ask. The agent reflects on history on its own.")
    agent = WellnessAgent(verbose=verbose)
    audit = _run(agent, "Review my week and optimize my shopping list for "
                        "muscle recovery.", None, show_full=verbose)
    results.append(("Autonomous weekly audit", audit))

    # --- 2. Autonomous interception of an unhealthy choice ------------------
    _banner(2, "INTERVENTION — BLOCK AN UNHEALTHY CHOICE",
            "A cheeseburger is submitted while the week is already trending down.")
    burger = SAMPLES / "burger.jpg"
    block = _run(WellnessAgent(verbose=verbose),
                 "I'm about to log this cheeseburger — good idea?",
                 str(burger), show_full=verbose)
    results.append(("Imbalanced meal (burger)", block))

    # --- 3. Evidence-based approval (not reflexively negative) --------------
    _banner(3, "APPROVAL — A GOOD CHOICE IS ENDORSED",
            "The same critic APPROVES a genuinely balanced meal.")
    salad = SAMPLES / "salad.jpg"
    approve = _run(WellnessAgent(verbose=verbose),
                   "Logging a grilled chicken salad — thoughts?",
                   str(salad), show_full=verbose)
    results.append(("Healthy meal (salad)", approve))

    # --- 4. Safety guardrail: reject non-food before fabricating data -------
    _banner(4, "GUARDRAIL — REJECT NON-FOOD INPUT",
            "A non-food image must be refused before any nutrition data exists.")
    non_food = Path(tempfile.gettempdir()) / "nutrisnap_demo_receipt.png"
    non_food.write_bytes(_TINY_PNG)
    guardrail = _run(WellnessAgent(verbose=verbose),
                     "Analyze this photo and log it.",
                     str(non_food), show_full=verbose)
    results.append(("Non-food image", guardrail))
    non_food.unlink(missing_ok=True)

    # --- Summary table for the writeup screenshot ---------------------------
    print("\n" + "=" * 74)
    print("  RUN SUMMARY")
    print("=" * 74)
    for name, res in results:
        print(f"  {name:<28} -> {res['verdict']}")
    print("=" * 74)
    print("\nTakeaway: one persona-driven ReAct agent, reading real logs through")
    print("its tool registry, autonomously PLANS, BLOCKS, APPROVES, and REFUSES —")
    print("without the user having to ask for any of it.\n")

    # Machine-readable artifact for the writeup / further analysis.
    out = Path(__file__).parent / "demo_run_output.json"
    out.write_text(json.dumps(
        {"backend": mode,
         "scenarios": [{"name": n, "intervention": r} for n, r in results]},
        indent=2), encoding="utf-8")
    print(f"Structured transcript written to {out.name}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
