import type { User } from "@supabase/supabase-js";

import {
  ANALYSIS_VERSION,
  PROMPT_VERSION,
  analyzeWhiteboardImageWithFallback,
  shouldRetryWithOriginal,
} from "@/lib/gemini";
import { buildSearchText } from "@/lib/search";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createSignedImageUrl,
  downloadImageObject,
  removeImageObjects,
} from "@/lib/storage";
import type { GeminiAnalysis, NoteWithImageUrl, WhiteboardNote } from "@/lib/types";

export async function userCanAccessNote(noteId: string, userId: string) {
  const note = await getNoteForUser(noteId, userId);

  return Boolean(note);
}

export async function listNotesForUser(input: {
  userId: string;
  query?: string;
  limit?: number;
}) {
  const supabase = createAdminClient();
  const workspaceIds = await getAccessibleWorkspaceIds(input.userId);

  if (workspaceIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("whiteboard_notes")
    .select("*")
    .in("workspace_id", workspaceIds)
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

  const notes = (data ?? []) as WhiteboardNote[];

  return Promise.all(
    notes.map(async (note) => ({
      ...note,
      image_url: await createSignedImageUrl(note.analysis_image_path),
    })),
  ) satisfies Promise<NoteWithImageUrl[]>;
}

export async function getNoteForUser(noteId: string, userId: string) {
  const supabase = createAdminClient();
  const workspaceIds = await getAccessibleWorkspaceIds(userId);

  if (workspaceIds.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("whiteboard_notes")
    .select("*")
    .eq("id", noteId)
    .in("workspace_id", workspaceIds)
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
    image_url: await createSignedImageUrl(note.original_image_path),
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
  const note = await getNoteForUser(input.noteId, input.userId);

  if (!note) {
    return null;
  }

  const keywords = note.keywords ?? [];
  const visualContext = note.visual_context ?? "";
  const searchText = buildSearchText({
    title: input.title,
    raw_text: input.rawText,
    summary: input.summary,
    keywords,
    visual_context: visualContext,
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
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as WhiteboardNote;
}

export async function deleteNoteForUser(noteId: string, userId: string) {
  const supabase = createAdminClient();
  const note = await getNoteForUser(noteId, userId);

  if (!note) {
    return false;
  }

  await removeImageObjects([note.original_image_path, note.analysis_image_path]);

  const { error } = await supabase
    .from("whiteboard_notes")
    .delete()
    .eq("id", noteId)
    .eq("owner_user_id", userId);

  if (error) {
    throw error;
  }

  return true;
}

export async function analyzeNoteForUser(noteId: string, user: User) {
  const supabase = createAdminClient();
  const note = await getNoteForUser(noteId, user.id);

  if (!note) {
    throw new Error("Note not found.");
  }

  await supabase
    .from("whiteboard_notes")
    .update({
      status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("owner_user_id", user.id);

  try {
    const analysisImage = await downloadImageObject(note.analysis_image_path);
    let result = await analyzeWhiteboardImageWithFallback({
      buffer: analysisImage,
      mimeType: "image/jpeg",
    });
    let fallbackModel = result.fallbackModel;

    if (shouldRetryWithOriginal(result.analysis)) {
      const originalImage = await downloadImageObject(note.original_image_path);

      if (originalImage.length <= 18 * 1024 * 1024) {
        const originalResult = await analyzeWhiteboardImageWithFallback({
          buffer: originalImage,
          mimeType: getMimeTypeFromPath(note.original_image_path),
        });

        if (scoreAnalysis(originalResult.analysis) >= scoreAnalysis(result.analysis)) {
          fallbackModel = originalResult.fallbackModel;
          result = originalResult;
        }
      }
    }

    const update = mapAnalysisToUpdate(result.analysis, {
      model: result.model,
      fallbackModel,
    });

    const { data, error } = await supabase
      .from("whiteboard_notes")
      .update(update)
      .eq("id", noteId)
      .eq("owner_user_id", user.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as WhiteboardNote;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    await supabase
      .from("whiteboard_notes")
      .update({
        status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", noteId)
      .eq("owner_user_id", user.id);

    throw error;
  }
}

function mapAnalysisToUpdate(
  analysis: GeminiAnalysis,
  meta: { model: string; fallbackModel: string | null },
) {
  const searchText = buildSearchText({
    title: analysis.title,
    raw_text: analysis.rawText,
    summary: analysis.summary,
    keywords: analysis.keywords,
    visual_context: analysis.visualContext,
  });

  return {
    title: analysis.title,
    raw_text: analysis.rawText,
    summary: analysis.summary,
    keywords: analysis.keywords,
    visual_context: analysis.visualContext,
    detected_languages: analysis.detectedLanguages,
    warnings: analysis.warnings,
    model: meta.model,
    fallback_model: meta.fallbackModel,
    prompt_version: PROMPT_VERSION,
    analysis_version: ANALYSIS_VERSION,
    search_text: searchText,
    status: "completed",
    error_message: null,
    updated_at: new Date().toISOString(),
  };
}

function scoreAnalysis(analysis: GeminiAnalysis) {
  return analysis.rawText.length + analysis.summary.length - analysis.warnings.length * 50;
}

function getMimeTypeFromPath(path: string) {
  if (path.endsWith(".png")) {
    return "image/png";
  }

  if (path.endsWith(".webp")) {
    return "image/webp";
  }

  if (path.endsWith(".heic")) {
    return "image/heic";
  }

  if (path.endsWith(".heif")) {
    return "image/heif";
  }

  return "image/jpeg";
}

async function getAccessibleWorkspaceIds(userId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => row.workspace_id as string);
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
