import Link from "next/link";
import { BookOpen, Search, Sparkles } from "lucide-react";

import { BottomDock } from "@/components/BottomDock";
import { CaptureUploader } from "@/components/CaptureUploader";
import { SignInButton } from "@/components/SignInButton";
import { SignOutButton } from "@/components/SignOutButton";
import { hasCoreEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
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
          <span className="eyebrow">화이트보드 노트</span>
          <h1>Slimboard</h1>
          <p>
            지워지는 화이트보드를 사진으로 남기고, 필요한 내용을 정리합니다.
          </p>
          <div className="actions">
            <SignInButton />
          </div>
        </div>

        <div className="feature-list">
          <div className="feature-row">
            <span className="feature-icon">
              <BookOpen size={20} />
            </span>
            <div>
              <strong>촬영하면 저장</strong>
              <span>회의 직후 모바일에서 바로 남길 수 있습니다.</span>
            </div>
          </div>
          <div className="feature-row">
            <span className="feature-icon">
              <Sparkles size={20} />
            </span>
            <div>
              <strong>내용 자동 정리</strong>
              <span>사진 속 내용을 읽기 쉬운 노트로 정리합니다.</span>
            </div>
          </div>
          <div className="feature-row">
            <span className="feature-icon">
              <Search size={20} />
            </span>
            <div>
              <strong>나중에 검색</strong>
              <span>저장한 화이트보드를 다시 찾기 쉽게 보관합니다.</span>
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
        <span className="eyebrow">설정 필요</span>
        <h1>앱 설정이 필요합니다</h1>
        <p className="page-subtitle">
          현재 Slimboard를 사용할 수 없습니다. 관리자에게 문의해주세요.
        </p>
      </section>

      <BottomDock active="home" />
    </main>
  );
}
