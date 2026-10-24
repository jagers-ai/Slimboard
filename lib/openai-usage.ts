import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_DIRECTORY = join(homedir(), ".slimboard", "usage");
export const PRICING_DATE = "2026-10-24";
export const USD_KRW_REFERENCE = 1400; // Reference conversion, not a live/card FX rate.

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  cacheWrite30mTokens: number;
  cacheWrite12hTokens: number;
  cacheWriteBreakdownSource: "provider" | "request-default-30m";
  outputTokens: number;
  reasoningTokens: number | null;
  totalTokens: number;
};

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

export function readTokenUsage(value: unknown): TokenUsage | null {
  if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens) ||
      !count(value.total_tokens) || value.total_tokens !== value.input_tokens + value.output_tokens) return null;
  const input = object(value.input_tokens_details) ? value.input_tokens_details : {};
  const output = object(value.output_tokens_details) ? value.output_tokens_details : {};
  const cached = input.cached_tokens ?? 0;
  const written = input.cache_write_tokens ?? 0;
  const split = object(input.cache_write_tokens_details) ? input.cache_write_tokens_details : null;
  // This request does not override the API's documented default 30-minute TTL.
  const write30m = split ? split.ttl_30m_tokens ?? 0 : written;
  const write12h = split ? split.ttl_12h_tokens ?? 0 : 0;
  const reasoning = output.reasoning_tokens ?? null;
  if (![cached, written, write30m, write12h].every(count) ||
      (reasoning !== null && (!count(reasoning) || reasoning > value.output_tokens))) return null;
  if (Number(cached) + Number(written) > value.input_tokens || Number(write30m) + Number(write12h) !== written) return null;
  return {
    inputTokens: value.input_tokens, cachedInputTokens: Number(cached), cacheWriteTokens: Number(written),
    cacheWrite30mTokens: Number(write30m), cacheWrite12hTokens: Number(write12h),
    cacheWriteBreakdownSource: split ? "provider" : "request-default-30m",
    outputTokens: value.output_tokens, reasoningTokens: reasoning as number | null, totalTokens: value.total_tokens,
  };
}

export function estimateUsageCost(usage: TokenUsage | null, model: string | null, tier: string | null) {
  const base = model && /^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
    ? { input: 2, cached: 0.1, output: 10 }
    : model && /^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
      ? { input: 10, cached: 1, output: 50 } : null;
  const factor = tier === "default" ? 1 : tier === "flex" ? 0.5 : tier === "priority" || tier === "fast" ? 2 : tier === "ultrafast" ? 6 : null;
  if (!usage || !base || factor === null) return null;
  const longContext = usage.inputTokens > 272_000;
  const rates = {
    input: base.input * factor * (longContext ? 2 : 1),
    cachedInput: base.cached * factor * (longContext ? 2 : 1),
    cacheWrite30m: base.input * 1.25 * factor * (longContext ? 2 : 1),
    cacheWrite12h: base.input * 2.5 * factor * (longContext ? 2 : 1),
    output: base.output * factor * (longContext ? 1.5 : 1),
  };
  const ordinaryInput = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
  const inputUsd = (ordinaryInput * rates.input + usage.cachedInputTokens * rates.cachedInput +
    usage.cacheWrite30mTokens * rates.cacheWrite30m + usage.cacheWrite12hTokens * rates.cacheWrite12h) / 1_000_000;
  // Reasoning is already included in outputTokens; never charge it twice.
  const outputUsd = usage.outputTokens * rates.output / 1_000_000;
  const round = (n: number) => Math.round(n * 1e9) / 1e9;
  const usd = round(inputUsd + outputUsd);
  return {
    kind: "usage-based-estimate" as const, pricingDate: PRICING_DATE, ratesPerMillionUsd: rates,
    inputUsd: round(inputUsd), outputUsd: round(outputUsd), usd,
    krwReference: Math.round(usd * USD_KRW_REFERENCE * 100) / 100,
    usdKrwReference: USD_KRW_REFERENCE, excludesTax: true,
  };
}

export type UsageRecord = {
  version: 1;
  id: string;
  timestamp: string;
  requestedModel: string | null;
  responseModel: string | null;
  reasoningEffort: string;
  serviceTier: string | null;
  responseId: string | null;
  requestId: string | null;
  source: "camera-lab" | "saved-note" | "direct";
  status: "completed" | "failed";
  errorCode: string | null;
  elapsedMs: number;
  usage: TokenUsage | null;
  cost: ReturnType<typeof estimateUsageCost>;
};

export async function appendUsageRecord(record: UsageRecord, directory = USAGE_DIRECTORY) {
  if (directory === USAGE_DIRECTORY) {
    const parent = join(homedir(), ".slimboard");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (!(await lstat(parent)).isDirectory()) throw new Error("Invalid usage directory");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error("Invalid usage directory");
  await chmod(directory, 0o700);
  const month = record.timestamp.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid usage date");
  const path = join(directory, `openai-${month}.jsonl`);
  const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("Invalid usage file");
    await file.chmod(0o600);
    await file.writeFile(JSON.stringify(record) + "\n");
    await file.sync();
  } finally { await file.close(); }
}
