import Link from "next/link";
import { BookOpen } from "lucide-react";

import { BottomDock } from "@/components/BottomDock";
import { NoteList } from "@/components/NoteList";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { listNotesForUser } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  if (!hasCoreEnv()) {
    return (
      <main className="app-shell">
        <section className="setup-panel">
          <span className="eyebrow">설정 필요</span>
          <h1>앱 설정이 필요합니다</h1>
          <p className="page-subtitle">
            현재 Slimboard를 사용할 수 없습니다. 관리자에게 문의해주세요.
          </p>
        </section>
        <BottomDock active="notes" />
      </main>
    );
  }

  const user = await requireUser();

  const notes = await listNotesForUser({
    userId: user.id,
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <BookOpen size={19} />
          </span>
          Slimboard
        </Link>
      </header>

      <section className="section-stack">
        <div className="section-heading">
          <span className="eyebrow">노트</span>
          <h1 className="page-title">저장한 화이트보드</h1>
          <p className="page-subtitle">촬영한 화이트보드를 다시 확인해보세요.</p>
        </div>

        <NoteList emptyText="첫 화이트보드를 저장해보세요." notes={notes} />
      </section>

      <BottomDock active="notes" />
    </main>
  );
}
