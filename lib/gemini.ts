import { GoogleGenAI, Type } from "@google/genai";

import { getEnv } from "@/lib/env";
import { normalizeAnalysis } from "@/lib/search";
import type { GeminiAnalysis } from "@/lib/types";

export const PROMPT_VERSION = "whiteboard-v1";
export const ANALYSIS_VERSION = "1";

const WHITEBOARD_PROMPT = `
You are Slimboard, a careful multimodal OCR assistant for whiteboard photos.

Return only JSON that matches the schema.

Rules:
- Preserve the visible whiteboard text as rawText. Keep Korean, English, numbers, and symbols as written.
- Do not invent unreadable content. Mark uncertain or unreadable parts as "[읽기 어려움]".
- Summarize the actual content in Korean.
- Capture useful keywords for search.
- Describe arrows, boxes, diagrams, relationships, and spatial grouping in visualContext.
- Add concise warnings for blur, glare, cut-off edges, very small text, low confidence, or privacy-sensitive-looking content.
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
    visualContext: { type: Type.STRING },
    detectedLanguages: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    warnings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    "title",
    "rawText",
    "summary",
    "keywords",
    "visualContext",
    "detectedLanguages",
    "warnings",
  ],
};

export async function analyzeWhiteboardImage(input: {
  buffer: Buffer;
  mimeType: string;
  model?: string;
}): Promise<{ analysis: GeminiAnalysis; model: string }> {
  const env = getEnv();
  const model = input.model ?? env.geminiModel;
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

  const response = await ai.models.generateContent({
    model,
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
    model,
  };
}

export async function analyzeWhiteboardImageWithFallback(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ analysis: GeminiAnalysis; model: string; fallbackModel: string | null }> {
  const env = getEnv();

  try {
    const result = await analyzeWhiteboardImage({
      ...input,
      model: env.geminiModel,
    });

    return {
      ...result,
      fallbackModel: null,
    };
  } catch (primaryError) {
    if (!env.geminiFallbackModel || env.geminiFallbackModel === env.geminiModel) {
      throw primaryError;
    }

    try {
      const result = await analyzeWhiteboardImage({
        ...input,
        model: env.geminiFallbackModel,
      });

      return {
        ...result,
        fallbackModel: env.geminiFallbackModel,
      };
    } catch (fallbackError) {
      const primaryMessage =
        primaryError instanceof Error ? primaryError.message : "Primary model failed.";
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : "Fallback model failed.";

      throw new Error(
        `Gemini analysis failed. Primary: ${primaryMessage} Fallback: ${fallbackMessage}`,
      );
    }
  }
}

export function shouldRetryWithOriginal(analysis: GeminiAnalysis) {
  const warningText = analysis.warnings.join(" ").toLowerCase();

  return (
    warningText.includes("작") ||
    warningText.includes("small") ||
    warningText.includes("low") ||
    warningText.includes("낮") ||
    warningText.includes("blur") ||
    warningText.includes("흐")
  );
}

function parseJson(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(withoutFence) as Partial<GeminiAnalysis>;
}
