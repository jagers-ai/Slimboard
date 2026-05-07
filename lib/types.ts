export type NoteStatus = "processing" | "completed" | "failed";

export type WhiteboardNote = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  title: string;
  raw_text: string;
  summary: string;
  keywords: string[];
  visual_context: string;
  detected_languages: string[];
  warnings: string[];
  original_image_path: string;
  analysis_image_path: string;
  status: NoteStatus;
  error_message: string | null;
  model: string | null;
  fallback_model: string | null;
  prompt_version: string;
  analysis_version: string;
  search_text: string;
  created_at: string;
  updated_at: string;
};

export type NoteWithImageUrl = WhiteboardNote & {
  image_url: string | null;
};

export type NotePreview = Pick<
  WhiteboardNote,
  | "id"
  | "title"
  | "raw_text"
  | "summary"
  | "visual_context"
  | "analysis_image_path"
  | "status"
  | "created_at"
> & {
  image_url: string | null;
};

export type GeminiAnalysis = {
  title: string;
  rawText: string;
  summary: string;
  keywords: string[];
  visualContext: string;
  detectedLanguages: string[];
  warnings: string[];
};
