"use client";

interface MacroStatProps {
  label: string;
  value: number;
  goal: number;
  color: string;
  unit?: string;
}

export function MacroStat({ label, value, goal, color, unit = "g" }: MacroStatProps) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className="text-xs tabular-nums text-muted">
          <span className="font-semibold text-foreground">{value}</span>
          {unit} / {goal}
          {unit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border/70">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
