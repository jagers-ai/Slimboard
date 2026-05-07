import {
  ANALYSIS_VERSION,
  PROMPT_VERSION,
  analyzeWhiteboardImage,
} from "@/lib/gemini";
import type { AppUser } from "@/lib/auth";
import { buildSearchText } from "@/lib/search";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createSignedImageUrl,
  createSignedImageUrls,
  downloadImageObject,
  removeImageObjects,
} from "@/lib/storage";
import type { GeminiAnalysis, NotePreview, NoteWithImageUrl, WhiteboardNote } from "@/lib/types";

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
  const workspaceIds = await getAccessibleWorkspaceIds(input.userId);

  if (workspaceIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("whiteboard_notes")
    .select(NOTE_PREVIEW_SELECT)
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

  const notes = (data ?? []) as Array<Omit<NotePreview, "image_url">>;

  if (input.includeImageUrl === false) {
    return notes.map((note) => ({
      ...note,
      image_url: null,
    })) satisfies NotePreview[];
  }

  const signedUrls = await createSignedImageUrls(notes.map((note) => note.analysis_image_path));

  return notes.map((note) => ({
    ...note,
    image_url: signedUrls.get(note.analysis_image_path) ?? null,
  })) satisfies NotePreview[];
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

export async function analyzeNoteForUser(noteId: string, user: AppUser) {
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
    const result = await analyzeWhiteboardImage({
      buffer: analysisImage,
      mimeType: "image/jpeg",
    });

    const update = mapAnalysisToUpdate(result.analysis, {
      model: result.model,
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
