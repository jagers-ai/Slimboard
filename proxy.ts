import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isCodexLabEnabled } from "@/lib/codex-lab";

export async function proxy(request: NextRequest) {
  // Cookie-authenticated writes must originate from this site. APIs and pages
  // containing private notes must never be served from a shared/browser cache.
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (isWrite && request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/api/lab/")) {
    const origin = request.headers.get("origin");
    const expectedOrigin = `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
    if (!origin || origin !== expectedOrigin) return new NextResponse("Forbidden", { status: 403 });
  }
  let response = NextResponse.next({
    request,
  });

  response.headers.set("Cache-Control", "private, no-store");

  if (["/lab/codex", "/api/lab/codex"].includes(request.nextUrl.pathname)) {
    if (!isCodexLabEnabled(request.headers.get("host"))) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        response.headers.set("Cache-Control", "private, no-store");
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
