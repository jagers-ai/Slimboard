import { NextResponse } from "next/server";

import { analyzeNoteForUser } from "@/lib/notes";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const note = await analyzeNoteForUser(id, user);

    return NextResponse.json({ note });
  } catch (error) {
    const message = error instanceof Error ? error.message : "분석에 실패했어요.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
