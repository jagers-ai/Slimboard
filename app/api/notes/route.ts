import { NextResponse } from "next/server";
import { prepareImage } from "@/lib/image";
import { getCurrentUser } from "@/lib/auth";
import { buildImagePaths, uploadImageObject } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const { listNotesForUser } = await import("@/lib/notes");
  const notes = await listNotesForUser({ userId: user.id, query: new URL(request.url).searchParams.get("query") ?? undefined, limit: 50 });
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (Number(request.headers.get("content-length")) > 22 * 1024 * 1024) {
    return NextResponse.json({ error: "사진 용량이 너무 커요." }, { status: 413 });
  }
  try {
    const form = await request.formData();
    const file = form.get("image");
    const noteId = form.get("noteId");
    if (!(file instanceof File) || typeof noteId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(noteId)) {
      return NextResponse.json({ error: "사진을 다시 선택해주세요." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin.from("whiteboard_notes").select("*").eq("id", noteId).eq("owner_user_id", user.id).maybeSingle();
    if (readError) throw readError;
    if (existing?.image_ready) return NextResponse.json({ note: existing });
    const prepared = await prepareImage(file);
    const workspaceId = await ensurePersonalWorkspace(user);
    const { analysisPath } = buildImagePaths({ userId: user.id, noteId });
    // Reserve the row BEFORE uploading. Any interrupted upload remains discoverable
    // and deletable; retrying this UUID resumes instead of creating a second record.
    const { error: insertError } = await admin.from("whiteboard_notes").upsert({
      id: noteId, workspace_id: workspaceId, owner_user_id: user.id,
      title: "사진 저장 중", original_image_path: null, analysis_image_path: analysisPath,
      image_ready: false, status: "processing", search_text: "",
      error_message: "사진 저장이 끝나지 않았어요. 선택한 사진 화면에서 다시 시도해주세요.",
    }, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { data: reserved, error: reserveError } = await admin.from("whiteboard_notes").select("id").eq("id", noteId).eq("owner_user_id", user.id).maybeSingle();
    if (reserveError || !reserved) throw new Error("사진을 저장하지 못했어요.");
    await uploadImageObject({ path: analysisPath, buffer: prepared.analysis.buffer, contentType: prepared.analysis.contentType });
    const { error: readyError } = await admin.from("whiteboard_notes").update({ image_ready: true, title: "정리를 기다리는 사진", error_message: null }).eq("id", noteId).eq("owner_user_id", user.id).eq("image_ready", false);
    if (readyError) throw readyError;
    const { data: note, error } = await admin.from("whiteboard_notes").select("*").eq("id", noteId).eq("owner_user_id", user.id).single();
    if (error) throw error;
    return NextResponse.json({ note }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "사진 저장에 실패했어요. 선택한 사진을 유지하고 있으니 다시 시도해주세요." }, { status: 400 });
  }
}
