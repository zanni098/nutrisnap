"use client";

import { useMemo } from "react";
import { Flame, Plus } from "lucide-react";
import { useMeals, useProfile } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import { useCapture } from "@/components/CaptureProvider";
import {
  dayKey,
  sumTotals,
  MEAL_TYPES,
  MEAL_LABELS,
} from "@/lib/nutrition";
import { ProgressRing } from "@/components/ProgressRing";
import { MacroStat } from "@/components/MacroStat";
import { MealCard } from "@/components/MealCard";
import type { MealType } from "@/lib/types";

export default function TodayPage() {
  const mounted = useMounted();
  const { meals, deleteMeal } = useMeals();
  const { profile } = useProfile();
  const { openCapture } = useCapture();
  const goals = profile.goals;

  const today = dayKey(new Date());
  const todays = useMemo(
    () => meals.filter((m) => dayKey(m.createdAt) === today),
    [meals, today],
  );
  const totals = useMemo(() => sumTotals(todays), [todays]);
  const remaining = Math.max(goals.calories - totals.calories, 0);
  const over = totals.calories > goals.calories;

  const byType = useMemo(() => {
    const map: Record<MealType, typeof todays> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };
    for (const m of todays) map[m.mealType].push(m);
    return map;
  }, [todays]);

  const dateLabel = new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (!mounted) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-6 px-5 pt-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted">{dateLabel}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {greeting()}
            {profile.name ? `, ${profile.name}` : ""}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-dark">
          <Flame className="h-4 w-4" /> {streak(meals)} day streak
        </div>
      </header>

      {/* Calorie ring */}
      <section className="flex flex-col items-center rounded-3xl bg-surface p-6 ring-1 ring-border">
        <ProgressRing
          value={totals.calories}
          max={goals.calories}
          color={over ? "var(--protein)" : "var(--cal)"}
        >
          <span className="text-4xl font-extrabold tabular-nums">
            {over ? totals.calories - goals.calories : remaining}
          </span>
          <span className="text-xs font-medium text-muted">
            {over ? "kcal over" : "kcal left"}
          </span>
        </ProgressRing>
        <div className="mt-4 flex w-full justify-between text-center text-xs">
          <Stat label="Goal" value={goals.calories} />
          <Stat label="Food" value={totals.calories} />
          <Stat label="Remaining" value={remaining} accent={!over} />
        </div>
      </section>

      {/* Macros */}
      <section className="flex flex-col gap-3 rounded-3xl bg-surface p-5 ring-1 ring-border">
        <MacroStat label="Protein" value={totals.protein} goal={goals.protein} color="var(--protein)" />
        <MacroStat label="Carbs" value={totals.carbs} goal={goals.carbs} color="var(--carbs)" />
        <MacroStat label="Fat" value={totals.fat} goal={goals.fat} color="var(--fat)" />
      </section>

      {/* Meals */}
      <section className="flex flex-col gap-4 pb-4">
        {todays.length === 0 ? (
          <EmptyState onAdd={openCapture} />
        ) : (
          MEAL_TYPES.filter((t) => byType[t].length > 0).map((type) => (
            <div key={type} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-bold">{MEAL_LABELS[type]}</h2>
                <span className="text-xs text-muted">
                  {sumTotals(byType[type]).calories} kcal
                </span>
              </div>
              {byType[type].map((m) => (
                <MealCard key={m.id} meal={m} onDelete={deleteMeal} />
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex-1">
      <p className={`text-lg font-bold tabular-nums ${accent ? "text-brand" : ""}`}>
        {value}
      </p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border bg-surface/60 px-6 py-10 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-2xl">
        🥗
      </div>
      <p className="text-sm font-semibold">No meals logged yet</p>
      <p className="max-w-xs text-xs text-muted">
        Tap the camera to snap your first meal and let AI do the counting.
      </p>
      <button
        onClick={onAdd}
        className="mt-1 flex items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white"
      >
        <Plus className="h-4 w-4" /> Add a meal
      </button>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Consecutive days (ending today or yesterday) with at least one logged meal. */
function streak(meals: { createdAt: string }[]): number {
  if (meals.length === 0) return 0;
  const days = new Set(meals.map((m) => dayKey(m.createdAt)));
  let count = 0;
  const cursor = new Date();
  // allow the streak to count even if today has no entry yet
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-5 pt-8">
      <div className="h-10 w-40 rounded-lg bg-border shimmer" />
      <div className="h-64 rounded-3xl bg-border shimmer" />
      <div className="h-32 rounded-3xl bg-border shimmer" />
    </div>
  );
}
