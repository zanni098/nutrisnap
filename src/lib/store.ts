"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Goals, MealEntry, Profile } from "./types";
import { DEFAULT_GOALS } from "./nutrition";

const MEALS_KEY = "nutrisnap.meals.v1";
const PROFILE_KEY = "nutrisnap.profile.v1";

const DEFAULT_PROFILE: Profile = {
  name: "",
  goals: DEFAULT_GOALS,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MEALS_KEY || e.key === PROFILE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
  emit();
}

// --- Meals ------------------------------------------------------------------

let mealsCache: MealEntry[] = [];
let mealsCacheRaw: string | null = null;

function getMealsSnapshot(): MealEntry[] {
  if (typeof window === "undefined") return mealsCache;
  const raw = window.localStorage.getItem(MEALS_KEY);
  // Keep a stable reference unless the underlying string changed,
  // so useSyncExternalStore doesn't loop.
  if (raw !== mealsCacheRaw) {
    mealsCacheRaw = raw;
    try {
      mealsCache = raw ? (JSON.parse(raw) as MealEntry[]) : [];
    } catch {
      mealsCache = [];
    }
  }
  return mealsCache;
}

export function useMeals() {
  const meals = useSyncExternalStore(subscribe, getMealsSnapshot, () => mealsCache);

  const addMeal = useCallback((meal: MealEntry) => {
    const next = [meal, ...read<MealEntry[]>(MEALS_KEY, [])];
    write(MEALS_KEY, next);
  }, []);

  const updateMeal = useCallback((id: string, patch: Partial<MealEntry>) => {
    const next = read<MealEntry[]>(MEALS_KEY, []).map((m) =>
      m.id === id ? { ...m, ...patch } : m,
    );
    write(MEALS_KEY, next);
  }, []);

  const deleteMeal = useCallback((id: string) => {
    const next = read<MealEntry[]>(MEALS_KEY, []).filter((m) => m.id !== id);
    write(MEALS_KEY, next);
  }, []);

  return { meals, addMeal, updateMeal, deleteMeal };
}

// --- Profile ----------------------------------------------------------------

let profileCache: Profile = DEFAULT_PROFILE;
let profileCacheRaw: string | null = null;

function getProfileSnapshot(): Profile {
  if (typeof window === "undefined") return profileCache;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (raw !== profileCacheRaw) {
    profileCacheRaw = raw;
    try {
      profileCache = raw
        ? { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Profile) }
        : DEFAULT_PROFILE;
    } catch {
      profileCache = DEFAULT_PROFILE;
    }
  }
  return profileCache;
}

export function useProfile() {
  const profile = useSyncExternalStore(
    subscribe,
    getProfileSnapshot,
    () => profileCache,
  );

  const setGoals = useCallback((goals: Goals) => {
    const current = read<Profile>(PROFILE_KEY, DEFAULT_PROFILE);
    write(PROFILE_KEY, { ...current, goals });
  }, []);

  const setName = useCallback((name: string) => {
    const current = read<Profile>(PROFILE_KEY, DEFAULT_PROFILE);
    write(PROFILE_KEY, { ...current, name });
  }, []);

  return { profile, setGoals, setName };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
