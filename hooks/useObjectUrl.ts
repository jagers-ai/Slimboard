"use client";

import { useEffect, useState } from "react";

/** Own each preview URL for exactly the lifetime of its source blob. */
export function useObjectUrl(blob: Blob | null): string | undefined {
  const [preview, setPreview] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // The URL is an external resource, so this effect has to own its whole lifetime.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview({ blob, url });
    return () => { URL.revokeObjectURL(url); setPreview(undefined); };
  }, [blob]);
  // Never display the previous photo while the next effect is pending.
  return preview?.blob === blob ? preview.url : undefined;
}
