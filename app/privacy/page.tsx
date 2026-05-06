import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

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

      <section className="detail-panel">
        <span className="eyebrow">Data policy</span>
        <h1 className="page-title">데이터 안내</h1>
        <p className="page-subtitle">
          Slimboard는 원본 화이트보드 사진을 private cloud storage에 저장하고, 분석용
          리사이즈 이미지를 Gemini API로 전송해 원문과 요약을 생성합니다.
        </p>
        <div className="form-stack" style={{ marginTop: 24 }}>
          <div className="privacy-note">
            원본 사진은 노트를 다시 확인하거나 재분석할 수 있도록 보관됩니다. 노트를
            삭제하면 원본 이미지와 분석용 이미지도 함께 삭제됩니다.
          </div>
          <div className="privacy-note">
            Gemini API 키는 서버에만 저장되며 브라우저에 노출되지 않습니다. 운영은 유료
            Gemini API 프로젝트 사용을 전제로 합니다.
          </div>
          <div className="privacy-note">
            MVP에서는 개인 노트만 지원합니다. 팀 공유와 초대 기능은 이후 workspace
            멤버십을 통해 확장됩니다.
          </div>
        </div>
      </section>
    </main>
  );
}
