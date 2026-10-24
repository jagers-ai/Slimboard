import { AccountBoundary } from "@/components/AccountBoundary";
import { notFound } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { NoteEditor } from "@/components/NoteEditor";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { getNoteWithImageUrl } from "@/lib/notes";

export const dynamic = "force-dynamic";

type NotePageProps = {
  params: Promise<{ id: string }>;
};

export default async function NotePage({ params }: NotePageProps) {
  if (!hasCoreEnv()) {
    notFound();
  }

  const user = await requireUser();
  const { id } = await params;
  const note = await getNoteWithImageUrl(id, user.id);

  if (!note) {
    notFound();
  }

  const editorNote = {
    id: note.id,
    title: note.title,
    raw_text: note.raw_text,
    summary: note.summary,
    keywords: note.keywords,
    error_message: note.error_message,
    created_at: note.created_at,
    status: note.status,
  };

  return (
    <AccountBoundary key={user.id} userId={user.id}><AppFrame active="notes">
      <NoteEditor key={note.id} note={editorNote} userId={user.id} photoUrl={note.image_url} />

    </AppFrame></AccountBoundary>
  );
}
