import { GoogleGenAI, Type } from "@google/genai";

import { getEnv } from "@/lib/env";
import { normalizeAnalysis } from "@/lib/search";
import type { GeminiAnalysis } from "@/lib/types";

export const GEMINI_MODEL = "gemini-3-flash-preview";
export const PROMPT_VERSION = "whiteboard-v2";
export const ANALYSIS_VERSION = "1";

const WHITEBOARD_PROMPT = `
You are Slimboard, a careful multimodal OCR assistant for whiteboard photos.

Return only JSON that matches the schema.

Rules:
- Preserve the visible whiteboard text as rawText. Keep Korean, English, numbers, and symbols as written.
- Do not invent unreadable content. Mark uncertain or unreadable parts as "[읽기 어려움]".
- Write the title in concise Korean based only on visible content.
- Summarize the core content in natural Korean honorific style.
- Keep the summary focused on what happened, what was decided, and what action is needed.
- Do not describe image quality, screen layout, glare, UI chrome, or visual context unless it is part of the actual note content.
- Capture useful keywords for search. Prefer concrete nouns, product names, errors, domains, and actions.
`.trim();

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    rawText: { type: Type.STRING },
    summary: { type: Type.STRING },
    keywords: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    "title",
    "rawText",
    "summary",
    "keywords",
  ],
};

export async function analyzeWhiteboardImage(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ analysis: GeminiAnalysis; model: string }> {
  const env = getEnv();
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: WHITEBOARD_PROMPT },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.buffer.toString("base64"),
            },
          },
        ],
      },
    ],
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseJsonSchema: responseSchema,
    },
  });

  const text = response.text;

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return {
    analysis: normalizeAnalysis(parseJson(text)),
    model: GEMINI_MODEL,
  };
}

function parseJson(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(withoutFence) as Partial<GeminiAnalysis>;
}
