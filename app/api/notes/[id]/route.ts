import { NextResponse } from "next/server";

import {
  deleteNoteForUser,
  getNoteWithImageUrl,
  updateNoteForUser,
} from "@/lib/notes";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const user = await getRouteUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const note = await getNoteWithImageUrl(id, user.id);

  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ note });
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await getRouteUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    rawText?: string;
    summary?: string;
  };

  const note = await updateNoteForUser({
    noteId: id,
    userId: user.id,
    title: body.title ?? "",
    rawText: body.rawText ?? "",
    summary: body.summary ?? "",
  });

  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ note });
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getRouteUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = await deleteNoteForUser(id, user.id);

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

async function getRouteUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
