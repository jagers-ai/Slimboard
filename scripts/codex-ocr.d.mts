import type { Buffer } from "node:buffer";

export const MAX_IMAGE_BYTES: number;
export type CodexOptions = {
  binary?: string;
  codexHome?: string;
  timeoutMs?: number;
  model?: string;
};
export type CodexAuthStatus = {
  available: boolean;
  authenticated: boolean;
  mode: "chatgpt" | "apikey" | null;
  message: string;
};
export type CodexAnalysis = {
  title: string;
  rawText: string;
  summary: string;
  keywords: string[];
};
export class CodexOcrError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export function checkCodexAuth(options?: CodexOptions): Promise<CodexAuthStatus>;
export function analyzeWithCodex(
  buffer: Buffer,
  mimeType?: string,
  options?: CodexOptions,
): Promise<{ analysis: CodexAnalysis; model: string; elapsedMs: number }>;
