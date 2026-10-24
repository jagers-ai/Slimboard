// Volatile, account-scoped drafts only. Photos and recovery receipts never enter
// localStorage/IndexedDB. Full logout/reload drops the entire heap.
const drafts = new Map<string, unknown>();
const listeners = new Set<() => void>();
let epoch = 0;
export function draftEpoch() { return epoch; }
export function subscribeDrafts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function notify() { listeners.forEach(listener => listener()); }
export function readDraft<T>(key: string): T | undefined { return drafts.get(key) as T | undefined; }
export function writeDraft<T>(key: string, value: T) { drafts.set(key, value); notify(); }
export function clearDraft(key: string) { drafts.delete(key); notify(); }
export function clearAllDrafts() { epoch++; drafts.clear(); notify(); }
