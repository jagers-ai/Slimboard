import { AccountBoundary } from "@/components/AccountBoundary";
import Link from "@/components/AppLink";
import { Search } from "lucide-react";

import { AppFrame } from "@/components/AppFrame";
import { SignOutButton } from "@/components/SignOutButton";
import { NoteList } from "@/components/NoteList";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { listNotesForUser } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  if (!hasCoreEnv()) {
    return (
      <AppFrame active="notes">
        <section className="setup-panel">
          <span className="eyebrow">설정 필요</span>
          <h1>앱 설정이 필요합니다</h1>
          <p className="page-subtitle">
            현재 Slimboard를 사용할 수 없습니다. 관리자에게 문의해주세요.
          </p>
        </section>
      </AppFrame>
    );
  }

  const user = await requireUser();

  const notes = await listNotesForUser({
    userId: user.id,
  });

  return (
    <AccountBoundary key={user.id} userId={user.id}><AppFrame active="notes">
      <header className="topbar">
        <Link className="brand" href="/">슬림보드</Link>
        <SignOutButton email={user.email ?? ""} />
      </header>

      <section className="section-stack">
        <div className="section-heading">
          <h1 className="page-title">노트</h1>
        </div>

        <Link className="notebook-search" href="/search"><Search size={20} aria-hidden="true" />기록 검색</Link>
        <NoteList emptyText="홈에서 첫 사진을 노트로 남겨보세요." notes={notes} />
      </section>

    </AppFrame></AccountBoundary>
  );
}
