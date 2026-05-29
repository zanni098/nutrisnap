"use client";

import { useMemo } from "react";
import { useMeals, useProfile } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import { dayKey, sumTotals, macroCalories } from "@/lib/nutrition";

export default function InsightsPage() {
  const mounted = useMounted();
  const { meals } = useMeals();
  const { profile } = useProfile();
  const goal = profile.goals.calories;

  const week = useMemo(() => {
    const days: { key: string; label: string; calories: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      const dayMeals = meals.filter((m) => dayKey(m.createdAt) === key);
      days.push({
        key,
        label: d.toLocaleDateString([], { weekday: "narrow" }),
        calories: sumTotals(dayMeals).calories,
      });
    }
    return days;
  }, [meals]);

  const totals = useMemo(() => sumTotals(meals), [meals]);
  const loggedDays = useMemo(
    () => new Set(meals.map((m) => dayKey(m.createdAt))).size,
    [meals],
  );
  const avg = loggedDays > 0 ? Math.round(totals.calories / loggedDays) : 0;

  const maxBar = Math.max(goal, ...week.map((d) => d.calories), 1);
  const macroCals = macroCalories(totals.protein, totals.carbs, totals.fat);
  const totalMacroCals = macroCals.protein + macroCals.carbs + macroCals.fat || 1;

  if (!mounted) {
    return (
      <div className="px-5 pt-8">
        <div className="h-8 w-32 rounded-lg bg-border shimmer" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-5 pt-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Insights</h1>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Avg / day" value={`${avg}`} unit="kcal" />
        <KpiCard label="Days logged" value={`${loggedDays}`} unit="days" />
        <KpiCard label="Meals" value={`${meals.length}`} unit="total" />
        <KpiCard
          label="Daily goal"
          value={`${goal}`}
          unit="kcal"
        />
      </div>

      {/* Weekly bar chart */}
      <section className="rounded-3xl bg-surface p-5 ring-1 ring-border">
        <h2 className="mb-4 text-sm font-bold">Last 7 days</h2>
        <div className="flex h-40 items-end justify-between gap-2">
          {week.map((d) => {
            const h = Math.round((d.calories / maxBar) * 100);
            const over = d.calories > goal;
            return (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-2">
                <div className="relative flex h-32 w-full items-end">
                  <div
                    className="w-full rounded-t-md transition-all duration-500"
                    style={{
                      height: `${Math.max(h, 2)}%`,
                      backgroundColor: over ? "var(--protein)" : "var(--cal)",
                    }}
                    title={`${d.calories} kcal`}
                  />
                </div>
                <span className="text-[10px] font-medium text-muted">{d.label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-1 text-[10px] text-muted">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--cal)" }} />
          On / under goal
          <span className="ml-3 inline-block h-2 w-2 rounded-full" style={{ background: "var(--protein)" }} />
          Over goal
        </div>
      </section>

      {/* Macro distribution */}
      <section className="rounded-3xl bg-surface p-5 ring-1 ring-border">
        <h2 className="mb-4 text-sm font-bold">Macro distribution</h2>
        {totals.calories === 0 ? (
          <p className="text-sm text-muted">Log some meals to see your macro split.</p>
        ) : (
          <>
            <div className="flex h-4 overflow-hidden rounded-full">
              <Segment pct={(macroCals.protein / totalMacroCals) * 100} color="var(--protein)" />
              <Segment pct={(macroCals.carbs / totalMacroCals) * 100} color="var(--carbs)" />
              <Segment pct={(macroCals.fat / totalMacroCals) * 100} color="var(--fat)" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Legend label="Protein" grams={totals.protein} pct={(macroCals.protein / totalMacroCals) * 100} color="var(--protein)" />
              <Legend label="Carbs" grams={totals.carbs} pct={(macroCals.carbs / totalMacroCals) * 100} color="var(--carbs)" />
              <Legend label="Fat" grams={totals.fat} pct={(macroCals.fat / totalMacroCals) * 100} color="var(--fat)" />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted">
        {unit} · {label}
      </p>
    </div>
  );
}

function Segment({ pct, color }: { pct: number; color: string }) {
  return <div style={{ width: `${pct}%`, backgroundColor: color }} />;
}

function Legend({
  label,
  grams,
  pct,
  color,
}: {
  label: string;
  grams: number;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="mx-auto mb-1 h-2 w-2 rounded-full" style={{ background: color }} />
      <p className="text-sm font-bold tabular-nums">{Math.round(pct)}%</p>
      <p className="text-[10px] text-muted">
        {label} · {grams}g
      </p>
    </div>
  );
}
