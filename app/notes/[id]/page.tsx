import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <BookOpen size={19} />
          </span>
          Slimboard
        </Link>
        <Link className="button" href="/">
          <ArrowLeft size={18} />
          목록
        </Link>
      </header>

      <section className="detail-layout">
        <div className="detail-panel">
          <div className="status-row">
            <div>
              <span className="eyebrow">Original image</span>
              <h1 className="page-title" style={{ fontSize: "2.2rem" }}>
                {note.title}
              </h1>
            </div>
            <StatusBadge status={note.status} />
          </div>
          <div className="detail-image">
            {note.image_url ? <img alt={note.title} src={note.image_url} /> : null}
          </div>
          {note.warnings.length > 0 ? (
            <div className="meta-list">
              {note.warnings.map((warning) => (
                <span className="chip" key={warning}>
                  {warning}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <NoteEditor note={note} />
      </section>
    </main>
  );
}
