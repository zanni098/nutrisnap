"use client";

import { useMemo } from "react";
import { useMeals, useProfile } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import { dayKey, sumTotals } from "@/lib/nutrition";
import { MealCard } from "@/components/MealCard";
import type { MealEntry } from "@/lib/types";

export default function HistoryPage() {
  const mounted = useMounted();
  const { meals, deleteMeal } = useMeals();
  const { profile } = useProfile();

  const groups = useMemo(() => {
    const map = new Map<string, MealEntry[]>();
    for (const m of meals) {
      const k = dayKey(m.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [meals]);

  if (!mounted) {
    return (
      <div className="px-5 pt-8">
        <div className="h-8 w-32 rounded-lg bg-border shimmer" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-5 pt-8">
      <h1 className="text-2xl font-extrabold tracking-tight">History</h1>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-10 text-center text-sm text-muted">
          Your logged meals will appear here, grouped by day.
        </p>
      ) : (
        groups.map(([key, dayMeals]) => {
          const totals = sumTotals(dayMeals);
          const pct = Math.min(
            Math.round((totals.calories / profile.goals.calories) * 100),
            999,
          );
          return (
            <section key={key} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <div>
                  <h2 className="text-sm font-bold">{formatDay(key)}</h2>
                  <p className="text-[11px] text-muted">
                    {dayMeals.length} {dayMeals.length === 1 ? "meal" : "meals"} ·{" "}
                    {pct}% of goal
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums">{totals.calories}</p>
                  <p className="text-[10px] text-muted">kcal</p>
                </div>
              </div>
              <div className="mb-1 flex gap-2 px-1 text-[10px] font-medium text-muted">
                <span style={{ color: "var(--protein)" }}>P {totals.protein}g</span>
                <span style={{ color: "var(--carbs)" }}>C {totals.carbs}g</span>
                <span style={{ color: "var(--fat)" }}>F {totals.fat}g</span>
              </div>
              {dayMeals.map((m) => (
                <MealCard key={m.id} meal={m} onDelete={deleteMeal} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function formatDay(key: string): string {
  const today = dayKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return "Today";
  if (key === dayKey(y)) return "Yesterday";
  return new Date(key + "T00:00:00").toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
