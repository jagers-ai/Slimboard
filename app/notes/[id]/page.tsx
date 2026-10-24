import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
} from "lucide-react";

import { BottomDock } from "@/components/BottomDock";
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
    <main className="app-shell">
      <header className="notebook-topbar">
        <Link className="text-button icon-button" href="/notes" aria-label="기록 목록으로"><ArrowLeft size={22} /></Link>
        <span>노트</span><span />
      </header>
      <article className="notebook-document">
        <time className="session-caption" dateTime={note.created_at}>{new Date(note.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" })}</time>
        <h1>{note.title}</h1>
        {note.status !== "completed" ? <StatusBadge status={note.status} /> : null}
        {note.image_url ? <details className="original-photo">
          <summary><img src={note.image_url} alt="" /><span>원본 사진 보기</span><ChevronDown size={20} /></summary>
          <img className="expanded-photo" alt={note.title} src={note.image_url} />
        </details> : null}
        <section className="document-section"><h2>요약</h2><p>{note.summary || "아직 정리된 내용이 없어요."}</p></section>
        <details className="document-disclosure"><summary>전체 원문<ChevronDown size={20} /></summary><p>{note.raw_text || "아직 읽은 내용이 없어요."}</p></details>
        {note.keywords.length ? <details className="document-disclosure"><summary>키워드<ChevronDown size={20} /></summary><p>{note.keywords.join(" · ")}</p></details> : null}
        <details className="document-disclosure" open={note.status === "failed" ? true : undefined}>
          <summary>노트 수정<ChevronDown size={20} /></summary><NoteEditor note={editorNote} />
        </details>
      </article>

      <BottomDock active="notes" />
    </main>
  );
}
