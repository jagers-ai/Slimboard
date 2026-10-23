import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { tunnelEnvironment } from "./phone-preview.mjs";
import {
  MAX_ANALYSES, SESSION_MS, allowedPreviewPath, authenticatedPreview,
  createPreviewServer, newPreviewSession, persistPreviewSession,
  previewConfig, previewCookie, sameOriginPreview,
} from "./codex-share.mjs";

const env = {
  NODE_ENV: "development", SLIMBOARD_ENABLE_CODEX_SHARE: "1", CODESPACES: "true",
  CODESPACE_NAME: "slimboard-example-123", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
};
const config = previewConfig(env);
const browserHeaders = { host: "localhost:3001", origin: config.origin, "sec-fetch-site": "same-origin" };
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });

function call(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers: { ...browserHeaders, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (x) => chunks.push(x)).on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function fixture(t, onRequest, preview = config) {
  let clock = 1_000_000;
  const session = newPreviewSession(clock);
  const seen = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const entry = { url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() };
    seen.push(entry);
    if (onRequest) return onRequest(entry, res);
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": ["app-session=updated; Path=/; HttpOnly", "__Host-slimboard-preview=spoof; Path=/; Secure"] });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = createPreviewServer({ config: preview, session, now: () => clock, upstreamPort });
  const port = await listen(proxy);
  t.after(async () => { await close(proxy); await close(upstream); });
  const cookie = previewCookie(session, clock).split(";")[0];
  return { port, session, seen, cookie, advance: (ms) => { clock += ms; } };
}

test("share startup fails closed outside explicit personal Codespace development", () => {
  assert.equal(config.origin, "https://slimboard-example-123-3001.app.github.dev");
  for (const overrides of [
    { NODE_ENV: "production" }, { NODE_ENV: undefined },
    { SLIMBOARD_ENABLE_CODEX_SHARE: undefined }, { CODESPACES: "false" },
    { VERCEL: "1" }, { CF_PAGES: "1" }, { CODESPACE_NAME: "bad.example" },
    { GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "evil.com" },
  ]) assert.throws(() => previewConfig({ ...env, ...overrides }));
});

test("fresh 192-bit invite and signed cookie expire at a fixed deadline and reject tampering", () => {
  const session = newPreviewSession(1000);
  const cookie = previewCookie(session, 1000);
  assert.equal(Buffer.from(session.inviteToken, "base64url").length, 24);
  assert.notEqual(session.inviteToken, newPreviewSession(1000).inviteToken);
  assert.equal(session.expiresAt, 1000 + SESSION_MS);
  assert.match(cookie, /; HttpOnly; Secure; SameSite=Strict;/);
  const bare = cookie.split(";")[0];
  assert.equal(authenticatedPreview(bare, session, 1001), true);
  assert.equal(authenticatedPreview(bare, session, session.expiresAt), false);
  assert.equal(authenticatedPreview(bare + "X", session, 1001), false);
  assert.equal(authenticatedPreview(`${bare}; ${bare}`, session, 1001), false);
  assert.equal(authenticatedPreview(bare, newPreviewSession(1000), 1001), false);
  assert.equal(authenticatedPreview("x".repeat(9000), session, 1001), false);
});

test("session files are private and cannot be placed in the repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slimboard-share-"));
  try {
    const session = newPreviewSession();
    const file = await persistPreviewSession(session, directory);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, "utf8")).inviteToken, session.inviteToken);
    await assert.rejects(persistPreviewSession(session, fileURLToPath(new URL("../.share-test", import.meta.url))), /outside the repository/);
    await assert.rejects(persistPreviewSession(session, fileURLToPath(new URL("../.share-test", import.meta.url)).normalize("NFC")), /outside the repository/);
    await symlink(fileURLToPath(new URL("..", import.meta.url)), join(directory, "repo-alias"));
    await assert.rejects(persistPreviewSession(session, join(directory, "repo-alias")), /outside the repository/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CSRF accepts the exact preview or matching proxy rewrite, never arbitrary forwarded origin", () => {
  assert.equal(sameOriginPreview(browserHeaders, config), true);
  const rewritten = {
    ...browserHeaders, origin: "https://localhost:3001",
    "x-forwarded-host": config.previewHost, "x-forwarded-proto": "https",
  };
  assert.equal(sameOriginPreview(rewritten, config), true);
  for (const overrides of [
    { origin: undefined }, { origin: "null" }, { origin: "https://evil.com" },
    { host: "evil.com" },
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
    { "x-forwarded-host": "other-3001.app.github.dev" }, { "x-forwarded-proto": "http" },
  ]) assert.equal(sameOriginPreview({ ...rewritten, ...overrides }, config), false);
});

test("route allowlist covers app UI and APIs but rejects traversal, source and unrelated endpoints", () => {
  for (const [path, method] of [
    ["/", "GET"], ["/lab/codex", "GET"], ["/notes", "GET"], ["/notes/abc-123", "GET"],
    ["/search?q=hello", "GET"], ["/auth/callback?code=example", "GET"],
    ["/_next/static/chunks/app.js", "GET"], ["/api/lab/codex", "POST"],
    ["/api/notes", "POST"], ["/api/notes/abc-123", "PATCH"], ["/api/notes/abc-123", "DELETE"],
    ["/api/notes/abc-123/analyze", "POST"], ["/api/recent-searches", "DELETE"],
  ]) assert.equal(allowedPreviewPath(path, method), true, path);
  for (const [path, method] of [
    ["/.env", "GET"], ["/@fs/etc/passwd", "GET"], ["/api/admin", "POST"],
    ["//evil.com", "GET"], ["/_next/static/../../.env", "GET"],
    ["/_next/static/%2e%2e/.env", "GET"], ["/_next/static/a%2fb", "GET"],
    ["/_next/static/%252e%252e/.env", "GET"], ["/_next/static/a%5cb", "GET"],
    ["/_next/static/a\\b", "GET"], ["/lab/codex", "POST"], ["/api/lab/codex", "DELETE"],
  ]) assert.equal(allowedPreviewPath(path, method), false, path);
});

test("only invite landing is unauthenticated; fragment token is never present in landing HTML", async (t) => {
  const f = await fixture(t);
  const landing = await call(f.port, "/");
  assert.equal(landing.status, 200);
  assert.match(landing.body, /history.replaceState/);
  assert.match(landing.headers["content-security-policy"], /default-src 'none'/);
  assert.equal(landing.body.includes(f.session.inviteToken), false);
  for (const path of ["/lab/codex", "/api/lab/codex", "/_next/static/a.js", "/notes"]) assert.equal((await call(f.port, path)).status, 401);
  assert.equal((await call(f.port, "/", { headers: { host: "evil.com" } })).status, 400);
  assert.equal(f.seen.length, 0);
});

test("invitation exchange requires correct token and same origin, then creates scoped cookie", async (t) => {
  const f = await fixture(t);
  const options = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: f.session.inviteToken }) };
  assert.equal((await call(f.port, "/__invite", { ...options, headers: { ...options.headers, origin: "https://evil.com" } })).status, 403);
  assert.equal((await call(f.port, "/__invite", { ...options, body: JSON.stringify({ token: "x".repeat(32) }) })).status, 401);
  const accepted = await call(f.port, "/__invite", options);
  assert.equal(accepted.status, 204);
  assert.match(accepted.headers["set-cookie"][0], /^__Host-slimboard-preview=/);
  assert.equal(accepted.body.includes(f.session.inviteToken), false);
  assert.equal(f.seen.length, 0);
});

test("authenticated forwarding normalizes Origin and Host, strips invite/forwarding headers and preserves app session", async (t) => {
  const f = await fixture(t);
  const result = await call(f.port, "/api/lab/codex", {
    method: "POST", body: "image body", headers: {
      cookie: `${f.cookie}; app-session=own-session`, authorization: "Bearer app-user-session",
      "x-forwarded-host": "evil.com", forwarded: "for=evil", "x-github-token": "never-upstream",
      "content-type": "multipart/form-data; boundary=test",
    },
  });
  assert.equal(result.status, 200);
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].headers.host, "127.0.0.1:3000");
  assert.equal(f.seen[0].headers.origin, "http://127.0.0.1:3000");
  assert.equal(f.seen[0].headers.cookie.trim(), "app-session=own-session");
  assert.equal(f.seen[0].headers.authorization, "Bearer app-user-session");
  for (const name of ["x-forwarded-host", "forwarded", "x-github-token"]) assert.equal(f.seen[0].headers[name], undefined);
  assert.equal(result.headers["set-cookie"].length, 1);
  assert.match(result.headers["set-cookie"][0], /^app-session=/);
  assert.equal(result.headers["cache-control"], "no-store");
});

test("authenticated cross-site writes and disallowed routes never reach upstream", async (t) => {
  const f = await fixture(t);
  const headers = { cookie: f.cookie };
  assert.equal((await call(f.port, "/api/lab/codex", { method: "POST", headers: { ...headers, origin: "https://evil.com" } })).status, 403);
  assert.equal((await call(f.port, "/api/notes/a", { method: "DELETE", headers: { ...headers, "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await call(f.port, "/api/admin", { method: "POST", headers })).status, 404);
  assert.equal((await call(f.port, "/_next/static/%2e%2e/.env", { headers })).status, 404);
  assert.equal(f.seen.length, 0);
});

test("one fixed invite has a total ten-analysis cap across all signed-in clients and rejects expired sessions", async (t) => {
  const f = await fixture(t);
  const options = { method: "POST", headers: { cookie: f.cookie }, body: "image" };
  for (let i = 0; i < MAX_ANALYSES; i++) assert.equal((await call(f.port, "/api/lab/codex", options)).status, 200);
  assert.equal((await call(f.port, "/api/notes/abc/analyze", options)).status, 429);
  assert.equal(f.seen.length, MAX_ANALYSES);
  f.advance(SESSION_MS);
  assert.equal((await call(f.port, "/lab/codex", { headers: { cookie: f.cookie } })).status, 410);
  assert.equal((await call(f.port, "/__invite", { ...options, headers: { "content-type": "application/json" }, body: JSON.stringify({ token: f.session.inviteToken }) })).status, 410);
});

test("parallel analysis is rejected without consuming extra quota", async (t) => {
  let finish;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const f = await fixture(t, (_req, res) => { finish = () => res.end("ok"); started(); });
  const options = { method: "POST", headers: { cookie: f.cookie }, body: "image" };
  const first = call(f.port, "/api/lab/codex", options);
  await startedPromise;
  assert.equal((await call(f.port, "/api/lab/codex", options)).status, 409);
  assert.equal(f.session.analyses, 1);
  finish();
  assert.equal((await first).status, 200);
});

test("oversize invite and image bodies are bounded before reaching upstream", async (t) => {
  const f = await fixture(t);
  assert.equal((await call(f.port, "/__invite", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(513) })).status, 413);
  assert.equal((await call(f.port, "/api/lab/codex", { method: "POST", headers: { cookie: f.cookie }, body: Buffer.alloc(11 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(f.session.analyses, 0);
  assert.equal(f.seen.length, 0);
});

test("upstream redirects cannot send clients or their invite to other hosts", async (t) => {
  const f = await fixture(t, (_req, res) => { res.writeHead(302, { location: "https://evil.com/path" }); res.end(); });
  assert.equal((await call(f.port, "/notes", { headers: { cookie: f.cookie } })).status, 502);
});

const phoneEnv = { NODE_ENV: "development", SLIMBOARD_ENABLE_CODEX_SHARE: "1", SLIMBOARD_SHARE_ORIGIN: "https://slimboard-test.trycloudflare.com" };
const phone = previewConfig(phoneEnv);

test("phone sharing requires an exact HTTPS tunnel origin and explicit local development", () => {
  assert.equal(phone.labOnly, true);
  for (const overrides of [
    { NODE_ENV: "production" }, { SLIMBOARD_ENABLE_CODEX_SHARE: "0" }, { VERCEL: "1" }, { CF_PAGES: "1" },
    { SLIMBOARD_SHARE_ORIGIN: "http://slimboard-test.trycloudflare.com" },
    { SLIMBOARD_SHARE_ORIGIN: "https://slimboard-test.trycloudflare.com.evil.com" },
    { SLIMBOARD_SHARE_ORIGIN: "https://slimboard-test.trycloudflare.com/" },
    { SLIMBOARD_SHARE_ORIGIN: "https://slimboard-test.trycloudflare.com:443" },
    { SLIMBOARD_SHARE_ORIGIN: "https://evil.com" },
  ]) assert.throws(() => previewConfig({ ...phoneEnv, ...overrides }));
});

test("phone gateway rejects all requests while the HTTPS tunnel is being prepared", async (t) => {
  const f = await fixture(t, undefined, { origin: "", labOnly: true });
  for (const path of ["/", "/lab/codex", "/api/lab/codex"]) {
    assert.equal((await call(f.port, path, { headers: { cookie: f.cookie } })).status, 503);
  }
  assert.equal(f.seen.length, 0);
});

test("phone invitation protects the lab, rejects HTTP/foreign origins, and hides unrelated app routes", async (t) => {
  const f = await fixture(t, undefined, phone);
  const headers = { origin: phone.origin, cookie: f.cookie };
  assert.equal((await call(f.port, "/api/lab/codex")).status, 401);
  const exchange = await call(f.port, "/__invite", {
    method: "POST", headers: { origin: phone.origin, "content-type": "application/json" },
    body: JSON.stringify({ token: f.session.inviteToken }),
  });
  assert.equal(exchange.status, 204);
  assert.match(exchange.headers["set-cookie"][0], /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await call(f.port, "/lab/codex", { headers })).status, 200);
  assert.equal((await call(f.port, "/api/lab/codex", { method: "POST", headers, body: "image" })).status, 200);
  for (const origin of ["http://localhost:3001", "https://localhost:3001", "https://evil.com", "null"]) {
    assert.equal((await call(f.port, "/api/lab/codex", { method: "POST", headers: { ...headers, origin } })).status, 403);
  }
  for (const path of ["/api/notes", "/notes", "/auth/callback", "/_next/static/app.js.map", "/__nextjs_original-stack-frames", "/.env.local"]) {
    assert.equal((await call(f.port, path, { headers })).status, 404);
  }
  assert.equal((await call(f.port, "/", { headers })).headers.location, "/lab/codex");
  assert.equal((await call(f.port, "/lab/codex", { headers: { ...headers, host: "evil.com" } })).status, 400);
  assert.equal(f.seen.length, 2);
});

test("the HTTPS tunnel process never receives application credentials", () => {
  assert.deepEqual(tunnelEnvironment({ PATH: "/bin", HOME: "/home/test", TMPDIR: "/tmp", OPENAI_API_KEY: "secret", SUPABASE_SERVICE_ROLE_KEY: "secret", NODE_OPTIONS: "--inspect", CLOUDFLARE_API_TOKEN: "secret" }), {
    PATH: "/bin", HOME: "/home/test", TMPDIR: "/tmp",
  });
});
