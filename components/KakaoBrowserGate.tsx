"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { detectKakaoMobile, externalBrowserLinks, type KakaoMobile } from "@/lib/external-browser";

export function KakaoBrowserGate({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<{ device: KakaoMobile; links: ReturnType<typeof externalBrowserLinks> } | null>(null);
  const [help, setHelp] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [manualCopy, setManualCopy] = useState(false);

  useEffect(() => {
    const device = detectKakaoMobile(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    if (!device) return;
    setContext({ device, links: externalBrowserLinks(window.location.href, device) });
    setHelp(new URLSearchParams(window.location.search).get("externalBrowser") === "help");
  }, []);

  useEffect(() => {
    if (context) document.getElementById("external-browser-heading")?.focus({ preventScroll: true });
  }, [context]);

  if (!context) return children;
  const browser = context.device === "ios" ? "Safari" : "Chrome";

  async function copyLink() {
    if (!context) return;
    try {
      await navigator.clipboard.writeText(context.links.home);
      setCopyMessage(`링크를 복사했어요. ${browser} 주소창에 붙여넣어 주세요.`);
      setManualCopy(false);
    } catch {
      setManualCopy(true);
      setCopyMessage("아래 주소를 길게 눌러 복사해 주세요.");
    }
  }

  return (
    <main className="app-shell external-browser-shell">
      <header className="topbar"><div className="brand">슬림보드</div></header>
      <section className="external-browser-content" aria-labelledby="external-browser-heading">
        <span className="eyebrow">카카오톡에서 접속했어요</span>
        <h1 id="external-browser-heading" className="page-title" tabIndex={-1}>외부 브라우저에서<br />열어주세요</h1>
        <p className="page-subtitle">로그인하려면 {browser}에서 열어 주세요.</p>
        <div className="external-browser-actions">
          <a className="button primary" href={context.links.primary} onClick={() => setHelp(true)}><ExternalLink size={18} aria-hidden="true" />{browser}{context.device === "ios" ? "로" : "으로"} 열기</a>
          <button type="button" className="button" onClick={() => void copyLink()}><Copy size={18} aria-hidden="true" />링크 복사</button>
        </div>
        <p className="external-browser-status" role="status">{copyMessage}</p>
        {manualCopy ? <label className="external-browser-copy">슬림보드 주소<input className="input" readOnly value={context.links.home} onFocus={(event) => event.currentTarget.select()} /></label> : null}
        <details className="external-browser-help" open={help} onToggle={(event) => setHelp(event.currentTarget.open)}>
          <summary>버튼을 눌러도 열리지 않나요?</summary>
          <p>{context.device === "android" ? "Chrome이 없거나 실행되지 않으면 기본 브라우저로 열어보세요. 삼성 인터넷도 사용할 수 있어요." : "기기 설정에 따라 Safari가 바로 열리지 않을 수 있어요. 기본 브라우저로 열거나 링크를 복사해 Safari 주소창에 붙여넣어 주세요."}</p>
          <a className="button" href={context.links.external}>다른 브라우저로 열기</a>
          <p>그래도 열리지 않으면 카카오톡 화면의 메뉴에서 ‘다른 브라우저로 열기’ 또는 비슷한 항목을 선택해 주세요.</p>
        </details>
      </section>
    </main>
  );
}
