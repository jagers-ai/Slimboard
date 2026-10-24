import { NextResponse } from "next/server";
import { analyzeNoteForUser, NoteOperationError } from "@/lib/notes";
import { getCurrentUser } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 2_100_000) return NextResponse.json({ error: "요청이 너무 커요." }, { status: 413 });
    const body = text ? JSON.parse(text) : {};
    if ((body.recovery !== undefined && typeof body.recovery !== "string") || (body.force !== undefined && typeof body.force !== "boolean")) {
      return NextResponse.json({ error: "요청을 확인해주세요." }, { status: 400 });
    }
    const result = await analyzeNoteForUser((await params).id, user, { recovery: body.recovery, force: body.force });
    return NextResponse.json(result, { status: "recovery" in result ? 503 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof NoteOperationError ? error.message : "처리에 실패했어요. 잠시 뒤 다시 시도해주세요." }, { status: error instanceof NoteOperationError ? error.status : 500 });
  }
}
