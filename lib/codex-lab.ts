// This experiment is only available in an explicitly enabled local dev server.
// The lab bypasses normal app sign-in, so it remains local development only.
export function isCodexLabEnabled(host: string | null) {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.SLIMBOARD_ENABLE_CODEX_LAB !== "1" ||
    process.env.VERCEL ||
    process.env.CF_PAGES ||
    !host
  ) {
    return false;
  }

  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

export function isSameOriginLabRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;

  try {
    const parsed = new URL(origin);
    const host = request.headers.get("host");
    if (parsed.origin !== origin || !isCodexLabEnabled(host)) return false;

    if (parsed.protocol === "http:" && parsed.host.toLowerCase() === host?.toLowerCase()) {
      return true;
    }

    // A personal Codespace's private proxy retains a loopback Host and may
    // rewrite the matching Origin to HTTPS loopback. Bind that rewrite to this
    // Codespace's exact forwarding address and the browser's same-origin signal.
    const name = process.env.CODESPACE_NAME;
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    if (
      process.env.CODESPACES !== "true" ||
      !name || !/^[a-z0-9-]+$/.test(name) ||
      domain !== "app.github.dev"
    ) return false;

    const previewHost = `${name}-3000.${domain}`;
    return origin === `https://${previewHost}` || (
      parsed.protocol === "https:" &&
      parsed.host.toLowerCase() === host?.toLowerCase() &&
      request.headers.get("x-forwarded-host") === previewHost &&
      request.headers.get("x-forwarded-proto") === "https" &&
      request.headers.get("sec-fetch-site") === "same-origin"
    );
  } catch {
    return false;
  }
}
