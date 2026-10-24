import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypted, owner/note/attempt-bound result receipt. Browser memory only; never logs.
// A DB-only retry needs no further paid model request.
export function sealRecovery(value: object, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(`slimboard-recovery-v1:${secret}`).digest(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
export function openRecovery<T>(token: string, secret: string): T {
  if (token.length > 2_000_000) throw new Error("Invalid recovery receipt");
  const bytes = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(`slimboard-recovery-v1:${secret}`).digest(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as T;
}

export async function saveAnalysisResult<T>(save: () => Promise<T>, recovery: string): Promise<{ note: T } | { recovery: string; error: string }> {
  // Retrying an owner/attempt-filtered database write is safe; never retry AI here.
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return { note: await save() }; } catch { /* retain the original analysis */ }
  }
  return { recovery, error: "내용 정리는 끝났지만 저장하지 못했어요. 이 화면에서 저장만 다시 시도해주세요." };
}
