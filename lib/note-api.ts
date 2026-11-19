import type { NoteEditorNote } from "./types";

type NoteResponse = { error?: string; recovery?: string; uploaded: boolean; usedUploadedImage: boolean; note?: NoteEditorNote };

function readEditorNote(value: unknown): NoteEditorNote | undefined {
  if (!value || typeof value !== "object") return;
  const { id, title, raw_text, summary, keywords, error_message, created_at, status } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof title !== "string" || typeof raw_text !== "string" ||
    typeof summary !== "string" || typeof created_at !== "string" ||
    (error_message !== null && typeof error_message !== "string") ||
    (status !== "processing" && status !== "completed" && status !== "failed") ||
    !Array.isArray(keywords) || !keywords.every(word => typeof word === "string")) return;
  return { id, title, raw_text, summary, keywords, error_message, created_at, status };
}
/** fetch() rejects with a browser-specific English TypeError ("Load failed", "Failed to fetch"). */
export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && !(error instanceof TypeError) ? error.message : fallback;
}
export async function readNoteResponse(response: Response): Promise<NoteResponse> {
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error("결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요."); }
  if (!raw || typeof raw !== "object") throw new Error("결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.");
  const value = raw as Record<string, unknown>;
  return {
    error: typeof value.error === "string" ? value.error : undefined,
    recovery: typeof value.recovery === "string" ? value.recovery : undefined,
    uploaded: value.uploaded === true,
    usedUploadedImage: value.usedUploadedImage === true,
    note: readEditorNote(value.note),
  };
}
