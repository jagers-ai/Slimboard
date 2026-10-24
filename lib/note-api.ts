import type { WhiteboardNote } from "./types";
type NoteResponse = { error?: string; recovery?: string; note?: Pick<WhiteboardNote, "title" | "raw_text" | "summary"> };
export async function readNoteResponse(response: Response): Promise<NoteResponse> {
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error("서버 응답을 확인하지 못했어요. 잠시 뒤 다시 시도해주세요."); }
  if (!raw || typeof raw !== "object") throw new Error("서버 응답을 확인하지 못했어요.");
  const value = raw as Record<string, unknown>;
  const note = value.note as Record<string, unknown> | undefined;
  return {
    error: typeof value.error === "string" ? value.error : undefined,
    recovery: typeof value.recovery === "string" ? value.recovery : undefined,
    note: note && typeof note.title === "string" && typeof note.raw_text === "string" && typeof note.summary === "string"
      ? { title: note.title, raw_text: note.raw_text, summary: note.summary } : undefined,
  };
}
