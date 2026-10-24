"use client";

import { useEffect, useState } from "react";

/** Own each preview URL for exactly the lifetime of its source blob. */
export function useObjectUrl(blob: Blob | null): string | undefined {
  const [preview, setPreview] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) { setPreview(undefined); return; }
    const url = URL.createObjectURL(blob);
    setPreview({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // Never display the previous photo while the next effect is pending.
  return preview?.blob === blob ? preview.url : undefined;
}
