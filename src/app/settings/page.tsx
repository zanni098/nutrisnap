"use client";

import { useState } from "react";
import { Calculator, Check, Sparkles } from "lucide-react";
import { useProfile } from "@/lib/store";
import { useMounted } from "@/lib/useMounted";
import {
  ACTIVITY_LEVELS,
  computeGoals,
  macroCalories,
  type MifflinInput,
} from "@/lib/nutrition";
import type { Goals } from "@/lib/types";

export default function SettingsPage() {
  const mounted = useMounted();
  const { profile, setGoals, setName } = useProfile();

  if (!mounted) {
    return (
      <div className="px-5 pt-8">
        <div className="h-8 w-32 rounded-lg bg-border shimmer" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-5 pt-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Profile & goals</h1>

      <NameField name={profile.name} onSave={setName} />
      <GoalsEditor goals={profile.goals} onSave={setGoals} />
      <TdeeCalculator onApply={setGoals} />

      <p className="pb-4 text-center text-[11px] text-muted">
        Data is stored locally on this device. NutriSnap · AI Calorie Tracker
      </p>
    </div>
  );
}

function NameField({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <section className="rounded-3xl bg-surface p-5 ring-1 ring-border">
      <label className="text-sm font-bold">Your name</label>
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Alex"
          className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={() => onSave(value.trim())}
          className="rounded-xl bg-brand px-4 text-sm font-semibold text-white"
        >
          Save
        </button>
      </div>
    </section>
  );
}

function GoalsEditor({ goals, onSave }: { goals: Goals; onSave: (g: Goals) => void }) {
  const [draft, setDraft] = useState<Goals>(goals);
  const [saved, setSaved] = useState(false);

  const macro = macroCalories(draft.protein, draft.carbs, draft.fat);
  const macroTotal = Math.round(macro.protein + macro.carbs + macro.fat);

  const update = (key: keyof Goals, v: string) => {
    setDraft({ ...draft, [key]: Math.max(0, parseInt(v || "0", 10)) });
    setSaved(false);
  };

  return (
    <section className="rounded-3xl bg-surface p-5 ring-1 ring-border">
      <h2 className="text-sm font-bold">Daily targets</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumField label="Calories" unit="kcal" value={draft.calories} onChange={(v) => update("calories", v)} />
        <NumField label="Protein" unit="g" value={draft.protein} onChange={(v) => update("protein", v)} />
        <NumField label="Carbs" unit="g" value={draft.carbs} onChange={(v) => update("carbs", v)} />
        <NumField label="Fat" unit="g" value={draft.fat} onChange={(v) => update("fat", v)} />
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Macros add up to ~{macroTotal} kcal.
      </p>
      <button
        onClick={() => {
          onSave(draft);
          setSaved(true);
        }}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white"
      >
        {saved ? <Check className="h-4 w-4" /> : null}
        {saved ? "Saved" : "Save targets"}
      </button>
    </section>
  );
}

function NumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">
        {label} ({unit})
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm tabular-nums outline-none focus:border-brand"
      />
    </label>
  );
}

function TdeeCalculator({ onApply }: { onApply: (g: Goals) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<MifflinInput>({
    sex: "male",
    age: 30,
    heightCm: 175,
    weightKg: 75,
    activity: 1.375,
    goal: "maintain",
  });
  const [result, setResult] = useState<Goals | null>(null);

  const num = (k: keyof MifflinInput, v: string) =>
    setInput({ ...input, [k]: parseFloat(v || "0") });

  return (
    <section className="rounded-3xl bg-surface p-5 ring-1 ring-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm font-bold">
          <Calculator className="h-4 w-4 text-brand" /> Goal calculator
        </span>
        <span className="text-xs text-muted">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Choice
              label="Male"
              active={input.sex === "male"}
              onClick={() => setInput({ ...input, sex: "male" })}
            />
            <Choice
              label="Female"
              active={input.sex === "female"}
              onClick={() => setInput({ ...input, sex: "female" })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Age" unit="yr" value={input.age} onChange={(v) => num("age", v)} />
            <NumField label="Height" unit="cm" value={input.heightCm} onChange={(v) => num("heightCm", v)} />
            <NumField label="Weight" unit="kg" value={input.weightKg} onChange={(v) => num("weightKg", v)} />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-muted">Activity</p>
            <div className="grid grid-cols-5 gap-1">
              {ACTIVITY_LEVELS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => setInput({ ...input, activity: a.value })}
                  className={`rounded-lg py-2 text-[10px] font-semibold ${
                    input.activity === a.value
                      ? "bg-brand text-white"
                      : "bg-background text-muted ring-1 ring-border"
                  }`}
                  title={a.hint}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(["lose", "maintain", "gain"] as const).map((g) => (
              <Choice
                key={g}
                label={g[0].toUpperCase() + g.slice(1)}
                active={input.goal === g}
                onClick={() => setInput({ ...input, goal: g })}
              />
            ))}
          </div>

          <button
            onClick={() => setResult(computeGoals(input))}
            className="flex items-center justify-center gap-2 rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background"
          >
            <Sparkles className="h-4 w-4" /> Calculate
          </button>

          {result && (
            <div className="rounded-2xl bg-brand-soft/60 p-4">
              <p className="text-xs text-brand-dark">Recommended daily target</p>
              <p className="text-2xl font-extrabold text-brand-dark">
                {result.calories} kcal
              </p>
              <p className="mt-1 text-xs text-brand-dark">
                P {result.protein}g · C {result.carbs}g · F {result.fat}g
              </p>
              <button
                onClick={() => onApply(result)}
                className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white"
              >
                Apply these targets
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Choice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl py-2.5 text-sm font-semibold ${
        active ? "bg-brand text-white" : "bg-background text-muted ring-1 ring-border"
      }`}
    >
      {label}
    </button>
  );
}
