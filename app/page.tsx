import Link from "next/link";
import {
  BookOpen,
  Camera,
  FileText,
  HomeIcon,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

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

        <section className="section-stack" id="search">
          <div className="section-heading">
            <span className="eyebrow">Board memory</span>
            <h1 className="page-title">저장한 화이트보드</h1>
            <p className="page-subtitle">원본, 원문, 요약을 한 번에 찾아요.</p>
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
            <div className="notes-list">
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
        </section>
      </section>

      <BottomDock active="home" />
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
        <div className="hero-card">
          <span className="eyebrow">Whiteboard memory</span>
          <h1>Slimboard</h1>
          <p>
            지워지는 화이트보드를 사진으로 남기고, 원문과 요약까지 바로 정리해요.
          </p>
          <div className="actions">
            <SignInButton />
            <Link className="button" href="/privacy">
              <ShieldCheck size={18} />
              데이터 안내
            </Link>
          </div>
        </div>

        <div className="feature-list">
          <div className="feature-row">
            <span className="feature-icon">
              <Camera size={20} />
            </span>
            <div>
              <strong>촬영하면 저장</strong>
              <span>회의 직후 모바일에서 바로 남겨요.</span>
            </div>
          </div>
          <div className="feature-row">
            <span className="feature-icon">
              <Sparkles size={20} />
            </span>
            <div>
              <strong>Gemini가 요약</strong>
              <span>원문, 요약, 키워드를 자동으로 정리해요.</span>
            </div>
          </div>
          <div className="feature-row">
            <span className="feature-icon">
              <Search size={20} />
            </span>
            <div>
              <strong>나중에 검색</strong>
              <span>사진만 남겨도 다시 찾기 쉬워져요.</span>
            </div>
          </div>
        </div>
      </section>

      <BottomDock active="home" />
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

      <BottomDock active="home" />
    </main>
  );
}

function BottomDock({ active }: { active: "home" | "capture" | "search" | "privacy" }) {
  return (
    <nav className="bottom-dock" aria-label="주요 이동">
      <Link className={`dock-item ${active === "home" ? "active" : ""}`} href="/">
        <HomeIcon size={22} />
        <span>홈</span>
      </Link>
      <a className={`dock-item ${active === "capture" ? "active" : ""}`} href="#capture">
        <Camera size={22} />
        <span>저장</span>
      </a>
      <a className={`dock-item ${active === "search" ? "active" : ""}`} href="#search">
        <Search size={22} />
        <span>검색</span>
      </a>
      <Link className={`dock-item ${active === "privacy" ? "active" : ""}`} href="/privacy">
        <ShieldCheck size={22} />
        <span>안내</span>
      </Link>
      <span className="dock-item muted-dock" aria-hidden="true">
        <FileText size={22} />
        <span>노트</span>
      </span>
    </nav>
  );
}
