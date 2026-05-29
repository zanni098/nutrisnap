"use client";

import { useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  ImagePlus,
  X,
  Loader2,
  RefreshCw,
  Check,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { processImageFile, processDataUrl, type ProcessedImage } from "@/lib/image";
import { useMeals, newId } from "@/lib/store";
import { guessMealType, MEAL_TYPES, MEAL_LABELS, scaled } from "@/lib/nutrition";
import type { AnalysisResult, MealEntry, MealType } from "@/lib/types";
import { HealthBadge } from "./HealthBadge";
import { MacroPill } from "./MacroPill";

type Stage = "select" | "analyzing" | "result" | "error";

const SAMPLES = [
  { label: "Salad", src: "/samples/salad.jpg" },
  { label: "Burger", src: "/samples/burger.jpg" },
  { label: "Breakfast", src: "/samples/breakfast.jpg" },
];

export function CaptureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addMeal } = useMeals();
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("select");
  const [image, setImage] = useState<ProcessedImage | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>("");
  const [mealType, setMealType] = useState<MealType>(guessMealType());
  const [servings, setServings] = useState(1);

  const reset = useCallback(() => {
    setStage("select");
    setImage(null);
    setResult(null);
    setError("");
    setServings(1);
    setMealType(guessMealType());
  }, []);

  const close = useCallback(() => {
    onClose();
    // delay reset so the exit animation isn't janky
    setTimeout(reset, 250);
  }, [onClose, reset]);

  const analyze = useCallback(async (img: ProcessedImage) => {
    setStage("analyzing");
    setError("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: img.dataUrl, mimeType: img.mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed.");
      setResult(data as AnalysisResult);
      setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStage("error");
    }
  }, []);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const img = await processImageFile(file);
        setImage(img);
        await analyze(img);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that image.");
        setStage("error");
      }
    },
    [analyze],
  );

  const handleSample = useCallback(
    async (src: string) => {
      try {
        const img = await processDataUrl(src);
        setImage(img);
        await analyze(img);
      } catch {
        setError("Couldn't load the sample image.");
        setStage("error");
      }
    },
    [analyze],
  );

  const save = useCallback(() => {
    if (!result) return;
    const entry: MealEntry = {
      ...result,
      id: newId(),
      createdAt: new Date().toISOString(),
      mealType,
      servings,
      imageUrl: image?.thumbnail,
    };
    addMeal(entry);
    close();
  }, [result, mealType, servings, image, addMeal, close]);

  const scaledTotals = result
    ? scaled({ ...result, servings } as MealEntry)
    : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
          <motion.div
            className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-background"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">
                {stage === "result" ? "Review & log" : "Snap your meal"}
              </h2>
              <button
                onClick={close}
                className="grid h-8 w-8 place-items-center rounded-full bg-border/60 text-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {stage === "select" && (
                <SelectStage
                  onPick={() => uploadRef.current?.click()}
                  onCamera={() => cameraRef.current?.click()}
                  onSample={handleSample}
                />
              )}

              {stage === "analyzing" && <AnalyzingStage src={image?.thumbnail} />}

              {stage === "error" && (
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-red-50 text-red-500">
                    <AlertCircle className="h-7 w-7" />
                  </div>
                  <p className="max-w-xs text-sm text-muted">{error}</p>
                  <button
                    onClick={reset}
                    className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white"
                  >
                    Try again
                  </button>
                </div>
              )}

              {stage === "result" && result && scaledTotals && (
                <ResultStage
                  result={result}
                  image={image?.thumbnail}
                  mealType={mealType}
                  setMealType={setMealType}
                  servings={servings}
                  setServings={setServings}
                  totals={scaledTotals}
                />
              )}
            </div>

            {stage === "result" && (
              <div className="border-t border-border bg-surface px-5 py-3">
                <div className="flex gap-3">
                  <button
                    onClick={reset}
                    className="flex items-center gap-2 rounded-full border border-border px-4 py-3 text-sm font-semibold text-foreground"
                  >
                    <RefreshCw className="h-4 w-4" /> Retake
                  </button>
                  <button
                    onClick={save}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 active:scale-[0.99]"
                  >
                    <Check className="h-4 w-4" /> Log meal
                  </button>
                </div>
              </div>
            )}

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SelectStage({
  onPick,
  onCamera,
  onSample,
}: {
  onPick: () => void;
  onCamera: () => void;
  onSample: (src: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onCamera}
        className="flex flex-col items-center gap-3 rounded-2xl bg-brand py-8 text-white shadow-lg shadow-brand/30 active:scale-[0.99]"
      >
        <Camera className="h-9 w-9" strokeWidth={2} />
        <span className="text-sm font-semibold">Take a photo</span>
      </button>
      <button
        onClick={onPick}
        className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface py-4 text-sm font-semibold text-foreground active:scale-[0.99]"
      >
        <ImagePlus className="h-5 w-5" /> Upload from library
      </button>

      <div className="pt-2">
        <p className="mb-2 text-xs font-medium text-muted">Or try a sample</p>
        <div className="flex gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.src}
              onClick={() => onSample(s.src)}
              className="flex-1 rounded-xl border border-border bg-surface px-2 py-2.5 text-[11px] font-medium text-muted hover:border-brand hover:text-brand"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyzingStage({ src }: { src?: string }) {
  return (
    <div className="flex flex-col items-center gap-5 py-8">
      <div className="relative h-44 w-44 overflow-hidden rounded-2xl bg-border">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Analyzing meal" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1 bg-brand animate-pulse-ring" />
      </div>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-brand" />
        Analyzing nutrition…
        <Sparkles className="h-4 w-4 text-brand" />
      </div>
      <p className="max-w-xs text-center text-xs text-muted">
        Our AI is identifying ingredients and estimating calories and macros.
      </p>
    </div>
  );
}

function ResultStage({
  result,
  image,
  mealType,
  setMealType,
  servings,
  setServings,
  totals,
}: {
  result: AnalysisResult;
  image?: string;
  mealType: MealType;
  setMealType: (m: MealType) => void;
  servings: number;
  setServings: (n: number) => void;
  totals: { calories: number; protein: number; carbs: number; fat: number };
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-4">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={result.title}
            className="h-20 w-20 flex-shrink-0 rounded-xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-lg font-bold leading-tight">{result.title}</h3>
            <HealthBadge score={result.healthScore} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{result.description}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted">Total calories</p>
            <p className="text-3xl font-extrabold tracking-tight">
              {totals.calories}
              <span className="ml-1 text-sm font-medium text-muted">kcal</span>
            </p>
          </div>
          <div className="text-right text-[11px] text-muted">
            {Math.round(result.confidence * 100)}% confidence
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <MacroPill label="Protein" value={totals.protein} color="var(--protein)" />
          <MacroPill label="Carbs" value={totals.carbs} color="var(--carbs)" />
          <MacroPill label="Fat" value={totals.fat} color="var(--fat)" />
        </div>
      </div>

      {/* Meal type */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted">Meal</p>
        <div className="flex gap-2">
          {MEAL_TYPES.map((m) => (
            <button
              key={m}
              onClick={() => setMealType(m)}
              className={`flex-1 rounded-full py-2 text-xs font-semibold transition-colors ${
                mealType === m
                  ? "bg-brand text-white"
                  : "bg-surface text-muted ring-1 ring-border"
              }`}
            >
              {MEAL_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Servings */}
      <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 ring-1 ring-border">
        <span className="text-sm font-medium">Servings</span>
        <div className="flex items-center gap-3">
          <Stepper
            onClick={() => setServings(Math.max(0.5, Math.round((servings - 0.5) * 10) / 10))}
            label="−"
          />
          <span className="w-10 text-center text-sm font-semibold tabular-nums">{servings}</span>
          <Stepper
            onClick={() => setServings(Math.round((servings + 0.5) * 10) / 10)}
            label="+"
          />
        </div>
      </div>

      {/* Items */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted">Detected items</p>
        <div className="divide-y divide-border overflow-hidden rounded-2xl ring-1 ring-border">
          {result.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between bg-surface px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{it.name}</p>
                <p className="text-xs text-muted">{it.quantity}</p>
              </div>
              <p className="text-sm font-semibold tabular-nums">{it.calories} kcal</p>
            </div>
          ))}
        </div>
      </div>

      {result.notes && (
        <div className="flex gap-2 rounded-2xl bg-brand-soft/60 p-3 text-xs text-brand-dark">
          <Sparkles className="h-4 w-4 flex-shrink-0" />
          <span>{result.notes}</span>
        </div>
      )}
    </div>
  );
}

function Stepper({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full bg-border/70 text-lg font-semibold text-foreground active:scale-95"
    >
      {label}
    </button>
  );
}
