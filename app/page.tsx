import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Search, ShieldCheck, Sparkles } from "lucide-react";

import { CaptureUploader } from "@/components/CaptureUploader";
import { SignInButton } from "@/components/SignInButton";
import { SignOutButton } from "@/components/SignOutButton";
import { StatusBadge } from "@/components/StatusBadge";
import { hasCoreEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { listNotesForUser } from "@/lib/notes";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  if (!hasCoreEnv()) {
    return <SetupScreen />;
  }

  const user = await getCurrentUser();

  if (!user) {
    return <Landing />;
  }

  await ensurePersonalWorkspace(user);

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const notes = await listNotesForUser({
    userId: user.id,
    query: q,
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
        <SignOutButton email={user.email ?? ""} />
      </header>

      <section className="dashboard">
        <CaptureUploader />

        <div>
          <div>
            <span className="eyebrow">Your board memory</span>
            <h1 className="page-title">화이트보드 노트</h1>
            <p className="page-subtitle">
              사진과 원문, 요약을 함께 보관하고 필요한 순간 다시 찾습니다.
            </p>
          </div>

          <form className="search-bar" action="/">
            <input
              className="input"
              name="q"
              placeholder="제목, 원문, 요약, 키워드 검색"
              defaultValue={q}
            />
            <button className="button" type="submit" aria-label="검색">
              <Search size={18} />
              검색
            </button>
          </form>

          {notes.length === 0 ? (
            <div className="empty-state">
              {q ? "검색 결과가 없어요." : "첫 화이트보드를 저장해보세요."}
            </div>
          ) : (
            <div className="notes-grid">
              {notes.map((note) => (
                <Link className="note-card" href={`/notes/${note.id}`} key={note.id}>
                  <div className="note-thumb">
                    {note.image_url ? (
                      <img alt="" src={note.image_url} />
                    ) : (
                      <BookOpen size={24} />
                    )}
                  </div>
                  <div className="note-body">
                    <h3>{note.title}</h3>
                    <p>{note.summary || note.raw_text || "분석이 진행 중입니다."}</p>
                    <StatusBadge status={note.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Landing() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={19} />
          </span>
          Slimboard
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Whiteboard memory</span>
          <h1>Slimboard</h1>
          <p>
            회의가 끝나면 지워지는 화이트보드를 사진으로 남기고, Gemini가 원문과
            요약으로 정리해 검색 가능한 노트로 보관합니다.
          </p>
          <div className="actions">
            <SignInButton />
            <Link className="button" href="/privacy">
              <ShieldCheck size={18} />
              데이터 안내
            </Link>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-note">
            <strong>원본 사진 + 원문 + 요약</strong>
            <span>
              촬영한 이미지는 private cloud storage에 보관되고 Gemini 분석은 서버에서
              안전하게 실행됩니다.
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

function SetupScreen() {
  return (
    <main className="app-shell">
      <section className="setup-panel">
        <span className="eyebrow">Setup needed</span>
        <h1>Slimboard 환경 설정이 필요해요</h1>
        <p className="page-subtitle">
          <code>.env.example</code>을 <code>.env.local</code>로 복사한 뒤 Supabase와
          Gemini 값을 채워주세요. 설정이 완료되면 Google 로그인, 저장소, Gemini 분석이
          연결됩니다.
        </p>
        <div className="actions">
          <Link className="button primary" href="/privacy">
            <Sparkles size={18} />
            데이터 흐름 보기
          </Link>
        </div>
      </section>
    </main>
  );
}
