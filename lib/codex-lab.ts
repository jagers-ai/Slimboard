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
    return (
      parsed.protocol === "http:" &&
      parsed.origin === origin &&
      parsed.host.toLowerCase() === request.headers.get("host")?.toLowerCase() &&
      isCodexLabEnabled(parsed.host)
    );
  } catch {
    return false;
  }
}
