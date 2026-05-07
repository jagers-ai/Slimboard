import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  FileText,
  HomeIcon,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <ShieldCheck size={19} />
          </span>
          Slimboard
        </Link>
        <Link className="button" href="/">
          <ArrowLeft size={18} />
          돌아가기
        </Link>
      </header>

      <section className="detail-panel privacy-panel">
        <span className="eyebrow">Data policy</span>
        <h1 className="page-title">데이터 안내</h1>
        <p className="page-subtitle">
          Slimboard가 사진을 어떻게 저장하고 분석하는지 짧게 정리했어.
        </p>
        <div className="policy-list">
          <div className="policy-row">
            <span className="feature-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <strong>원본 사진은 private storage에 저장</strong>
              <span>노트를 다시 확인하거나 재분석할 수 있도록 보관해.</span>
            </div>
          </div>
          <div className="policy-row">
            <span className="feature-icon">
              <LockKeyhole size={20} />
            </span>
            <div>
              <strong>Gemini API 키는 서버에만 보관</strong>
              <span>브라우저에는 노출하지 않고 서버에서 분석을 실행해.</span>
            </div>
          </div>
          <div className="policy-row">
            <span className="feature-icon">
              <FileText size={20} />
            </span>
            <div>
              <strong>삭제하면 이미지도 함께 정리</strong>
              <span>노트를 지우면 연결된 원본 이미지와 분석 이미지도 삭제해.</span>
            </div>
          </div>
        </div>
      </section>

      <BottomDock active="privacy" />
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
      <Link className={`dock-item ${active === "capture" ? "active" : ""}`} href="/#capture">
        <Camera size={22} />
        <span>저장</span>
      </Link>
      <Link className={`dock-item ${active === "search" ? "active" : ""}`} href="/#search">
        <Search size={22} />
        <span>검색</span>
      </Link>
      <span className={`dock-item ${active === "privacy" ? "active" : ""}`} aria-current="page">
        <ShieldCheck size={22} />
        <span>안내</span>
      </span>
      <span className="dock-item muted-dock" aria-hidden="true">
        <FileText size={22} />
        <span>노트</span>
      </span>
    </nav>
  );
}
