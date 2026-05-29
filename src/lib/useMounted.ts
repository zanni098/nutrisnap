"use client";

import { useEffect, useState } from "react";

/** True after the first client render — used to avoid SSR/localStorage hydration mismatches. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Intentional: flip to true once on mount to gate client-only rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  return mounted;
}
