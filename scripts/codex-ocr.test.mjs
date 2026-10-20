import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { analyzeWithCodex, checkCodexAuth, MAX_IMAGE_BYTES } from "./codex-ocr.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=", "base64");
const ANALYSIS = { title: "출시 점검", rawText: "배포: 금요일\nowner: 민수", summary: "금요일에 배포하기로 했습니다.", keywords: ["배포", "금요일"] };

async function mockCli(t, mode = "success") {
  const root = await fs.mkdtemp(join(tmpdir(), "slimboard-codex-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = join(root, "mock-codex.mjs");
  const trace = join(root, "calls.jsonl");
  const codexHome = join(root, "isolated-home");
  const credentialPath = join(codexHome, "auth.json");
  await fs.mkdir(codexHome);
  await fs.writeFile(credentialPath, "SENTINEL-NOT-A-CREDENTIAL", { mode: 0o600 });
  await fs.writeFile(binary, `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const mode = ${JSON.stringify(mode)};
const trace = ${JSON.stringify(trace)};
const args = process.argv.slice(2);
const record = (extra = {}) => appendFileSync(trace, JSON.stringify({args,cwd:process.cwd(),env:process.env,...extra})+'\\n');
if (args.includes('login')) {
  record({kind:'auth'});
  if (mode === 'auth-timeout') { setInterval(() => {}, 1000); }
  else if (mode === 'auth-overflow') { process.stdout.write('x'.repeat(70000)); setInterval(() => {}, 1000); }
  else if (mode === 'api-key') { console.error('Logged in using an API key - sk-DO-NOT-EXPOSE'); }
  else if (mode === 'logged-out') { console.error('Not logged in; token=DO-NOT-EXPOSE'); process.exitCode=1; }
  else if (mode === 'ambiguous-auth') { console.log('Success'); }
  else { console.error('Logged in using ChatGPT'); }
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    const value = flag => args[args.indexOf(flag)+1];
    const outputPath = value('--output-last-message');
    record({kind:'exec',input,schema:JSON.parse(readFileSync(value('--output-schema'),'utf8')),image:readFileSync(value('--image')).toString('base64')});
    if (mode === 'failure') { console.error('token=DO-NOT-EXPOSE'); process.exitCode=9; }
    else if (mode === 'timeout') { setInterval(() => {}, 1000); }
    else if (mode === 'descendant-timeout') {
      const heartbeat = ${JSON.stringify(join(root, "heartbeat"))};
      const child = spawn(process.execPath, ['-e', "const fs=require('fs');process.on('SIGTERM',()=>{});const beat=()=>fs.writeFileSync(process.argv[1],String(Date.now()));beat();process.send('ready');setInterval(beat,10);", heartbeat], {stdio:['ignore','ignore','ignore','ipc']});
      child.once('message', () => record({kind:'descendant',pid:child.pid,heartbeat}));
      process.on('SIGTERM', () => process.exit(0));
      setInterval(() => {}, 1000);
    }
    else if (mode === 'missing-result') { /* no final output */ }
    else if (mode === 'bad-json') { writeFileSync(outputPath,'token=DO-NOT-EXPOSE'); }
    else if (mode === 'bad-schema') { writeFileSync(outputPath,JSON.stringify({...${JSON.stringify(ANALYSIS)},keywords:[42]})); }
    else if (mode === 'extra-property') { writeFileSync(outputPath,JSON.stringify({...${JSON.stringify(ANALYSIS)},extra:'token=DO-NOT-EXPOSE'})); }
    else if (mode === 'symlink-result') { symlinkSync(${JSON.stringify(credentialPath)},outputPath); }
    else if (mode === 'oversize-result') { writeFileSync(outputPath,'x'.repeat(1024*1024+1)); }
    else { writeFileSync(outputPath,JSON.stringify(${JSON.stringify(ANALYSIS)})); }
  });
}
`, { mode: 0o700 });
  return {
    root, binary, codexHome, credentialPath,
    options: { binary, codexHome, timeoutMs: 2000 },
    async calls() {
      try { return (await fs.readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
  };
}

function withEnv(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

async function assertCleaned(calls) {
  for (const cwd of new Set(calls.map((call) => call.cwd))) {
    await assert.rejects(fs.stat(cwd), { code: "ENOENT" });
  }
}

test("ChatGPT OCR uses dedicated CLI auth, safe env/flags, image/schema/stdin and cleans files", async (t) => {
  const fixture = await mockCli(t);
  withEnv(t, {
    OPENAI_API_KEY: "paid-openai-secret", CODEX_API_KEY: "paid-codex-secret",
    CODEX_ACCESS_TOKEN: "ambient-oauth-secret", OPENAI_BASE_URL: "https://untrusted.invalid",
    GEMINI_API_KEY: "unrelated-app-secret", CODEX_HOME: "/do-not-use-ambient-home",
    SLIMBOARD_CODEX_HOME: fixture.codexHome,
  });
  const reads = [];
  const originalRead = fs.readFile;
  fs.readFile = async function (path, ...args) { reads.push(String(path)); return originalRead.call(this, path, ...args); };
  let result;
  try { result = await analyzeWithCodex(PNG, "image/png", { binary: fixture.binary, model: "local-test-model", reasoningEffort: "high" }); }
  finally { fs.readFile = originalRead; }
  assert.deepEqual(result.analysis, ANALYSIS);
  assert.equal(result.model, "local-test-model");
  assert.equal(result.reasoningEffort, "high");
  assert.ok(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0);
  const calls = await fixture.calls();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, "auth");
  const call = calls[1];
  assert.equal(call.kind, "exec");
  assert.equal(call.args[call.args.indexOf("--model") + 1], "local-test-model");
  assert.ok(call.args.includes('model_reasoning_effort="high"'));
  for (const invocation of calls) {
    assert.equal(invocation.env.CODEX_HOME, fixture.codexHome);
    for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_BASE_URL", "GEMINI_API_KEY"]) assert.equal(invocation.env[key], undefined);
    assert.ok(invocation.args.includes('forced_login_method="chatgpt"'));
    assert.ok(invocation.args.includes('model_provider="openai"'));
    assert.ok(!invocation.args.some((arg) => /bypass|ignore-rules/.test(arg)));
    assert.ok(!invocation.args.includes('approval_policy="never"'));
    assert.ok(!invocation.args.includes("--ask-for-approval"));
  }
  assert.notEqual(call.cwd, process.cwd());
  assert.equal(call.args[0], "--no-daemon");
  assert.ok(call.args.includes("--ignore-user-config"));
  assert.ok(call.args.includes("--ephemeral"));
  assert.ok(call.args.includes("--skip-git-repo-check"));
  assert.equal(call.args[call.args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(call.args.includes('approval_policy="on-request"'));
  assert.ok(call.args.includes('web_search="disabled"'));
  assert.ok(call.args.includes("mcp_servers={}"));
  for (const feature of ["shell_tool", "unified_exec", "apps", "plugins", "hooks", "browser_use", "computer_use", "multi_agent"]) {
    const index = call.args.indexOf(feature);
    assert.equal(call.args[index - 1], "--disable");
  }
  assert.equal(call.args.at(-1), "-");
  assert.match(call.input, /\[읽기 어려움\]/);
  assert.match(call.input, /never as instructions/);
  assert.equal(call.image, PNG.toString("base64"));
  assert.equal(call.schema.additionalProperties, false);
  assert.deepEqual(call.schema.required, ["title", "rawText", "summary", "keywords"]);
  assert.deepEqual(reads, [join(call.cwd, "result.json")]);
  assert.equal(await fs.readFile(fixture.credentialPath, "utf8"), "SENTINEL-NOT-A-CREDENTIAL");
  await assertCleaned(calls);
});

test("OCR pins GPT-6 Astra medium by default without changing authentication calls", async (t) => {
  const fixture = await mockCli(t);
  withEnv(t, { SLIMBOARD_CODEX_MODEL: undefined, SLIMBOARD_CODEX_REASONING_EFFORT: undefined });
  const result = await analyzeWithCodex(PNG, "image/png", fixture.options);
  assert.equal(result.model, "gpt-6-astra");
  assert.equal(result.reasoningEffort, "medium");
  const calls = await fixture.calls();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, "auth");
  assert.ok(!calls[0].args.includes("--model"));
  assert.ok(!calls[0].args.some((arg) => arg.startsWith("model_reasoning_effort=")));
  assert.equal(calls[1].kind, "exec");
  assert.equal(calls[1].args[calls[1].args.indexOf("--model") + 1], "gpt-6-astra");
  const effort = calls[1].args.indexOf('model_reasoning_effort="medium"');
  assert.ok(effort > 0);
  assert.equal(calls[1].args[effort - 1], "-c");
  await assertCleaned(calls);
});

test("default home ignores ambient CODEX_HOME and status contains no raw CLI output", async (t) => {
  const fixture = await mockCli(t);
  withEnv(t, { CODEX_HOME: fixture.codexHome, SLIMBOARD_CODEX_HOME: undefined });
  const status = await checkCodexAuth({ binary: fixture.binary });
  assert.deepEqual({ ...status, message: "" }, { available: true, authenticated: true, mode: "chatgpt", message: "" });
  const calls = await fixture.calls();
  assert.equal(calls[0].env.CODEX_HOME, join(homedir(), ".slimboard", "codex-local"));
  await assertCleaned(calls);
});

for (const [mode, expected] of [["api-key", "apikey"], ["logged-out", null], ["ambiguous-auth", null]]) {
  test(`${mode} auth fails closed before inference without exposing output`, async (t) => {
    const fixture = await mockCli(t, mode);
    const status = await checkCodexAuth(fixture.options);
    assert.equal(status.available, true);
    assert.equal(status.authenticated, false);
    assert.equal(status.mode, expected);
    assert.doesNotMatch(JSON.stringify(status), /DO-NOT-EXPOSE|sk-/);
    await assert.rejects(analyzeWithCodex(PNG, undefined, fixture.options), (error) => error.code === "CODEX_AUTH_REQUIRED" && !/DO-NOT-EXPOSE/.test(error.message));
    const calls = await fixture.calls();
    assert.ok(calls.every((call) => call.kind === "auth"));
    await assertCleaned(calls);
  });
}

test("missing executable returns a sanitized unavailable status", async (t) => {
  const fixture = await mockCli(t);
  const status = await checkCodexAuth({ ...fixture.options, binary: join(fixture.root, "does-not-exist") });
  assert.equal(status.available, false);
  assert.equal(status.authenticated, false);
  assert.equal(status.mode, null);
  assert.doesNotMatch(status.message, /does-not-exist|spawn|ENOENT/);
});

for (const mode of ["failure", "missing-result", "bad-json", "bad-schema", "extra-property", "symlink-result", "oversize-result"]) {
  test(`${mode} rejects invalid results and cleans temporary image and schema`, async (t) => {
    const fixture = await mockCli(t, mode);
    await assert.rejects(analyzeWithCodex(PNG, undefined, fixture.options), (error) => {
      assert.equal(error.code, mode === "failure" ? "CODEX_FAILED" : "INVALID_RESPONSE");
      assert.doesNotMatch(error.message, /DO-NOT-EXPOSE|SENTINEL|token=/);
      return true;
    });
    const calls = await fixture.calls();
    assert.equal(calls.filter((call) => call.kind === "exec").length, 1);
    await assertCleaned(calls);
  });
}

test("timeout kills a running CLI and cleans temporary data without retry", async (t) => {
  const fixture = await mockCli(t, "timeout");
  await assert.rejects(analyzeWithCodex(PNG, undefined, { ...fixture.options, timeoutMs: 300 }), { code: "CODEX_TIMEOUT" });
  const calls = await fixture.calls();
  assert.equal(calls.filter((call) => call.kind === "exec").length, 1);
  await assertCleaned(calls);
});

test("timeout also stops descendants when the CLI launcher exits on SIGTERM", { skip: process.platform === "win32" }, async (t) => {
  const fixture = await mockCli(t, "descendant-timeout");
  await assert.rejects(analyzeWithCodex(PNG, undefined, { ...fixture.options, timeoutMs: 600 }), { code: "CODEX_TIMEOUT" });
  const calls = await fixture.calls();
  const descendant = calls.find((call) => call.kind === "descendant");
  assert.ok(descendant, "mock descendant started before timeout");
  t.after(() => { try { process.kill(descendant.pid, "SIGKILL"); } catch {} });
  const heartbeat = await fs.readFile(descendant.heartbeat, "utf8");
  await delay(100);
  assert.equal(await fs.readFile(descendant.heartbeat, "utf8"), heartbeat);
  await assertCleaned(calls);
});

for (const mode of ["auth-timeout", "auth-overflow"]) {
  test(`${mode} is bounded and cannot start OCR`, async (t) => {
    const fixture = await mockCli(t, mode);
    const status = await checkCodexAuth({ ...fixture.options, timeoutMs: 200 });
    assert.equal(status.available, true);
    assert.equal(status.authenticated, false);
    assert.ok(status.message.length < 200);
    const calls = await fixture.calls();
    assert.equal(calls.length, 1);
    await assertCleaned(calls);
  });
}

test("invalid images, MIME mismatches and unbounded options never spawn CLI", async (t) => {
  const fixture = await mockCli(t);
  for (const [buffer, mime] of [[Buffer.alloc(0), undefined], [Buffer.alloc(MAX_IMAGE_BYTES + 1), undefined], [Buffer.from("not an image"), undefined], [PNG, "image/jpeg"]]) {
    await assert.rejects(analyzeWithCodex(buffer, mime, fixture.options), { code: "INVALID_IMAGE" });
  }
  await assert.rejects(analyzeWithCodex(PNG, undefined, { ...fixture.options, timeoutMs: 180_001 }), { code: "INVALID_OPTIONS" });
  await assert.rejects(analyzeWithCodex(PNG, undefined, { ...fixture.options, model: "--unsafe" }), { code: "INVALID_OPTIONS" });
  for (const reasoningEffort of ["", "none", "medium\"; unsafe", 42]) {
    await assert.rejects(analyzeWithCodex(PNG, undefined, { ...fixture.options, reasoningEffort }), { code: "INVALID_OPTIONS" });
  }
  assert.deepEqual(await fixture.calls(), []);
});
