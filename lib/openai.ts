import { analyzeWithOpenAI } from "@/lib/openai-ocr";

export const PROMPT_VERSION = "whiteboard-openai-v1";
export const ANALYSIS_VERSION = "1";

export async function analyzeWhiteboardImage(input: { buffer: Buffer; mimeType: string }) {
  return analyzeWithOpenAI(input.buffer, input.mimeType, { source: "saved-note" });
}
