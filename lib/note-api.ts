import type { WhiteboardNote } from "./types";
type NoteResponse = { error?: string; recovery?: string; note?: Pick<WhiteboardNote, "title" | "raw_text" | "summary"> };
export async function readNoteResponse(response: Response): Promise<NoteResponse> {
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error("결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요."); }
  if (!raw || typeof raw !== "object") throw new Error("결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.");
  const value = raw as Record<string, unknown>;
  const note = value.note as Record<string, unknown> | undefined;
  return {
    error: typeof value.error === "string" ? value.error : undefined,
    recovery: typeof value.recovery === "string" ? value.recovery : undefined,
    note: note && typeof note.title === "string" && typeof note.raw_text === "string" && typeof note.summary === "string"
      ? { title: note.title, raw_text: note.raw_text, summary: note.summary } : undefined,
  };
}
