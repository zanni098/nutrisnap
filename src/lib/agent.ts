/**
 * Browser-side Wellness Agent — a TypeScript port of the Python ReAct agent
 * (see wellness-agent/) so the deployed app can demonstrate the
 * autonomous "Proactive Wellness Critic" live, over the user's real localStorage
 * diary, with no backend.
 *
 * It mirrors the Python deterministic (mock) policy exactly: read the logs,
 * quantify the trajectory, optionally judge a new meal against that trajectory,
 * then emit a single structured intervention (APPROVE / WARN / BLOCK /
 * PROACTIVE_PLAN) plus a corrective plan and grocery list.
 */

import type { AnalysisResult, Goals, MealEntry, MealType } from "./types";
import { DEFAULT_GOALS, dayKey, scaled } from "./nutrition";
import { newId } from "./store";

// Thresholds — kept in lockstep with wellness-agent/agent/guardrails.py
export const LOW_HEALTH_SCORE = 3;

export type Verdict = "APPROVE" | "WARN" | "BLOCK" | "PROACTIVE_PLAN";

export interface Trajectory {
  windowDays: number;
  goals: Goals;
  dailyAverages: Goals;
  deltasVsGoals: Goals;
  deficits: (keyof Goals)[]; // macros >15% under goal
  surpluses: (keyof Goals)[]; // metrics >15% over goal
  healthScoreTrend: { earlyAvg: number; lateAvg: number; declining: boolean };
}

export interface Intervention {
  verdict: Verdict;
  reasoning: string;
  mealAssessment: string;
  deficits: (keyof Goals)[];
  correctiveActions: string[];
  groceryList: string[];
  nextCheckin: string;
}

export interface ReActStep {
  thought: string;
  action?: string;
  observation?: string;
}

export interface AgentResult {
  steps: ReActStep[];
  trajectory: Trajectory | null;
  intervention: Intervention;
}

// --- trajectory -------------------------------------------------------------

const MACROS: (keyof Goals)[] = ["calories", "protein", "carbs", "fat"];

function recentWindow(meals: MealEntry[], days: number): MealEntry[] {
  const keys = Array.from(new Set(meals.map((m) => dayKey(m.createdAt)))).sort();
  const recent = new Set(keys.slice(-days));
  return meals
    .filter((m) => recent.has(dayKey(m.createdAt)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function computeTrajectory(
  meals: MealEntry[],
  goals: Goals,
  days = 7,
): Trajectory | null {
  const windowed = recentWindow(meals, days);
  if (windowed.length === 0) return null;

  const byDay = new Map<string, Goals>();
  for (const m of windowed) {
    const key = dayKey(m.createdAt);
    const bucket = byDay.get(key) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const s = scaled(m);
    byDay.set(key, {
      calories: bucket.calories + s.calories,
      protein: bucket.protein + s.protein,
      carbs: bucket.carbs + s.carbs,
      fat: bucket.fat + s.fat,
    });
  }

  const dayTotals = Array.from(byDay.values());
  const n = dayTotals.length;
  const averages = { calories: 0, protein: 0, carbs: 0, fat: 0 } as Goals;
  for (const key of MACROS) {
    averages[key] = Math.round(
      dayTotals.reduce((sum, d) => sum + d[key], 0) / n,
    );
  }
  const deltas = { calories: 0, protein: 0, carbs: 0, fat: 0 } as Goals;
  for (const key of MACROS) deltas[key] = averages[key] - goals[key];

  const scores = windowed.map((m) => m.healthScore ?? 0);
  const half = Math.max(1, Math.floor(scores.length / 2));
  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0;
  const earlyAvg = avg(scores.slice(0, half));
  const lateAvg = avg(scores.slice(half));

  const deficits = MACROS.filter(
    (k) => k !== "calories" && deltas[k] < -0.15 * goals[k],
  );
  const surpluses = MACROS.filter((k) => deltas[k] > 0.15 * goals[k]);

  return {
    windowDays: n,
    goals,
    dailyAverages: averages,
    deltasVsGoals: deltas,
    deficits,
    surpluses,
    healthScoreTrend: { earlyAvg, lateAvg, declining: lateAvg < earlyAvg },
  };
}

// --- corrective plan (mirrors agent/tools.generate_wellness_plan) -----------

const GROCERY_FOR_DEFICIT: Record<string, string[]> = {
  protein: ["chicken breast", "Greek yogurt", "eggs", "canned tuna", "cottage cheese", "lentils", "whey protein"],
  carbs: ["oats", "brown rice", "sweet potatoes", "bananas", "whole-grain bread"],
  fat: ["avocados", "olive oil", "almonds", "salmon fillets", "chia seeds"],
};
const ALWAYS_GROCERIES = ["spinach", "broccoli", "mixed berries", "carrots"];

function buildPlan(t: Trajectory): { correctiveActions: string[]; groceryList: string[] } {
  const groceries = [...ALWAYS_GROCERIES];
  for (const macro of t.deficits) groceries.push(...(GROCERY_FOR_DEFICIT[macro] ?? []));

  const actions: string[] = [];
  if (t.deficits.includes("protein")) {
    actions.push(
      `Add ~${Math.abs(t.deltasVsGoals.protein)}g protein/day: front-load 30g at breakfast (Greek yogurt or eggs).`,
    );
  }
  if (t.deltasVsGoals.calories > 0) {
    actions.push(
      `Trim ~${t.deltasVsGoals.calories} kcal/day by swapping one fried/processed meal for a grilled protein + vegetable plate.`,
    );
  }
  if (t.healthScoreTrend.declining) {
    actions.push(
      "Health scores are trending down — plan dinners ahead for the next 3 days instead of deciding when hungry.",
    );
  }
  if (actions.length === 0) actions.push("Trajectory is on target — maintain current pattern.");
  return { correctiveActions: actions, groceryList: groceries };
}

// --- sample meals (mirror agent/tools._MOCK_VISION) -------------------------

export interface SampleMeal {
  key: string;
  label: string;
  analysis: AnalysisResult & { isNonFood?: boolean };
}

export const SAMPLE_MEALS: SampleMeal[] = [
  {
    key: "burger",
    label: "🍔 Cheeseburger & fries",
    analysis: {
      title: "Double Cheeseburger and Fries", description: "Recognized from photo.",
      items: [], calories: 1150, protein: 38, carbs: 96, fat: 62,
      healthScore: 2, confidence: 0.88,
      notes: "Heavy on saturated fat and refined carbs.",
    },
  },
  {
    key: "salad",
    label: "🥗 Grilled chicken salad",
    analysis: {
      title: "Grilled Chicken Salad", description: "Recognized from photo.",
      items: [], calories: 470, protein: 41, carbs: 22, fat: 24,
      healthScore: 9, confidence: 0.9,
      notes: "Excellent lean protein and fiber balance.",
    },
  },
  {
    key: "nonfood",
    label: "🧾 Non-food image",
    analysis: {
      title: "No food detected", description: "The image does not contain food.",
      items: [], calories: 0, protein: 0, carbs: 0, fat: 0,
      healthScore: 0, confidence: 0, notes: "Please submit a photo of a meal.",
      isNonFood: true,
    },
  },
];

// --- the agent loop (mirrors agent_runtime._deterministic_intervention) ------

export function runAgent(
  meals: MealEntry[],
  goals: Goals,
  sample?: SampleMeal,
): AgentResult {
  const steps: ReActStep[] = [];
  const trajectory = computeTrajectory(meals, goals);

  steps.push({
    thought: "I need historical evidence before judging anything. Pulling the last 7 days of logged meals first.",
    action: "fetch_logged_macros(days=7)",
    observation: trajectory
      ? `Loaded ${trajectory.windowDays} logged day(s).`
      : "No meals logged in the window.",
  });

  if (!trajectory) {
    return {
      steps,
      trajectory: null,
      intervention: {
        verdict: "PROACTIVE_PLAN",
        reasoning: "No logged meals yet — seed the demo week or log a meal so I can audit your trajectory.",
        mealAssessment: "",
        deficits: [],
        correctiveActions: ["Log at least one day of meals, then re-run the audit."],
        groceryList: [],
        nextCheckin: "As soon as there's data to analyze.",
      },
    };
  }

  const deltas = trajectory.deltasVsGoals;
  steps.push({
    thought: "Logs retrieved. Now I will quantify the gap between actual intake and the user's goals to find deficits.",
    action: "calculate_trajectory(days=7)",
    observation:
      `avg ${trajectory.dailyAverages.calories} kcal/day · ` +
      `protein ${deltas.protein >= 0 ? "+" : ""}${deltas.protein}g vs goal · ` +
      `deficits: ${trajectory.deficits.join(", ") || "none"} · ` +
      `health ${trajectory.healthScoreTrend.earlyAvg} → ${trajectory.healthScoreTrend.lateAvg}`,
  });

  const analysis = sample?.analysis;
  const declining = trajectory.healthScoreTrend.declining;
  let verdict: Verdict = "PROACTIVE_PLAN";
  let assessment = "";

  if (analysis) {
    steps.push({
      thought: "A new meal was submitted. I will judge it against the weekly trajectory, not in isolation.",
      action: `parse_food_image("${sample?.key}")`,
      observation: analysis.isNonFood
        ? "No food detected in the image."
        : `${analysis.title}: ${analysis.calories} kcal, healthScore ${analysis.healthScore}/10.`,
    });

    if (analysis.isNonFood) {
      verdict = "BLOCK";
      assessment = "Image rejected: no food detected. Nothing was logged.";
    } else if (analysis.healthScore <= LOW_HEALTH_SCORE && declining) {
      verdict = "BLOCK";
      assessment = `'${analysis.title}' scores ${analysis.healthScore}/10 (${analysis.calories} kcal) while your health trend is already declining — logging it was withheld.`;
    } else if (analysis.healthScore <= LOW_HEALTH_SCORE) {
      verdict = "WARN";
      assessment = `'${analysis.title}' is a low-quality choice (${analysis.healthScore}/10); logged with a warning.`;
    } else {
      verdict = "APPROVE";
      assessment = `'${analysis.title}' fits your goals (${analysis.healthScore}/10) — approved and logged.`;
    }
  }

  const plan = buildPlan(trajectory);
  steps.push({
    thought: "I have the trajectory data. Time to draft a corrective plan and grocery list that closes the identified gaps.",
    action: "generate_wellness_plan()",
    observation: `${plan.correctiveActions.length} action(s), ${plan.groceryList.length} grocery items.`,
  });
  steps.push({ thought: "All evidence gathered — issuing the final structured intervention." });

  const reasonParts: string[] = [];
  if (trajectory.deficits.length) {
    const gaps = trajectory.deficits
      .map((d) => `${d} (${deltas[d] >= 0 ? "+" : ""}${deltas[d]}g/day vs goal)`)
      .join(", ");
    reasonParts.push(`7-day audit shows sustained deficits: ${gaps}.`);
  }
  if (declining) {
    reasonParts.push(
      `Meal quality is declining (avg health score ${trajectory.healthScoreTrend.earlyAvg} → ${trajectory.healthScoreTrend.lateAvg}).`,
    );
  }
  if (deltas.calories > 0) reasonParts.push(`Calories average +${deltas.calories}/day over goal.`);
  if (reasonParts.length === 0) reasonParts.push("Weekly trajectory is within targets.");

  return {
    steps,
    trajectory,
    intervention: {
      verdict,
      reasoning: reasonParts.join(" "),
      mealAssessment: assessment,
      deficits: trajectory.deficits,
      correctiveActions: plan.correctiveActions,
      groceryList: plan.groceryList,
      nextCheckin: "Tomorrow after dinner — I will re-audit the trajectory.",
    },
  };
}

// --- demo seed (mirror agent/data_store._SEED_WEEK) -------------------------

const SEED_WEEK: [number, MealType, string, number, number, number, number, number][] = [
  [6, "breakfast", "Greek Yogurt Bowl", 380, 28, 42, 11, 8],
  [6, "lunch", "Grilled Chicken Salad", 520, 42, 24, 26, 9],
  [6, "dinner", "Salmon and Rice", 640, 38, 58, 24, 8],
  [5, "breakfast", "Oatmeal with Banana", 410, 12, 74, 8, 7],
  [5, "lunch", "Turkey Sandwich", 560, 30, 52, 22, 6],
  [5, "dinner", "Pasta Alfredo", 820, 22, 88, 38, 4],
  [4, "breakfast", "Bagel with Cream Cheese", 450, 11, 68, 14, 4],
  [4, "lunch", "Cheeseburger and Fries", 980, 34, 82, 52, 3],
  [4, "dinner", "Pepperoni Pizza", 890, 30, 92, 40, 3],
  [3, "breakfast", "Blueberry Muffin", 420, 6, 62, 16, 3],
  [3, "lunch", "Ramen Bowl", 680, 18, 94, 22, 4],
  [3, "dinner", "Fried Chicken Plate", 940, 40, 66, 50, 3],
  [2, "breakfast", "Iced Latte Only", 190, 6, 24, 7, 4],
  [2, "lunch", "Burrito Bowl", 720, 32, 78, 28, 6],
  [2, "dinner", "Mac and Cheese", 760, 20, 84, 34, 3],
  [1, "breakfast", "Donut and Coffee", 380, 5, 52, 16, 2],
  [1, "lunch", "Hot Dog Combo", 850, 22, 74, 46, 2],
  [1, "dinner", "Instant Noodles", 520, 12, 76, 18, 3],
];

const HOUR_FOR: Record<MealType, number> = { breakfast: 8, lunch: 13, dinner: 19, snack: 16 };

/** A declining demo week (protein deficit + falling health scores). */
export function buildDemoWeek(): MealEntry[] {
  return SEED_WEEK.map(([daysAgo, mealType, title, cal, protein, carbs, fat, score]) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(HOUR_FOR[mealType], 0, 0, 0);
    return {
      id: newId(),
      createdAt: d.toISOString(),
      mealType,
      servings: 1,
      title,
      description: `${title} (seeded demo history)`,
      items: [{ name: title, quantity: "1 serving", calories: cal, protein, carbs, fat }],
      calories: cal,
      protein,
      carbs,
      fat,
      healthScore: score,
      confidence: 0.9,
      notes: "",
    };
  });
}
