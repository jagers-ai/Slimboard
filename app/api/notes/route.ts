import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { prepareImage } from "@/lib/image";
import { buildSearchText } from "@/lib/search";
import { buildImagePaths, removeImageObjects, uploadImageObject } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") ?? undefined;
  const { listNotesForUser } = await import("@/lib/notes");
  const notes = await listNotesForUser({
    userId: user.id,
    query,
    limit: 50,
  });

  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "이미지 파일을 선택해주세요." }, { status: 400 });
    }

    const workspaceId = await ensurePersonalWorkspace(user);
    const noteId = randomUUID();
    const prepared = await prepareImage(file);
    const { originalPath, analysisPath } = buildImagePaths({
      userId: user.id,
      noteId,
      originalExtension: prepared.original.extension,
    });

    await uploadImageObject({
      path: originalPath,
      buffer: prepared.original.buffer,
      contentType: prepared.original.contentType,
    });
    await uploadImageObject({
      path: analysisPath,
      buffer: prepared.analysis.buffer,
      contentType: prepared.analysis.contentType,
    });

    const admin = createAdminClient();
    const title = "Processing whiteboard";
    const searchText = buildSearchText({ title });
    const { data, error } = await admin
      .from("whiteboard_notes")
      .insert({
        id: noteId,
        workspace_id: workspaceId,
        owner_user_id: user.id,
        title,
        original_image_path: originalPath,
        analysis_image_path: analysisPath,
        status: "processing",
        search_text: searchText,
      })
      .select("*")
      .single();

    if (error) {
      await removeImageObjects([originalPath, analysisPath]);
      throw error;
    }

    return NextResponse.json({ note: data }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "화이트보드 업로드에 실패했어요.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
