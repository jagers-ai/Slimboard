"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/** Read a browser-only value after hydration. `read` must return a stable primitive. */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscription, read, () => serverValue);
}
