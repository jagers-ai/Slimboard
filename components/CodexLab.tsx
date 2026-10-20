"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, ImageUp, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";

type AuthStatus = { available: boolean; authenticated: boolean; mode: string | null; message: string };
type AnalysisResult = {
  analysis: { title: string; rawText: string; summary: string; keywords: string[] };
  model: string;
  elapsedMs?: number;
};

export function CodexLab() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function refreshAuth() {
    setChecking(true);
    try {
      const response = await fetch("/api/lab/codex", { cache: "no-store" });
      if (!response.ok) throw new Error("로그인 상태를 확인하지 못했어요.");
      setAuth(await response.json());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "연결을 확인해주세요.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { void refreshAuth(); }, []);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function analyze() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/lab/codex", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "분석하지 못했어요.");
      setResult(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "분석하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const ready = auth?.authenticated && auth.mode === "chatgpt";
  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="brand"><span className="brand-mark"><BookOpen size={19} /></span>Slimboard</span>
        <span className="eyebrow">로컬 실험</span>
      </header>
      <div className="section-stack">
        <section className="panel">
          <div className="section-heading">
            <span className="eyebrow">ChatGPT 구독으로 분석</span>
            <h1 className="note-title">사진을 노트로</h1>
            <p className="muted">화이트보드의 글과 핵심 내용을 얼마나 잘 정리하는지 확인해보세요.</p>
          </div>
          <p className="muted" role="status">{auth?.message ?? "Codex 로그인 확인 중…"}</p>
          {!ready ? <p className="muted">이 PC의 터미널에서 <code>npm run lab:login</code>으로 연결해주세요.</p> : null}
          <button className="button" onClick={refreshAuth} disabled={checking || busy}>
            <RefreshCw size={18} />{checking ? "확인 중" : "연결 다시 확인"}
          </button>
        </section>
        <section className="panel capture-panel">
          <input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (!selected) return;
              setResult(null); setError("");
              if (selected.size > 10 * 1024 * 1024) { setError("10MB 이하 사진을 선택해주세요."); setFile(null); return; }
              setFile(selected);
            }} />
          <div className="upload-preview">
            {preview ? <img src={preview} alt="분석할 화이트보드 사진" /> :
              <div className="upload-empty"><ImageUp size={28} /><strong>화이트보드 사진을 선택해주세요</strong><span>JPG, PNG, WebP · 최대 10MB</span></div>}
          </div>
          <button className="button full-width" disabled={busy} onClick={() => input.current?.click()}><ImageUp size={18} />사진 선택</button>
          <button className="button primary full-width" disabled={!file || !ready || busy} onClick={analyze}>
            {busy ? <LoaderCircle size={18} /> : <Sparkles size={18} />}{busy ? "내용을 읽고 있어요…" : "ChatGPT 구독으로 분석"}
          </button>
          <p className="muted">사진은 분석을 위해 OpenAI로 전송됩니다. 이 실험에서는 노트 보관함에 저장하지 않습니다.</p>
          {error ? <p className="inline-message" role="alert">{error}</p> : null}
        </section>
        {result ? <section className="panel form-stack" aria-live="polite">
          <span className="eyebrow">분석 완료{result.elapsedMs ? ` · ${(result.elapsedMs / 1000).toFixed(1)}초` : ""}</span>
          <h2>{result.analysis.title}</h2>
          <strong>핵심 요약</strong><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{result.analysis.summary}</p>
          <strong>사진 속 원문</strong><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{result.analysis.rawText}</p>
          <strong>검색 키워드</strong><p className="muted">{result.analysis.keywords.join(", ")}</p>
          <p className="muted">모델: {result.model}</p>
        </section> : null}
      </div>
    </main>
  );
}
