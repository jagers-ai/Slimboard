import { NextResponse } from "next/server";

import { getOptionalEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const env = getOptionalEnv();
  const siteUrl = env.siteUrl ?? requestUrl.origin;

  return NextResponse.redirect(new URL(next, siteUrl));
}
