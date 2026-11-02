"use client";
import { useRef, useState } from "react";

import { useSessionDraft } from "@/hooks/useSessionDraft";
import { prepareCameraPhoto } from "@/lib/prepare-camera-photo";

export type PhotoDraft = { file: File | null; noteId: string | null; uploaded: boolean; recovery: string | null };

export const emptyPhotoDraft: PhotoDraft = { file: null, noteId: null, uploaded: false, recovery: null };

/**
 * The selected whiteboard photo, shared by the home "새 노트" sheet and the
 * photo review screen. Account-scoped memory only (see lib/session-drafts).
 */
export function useCaptureDraft(userId: string) {
  const [draft, setDraft, clearDraft] = useSessionDraft<PhotoDraft>(`${userId}:capture`, emptyPhotoDraft);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  /** Prepares a picked photo as the new draft. Resolves true when it was kept. */
  async function choose(next: File | undefined) {
    if (!next || busy.current) return false;
    if (draft.recovery && !window.confirm("아직 저장하지 못한 노트가 있어요. 새 사진을 고를까요?")) return false;
    busy.current = true;
    setPreparing(true);
    setError(null);
    try {
      const prepared = await prepareCameraPhoto(next);
      setDraft({ file: prepared, noteId: crypto.randomUUID(), uploaded: false, recovery: null });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사진을 준비하지 못했어요.");
      return false;
    } finally {
      busy.current = false;
      setPreparing(false);
    }
  }

  function discard() {
    if (draft.recovery && !window.confirm("아직 저장하지 못한 노트가 사라져요. 고른 사진을 지울까요?")) return false;
    setDraft(emptyPhotoDraft);
    clearDraft();
    setError(null);
    return true;
  }

  return { draft, setDraft, clearDraft, choose, discard, preparing, error, setError };
}
