# AI Prompt & Schema Design

The heart of NutriSnap is a single, carefully designed vision prompt plus a
strict response schema. This file documents both so the AI usage is fully
transparent.

## System prompt (sent to Gemini)

```
You are a meticulous nutritionist and food-recognition expert.
Analyze the food in the image and estimate its nutritional content.
- Identify every distinct food and drink item you can see.
- Estimate realistic portion sizes from visual cues (plate size, utensils, packaging).
- Provide per-item calories and macros (protein, carbs, fat in grams), plus accurate totals.
- The totals must equal the sum of the item values.
- healthScore: weigh whole foods, vegetables, lean protein, and fiber positively;
  ultra-processed, fried, and sugary items negatively.
- confidence: lower it when the image is blurry, partially hidden, or ambiguous.
- notes: a single short, encouraging, practical tip (max ~20 words).
If the image clearly contains no food, return a single item named "No food detected"
with all values 0, healthScore 0, and confidence 0.
```

## Response schema (Gemini `responseSchema`, JSON mode)

```
{
  title: string,            // short meal name
  description: string,      // one sentence
  items: [{ name, quantity, calories, protein, carbs, fat }],
  calories, protein, carbs, fat,   // totals
  healthScore: number (0-10),
  confidence: number (0-1),
  notes: string
}
```

## Why this design

- **Per-item + totals** lets the UI show a believable breakdown and lets the
  server reconcile totals against the sum of items.
- **healthScore + confidence** turn a raw estimate into product signal: the UI
  shows a colored health badge and a "% confidence" label, which is honest about
  AI uncertainty.
- **No-food guard** keeps the UX graceful when someone snaps a non-meal.

## Robustness added after testing

- Server rounds/clamps every numeric field and falls back to summing items if a
  total is missing.
- Retries with exponential backoff + multi-model fallback for transient
  `503 overloaded` responses (see `01-build-session.md`).
- Image payloads capped at 8 MB; data-URL prefixes stripped before decoding.

## Models used

- Primary: `gemini-2.5-flash`
- Fallbacks: `gemini-2.0-flash`, `gemini-flash-latest`
- SDK: `@google/genai`
