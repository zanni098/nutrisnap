"""Agent memory: short-term ReAct scratchpad + long-term profile state.

Short-term memory is the working context of one agent run (thoughts,
tool calls, observations). Long-term memory persists across runs in
``agent/data/agent.profile_state.v1.json`` and accumulates dietary
trends, user preferences, and past interventions — so the user never
has to re-state them.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

STATE_FILE = Path(__file__).parent / "data" / "agent.profile_state.v1.json"

_DEFAULT_STATE: dict[str, Any] = {
    "preferences": [],          # e.g. "no pork", "training for muscle recovery"
    "observed_trends": [],      # agent-written trend notes with timestamps
    "interventions": [],        # past verdicts, so the agent stays consistent
}


class ShortTermMemory:
    """Ordered scratchpad for a single ReAct run."""

    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []

    def add(self, kind: str, content: Any) -> None:
        self.steps.append({"kind": kind, "content": content})

    def as_transcript(self) -> str:
        """Render the scratchpad the way the LLM sees it on each iteration."""
        lines = []
        for step in self.steps:
            content = step["content"]
            if not isinstance(content, str):
                content = json.dumps(content, default=str)
            lines.append(f"{step['kind'].upper()}: {content}")
        return "\n".join(lines)


class LongTermProfile:
    """Persistent cross-session state, loaded fresh and saved after mutation."""

    def __init__(self, path: Path = STATE_FILE) -> None:
        self.path = path
        self.state = self._load()

    def _load(self) -> dict[str, Any]:
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                return {**_DEFAULT_STATE, **loaded}
            except (json.JSONDecodeError, OSError):
                pass
        return {key: list(value) for key, value in _DEFAULT_STATE.items()}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.state, indent=2), encoding="utf-8")

    def _stamped(self, note: str) -> dict[str, str]:
        return {"at": datetime.now().isoformat(timespec="seconds"), "note": note}

    def add_preference(self, preference: str) -> None:
        if preference not in self.state["preferences"]:
            self.state = {**self.state,
                          "preferences": [*self.state["preferences"], preference]}
            self._save()

    def record_trend(self, note: str) -> None:
        self.state = {**self.state,
                      "observed_trends": [*self.state["observed_trends"][-19:],
                                          self._stamped(note)]}
        self._save()

    def record_intervention(self, verdict: str, summary: str) -> None:
        entry = {**self._stamped(summary), "verdict": verdict}
        self.state = {**self.state,
                      "interventions": [*self.state["interventions"][-19:], entry]}
        self._save()

    def context_block(self) -> str:
        """Compact long-term context injected into the system prompt."""
        prefs = "; ".join(self.state["preferences"]) or "none recorded"
        trends = "; ".join(t["note"] for t in self.state["observed_trends"][-3:]) or "none yet"
        past = "; ".join(f"[{i['verdict']}] {i['note']}"
                         for i in self.state["interventions"][-3:]) or "none yet"
        return (f"Known user preferences: {prefs}\n"
                f"Recent observed trends: {trends}\n"
                f"Recent interventions: {past}")
