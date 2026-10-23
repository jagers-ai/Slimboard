// Against the real local HTTP server. No valid image or paid API call is sent.
import assert from "node:assert/strict";
import { request } from "node:http";

function call(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // node:http preserves Host overrides; fetch may replace this forbidden header.
    const req = request({ hostname: "127.0.0.1", port: 3000, path, method,
      headers: { host: "127.0.0.1:3000", ...headers }, timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("timeout", () => req.destroy(new Error("Local lab timed out.")));
    req.on("error", reject);
    req.end(body);
  });
}

const checks = [
  ["status", "/api/lab/codex", {}, 200],
  ["camera page", "/lab/codex", {}, 200],
  ["external Host status", "/api/lab/codex", { headers: { host: "evil.example" } }, 404],
  ["external Host page", "/lab/codex", { headers: { host: "evil.example" } }, 404],
  ["external Host POST", "/api/lab/codex", { method: "POST", headers: { host: "evil.example", origin: "http://evil.example" } }, 404],
  ["cross-origin POST", "/api/lab/codex", { method: "POST", headers: { origin: "https://evil.example" } }, 403],
  ["missing Origin", "/api/lab/codex", { method: "POST" }, 403],
];
const boundary = "slimboard-smoke-boundary";
const body = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="invalid.jpg"\r\nContent-Type: image/jpeg\r\n\r\nnot an image\r\n--${boundary}--\r\n`;
checks.push(["invalid image", "/api/lab/codex", { method: "POST", body, headers: {
  origin: "http://127.0.0.1:3000", "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": Buffer.byteLength(body),
} }, 400]);
for (const [name, path, options, expected] of checks) {
  const response = await call(path, options);
  assert.equal(response.status, expected, name);
  if (name === "status") assert.equal(typeof JSON.parse(response.body).ready, "boolean");
  console.log(`PASS ${name}: ${response.status}`);
}
