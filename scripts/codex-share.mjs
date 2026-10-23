// A short-lived, authenticated internal-development preview. Never publish
// the Next development server itself or use this as production hosting.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { chmod, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SHARE_PORT = 3001;
export const SESSION_MS = 4 * 60 * 60 * 1000;
export const MAX_ANALYSES = 10;
const COOKIE = "__Host-slimboard-preview";
const MAX_BODY = 11 * 1024 * 1024;
const validHost = (host) => ["localhost:3001", "127.0.0.1:3001", "[::1]:3001"].includes(host);
const safeEqual = (a, b) => timingSafeEqual(
  createHash("sha256").update(String(a)).digest(),
  createHash("sha256").update(String(b)).digest(),
);

export function previewConfig(env = process.env) {
  if (env.NODE_ENV === "development" && env.SLIMBOARD_ENABLE_CODEX_SHARE === "1" &&
      !env.VERCEL && !env.CF_PAGES && !env.CODESPACES &&
      /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(env.SLIMBOARD_SHARE_ORIGIN ?? "")) {
    return { previewHost: new URL(env.SLIMBOARD_SHARE_ORIGIN).host, origin: env.SLIMBOARD_SHARE_ORIGIN, labOnly: true };
  }
  if (env.NODE_ENV !== "development" || env.SLIMBOARD_ENABLE_CODEX_SHARE !== "1" ||
      env.CODESPACES !== "true" || env.VERCEL || env.CF_PAGES ||
      !/^[a-z0-9-]+$/.test(env.CODESPACE_NAME ?? "") ||
      env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN !== "app.github.dev") {
    throw new Error("Temporary sharing requires explicit local development and a supported HTTPS preview origin.");
  }
  const previewHost = `${env.CODESPACE_NAME}-${SHARE_PORT}.app.github.dev`;
  return { previewHost, origin: `https://${previewHost}` };
}

export function newPreviewSession(now = Date.now()) {
  return {
    inviteToken: randomBytes(24).toString("base64url"),
    key: randomBytes(32), id: randomBytes(16).toString("base64url"),
    expiresAt: now + SESSION_MS, analyses: 0, busy: false,
  };
}

export async function persistPreviewSession(session, directory = join(homedir(), ".slimboard", "codex-share")) {
  const project = (await realpath(fileURLToPath(new URL("..", import.meta.url)))).normalize("NFC");
  const destination = resolve(directory);
  const insideProject = (path) => path.normalize("NFC") === project || path.normalize("NFC").startsWith(project + sep);
  if (insideProject(destination)) {
    throw new Error("Preview credentials must be stored outside the repository.");
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const canonical = await realpath(destination);
  if (insideProject(canonical)) throw new Error("Preview credentials must be stored outside the repository.");
  await chmod(canonical, 0o700);
  const path = join(canonical, `${session.id}.json`);
  await writeFile(path, JSON.stringify({
    inviteToken: session.inviteToken, key: session.key.toString("base64url"),
    id: session.id, expiresAt: session.expiresAt,
  }), { flag: "wx", mode: 0o600 });
  return path;
}

const sign = (session, value) => createHmac("sha256", session.key).update(value).digest("base64url");
export function previewCookie(session, now = Date.now()) {
  const value = `${session.id}.${session.expiresAt}`;
  return `${COOKIE}=${value}.${sign(session, value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((session.expiresAt - now) / 1000))}`;
}

export function authenticatedPreview(cookieHeader, session, now = Date.now()) {
  if (now >= session.expiresAt || !cookieHeader || cookieHeader.length > 8192) return false;
  const matches = cookieHeader.split(";").map((x) => x.trim()).filter((x) => x.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return false;
  const value = `${session.id}.${session.expiresAt}`;
  return safeEqual(matches[0].slice(COOKIE.length + 1), `${value}.${sign(session, value)}`);
}

export function sameOriginPreview(headers, config) {
  if (!validHost(headers.host) || headers["sec-fetch-site"] !== "same-origin") return false;
  if (config.labOnly) return headers.origin === config.origin;
  const host = headers.host;
  const origin = headers.origin;
  if (origin === config.origin) return true;
  if (origin === `http://${host}`) return true;
  return origin === `https://${host}` &&
    headers["x-forwarded-host"] === config.previewHost &&
    headers["x-forwarded-proto"] === "https";
}

export function allowedPreviewPath(rawUrl, method, labOnly = false) {
  if (typeof rawUrl !== "string" || rawUrl.length > 4096 || !rawUrl.startsWith("/") || rawUrl.startsWith("//")) return false;
  const path = rawUrl.split("?")[0];
  // Reject normalization tricks before URL parsing, including encoded slashes.
  if (/[\\\u0000-\u0020\u007f]/.test(rawUrl) || /%(?:2e|2f|5c|00|25)/i.test(path) || path.split("/").includes("..")) return false;
  if (labOnly) {
    if (path === "/api/lab/codex") return ["GET", "POST"].includes(method);
    return ["GET", "HEAD"].includes(method) &&
      (["/lab/codex", "/favicon.ico"].includes(path) ||
       (path.startsWith("/_next/static/") && !path.endsWith(".map")));
  }
  if (path === "/api/lab/codex" || path === "/api/notes") return ["GET", "POST"].includes(method);
  if (path === "/api/recent-searches") return ["GET", "POST", "DELETE"].includes(method);
  if (/^\/api\/notes\/[A-Za-z0-9_-]{1,128}$/.test(path)) return ["GET", "PATCH", "DELETE"].includes(method);
  if (/^\/api\/notes\/[A-Za-z0-9_-]{1,128}\/analyze$/.test(path)) return method === "POST";
  if (!["GET", "HEAD"].includes(method)) return false;
  return ["/", "/lab/codex", "/notes", "/search", "/auth/callback", "/favicon.ico"].includes(path) ||
    /^\/notes\/[A-Za-z0-9_-]{1,128}$/.test(path) || path.startsWith("/_next/static/");
}

function appCookies(header) {
  return header?.split(";").filter((x) => !x.trim().startsWith(`${COOKIE}=`)).join(";");
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Content-Type": "text/plain; charset=utf-8", ...headers,
  });
  res.end(body);
}

function invitePage(res) {
  const nonce = randomBytes(18).toString("base64url");
  reply(res, 200, `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Slimboard</title><style nonce="${nonce}">body{font:18px system-ui;max-width:360px;margin:20vh auto;padding:24px;color:#172033}h1{font-size:28px}</style><h1>Slimboard</h1><p id="message">초대 링크를 확인하고 있어요.</p><script nonce="${nonce}">const token=new URLSearchParams(location.hash.slice(1)).get('invite');history.replaceState(null,'','/');if(!token){document.getElementById('message').textContent='전달받은 초대 링크로 열어주세요.'}else{fetch('/__invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error();location.replace('/lab/codex')}).catch(()=>{document.getElementById('message').textContent='초대 링크가 만료되었거나 사용할 수 없어요.'})}</script></html>`, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted); };
    const fail = (status) => { cleanup(); req.pause(); reject(Object.assign(new Error("Request rejected"), { status })); };
    const data = (chunk) => { size += chunk.length; if (size > limit) fail(413); else chunks.push(chunk); };
    const end = () => { cleanup(); resolveBody(Buffer.concat(chunks)); };
    const error = () => fail(400);
    const aborted = () => fail(400);
    req.on("data", data).once("end", end).once("error", error).once("aborted", aborted);
  });
}

export function createPreviewServer({ config, session, now = Date.now, upstreamPort = 3000 }) {
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    let claimed = false;
    const release = () => { if (claimed) { session.busy = false; claimed = false; } };
    res.once("close", release);
    try {
      if (!validHost(req.headers.host)) return reply(res, 400, "Invalid host");
      if (!config.origin) return reply(res, 503, "연결을 준비하고 있어요.");
      if (now() >= session.expiresAt) return reply(res, 410, "초대 링크가 만료되었어요.");
      const auth = authenticatedPreview(req.headers.cookie, session, now());
      if (req.url === "/" && req.method === "GET" && !auth) return invitePage(res);
      if (req.url === "/__invite" && req.method === "POST") {
        if (!sameOriginPreview(req.headers, config)) return reply(res, 403, "Request rejected");
        if (req.headers["content-type"] !== "application/json") return reply(res, 400, "Request rejected");
        let token;
        try { token = JSON.parse((await readBody(req, 512)).toString("utf8")).token; } catch (error) {
          if (error.status) throw error;
          return reply(res, 400, "Request rejected");
        }
        if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token) || !safeEqual(token, session.inviteToken)) return reply(res, 401, "초대 링크를 확인해주세요.");
        return reply(res, 204, "", { "Set-Cookie": previewCookie(session, now()) });
      }
      if (!auth) return reply(res, 401, "전달받은 초대 링크로 열어주세요.");
      if (req.url === "/" && req.method === "GET" && auth) return reply(res, 302, "", { Location: "/lab/codex" });
      if (!allowedPreviewPath(req.url, req.method, config.labOnly)) return reply(res, 404, "Not found");
      const mutating = !["GET", "HEAD"].includes(req.method);
      if (mutating && !sameOriginPreview(req.headers, config)) return reply(res, 403, "Request rejected");
      let body;
      const analysis = req.method === "POST" && (req.url.split("?")[0] === "/api/lab/codex" || /^\/api\/notes\/[^/]+\/analyze(?:\?|$)/.test(req.url));
      if (analysis) {
        if (session.busy) return reply(res, 409, "앞선 사진 분석이 끝나면 다시 시도해주세요.");
        if (session.analyses >= MAX_ANALYSES) return reply(res, 429, "이번 초대의 분석 횟수를 모두 사용했어요.");
        session.busy = true; claimed = true;
      }
      if (mutating) {
        body = await readBody(req, MAX_BODY);
        if (now() >= session.expiresAt) { release(); return reply(res, 410, "초대 링크가 만료되었어요."); }
        if (analysis) session.analyses++;
      }
      // Allowlist headers: the invitation and forwarded identity never reach
      // Next. Preserve only the app user's own Supabase session credentials.
      const headers = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" };
      for (const name of ["accept", "accept-language", "content-type", "range", "if-none-match", "if-modified-since", "rsc", "next-router-state-tree", "next-router-prefetch", "next-url", "authorization"]) {
        if (req.headers[name] !== undefined) headers[name] = req.headers[name];
      }
      const cookies = appCookies(req.headers.cookie);
      if (cookies) headers.cookie = cookies;
      if (body) headers["content-length"] = String(body.length);
      const upstream = httpRequest({ hostname: "127.0.0.1", port: upstreamPort, path: req.url, method: req.method, headers, timeout: 190_000 }, (response) => {
        const resultHeaders = {};
        for (const name of ["content-type", "content-length", "content-encoding", "etag", "last-modified", "vary"]) {
          if (response.headers[name] !== undefined) resultHeaders[name] = response.headers[name];
        }
        if (response.headers.location) {
          let target;
          try { target = new URL(response.headers.location, "http://127.0.0.1:3000"); } catch {}
          if (!target || !["http://127.0.0.1:3000", "http://localhost:3000", config.origin].includes(target.origin) || !allowedPreviewPath(target.pathname + target.search, "GET", config.labOnly)) {
            response.resume(); release(); return reply(res, 502, "화면을 열지 못했어요.");
          }
          resultHeaders.location = target.pathname + target.search;
        }
        const cookies = response.headers["set-cookie"]?.filter((x) => !x.trim().startsWith(`${COOKIE}=`));
        if (cookies?.length) resultHeaders["set-cookie"] = cookies;
        res.writeHead(response.statusCode ?? 502, {
          ...resultHeaders, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
        });
        response.once("end", release);
        response.once("error", () => { release(); res.destroy(); });
        response.pipe(res);
      });
      upstream.once("timeout", () => upstream.destroy());
      upstream.once("error", () => { release(); if (!res.headersSent) reply(res, 502, "잠시 후 다시 시도해주세요."); else res.destroy(); });
      res.once("close", () => upstream.destroy());
      upstream.end(body);
    } catch (error) {
      release();
      if (!res.headersSent) reply(res, error.status ?? 502, "요청을 처리하지 못했어요.", { Connection: "close" });
      else res.destroy();
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 15_000;
  server.maxConnections = 32;
  server.on("upgrade", (_req, socket) => socket.destroy());
  return server;
}

export async function startPreview(env = process.env) {
  const config = previewConfig(env);
  return (await startPreviewServer(config)).server;
}

export async function startPreviewServer(config, { announce = true } = {}) {
  const session = newPreviewSession();
  const file = await persistPreviewSession(session);
  const server = createPreviewServer({ config, session });
  try {
    await new Promise((done, fail) => { server.once("error", fail); server.listen(SHARE_PORT, "127.0.0.1", done); });
  } catch { await unlink(file).catch(() => {}); throw new Error("Temporary preview could not start."); }
  const stop = () => { server.close(); server.closeAllConnections(); };
  const expiry = setTimeout(stop, SESSION_MS);
  server.once("close", () => { clearTimeout(expiry); unlink(file).catch(() => {}); process.off("SIGINT", stop); process.off("SIGTERM", stop); });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (announce) {
    console.log("Temporary internal preview: expires in 4 hours, maximum 10 analyses. Keep port 3000 private.");
    console.log(`${config.origin}/#invite=${session.inviteToken}`);
  }
  return { server, session };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPreview().catch(() => { console.error("Temporary preview unavailable. Check the explicit development settings and free port 3001."); process.exitCode = 1; });
}
