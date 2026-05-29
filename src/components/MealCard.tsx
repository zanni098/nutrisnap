"use client";

import { Trash2 } from "lucide-react";
import type { MealEntry } from "@/lib/types";
import { scaled } from "@/lib/nutrition";

export function MealCard({
  meal,
  onDelete,
}: {
  meal: MealEntry;
  onDelete?: (id: string) => void;
}) {
  const t = scaled(meal);
  const time = new Date(meal.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-border">
      {meal.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={meal.imageUrl}
          alt={meal.title}
          className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-xl bg-brand-soft text-lg">
          🍽️
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{meal.title}</p>
        <p className="text-xs text-muted">
          {time}
          {meal.servings !== 1 && ` · ${meal.servings}×`}
        </p>
        <div className="mt-1 flex gap-2 text-[10px] font-medium text-muted">
          <span style={{ color: "var(--protein)" }}>P {t.protein}g</span>
          <span style={{ color: "var(--carbs)" }}>C {t.carbs}g</span>
          <span style={{ color: "var(--fat)" }}>F {t.fat}g</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-bold tabular-nums">{t.calories}</span>
        <span className="text-[10px] text-muted">kcal</span>
      </div>
      {onDelete && (
        <button
          onClick={() => onDelete(meal.id)}
          aria-label="Delete meal"
          className="ml-1 grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
