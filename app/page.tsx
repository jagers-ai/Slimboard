import { AccountBoundary } from "@/components/AccountBoundary";
import Link from "@/components/AppLink";
import { Search } from "lucide-react";

import { AppFrame } from "@/components/AppFrame";
import { NewNoteButton, PendingPhotoNotice } from "@/components/NewNoteButton";
import { NoteList } from "@/components/NoteList";
import { SignInButton } from "@/components/SignInButton";
import { hasCoreEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { listNotesForUser } from "@/lib/notes";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!hasCoreEnv()) {
    return <SetupScreen />;
  }

  const user = await getCurrentUser();

  if (!user) {
    return <Landing />;
  }

  await ensurePersonalWorkspace(user);
  const notes = await listNotesForUser({ userId: user.id });

  return (
    <AccountBoundary key={user.id} userId={user.id}><AppFrame active="home" overlay={<NewNoteButton key={user.id} userId={user.id} />}>
      <header className="home-header">
        <h1 className="home-brand">슬림보드</h1>
        <Link className="text-button icon-button" href="/search" aria-label="노트 검색"><Search size={24} aria-hidden="true" /></Link>
      </header>

      <PendingPhotoNotice userId={user.id} />
      <NoteList notes={notes} empty={<div className="feed-empty">
        <strong>아직 노트가 없어요</strong>
        <p>오른쪽 아래 새 노트 버튼으로 화이트보드를 찍어보세요.</p>
      </div>} />
    </AppFrame></AccountBoundary>
  );
}

function Landing() {
  return (
    <AppFrame active="home" className="landing-shell" footer={<SignInButton />}>
      <section className="landing">
        <span className="landing-mark" aria-hidden="true">
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <rect x="6" y="9" width="40" height="28" rx="3" fill="#ffffff" />
            <path d="M13 18h16M13 25h24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M20 37l-4 8M32 37l4 8" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </span>
        <h1>화이트보드를 노트로</h1>
        <p>사진만 찍으면 AI가 보기 좋은 노트로 정리해 드려요. 지난 회의 내용도 검색으로 바로 찾아요.</p>
      </section>
    </AppFrame>
  );
}

function SetupScreen() {
  return (
    <AppFrame active="home">
      <section className="setup-panel">
        <h1>잠시 이용할 수 없어요</h1>
        <p className="page-subtitle">
          잠시 후 다시 시도해 주세요.
        </p>
      </section>
    </AppFrame>
  );
}
