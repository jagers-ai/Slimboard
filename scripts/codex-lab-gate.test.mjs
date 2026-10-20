import assert from "node:assert/strict";
import test from "node:test";

import { isCodexLabEnabled, isSameOriginLabRequest } from "../lib/codex-lab.ts";

function inLocalLab(fn) {
  const names = ["NODE_ENV", "SLIMBOARD_ENABLE_CODEX_LAB", "VERCEL", "CF_PAGES", "CODESPACES", "CODESPACE_NAME", "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.NODE_ENV = "development";
  process.env.SLIMBOARD_ENABLE_CODEX_LAB = "1";
  delete process.env.VERCEL;
  delete process.env.CF_PAGES;
  delete process.env.CODESPACES;
  delete process.env.CODESPACE_NAME;
  delete process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  try { fn(); } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test("lab requires opt-in local development, never production or hosted runtime", () => inLocalLab(() => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) assert.equal(isCodexLabEnabled(host), true);
  for (const host of [null, "example.com", "localhost.evil.com", "127.0.0.1.evil.com", "localhost,evil.com", "0.0.0.0:3000"]) assert.equal(isCodexLabEnabled(host), false);
  delete process.env.SLIMBOARD_ENABLE_CODEX_LAB;
  assert.equal(isCodexLabEnabled("localhost:3000"), false);
  process.env.SLIMBOARD_ENABLE_CODEX_LAB = "1";
  process.env.NODE_ENV = "production";
  assert.equal(isCodexLabEnabled("localhost:3000"), false);
  process.env.NODE_ENV = "development";
  process.env.VERCEL = "1";
  assert.equal(isCodexLabEnabled("localhost:3000"), false);
  delete process.env.VERCEL;
  process.env.CF_PAGES = "1";
  assert.equal(isCodexLabEnabled("localhost:3000"), false);
}));

test("private Codespace preview accepts only its exact HTTPS origin through loopback", () => inLocalLab(() => {
  process.env.CODESPACES = "true";
  process.env.CODESPACE_NAME = "slimboard-example-123";
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = "app.github.dev";
  const origin = "https://slimboard-example-123-3000.app.github.dev";
  const request = (value = origin, host = "127.0.0.1:3000") => new Request("http://127.0.0.1:3000/api/lab/codex", {
    method: "POST", headers: { host, origin: value },
  });
  assert.equal(isSameOriginLabRequest(request()), true);
  for (const value of ["https://other-3000.app.github.dev", "https://slimboard-example-123-3001.app.github.dev", "http://slimboard-example-123-3000.app.github.dev", origin + ".evil.com"]) {
    assert.equal(isSameOriginLabRequest(request(value)), false);
  }
  assert.equal(isSameOriginLabRequest(request(origin, "example.com")), false);
  process.env.CODESPACES = "false";
  assert.equal(isSameOriginLabRequest(request()), false);
  process.env.CODESPACES = "true";
  process.env.NODE_ENV = "production";
  assert.equal(isSameOriginLabRequest(request()), false);
}));

test("analysis POST requires matching local Origin and Host", () => inLocalLab(() => {
  const request = (origin, host = "localhost:3000") => new Request("http://localhost:3000/api/lab/codex", {
    method: "POST", headers: { host, ...(origin ? { origin } : {}) },
  });
  assert.equal(isSameOriginLabRequest(request("http://localhost:3000")), true);
  for (const origin of [null, "null", "https://evil.com", "http://localhost:3001", "http://127.0.0.1:3000", "http://localhost:3000/path", "not-a-url"]) {
    assert.equal(isSameOriginLabRequest(request(origin)), false);
  }
}));
