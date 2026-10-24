import { getCurrentUser } from "@/lib/auth";
import { getNoteForUser } from "@/lib/notes";
import { downloadImageObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const user = await getCurrentUser(request);
  if (!user) return new Response(null, { status: 401, headers });
  const note = await getNoteForUser((await context.params).id, user.id);
  if (!note || !note.image_ready) return new Response(null, { status: 404, headers });
  try {
    const bytes = await downloadImageObject(note.analysis_image_path);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
