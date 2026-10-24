"use client";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import { readDraft, writeDraft, clearDraft, subscribeDrafts, draftEpoch } from "@/lib/session-drafts";

export function useSessionDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readDraft<T>(key) ?? initial);
  const current = useRef(value);
  const epoch = useRef(draftEpoch());
  useEffect(() => subscribeDrafts(() => {
    const latest = readDraft<T>(key);
    if (latest !== undefined) { current.current = latest; setValue(latest); }
  }), [key]);
  function update(next: SetStateAction<T>) {
    if (epoch.current !== draftEpoch()) return;
    const resolved = typeof next === "function" ? (next as (value: T) => T)(current.current) : next;
    current.current = resolved;
    writeDraft(key, resolved);
    setValue(resolved);
  }
  return [value, update, () => { if (epoch.current === draftEpoch()) clearDraft(key); }] as const;
}
export function useUnloadWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
