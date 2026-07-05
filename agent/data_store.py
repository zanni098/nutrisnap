"""JSON data bridge mirroring NutriSnap's browser localStorage schema.

The Next.js app persists meals under the localStorage key
``nutrisnap.meals.v1`` and the profile under ``nutrisnap.profile.v1``
(see src/lib/store.ts). A Python process cannot read browser storage,
so this module keeps the same shapes in ``agent/data/*.json`` files.
Exporting localStorage from the browser into these files makes the two
layers fully interchangeable.

Shapes match src/lib/types.ts exactly:
    MealEntry: id, createdAt, mealType, servings, imageUrl?, plus the
               AnalysisResult fields (title, description, items,
               calories, protein, carbs, fat, healthScore, confidence, notes)
    Profile:   name, goals {calories, protein, carbs, fat}
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent / "data"
MEALS_FILE = DATA_DIR / "nutrisnap.meals.v1.json"
PROFILE_FILE = DATA_DIR / "nutrisnap.profile.v1.json"

# Mirrors DEFAULT_GOALS in src/lib/nutrition.ts
DEFAULT_GOALS = {"calories": 2000, "protein": 150, "carbs": 200, "fat": 67}


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return fallback


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def load_meals() -> list[dict[str, Any]]:
    """All logged MealEntry records, oldest first."""
    meals = _read_json(MEALS_FILE, [])
    return sorted(meals, key=lambda m: m.get("createdAt", ""))


def save_meal(analysis: dict[str, Any], meal_type: str, servings: float = 1.0,
              created_at: str | None = None) -> dict[str, Any]:
    """Append a new MealEntry built from an AnalysisResult; returns the entry."""
    entry = {
        **analysis,
        "id": str(uuid.uuid4()),
        "createdAt": created_at or datetime.now().isoformat(timespec="seconds"),
        "mealType": meal_type,
        "servings": servings,
    }
    meals = _read_json(MEALS_FILE, [])
    _write_json(MEALS_FILE, [*meals, entry])
    return entry


def load_profile() -> dict[str, Any]:
    return _read_json(PROFILE_FILE, {"name": "there", "goals": dict(DEFAULT_GOALS)})


def save_profile(profile: dict[str, Any]) -> None:
    _write_json(PROFILE_FILE, profile)


def day_key(iso_timestamp: str) -> str:
    """Local YYYY-MM-DD bucket key — mirrors dayKey() in src/lib/nutrition.ts."""
    return iso_timestamp[:10]


def scaled_totals(entry: dict[str, Any]) -> dict[str, int]:
    """Servings-scaled macros for one entry — mirrors scaled() in nutrition.ts."""
    s = entry.get("servings") or 1
    return {k: round(entry.get(k, 0) * s) for k in ("calories", "protein", "carbs", "fat")}


def totals_by_day(meals: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Aggregate scaled macro totals into per-day buckets."""
    days: dict[str, dict[str, int]] = {}
    for meal in meals:
        key = day_key(meal["createdAt"])
        bucket = days.setdefault(key, {"calories": 0, "protein": 0, "carbs": 0, "fat": 0})
        for macro, value in scaled_totals(meal).items():
            bucket[macro] += value
    return days


# ---------------------------------------------------------------------------
# Demo seed: a realistic week where protein consistently undershoots the goal
# and health scores decline — the trajectory the agent should catch.
# ---------------------------------------------------------------------------

_SEED_WEEK = [
    # (days_ago, meal_type, title, cal, protein, carbs, fat, healthScore)
    (6, "breakfast", "Greek Yogurt Bowl", 380, 28, 42, 11, 8),
    (6, "lunch", "Grilled Chicken Salad", 520, 42, 24, 26, 9),
    (6, "dinner", "Salmon and Rice", 640, 38, 58, 24, 8),
    (5, "breakfast", "Oatmeal with Banana", 410, 12, 74, 8, 7),
    (5, "lunch", "Turkey Sandwich", 560, 30, 52, 22, 6),
    (5, "dinner", "Pasta Alfredo", 820, 22, 88, 38, 4),
    (4, "breakfast", "Bagel with Cream Cheese", 450, 11, 68, 14, 4),
    (4, "lunch", "Cheeseburger and Fries", 980, 34, 82, 52, 3),
    (4, "dinner", "Pepperoni Pizza", 890, 30, 92, 40, 3),
    (3, "breakfast", "Blueberry Muffin", 420, 6, 62, 16, 3),
    (3, "lunch", "Ramen Bowl", 680, 18, 94, 22, 4),
    (3, "dinner", "Fried Chicken Plate", 940, 40, 66, 50, 3),
    (2, "breakfast", "Skipped — Iced Latte Only", 190, 6, 24, 7, 4),
    (2, "lunch", "Burrito Bowl", 720, 32, 78, 28, 6),
    (2, "dinner", "Mac and Cheese", 760, 20, 84, 34, 3),
    (1, "breakfast", "Donut and Coffee", 380, 5, 52, 16, 2),
    (1, "lunch", "Hot Dog Combo", 850, 22, 74, 46, 2),
    (1, "dinner", "Instant Noodles", 520, 12, 76, 18, 3),
]


def seed_demo_history(force: bool = False) -> int:
    """Populate the log with a 7-day demo week; returns entries written.

    Skips silently when data already exists unless ``force`` is set,
    so a real exported log is never clobbered by the demo.
    """
    if MEALS_FILE.exists() and not force:
        return 0

    today = datetime.now().replace(hour=8, minute=0, second=0, microsecond=0)
    hour_for = {"breakfast": 8, "lunch": 13, "dinner": 19, "snack": 16}
    entries = []
    for days_ago, meal_type, title, cal, protein, carbs, fat, score in _SEED_WEEK:
        ts = (today - timedelta(days=days_ago)).replace(hour=hour_for[meal_type])
        entries.append({
            "id": str(uuid.uuid4()),
            "createdAt": ts.isoformat(timespec="seconds"),
            "mealType": meal_type,
            "servings": 1,
            "title": title,
            "description": f"{title} (seeded demo history)",
            "items": [{"name": title, "quantity": "1 serving", "calories": cal,
                       "protein": protein, "carbs": carbs, "fat": fat}],
            "calories": cal,
            "protein": protein,
            "carbs": carbs,
            "fat": fat,
            "healthScore": score,
            "confidence": 0.9,
            "notes": "",
        })
    _write_json(MEALS_FILE, entries)

    if force or not PROFILE_FILE.exists():
        save_profile({"name": "Alex", "goals": dict(DEFAULT_GOALS)})
    return len(entries)
