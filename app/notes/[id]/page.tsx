import { AccountBoundary } from "@/components/AccountBoundary";
import Link from "@/components/AppLink";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
} from "lucide-react";

import { BottomDock } from "@/components/BottomDock";
import { NoteDocument } from "@/components/NoteDocument";
import { NoteEditor } from "@/components/NoteEditor";
import { StatusBadge } from "@/components/StatusBadge";
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
  };

  return (
    <AccountBoundary key={user.id} userId={user.id}><main className="app-shell">
      <header className="notebook-topbar">
        <Link className="text-button icon-button" href="/notes" aria-label="기록 목록으로"><ArrowLeft size={22} /></Link>
        <span>노트</span><span />
      </header>
      <NoteDocument createdAt={note.created_at} photoUrl={note.image_url}
        analysis={{ title: note.title, summary: note.summary, rawText: note.raw_text, keywords: note.keywords }}
        status={note.status !== "completed" ? <StatusBadge status={note.status} /> : null}>
        {note.owner_user_id === user.id ? <details className="document-disclosure" open={note.status === "failed" ? true : undefined}>
          <summary>노트 수정<ChevronDown size={20} /></summary><NoteEditor key={note.id} note={editorNote} userId={user.id} />
        </details> : null}
      </NoteDocument>

      <BottomDock active="notes" />
    </main></AccountBoundary>
  );
}
