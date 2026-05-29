"use client";

export function MacroPill({
  label,
  value,
  color,
  unit = "g",
}: {
  label: string;
  value: number;
  color: string;
  unit?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-xl bg-background py-2">
      <span
        className="mb-1 h-1.5 w-6 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-sm font-bold tabular-nums">
        {value}
        <span className="text-[10px] font-medium text-muted">{unit}</span>
      </span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  );
}
