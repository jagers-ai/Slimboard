import { NextResponse } from "next/server";

import {
  deleteNoteForUser,
  getNoteWithImageUrl,
  updateNoteForUser,
} from "@/lib/notes";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요. 수정한 내용은 이 화면에 유지됩니다." }, { status: 401 });
  }

  const { id } = await params;
  const note = await getNoteWithImageUrl(id, user.id);

  if (!note) {
    return NextResponse.json({ error: "기록을 찾을 수 없어요." }, { status: 404 });
  }

  return NextResponse.json({ note });
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요. 수정한 내용은 이 화면에 유지됩니다." }, { status: 401 });
  }

  try {
  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    rawText?: string;
    summary?: string;
  };

  if (![body.title, body.rawText, body.summary].every(value => value === undefined || (typeof value === "string" && value.length <= 100_000))) return NextResponse.json({ error: "입력 내용을 확인해주세요." }, { status: 400 });
  const note = await updateNoteForUser({
    noteId: id,
    userId: user.id,
    title: body.title ?? "",
    rawText: body.rawText ?? "",
    summary: body.summary ?? "",
  });

  if (!note) {
    return NextResponse.json({ error: "기록을 찾을 수 없어요." }, { status: 404 });
  }

  return NextResponse.json({ note });
  } catch { return NextResponse.json({ error: "저장하지 못했어요. 분석 중인지 확인하고 다시 시도해주세요." }, { status: 409 }); }
}

export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요. 수정한 내용은 이 화면에 유지됩니다." }, { status: 401 });
  }

  const { id } = await params;
  let deleted;
  try { deleted = await deleteNoteForUser(id, user.id); }
  catch { return NextResponse.json({ error: "삭제하지 못했어요. 잠시 뒤 다시 시도해주세요." }, { status: 503 }); }

  if (!deleted) {
    return NextResponse.json({ error: "기록을 찾을 수 없어요." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
