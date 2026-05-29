"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { CaptureSheet } from "./CaptureSheet";

interface CaptureContextValue {
  open: boolean;
  openCapture: () => void;
  closeCapture: () => void;
}

const CaptureContext = createContext<CaptureContextValue | null>(null);

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openCapture = useCallback(() => setOpen(true), []);
  const closeCapture = useCallback(() => setOpen(false), []);

  return (
    <CaptureContext.Provider value={{ open, openCapture, closeCapture }}>
      {children}
      <CaptureSheet open={open} onClose={closeCapture} />
    </CaptureContext.Provider>
  );
}

export function useCapture(): CaptureContextValue {
  const ctx = useContext(CaptureContext);
  if (!ctx) throw new Error("useCapture must be used within CaptureProvider");
  return ctx;
}
