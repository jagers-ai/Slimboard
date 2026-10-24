export function safeAuthNext(value: string | null, origin: string): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const target = new URL(value, origin);
  return target.origin === origin && !target.pathname.startsWith("/auth/") ? target.pathname + target.search + target.hash : "/";
}
