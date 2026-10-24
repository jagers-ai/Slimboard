import { randomUUID } from "node:crypto";
import { openRecovery, sealRecovery, saveAnalysisResult } from "@/lib/analysis-recovery";
import { deleteOwnedNote, getOwnedNote } from "@/lib/note-mutations";
import {
  ANALYSIS_VERSION,
  PROMPT_VERSION,
  analyzeWhiteboardImage,
} from "@/lib/openai";
import type { AppUser } from "@/lib/auth";
import { buildSearchText } from "@/lib/search";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  downloadImageObject,
  removeImageObjects,
} from "@/lib/storage";
import type { WhiteboardAnalysis, NotePreview, NoteWithImageUrl, WhiteboardNote } from "@/lib/types";

const NOTE_PREVIEW_SELECT =
  "id,title,raw_text,summary,analysis_image_path,status,created_at";

export async function userCanAccessNote(noteId: string, userId: string) {
  const note = await getNoteForUser(noteId, userId);

  return Boolean(note);
}

export async function listNotesForUser(input: {
  userId: string;
  query?: string;
  limit?: number;
  includeImageUrl?: boolean;
}) {
  const supabase = createAdminClient();

  let query = supabase
    .from("whiteboard_notes")
    .select(NOTE_PREVIEW_SELECT)
    .eq("owner_user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 30);

  const normalizedQuery = input.query?.trim();

  if (normalizedQuery) {
    query = query.ilike("search_text", `%${escapeIlikePattern(normalizedQuery)}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const notes = (data ?? []) as Array<Omit<NotePreview, "image_url">>;

  if (input.includeImageUrl === false) {
    return notes.map((note) => ({
      ...note,
      image_url: null,
    })) satisfies NotePreview[];
  }

  return notes.map((note) => ({
    ...note,
    image_url: `/api/notes/${note.id}/image`,
  })) satisfies NotePreview[];
}

export async function getNoteForUser(noteId: string, userId: string) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("whiteboard_notes")
    .select("*")
    .eq("id", noteId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data ?? null) as WhiteboardNote | null;
}

export async function getNoteWithImageUrl(noteId: string, userId: string) {
  const note = await getNoteForUser(noteId, userId);

  if (!note) {
    return null;
  }

  return {
    ...note,
    image_url: `/api/notes/${note.id}/image`,
  } satisfies NoteWithImageUrl;
}

export async function updateNoteForUser(input: {
  noteId: string;
  userId: string;
  title: string;
  rawText: string;
  summary: string;
}) {
  const supabase = createAdminClient();
  const note = await getOwnedNote(input.noteId, input.userId, getNoteForUser);

  if (!note) {
    return null;
  }

  const keywords = note.keywords ?? [];
  const searchText = buildSearchText({
    title: input.title,
    raw_text: input.rawText,
    summary: input.summary,
    keywords,
  });

  const { data, error } = await supabase
    .from("whiteboard_notes")
    .update({
      title: input.title.trim() || "Untitled whiteboard",
      raw_text: input.rawText,
      summary: input.summary,
      search_text: searchText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.noteId)
    .eq("owner_user_id", input.userId)
    .or("status.neq.processing,analysis_attempt.is.null")
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as WhiteboardNote;
}

export async function deleteNoteForUser(noteId: string, userId: string) {
  return deleteOwnedNote(noteId, userId, {
    load: getNoteForUser,
    deleteRow: async (id, ownerId) => {
      const { data, error } = await createAdminClient()
        .from("whiteboard_notes")
        .delete()
        .eq("id", id)
        .eq("owner_user_id", ownerId)
        .or("status.neq.processing,analysis_attempt.is.null")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    removeImages: async paths => {
      await removeImageObjects(paths);
      const { error } = await createAdminClient().from("note_image_cleanup").delete().eq("note_id", noteId).eq("owner_user_id", userId);
      if (error) throw error;
    },
    onCleanupFailure: () => console.warn("Deleted note image cleanup failed; storage cleanup required."),
  });
}

type AnalysisUpdate = ReturnType<typeof mapAnalysisToUpdate>;
type Recovery = { owner: string; note: string; attempt: string; expires: number; update: AnalysisUpdate };

export class NoteOperationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function analyzeNoteForUser(noteId: string, user: AppUser, options: { recovery?: string; force?: boolean } = {}) {
  const supabase = createAdminClient();
  const note = await getOwnedNote(noteId, user.id, getNoteForUser);
  if (!note) throw new NoteOperationError("기록을 찾을 수 없어요.", 404);
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const persist = async (attempt: string, update: AnalysisUpdate) => {
    const { data, error } = await supabase.from("whiteboard_notes").update(update)
      .eq("id", noteId).eq("owner_user_id", user.id).eq("analysis_attempt", attempt).eq("status", "processing").select("*").maybeSingle();
    if (error) throw new Error("Result save failed");
    if (data) return data as WhiteboardNote;
    // The first write may have committed even if its response was lost. Read
    // through instead of overwriting a later human edit with the AI result.
    const current = await getNoteForUser(noteId, user.id);
    if (current?.analysis_attempt === attempt && current.status === "completed") return current;
    throw new Error("Result save failed");
  };
  if (options.recovery) {
    let receipt: Recovery;
    try { receipt = openRecovery<Recovery>(options.recovery, secret); }
    catch { throw new NoteOperationError("저장 정보를 확인하지 못했어요.", 400); }
    if (receipt.owner !== user.id || receipt.note !== noteId || receipt.expires < Date.now() || receipt.attempt !== note.analysis_attempt) {
      throw new NoteOperationError("이 기록의 저장 정보가 만료되었거나 변경됐어요.", 409);
    }
    if (note.status === "completed") return { note };
    if (note.status !== "processing") throw new NoteOperationError("기록 상태가 변경됐어요.", 409);
    return saveAnalysisResult(() => persist(receipt.attempt, receipt.update), options.recovery);
  }
  const attempt = randomUUID();
  const { data: claim, error: claimError } = await supabase.rpc("claim_note_analysis", {
    p_note: noteId, p_owner: user.id, p_attempt: attempt, p_force: options.force === true,
  });
  if (claimError) throw new NoteOperationError("분석을 준비하지 못했어요. 잠시 뒤 다시 시도해주세요.", 503);
  if (claim === "completed") return { note: await getNoteForUser(noteId, user.id) };
  if (claim !== "claimed") {
    const messages: Record<string, string> = {
      busy: "이미 분석 중이거나 이전 요청의 결과를 확인 중이에요. 중복 분석은 시작하지 않았어요.",
      image_pending: "사진 저장을 먼저 완료해주세요.",
      retry_required: "이전 분석이 실패했어요. 기록 화면에서 재분석을 선택해주세요.",
      rate_limited: "분석 요청이 많아요. 잠시 뒤 다시 시도해주세요.",
    };
    throw new NoteOperationError(messages[String(claim)] ?? "기록을 찾을 수 없어요.", claim === "rate_limited" ? 429 : 409);
  }
  let result;
  try {
    const image = await downloadImageObject(note.analysis_image_path);
    result = await analyzeWhiteboardImage({ buffer: image, mimeType: "image/jpeg" });
  } catch {
    await supabase.from("whiteboard_notes").update({ status: "failed", error_message: "분석에 실패했어요. 사진은 저장되어 있어요.", updated_at: new Date().toISOString() })
      .eq("id", noteId).eq("owner_user_id", user.id).eq("analysis_attempt", attempt);
    throw new NoteOperationError("분석에 실패했어요. 사진은 저장되어 있어요. 재분석은 별도 요청으로 진행됩니다.", 502);
  }
  const update = mapAnalysisToUpdate(result.analysis, { model: result.model });
  const recovery = sealRecovery({ owner: user.id, note: noteId, attempt, expires: Date.now() + 7 * 86400_000, update } satisfies Recovery, secret);
  return saveAnalysisResult(() => persist(attempt, update), recovery);
}

function mapAnalysisToUpdate(
  analysis: WhiteboardAnalysis,
  meta: { model: string },
) {
  const searchText = buildSearchText({
    title: analysis.title,
    raw_text: analysis.rawText,
    summary: analysis.summary,
    keywords: analysis.keywords,
  });

  return {
    title: analysis.title,
    raw_text: analysis.rawText,
    summary: analysis.summary,
    keywords: analysis.keywords,
    visual_context: "",
    detected_languages: [],
    warnings: [],
    model: meta.model,
    fallback_model: null,
    prompt_version: PROMPT_VERSION,
    analysis_version: ANALYSIS_VERSION,
    search_text: searchText,
    status: "completed",
    error_message: null,
    updated_at: new Date().toISOString(),
  };
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
