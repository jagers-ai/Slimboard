// This experiment is only available in an explicitly enabled local dev server.
// It must not become a hosted inference endpoint using a personal Codex login.
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

    // A personal Codespace's private forwarding proxy retains the loopback Host.
    // Accept only that Codespace's exact HTTPS origin; do not trust forwarded
    // headers supplied by a request, or enable this in production deployments.
    const name = process.env.CODESPACE_NAME;
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    return (
      process.env.CODESPACES === "true" &&
      Boolean(name && /^[a-z0-9-]+$/.test(name)) &&
      domain === "app.github.dev" &&
      origin === `https://${name}-3000.${domain}`
    );
  } catch {
    return false;
  }
}
