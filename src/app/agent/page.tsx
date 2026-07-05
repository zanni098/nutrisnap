"use client";

import { useState } from "react";
import { Sparkles, ShieldCheck, ShieldAlert, ShieldX, ClipboardList, Loader2 } from "lucide-react";
import { useMeals, useProfile } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import {
  runAgent,
  buildDemoWeek,
  SAMPLE_MEALS,
  type AgentResult,
  type SampleMeal,
  type Verdict,
} from "@/lib/agent";

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  APPROVE: { label: "APPROVE", cls: "bg-brand-soft text-brand-dark", Icon: ShieldCheck },
  WARN: { label: "WARN", cls: "bg-amber-100 text-amber-700", Icon: ShieldAlert },
  BLOCK: { label: "BLOCK", cls: "bg-red-100 text-red-700", Icon: ShieldX },
  PROACTIVE_PLAN: { label: "PROACTIVE PLAN", cls: "bg-blue-100 text-blue-700", Icon: ClipboardList },
};

export default function AgentPage() {
  const mounted = useMounted();
  const { meals, addMeal } = useMeals();
  const { profile } = useProfile();
  const [result, setResult] = useState<AgentResult | null>(null);
  const [running, setRunning] = useState(false);
  const [activeSample, setActiveSample] = useState<string | null>(null);

  function run(sample?: SampleMeal) {
    setRunning(true);
    setActiveSample(sample?.key ?? "audit");
    // Small delay so the ReAct trace visibly "thinks" (demo affordance).
    setTimeout(() => {
      setResult(runAgent(meals, profile.goals, sample));
      setRunning(false);
    }, 450);
  }

  function seed() {
    for (const m of buildDemoWeek()) addMeal(m);
  }

  if (!mounted) {
    return (
      <div className="px-5 pt-8">
        <div className="h-8 w-40 rounded-lg bg-border shimmer" />
      </div>
    );
  }

  const empty = meals.length === 0;

  return (
    <div className="flex flex-col gap-6 px-5 pt-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight">Wellness Agent</h1>
        </div>
        <p className="text-xs text-muted">
          A <b>Proactive Wellness Critic</b> — it reads your history, reflects on your
          trajectory, and autonomously plans, approves, or <b>blocks</b> meals.
        </p>
      </header>

      {empty && (
        <div className="flex flex-col gap-3 rounded-3xl border border-dashed border-border bg-surface/60 px-5 py-6 text-center">
          <p className="text-sm font-semibold">No meals logged yet</p>
          <p className="mx-auto max-w-xs text-xs text-muted">
            Load a realistic 7-day demo week (protein deficit + declining quality) so the
            agent has a trajectory to audit.
          </p>
          <button
            onClick={seed}
            className="mx-auto mt-1 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white"
          >
            Seed 7-day demo week
          </button>
        </div>
      )}

      {/* Controls */}
      <section className="flex flex-col gap-3 rounded-3xl bg-surface p-5 ring-1 ring-border">
        <button
          onClick={() => run()}
          disabled={running || empty}
          className="flex items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {running && activeSample === "audit" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Audit my week &amp; plan
        </button>

        <p className="mt-1 text-[11px] font-medium text-muted">
          …or submit a meal and watch it decide in context:
        </p>
        <div className="grid grid-cols-1 gap-2">
          {SAMPLE_MEALS.map((s) => (
            <button
              key={s.key}
              onClick={() => run(s)}
              disabled={running || empty}
              className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            >
              <span>{s.label}</span>
              {running && activeSample === s.key ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted" />
              ) : (
                <span className="text-[11px] text-muted">evaluate →</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ReAct trace */}
      {result && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-sm font-bold">Reasoning trace</h2>
          <ol className="flex flex-col gap-2">
            {result.steps.map((step, i) => (
              <li key={i} className="rounded-2xl bg-surface p-3 ring-1 ring-border">
                <p className="text-xs text-foreground">
                  <span className="font-semibold text-brand">think </span>
                  {step.thought}
                </p>
                {step.action && (
                  <p className="mt-1 font-mono text-[11px] text-muted">→ {step.action}</p>
                )}
                {step.observation && (
                  <p className="mt-0.5 text-[11px] text-muted">obs: {step.observation}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Intervention */}
      {result && <InterventionCard result={result} />}
    </div>
  );
}

function InterventionCard({ result }: { result: AgentResult }) {
  const { intervention } = result;
  const v = VERDICT_STYLE[intervention.verdict];
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${v.cls}`}>
          <v.Icon className="h-4 w-4" />
          {v.label}
        </span>
        <span className="text-[11px] text-muted">structured intervention</span>
      </div>

      {intervention.mealAssessment && (
        <p className="text-sm font-medium">{intervention.mealAssessment}</p>
      )}
      <p className="text-xs text-muted">{intervention.reasoning}</p>

      {intervention.correctiveActions.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-bold">Corrective actions</h3>
          <ul className="flex flex-col gap-1.5">
            {intervention.correctiveActions.map((a, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span className="text-brand">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {intervention.groceryList.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-bold">Grocery list</h3>
          <div className="flex flex-wrap gap-1.5">
            {intervention.groceryList.map((g) => (
              <span key={g} className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand-dark">
                {g}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="border-t border-border pt-3 text-[11px] text-muted">
        Next check-in: {intervention.nextCheckin}
      </p>
    </section>
  );
}
