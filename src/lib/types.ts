export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface Macros {
  protein: number; // grams
  carbs: number; // grams
  fat: number; // grams
}

/** A single recognized food item within a photo. */
export interface FoodItem {
  name: string;
  quantity: string; // e.g. "1 cup", "120 g", "2 slices"
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Raw result returned by the AI vision model. */
export interface AnalysisResult {
  title: string; // short name for the whole meal
  description: string;
  items: FoodItem[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  healthScore: number; // 1-10
  confidence: number; // 0-1
  notes: string; // short insight / tip
}

/** A meal saved to the diary. */
export interface MealEntry extends AnalysisResult {
  id: string;
  createdAt: string; // ISO timestamp
  mealType: MealType;
  servings: number; // multiplier applied to the base analysis
  imageUrl?: string; // data URL thumbnail
}

export interface Goals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Profile {
  name: string;
  goals: Goals;
}
