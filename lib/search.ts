import type { GeminiAnalysis } from "@/lib/types";

export function buildSearchText(input: {
  title?: string | null;
  raw_text?: string | null;
  summary?: string | null;
  keywords?: string[] | null;
}) {
  return [
    input.title,
    input.raw_text,
    input.summary,
    ...(input.keywords ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function normalizeAnalysis(analysis: Partial<GeminiAnalysis>): GeminiAnalysis {
  return {
    title: cleanText(analysis.title) || "Untitled whiteboard",
    rawText: cleanText(analysis.rawText),
    summary: cleanText(analysis.summary),
    keywords: cleanList(analysis.keywords).slice(0, 16),
  };
}

function cleanText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function cleanList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  );
}
