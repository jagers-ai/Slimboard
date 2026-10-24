import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, rm, symlink, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendUsageRecord, estimateUsageCost, readTokenUsage } from "../lib/openai-usage.ts";

const raw = {
  input_tokens: 12000,
  input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 } },
  output_tokens: 1000, output_tokens_details: { reasoning_tokens: 600 }, total_tokens: 13000,
};

test("prices cache reads, both write lifetimes and output without double-counting reasoning", () => {
  const usage = readTokenUsage(raw);
  const cost = estimateUsageCost(usage, "gpt-6.1-sol", "default");
  // $0.002 ordinary + $0.0004 read + $0.0075 30m write + $0.02 12h write + $0.01 output.
  assert.equal(cost.inputUsd, 0.0299);
  assert.equal(cost.outputUsd, 0.01);
  assert.equal(cost.usd, 0.0399);
  assert.equal(cost.krwReference, 55.86);
  assert.equal(cost.pricingDate, "2026-10-24");
  assert.equal(usage.reasoningTokens, 600);
  assert.equal(usage.cacheWriteBreakdownSource, "provider");
});

test("uses the actual model and service tier, and leaves unsupported or absent pricing unknown", () => {
  const usage = readTokenUsage(raw);
  assert.equal(estimateUsageCost(usage, "gpt-6.1-sol-2026-09-29", "default").usd, 0.0399);
  assert.equal(estimateUsageCost(usage, "gpt-6.1-sol", "priority").usd, 0.0798);
  assert.equal(estimateUsageCost(usage, "gpt-6.1-sol", "flex").usd, 0.01995);
  assert.equal(estimateUsageCost(usage, "gpt-6.1-sol", "ultrafast").usd, 0.2394);
  for (const [u, model, tier] of [[null, "gpt-6.1-sol", "default"], [usage, "gpt-6.1-sol-pro", "default"], [usage, "gpt-6.1-sol", null], [usage, null, "default"]]) {
    assert.equal(estimateUsageCost(u, model, tier), null);
  }
});

test("long-context rates apply at the documented boundary", () => {
  const usage = (n) => readTokenUsage({ input_tokens: n, output_tokens: 1000, total_tokens: n + 1000 });
  assert.equal(estimateUsageCost(usage(272000), "gpt-6.1-sol", "default").usd, 0.554);
  assert.equal(estimateUsageCost(usage(272001), "gpt-6.1-sol", "default").usd, 1.103004);
});

test("missing usage stays unknown and inconsistent token counts are rejected", () => {
  for (const u of [undefined, null, {}, { ...raw, input_tokens: -1 }, { ...raw, output_tokens: 1.2 },
    { ...raw, total_tokens: 1 }, { ...raw, output_tokens_details: { reasoning_tokens: 2000 } },
    { ...raw, input_tokens_details: { cached_tokens: 15000 } },
    { ...raw, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 4, cache_write_tokens_details: { ttl_30m_tokens: 2, ttl_12h_tokens: 1 } } },
  ]) assert.equal(readTokenUsage(u), null);
  const legacy = readTokenUsage({ input_tokens: 10, output_tokens: 2, total_tokens: 12 });
  assert.equal(legacy.reasoningTokens, null);
  const defaultTtl = readTokenUsage({ ...raw, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 100 } });
  assert.equal(defaultTtl.cacheWrite30mTokens, 100);
  assert.equal(defaultTtl.cacheWriteBreakdownSource, "request-default-30m");
});

const record = {
  version: 1, id: "test", timestamp: "2026-10-24T00:00:00.000Z", requestedModel: "gpt-6.1-sol", responseModel: "gpt-6.1-sol",
  reasoningEffort: "medium", serviceTier: "default", responseId: "resp_test", requestId: "req_test", source: "camera-lab",
  status: "completed", errorCode: null, elapsedMs: 6000, usage: readTokenUsage(raw),
  cost: estimateUsageCost(readTokenUsage(raw), "gpt-6.1-sol", "default"),
};

test("usage records append as private JSONL and concurrent requests remain distinct", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slimboard-usage-"));
  try {
    await Promise.all(Array.from({ length: 10 }, (_, i) => appendUsageRecord({ ...record, id: `test-${i}` }, directory)));
    const file = join(directory, "openai-2026-10.jsonl");
    const rows = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(rows.length, 10);
    assert.equal(new Set(rows.map((r) => r.id)).size, 10);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("log writes refuse symlink directories, symlink files and hardlinked targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "slimboard-usage-links-"));
  try {
    const target = join(root, "keep.txt");
    await writeFile(target, "keep unchanged");
    const directory = join(root, "alias");
    await symlink(root, directory);
    await assert.rejects(appendUsageRecord(record, directory));
    const file = join(root, "openai-2026-10.jsonl");
    await symlink(target, file);
    await assert.rejects(appendUsageRecord(record, root));
    await rm(file);
    await link(target, file);
    await assert.rejects(appendUsageRecord(record, root));
    assert.equal(await readFile(target, "utf8"), "keep unchanged");
  } finally { await rm(root, { recursive: true, force: true }); }
});
