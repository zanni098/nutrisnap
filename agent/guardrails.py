"""Runtime guardrails for the wellness agent.

Three layers, as covered in the course safety modules:
  1. Input guards   — reject non-food / invalid inputs before any tool runs.
  2. Output guards  — clamp model output to physically plausible ranges.
  3. Loop guards    — bound agent autonomy (iteration budget, tool whitelist).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# Loop guards
MAX_REACT_ITERATIONS = 8

# Output guards: plausible single-meal ranges (1 serving)
MAX_MEAL_CALORIES = 3000
MAX_MEAL_MACRO_GRAMS = 400

# Intervention thresholds used by the persona prompt and mock reasoning
LOW_HEALTH_SCORE = 3          # meals at or below this are flagged
LOW_CONFIDENCE = 0.4          # vision results below this need user confirmation
CALORIE_BUDGET_BLOCK_PCT = 0.60  # meal eating >60% of remaining budget => intervene

ALLOWED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


class GuardrailViolation(Exception):
    """Raised when an input or output fails a safety check."""


def check_image_input(image_path: str) -> Path:
    """Validate an image path before it reaches the vision tool."""
    path = Path(image_path)
    if not path.exists():
        raise GuardrailViolation(f"Image not found: {image_path}")
    if path.suffix.lower() not in ALLOWED_IMAGE_SUFFIXES:
        raise GuardrailViolation(
            f"Unsupported file type '{path.suffix}'. Allowed: {sorted(ALLOWED_IMAGE_SUFFIXES)}"
        )
    if path.stat().st_size == 0:
        raise GuardrailViolation(f"Image file is empty: {image_path}")
    return path


def is_non_food(analysis: dict[str, Any]) -> bool:
    """Detect the sentinel the vision prompt returns for non-food images."""
    items = analysis.get("items") or []
    if analysis.get("confidence", 0) == 0 and analysis.get("healthScore", 0) == 0:
        return True
    return any("no food" in str(item.get("name", "")).lower() for item in items)


def clamp_analysis(analysis: dict[str, Any]) -> dict[str, Any]:
    """Clamp vision output to sane ranges — mirrors normalize() in src/lib/gemini.ts,
    with an additional physical-plausibility ceiling on top."""
    def clamp(value: Any, lo: float, hi: float) -> float:
        try:
            return max(lo, min(hi, float(value)))
        except (TypeError, ValueError):
            return lo

    clamped = dict(analysis)
    clamped["calories"] = round(clamp(analysis.get("calories"), 0, MAX_MEAL_CALORIES))
    for macro in ("protein", "carbs", "fat"):
        clamped[macro] = round(clamp(analysis.get(macro), 0, MAX_MEAL_MACRO_GRAMS))
    clamped["healthScore"] = round(clamp(analysis.get("healthScore"), 0, 10))
    clamped["confidence"] = clamp(analysis.get("confidence"), 0.0, 1.0)
    return clamped


def validate_tool_call(tool_name: str, registry: dict[str, Any]) -> None:
    """Whitelist enforcement: the agent may only invoke registered tools."""
    if tool_name not in registry:
        raise GuardrailViolation(
            f"Tool '{tool_name}' is not in the registry. Allowed: {sorted(registry)}"
        )
