"use client";

export function HealthBadge({ score }: { score: number }) {
  const { label, cls } = grade(score);
  return (
    <span
      className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}
      title={`Health score: ${score}/10`}
    >
      {label} {score}/10
    </span>
  );
}

function grade(score: number): { label: string; cls: string } {
  if (score >= 8) return { label: "Great", cls: "bg-emerald-100 text-emerald-700" };
  if (score >= 6) return { label: "Good", cls: "bg-lime-100 text-lime-700" };
  if (score >= 4) return { label: "Okay", cls: "bg-amber-100 text-amber-700" };
  if (score >= 1) return { label: "Heavy", cls: "bg-orange-100 text-orange-700" };
  return { label: "—", cls: "bg-gray-100 text-gray-500" };
}
