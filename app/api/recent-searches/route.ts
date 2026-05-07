import { NextResponse } from "next/server";

import {
  clearRecentSearchesForUser,
  deleteRecentSearchForUser,
  listRecentSearchesForUser,
  saveRecentSearchForUser,
} from "@/lib/recent-searches";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recentSearches = await listRecentSearchesForUser(user.id);

  return NextResponse.json({ recentSearches });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { query?: unknown };
  const query = typeof payload.query === "string" ? payload.query : "";
  const recentSearch = await saveRecentSearchForUser(user.id, query);

  return NextResponse.json({ recentSearch });
}

export async function DELETE(request: Request) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  if (searchParams.get("all") === "true") {
    await clearRecentSearchesForUser(user.id);
    return NextResponse.json({ ok: true });
  }

  const query = searchParams.get("query") ?? "";
  await deleteRecentSearchForUser(user.id, query);

  return NextResponse.json({ ok: true });
}

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
