import type { WhiteboardAnalysis } from "./types.ts";

const ENDPOINT = "/api/lab/codex";
const INVALID_RESPONSE = "사진을 정리하지 못했어요. 잠시 후 다시 시도해주세요.";
type Fetch = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function checkCameraReady(signal: AbortSignal, request: Fetch = fetch): Promise<boolean> {
  const response = await request(ENDPOINT, { cache: "no-store", signal });
  if (!response.ok) return false;
  const payload: unknown = await response.json();
  return isRecord(payload) && payload.ready === true;
}

export async function analyzeCameraPhoto(photo: File, signal: AbortSignal, request: Fetch = fetch): Promise<WhiteboardAnalysis> {
  const form = new FormData();
  form.append("image", photo);
  const response = await request(ENDPOINT, { method: "POST", body: form, signal });
  // The HTTPS gateway may return text/HTML; never show its body as an error.
  if (response.status === 401 || response.status === 410) {
    throw new Error("초대 링크가 만료되었어요. 새 초대 링크로 다시 열어주세요.");
  }
  if (response.status === 429) throw new Error("이번 초대의 분석 횟수를 모두 사용했어요.");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error(INVALID_RESPONSE); }
  if (!response.ok) {
    throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : INVALID_RESPONSE);
  }
  const analysis = isRecord(payload) ? payload.analysis : null;
  if (!isRecord(analysis) || typeof analysis.title !== "string" || typeof analysis.summary !== "string"
    || typeof analysis.rawText !== "string" || !Array.isArray(analysis.keywords)
    || !analysis.keywords.every((word) => typeof word === "string")) {
    throw new Error(INVALID_RESPONSE);
  }
  // Keep only UI content in session memory; accounting stays in the server ledger.
  return { title: analysis.title, summary: analysis.summary, rawText: analysis.rawText, keywords: analysis.keywords };
}

export function cameraErrorMessage(failure: unknown): string {
  return failure instanceof TypeError
    ? "연결이 끊겼어요. 인터넷 연결을 확인한 뒤 다시 시도해주세요."
    : failure instanceof Error ? failure.message : INVALID_RESPONSE;
}
