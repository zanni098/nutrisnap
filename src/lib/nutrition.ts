import type { Goals, MealEntry, MealType } from "./types";

export const DEFAULT_GOALS: Goals = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 67,
};

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export interface DayTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Local YYYY-MM-DD key for a date (used to bucket meals into days). */
export function dayKey(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function scaled(entry: MealEntry): DayTotals {
  const s = entry.servings || 1;
  return {
    calories: Math.round(entry.calories * s),
    protein: Math.round(entry.protein * s),
    carbs: Math.round(entry.carbs * s),
    fat: Math.round(entry.fat * s),
  };
}

export function sumTotals(entries: MealEntry[]): DayTotals {
  return entries.reduce<DayTotals>(
    (acc, e) => {
      const s = scaled(e);
      acc.calories += s.calories;
      acc.protein += s.protein;
      acc.carbs += s.carbs;
      acc.fat += s.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Suggest a meal type from the current time of day. */
export function guessMealType(date = new Date()): MealType {
  const h = date.getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 18) return "snack";
  return "dinner";
}

export function macroCalories(protein: number, carbs: number, fat: number) {
  return {
    protein: protein * 4,
    carbs: carbs * 4,
    fat: fat * 9,
  };
}

export interface MifflinInput {
  sex: "male" | "female";
  age: number;
  heightCm: number;
  weightKg: number;
  activity: number; // multiplier
  goal: "lose" | "maintain" | "gain";
}

/** Mifflin-St Jeor TDEE + a sensible macro split. */
export function computeGoals(input: MifflinInput): Goals {
  const { sex, age, heightCm, weightKg, activity, goal } = input;
  const bmr =
    10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
  let calories = bmr * activity;
  if (goal === "lose") calories -= 500;
  if (goal === "gain") calories += 350;
  calories = Math.round(calories / 10) * 10;

  // protein 1.8 g/kg, fat 25% of calories, carbs fill the rest.
  const protein = Math.round(weightKg * 1.8);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.round((calories - protein * 4 - fat * 9) / 4);

  return {
    calories,
    protein,
    carbs: Math.max(carbs, 0),
    fat,
  };
}

export const ACTIVITY_LEVELS = [
  { label: "Sedentary", value: 1.2, hint: "Little or no exercise" },
  { label: "Light", value: 1.375, hint: "1–3 days/week" },
  { label: "Moderate", value: 1.55, hint: "3–5 days/week" },
  { label: "Active", value: 1.725, hint: "6–7 days/week" },
  { label: "Athlete", value: 1.9, hint: "Hard daily training" },
];
