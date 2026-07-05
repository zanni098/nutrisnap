"""LLM client: Gemini (Google AI Studio) primary, deterministic mock fallback.

Live mode mirrors the app's own reliability layer in src/lib/gemini.ts:
the same model fallback chain, retry-with-backoff on transient errors,
and JSON-schema-constrained responses.

Mock mode needs no API key or network. It produces deterministic,
schema-valid ReAct steps so the demo always runs — the mock only decides
WHICH tool to call next; all nutrition numbers still come from the real
tool implementations.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]
MAX_ATTEMPTS = 3
_RETRYABLE = re.compile(r"\b(429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded)\b", re.I)


def api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def live_available() -> bool:
    if not api_key():
        return False
    try:
        import google.genai  # noqa: F401
        return True
    except ImportError:
        return False


class GeminiClient:
    """Thin wrapper over google-genai with retry + model fallback."""

    def __init__(self) -> None:
        from google import genai
        self._client = genai.Client(api_key=api_key())

    def generate_json(self, system: str, user_parts: list[Any],
                      response_schema: dict[str, Any] | None = None) -> dict[str, Any]:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=response_schema,
            temperature=0.3,
        )
        last_error: Exception | None = None
        for model in MODELS:
            for attempt in range(MAX_ATTEMPTS):
                try:
                    response = self._client.models.generate_content(
                        model=model, contents=user_parts, config=config)
                    if not response.text:
                        raise RuntimeError("Model returned an empty response.")
                    return json.loads(response.text)
                except Exception as err:  # noqa: BLE001 — classified below
                    last_error = err
                    if not _RETRYABLE.search(str(err)):
                        raise
                    if attempt < MAX_ATTEMPTS - 1:
                        time.sleep(0.4 * 2 ** attempt)
        raise last_error or RuntimeError("All Gemini models were unavailable.")


class MockLLM:
    """Deterministic ReAct policy used when no API key / SDK is available.

    Implements the Proactive Wellness Critic decision procedure as a fixed
    script over the observations gathered so far: fetch logs -> compute
    trajectory -> (optionally analyze a new image) -> emit the intervention.
    """

    def next_step(self, goal: str, transcript: str,
                  pending_image: str | None) -> dict[str, Any]:
        seen = transcript  # observations accumulated so far

        if "fetch_logged_macros" not in seen:
            return {
                "thought": "I need historical evidence before judging anything. "
                           "Pulling the last 7 days of logged meals first.",
                "action": "fetch_logged_macros",
                "action_input": {"days": 7},
            }
        if "calculate_trajectory" not in seen:
            return {
                "thought": "Logs retrieved. Now I will quantify the gap between "
                           "actual intake and the user's goals to find deficits.",
                "action": "calculate_trajectory",
                "action_input": {"days": 7},
            }
        if pending_image and "parse_food_image" not in seen:
            return {
                "thought": "A new meal photo was submitted. I will run the vision "
                           "tool and judge it against the weekly trajectory.",
                "action": "parse_food_image",
                "action_input": {"image_path": pending_image},
            }
        if "generate_wellness_plan" not in seen:
            return {
                "thought": "I have the trajectory data. Time to draft a corrective "
                           "plan and grocery list that closes the identified gaps.",
                "action": "generate_wellness_plan",
                "action_input": {"focus": goal},
            }
        return {
            "thought": "All evidence gathered — issuing the final structured "
                       "intervention.",
            "final": True,
        }


def parse_react_json(raw: str | dict[str, Any]) -> dict[str, Any]:
    """Coerce an LLM ReAct step into a dict, tolerating fenced JSON."""
    if isinstance(raw, dict):
        return raw
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    return json.loads(text)
