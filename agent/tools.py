"""Tool registry — NutriSnap features wrapped as LLM-callable tools.

Each tool has a declaration (name / description / JSON-schema parameters,
Google ADK style) and an executable. The ReAct loop may only invoke tools
present in TOOL_REGISTRY (enforced by guardrails.validate_tool_call).

    parse_food_image        vision analysis of a meal photo (Gemini or mock)
    fetch_logged_macros     read the nutrition diary (data bridge)
    calculate_trajectory    quantify intake vs goals over a window
    generate_wellness_plan  corrective plan + grocery list from the trajectory
    log_meal                commit an approved analysis to the diary
"""

from __future__ import annotations

import base64
import mimetypes
from typing import Any, Callable

from . import data_store, guardrails, llm_client

# Vision prompt kept in lockstep with SYSTEM_PROMPT in src/lib/gemini.ts
VISION_SYSTEM_PROMPT = """You are a meticulous nutritionist and food-recognition expert.
Analyze the food in the image and estimate its nutritional content.
- Identify every distinct food and drink item you can see.
- Estimate realistic portion sizes from visual cues (plate size, utensils, packaging).
- Provide per-item calories and macros (protein, carbs, fat in grams), plus accurate totals.
- The totals must equal the sum of the item values.
- healthScore: weigh whole foods, vegetables, lean protein, and fiber positively; ultra-processed, fried, and sugary items negatively.
- confidence: lower it when the image is blurry, partially hidden, or ambiguous.
- notes: a single short, encouraging, practical tip (max ~20 words).
If the image clearly contains no food, return a single item named "No food detected" with all values 0, healthScore 0, and confidence 0."""

VISION_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING"},
        "description": {"type": "STRING"},
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "quantity": {"type": "STRING"},
                    "calories": {"type": "NUMBER"},
                    "protein": {"type": "NUMBER"},
                    "carbs": {"type": "NUMBER"},
                    "fat": {"type": "NUMBER"},
                },
                "required": ["name", "quantity", "calories", "protein", "carbs", "fat"],
            },
        },
        "calories": {"type": "NUMBER"},
        "protein": {"type": "NUMBER"},
        "carbs": {"type": "NUMBER"},
        "fat": {"type": "NUMBER"},
        "healthScore": {"type": "NUMBER"},
        "confidence": {"type": "NUMBER"},
        "notes": {"type": "STRING"},
    },
    "required": ["title", "description", "items", "calories", "protein",
                 "carbs", "fat", "healthScore", "confidence", "notes"],
}

# Deterministic vision results for offline mode, keyed by filename keywords.
_MOCK_VISION = {
    "burger": {"title": "Double Cheeseburger and Fries", "calories": 1150,
               "protein": 38, "carbs": 96, "fat": 62, "healthScore": 2,
               "notes": "Heavy on saturated fat and refined carbs; consider a grilled option."},
    "salad": {"title": "Grilled Chicken Salad", "calories": 470,
              "protein": 41, "carbs": 22, "fat": 24, "healthScore": 9,
              "notes": "Excellent lean protein and fiber balance — great choice."},
    "breakfast": {"title": "Eggs, Toast and Fruit", "calories": 520,
                  "protein": 26, "carbs": 54, "fat": 22, "healthScore": 7,
                  "notes": "Solid start; add Greek yogurt to push protein higher."},
}

_NON_FOOD_RESULT = {
    "title": "No food detected", "description": "The image does not contain food.",
    "items": [{"name": "No food detected", "quantity": "0", "calories": 0,
               "protein": 0, "carbs": 0, "fat": 0}],
    "calories": 0, "protein": 0, "carbs": 0, "fat": 0,
    "healthScore": 0, "confidence": 0.0, "notes": "Please submit a photo of a meal.",
}


def parse_food_image(image_path: str) -> dict[str, Any]:
    """Analyze a meal photo. Same schema and prompt as POST /api/analyze."""
    path = guardrails.check_image_input(image_path)

    if llm_client.live_available():
        data = base64.b64encode(path.read_bytes()).decode()
        mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
        from google.genai import types
        client = llm_client.GeminiClient()
        result = client.generate_json(
            system=VISION_SYSTEM_PROMPT,
            user_parts=[
                "Analyze this meal photo and return the nutrition breakdown.",
                types.Part.from_bytes(data=base64.b64decode(data), mime_type=mime),
            ],
            response_schema=VISION_RESPONSE_SCHEMA,
        )
    else:
        stem = path.stem.lower()
        match = next((v for k, v in _MOCK_VISION.items() if k in stem), None)
        if match is None:
            result = dict(_NON_FOOD_RESULT)
        else:
            result = {
                "description": f"Recognized {match['title']} from the photo.",
                "items": [{"name": match["title"], "quantity": "1 serving",
                           **{k: match[k] for k in ("calories", "protein", "carbs", "fat")}}],
                "confidence": 0.88,
                **match,
            }

    result = guardrails.clamp_analysis(result)
    result["isNonFood"] = guardrails.is_non_food(result)
    return result


def fetch_logged_macros(days: int = 7) -> dict[str, Any]:
    """Read the diary: per-day totals plus a compact meal list."""
    meals = data_store.load_meals()
    by_day = data_store.totals_by_day(meals)
    recent_days = sorted(by_day)[-days:]
    return {
        "profile": data_store.load_profile(),
        "days": {d: by_day[d] for d in recent_days},
        "meals": [
            {"day": data_store.day_key(m["createdAt"]), "mealType": m["mealType"],
             "title": m["title"], **data_store.scaled_totals(m),
             "healthScore": m.get("healthScore", 0)}
            for m in meals if data_store.day_key(m["createdAt"]) in recent_days
        ],
    }


def calculate_trajectory(days: int = 7) -> dict[str, Any]:
    """Quantify average intake vs goals and surface deficits and trends."""
    snapshot = fetch_logged_macros(days)
    goals = snapshot["profile"]["goals"]
    day_totals = list(snapshot["days"].values())
    if not day_totals:
        return {"error": "No logged meals in the selected window."}

    n = len(day_totals)
    averages = {k: round(sum(d[k] for d in day_totals) / n)
                for k in ("calories", "protein", "carbs", "fat")}
    deltas = {k: averages[k] - goals[k] for k in averages}

    scores = [m["healthScore"] for m in snapshot["meals"]]
    half = max(1, len(scores) // 2)
    early, late = scores[:half], scores[half:]
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else 0.0  # noqa: E731

    deficits = [k for k, v in deltas.items() if k != "calories" and v < -0.15 * goals[k]]
    surpluses = [k for k, v in deltas.items() if v > 0.15 * goals[k]]

    return {
        "windowDays": n,
        "goals": goals,
        "dailyAverages": averages,
        "deltasVsGoals": deltas,
        "deficits": deficits,          # macros >15% under goal
        "surpluses": surpluses,        # metrics >15% over goal
        "healthScoreTrend": {"earlyAvg": avg(early), "lateAvg": avg(late),
                             "declining": avg(late) < avg(early)},
    }


# Grocery staples per macro gap, used to assemble the corrective list.
_GROCERY_FOR_DEFICIT = {
    "protein": ["chicken breast", "Greek yogurt", "eggs", "canned tuna",
                "cottage cheese", "lentils", "whey protein"],
    "carbs": ["oats", "brown rice", "sweet potatoes", "bananas", "whole-grain bread"],
    "fat": ["avocados", "olive oil", "almonds", "salmon fillets", "chia seeds"],
}
_ALWAYS_GROCERIES = ["spinach", "broccoli", "mixed berries", "carrots"]


def generate_wellness_plan(focus: str = "general wellness") -> dict[str, Any]:
    """Deterministic corrective plan derived from the current trajectory."""
    trajectory = calculate_trajectory()
    if "error" in trajectory:
        return trajectory

    deficits = trajectory["deficits"]
    groceries = [*_ALWAYS_GROCERIES]
    for macro in deficits:
        groceries.extend(_GROCERY_FOR_DEFICIT.get(macro, []))

    actions = []
    deltas = trajectory["deltasVsGoals"]
    if "protein" in deficits:
        actions.append(f"Add ~{abs(deltas['protein'])}g protein/day: front-load "
                       "30g at breakfast (Greek yogurt or eggs).")
    if deltas["calories"] > 0:
        actions.append(f"Trim ~{deltas['calories']} kcal/day by swapping one "
                       "fried/processed meal for a grilled protein + vegetable plate.")
    if trajectory["healthScoreTrend"]["declining"]:
        actions.append("Health scores are trending down — plan dinners ahead "
                       "for the next 3 days instead of deciding when hungry.")
    if not actions:
        actions.append("Trajectory is on target — maintain current pattern.")

    return {
        "focus": focus,
        "correctiveActions": actions,
        "groceryList": groceries,
        "basedOn": {"deficits": deficits,
                    "deltasVsGoals": deltas,
                    "healthScoreTrend": trajectory["healthScoreTrend"]},
    }


def log_meal(analysis: dict[str, Any], meal_type: str = "lunch",
             servings: float = 1.0) -> dict[str, Any]:
    """Commit an approved analysis to the diary. Refuses non-food results."""
    if guardrails.is_non_food(analysis):
        raise guardrails.GuardrailViolation("Refusing to log a non-food analysis.")
    entry = data_store.save_meal(analysis, meal_type, servings)
    return {"logged": True, "id": entry["id"], "title": entry["title"]}


TOOL_REGISTRY: dict[str, dict[str, Any]] = {
    "parse_food_image": {
        "fn": parse_food_image,
        "description": "Analyze a meal photo and return per-item nutrition, totals, "
                       "healthScore (1-10) and confidence (0-1).",
        "parameters": {"type": "object",
                       "properties": {"image_path": {"type": "string"}},
                       "required": ["image_path"]},
    },
    "fetch_logged_macros": {
        "fn": fetch_logged_macros,
        "description": "Read the user's nutrition diary: per-day macro totals and "
                       "meal list for the last N days, plus profile goals.",
        "parameters": {"type": "object",
                       "properties": {"days": {"type": "integer", "default": 7}},
                       "required": []},
    },
    "calculate_trajectory": {
        "fn": calculate_trajectory,
        "description": "Compare average intake vs goals over N days; returns "
                       "deficits, surpluses and the health-score trend.",
        "parameters": {"type": "object",
                       "properties": {"days": {"type": "integer", "default": 7}},
                       "required": []},
    },
    "generate_wellness_plan": {
        "fn": generate_wellness_plan,
        "description": "Build a corrective action plan and grocery list that "
                       "closes the gaps found in the trajectory.",
        "parameters": {"type": "object",
                       "properties": {"focus": {"type": "string"}},
                       "required": []},
    },
    "log_meal": {
        "fn": log_meal,
        "description": "Commit an approved meal analysis to the diary. Only call "
                       "after deciding the meal should be logged.",
        "parameters": {"type": "object",
                       "properties": {"analysis": {"type": "object"},
                                      "meal_type": {"type": "string"},
                                      "servings": {"type": "number"}},
                       "required": ["analysis"]},
    },
}


def execute_tool(name: str, arguments: dict[str, Any]) -> Any:
    """Guardrail-checked dispatch used by the ReAct loop."""
    guardrails.validate_tool_call(name, TOOL_REGISTRY)
    fn: Callable[..., Any] = TOOL_REGISTRY[name]["fn"]
    return fn(**arguments)


def tool_declarations() -> list[dict[str, Any]]:
    """Registry as declarations for prompt injection / native function calling."""
    return [{"name": name, "description": spec["description"],
             "parameters": spec["parameters"]}
            for name, spec in TOOL_REGISTRY.items()]
