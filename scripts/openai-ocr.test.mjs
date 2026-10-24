import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWithOpenAI as analyze, MAX_IMAGE_BYTES } from "../lib/openai-ocr.ts";
const analyzeWithOpenAI = (image, mime, options = {}) => analyze(image, mime, { recordUsage: async () => {}, ...options });

const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const analysis = { title: "회의", rawText: "금요일 출시", summary: "금요일에 출시합니다.", keywords: ["출시"] };
const responseBody = (value = analysis) => ({ status: "completed", id: "resp_test", model: "gpt-6.1-sol", service_tier: "default",
usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100, cache_write_tokens_details: { ttl_30m_tokens: 100, ttl_12h_tokens: 0 } }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1300 }, output: [
  { type: "reasoning", summary: [] },
  { type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] },
] });

test("uses the existing server key for one structured vision request and returns usable note data", async () => {
  let calls = 0;
  const result = await analyzeWithOpenAI(image, "image/jpeg", {
    apiKey: "test-private-key",
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init.headers.Authorization, "Bearer test-private-key");
      assert.equal(init.redirect, "manual");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-6.1-sol");
      assert.equal(body.reasoning.effort, "medium");
      assert.equal(body.service_tier, "default");
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.input[0].content[1].image_url, "data:image/jpeg;base64," + image.toString("base64"));
      assert.equal(body.input[0].content[1].detail, "original");
      assert.equal(body.tools, undefined);
      return Response.json(responseBody());
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.analysis, analysis);
  assert.ok(result.elapsedMs >= 0);
  assert.equal(JSON.stringify(result).includes("test-private-key"), false);
  assert.equal(result.accounting.recorded, true);
  assert.equal(result.accounting.usage.reasoningTokens, 100);
  assert.equal(result.accounting.cost.usd, 0.00467);
});

test("records exactly one metadata-only accounting entry, including failed parsing of a billed response", async () => {
  for (const bad of [false, true]) {
    const records = [];
    const run = analyzeWithOpenAI(image, "image/jpeg", {
      apiKey: "private-secret", source: "camera-lab", recordUsage: async (r) => records.push(r),
      fetch: async () => Response.json(responseBody(bad ? { ...analysis, extra: "private-photo-text" } : analysis), { headers: { "x-request-id": "req_test" } }),
    });
    if (bad) await assert.rejects(run, { code: "INVALID_RESPONSE" }); else await run;
    assert.equal(records.length, 1);
    assert.equal(records[0].status, bad ? "failed" : "completed");
    assert.equal(records[0].usage.totalTokens, 1300);
    assert.equal(records[0].cost.usd, 0.00467);
    assert.equal(records[0].responseId, "resp_test");
    assert.equal(records[0].requestId, "req_test");
    assert.equal(records[0].source, "camera-lab");
    assert.doesNotMatch(JSON.stringify(records), /private-secret|private-photo-text|회의|금요일|data:image/);
  }
});

test("transport and HTTP errors record unknown usage, never a fabricated zero cost or retry", async () => {
  for (const transport of [async () => new Response("private error", { status: 429 }), async () => { throw Error("private error"); }]) {
    const records = [];
    await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", { apiKey: "test", fetch: transport, recordUsage: async (r) => records.push(r) }));
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "failed");
    assert.equal(records[0].usage, null);
    assert.equal(records[0].cost, null);
    assert.doesNotMatch(JSON.stringify(records), /private error/);
  }
});

test("logging failure preserves the paid result and explicitly reports it was not recorded", async () => {
  let calls = 0;
  const result = await analyzeWithOpenAI(image, "image/jpeg", {
    apiKey: "test", fetch: async () => { calls++; return Response.json(responseBody()); },
    recordUsage: async () => { throw Error("private file path"); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.analysis, analysis);
  assert.equal(result.accounting.recorded, false);
});

test("rejects invalid image bytes, oversize files, missing keys and invalid effort before calling the API", async () => {
  const never = async () => { assert.fail("must not call API"); };
  for (const [buffer, mime] of [[Buffer.alloc(0), "image/jpeg"], [image, "image/png"], [Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/jpeg"], [image, "text/plain"]]) {
    await assert.rejects(analyzeWithOpenAI(buffer, mime, { apiKey: "test", fetch: never }), { code: "INVALID_IMAGE" });
  }
  await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", { apiKey: "", fetch: never }), { code: "NOT_CONFIGURED" });
  await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", { apiKey: "test", reasoningEffort: "invalid", fetch: never }), { code: "INVALID_CONFIG" });
});

test("provider and network failures are not retried or leaked to callers", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", {
      apiKey: "private-secret",
      fetch: async () => { calls++; return new Response("sensitive provider detail private-secret", { status }); },
    }), (error) => error.code === `HTTP_${status}` && !error.message.includes("private-secret") && !error.message.includes("provider"));
    assert.equal(calls, 1);
  }
  await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", {
    apiKey: "test", fetch: async () => { throw new Error("private-secret"); },
  }), (error) => error.code === "REQUEST_FAILED" && !error.message.includes("private-secret"));
});

test("refusals, incomplete output, malformed JSON and wrong schemas cannot become saved notes", async () => {
  const invalid = [
    { ...responseBody(), status: "incomplete" },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] },
    responseBody({ ...analysis, extra: "unexpected" }),
    responseBody({ ...analysis, keywords: [42] }),
    responseBody({ ...analysis, rawText: null }),
    responseBody(null),
  ];
  for (const body of invalid) {
    await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", { apiKey: "test", fetch: async () => Response.json(body) }), { code: "INVALID_RESPONSE" });
  }
});

test("a slow request is aborted and reported without raw transport details", async () => {
  await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", {
    apiKey: "test", timeoutMs: 5,
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("private transport detail")))),
  }), { code: "TIMEOUT" });
});

test("a timeout while receiving the response body is recorded as unknown usage", async () => {
  const records = [];
  await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", {
    apiKey: "test", timeoutMs: 5, recordUsage: async (r) => records.push(r),
    fetch: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) { signal.addEventListener("abort", () => controller.error(new Error("private transport detail"))); },
    }), { headers: { "content-type": "application/json" } }),
  }), { code: "TIMEOUT" });
  assert.equal(records.length, 1);
  assert.equal(records[0].errorCode, "TIMEOUT");
  assert.equal(records[0].usage, null);
  assert.equal(records[0].cost, null);
});

test("provider redirects are rejected without forwarding credentials", async () => {
  let calls = 0;
  await assert.rejects(analyzeWithOpenAI(image, "image/jpeg", { apiKey: "test", fetch: async (_url, init) => {
    calls++; assert.equal(init.redirect, "manual");
    return new Response(null, { status: 307, headers: { Location: "https://other.invalid" } });
  }}), error => error.code === "HTTP_307");
  assert.equal(calls, 1);
});
