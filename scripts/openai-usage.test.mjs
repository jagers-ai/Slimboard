import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, rm, symlink, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeUsageRecord, estimateUsageCost, readTokenUsage } from "../lib/openai-usage.ts";

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

test("durable private usage write stores one parameterized record", async () => {
  let sql, parameters, writes = 0;
  const database = { prepare(query) { sql = query; return { bind(...values) { parameters = values; return { async run() { writes++; } }; } }; } };
  await writeUsageRecord(record, database);
  assert.match(sql, /INSERT INTO openai_usage/);
  assert.equal(writes, 1);
  assert.deepEqual(parameters, [record.id, record.timestamp, JSON.stringify(record)]);
});
test("a failed usage write is reported and never retries a paid analysis", async () => {
  const database = { prepare() { return { bind() { return { async run() { throw Error("storage unavailable"); } }; } }; } };
  await assert.rejects(writeUsageRecord(record, database));
});
