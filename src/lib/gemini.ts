import { GoogleGenAI, Type } from "@google/genai";
import type { AnalysisResult } from "./types";

// Primary model plus fallbacks tried in order when one is overloaded/unavailable.
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
const MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand)\b/i.test(msg);
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return new GoogleGenAI({ apiKey });
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Short name for the overall meal, max 5 words." },
    description: { type: Type.STRING, description: "One concise sentence describing the plate." },
    items: {
      type: Type.ARRAY,
      description: "Each distinct food/drink component on the plate.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          quantity: { type: Type.STRING, description: "Estimated portion, e.g. '1 cup', '120 g', '2 slices'." },
          calories: { type: Type.NUMBER },
          protein: { type: Type.NUMBER, description: "grams" },
          carbs: { type: Type.NUMBER, description: "grams" },
          fat: { type: Type.NUMBER, description: "grams" },
        },
        required: ["name", "quantity", "calories", "protein", "carbs", "fat"],
      },
    },
    calories: { type: Type.NUMBER, description: "Total calories for the whole meal." },
    protein: { type: Type.NUMBER, description: "Total protein grams." },
    carbs: { type: Type.NUMBER, description: "Total carbohydrate grams." },
    fat: { type: Type.NUMBER, description: "Total fat grams." },
    healthScore: { type: Type.NUMBER, description: "Overall healthiness from 1 (poor) to 10 (excellent)." },
    confidence: { type: Type.NUMBER, description: "Confidence in the estimate from 0 to 1." },
    notes: { type: Type.STRING, description: "One short, friendly nutrition insight or tip about this meal." },
  },
  required: ["title", "description", "items", "calories", "protein", "carbs", "fat", "healthScore", "confidence", "notes"],
};

const SYSTEM_PROMPT = `You are a meticulous nutritionist and food-recognition expert.
Analyze the food in the image and estimate its nutritional content.
- Identify every distinct food and drink item you can see.
- Estimate realistic portion sizes from visual cues (plate size, utensils, packaging).
- Provide per-item calories and macros (protein, carbs, fat in grams), plus accurate totals.
- The totals must equal the sum of the item values.
- healthScore: weigh whole foods, vegetables, lean protein, and fiber positively; ultra-processed, fried, and sugary items negatively.
- confidence: lower it when the image is blurry, partially hidden, or ambiguous.
- notes: a single short, encouraging, practical tip (max ~20 words).
If the image clearly contains no food, return a single item named "No food detected" with all values 0, healthScore 0, and confidence 0.`;

export async function analyzeMealImage(
  base64Data: string,
  mimeType: string,
): Promise<AnalysisResult> {
  const ai = getClient();

  const request = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Analyze this meal photo and return the nutrition breakdown." },
          { inlineData: { mimeType, data: base64Data } },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.3,
    },
  };

  let lastError: unknown;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const response = await ai.models.generateContent({ model, ...request });
        const text = response.text;
        if (!text) throw new Error("The model returned an empty response.");
        return normalize(JSON.parse(text) as AnalysisResult);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        // exponential backoff before retrying the same model
        if (attempt < MAX_ATTEMPTS - 1) await sleep(400 * 2 ** attempt);
      }
    }
    // model exhausted its retries — fall through to the next fallback model
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All models were unavailable.");
}

function round(n: number): number {
  return Math.max(0, Math.round(n));
}

/** Defensively coerce / round model output into clean numbers. */
function normalize(r: AnalysisResult): AnalysisResult {
  const items = (r.items ?? []).map((it) => ({
    name: it.name ?? "Unknown",
    quantity: it.quantity ?? "1 serving",
    calories: round(it.calories),
    protein: round(it.protein),
    carbs: round(it.carbs),
    fat: round(it.fat),
  }));

  // Prefer model totals, but fall back to summing items when they are missing.
  const sum = (key: "calories" | "protein" | "carbs" | "fat") =>
    items.reduce((acc, it) => acc + it[key], 0);

  return {
    title: r.title?.trim() || "Meal",
    description: r.description?.trim() || "",
    items,
    calories: round(r.calories || sum("calories")),
    protein: round(r.protein || sum("protein")),
    carbs: round(r.carbs || sum("carbs")),
    fat: round(r.fat || sum("fat")),
    healthScore: Math.min(10, Math.max(0, Math.round(r.healthScore ?? 0))),
    confidence: Math.min(1, Math.max(0, r.confidence ?? 0)),
    notes: r.notes?.trim() || "",
  };
}
