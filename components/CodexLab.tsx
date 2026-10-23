"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Camera, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";

type AuthStatus = { ready: boolean };
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
  const [preparing, setPreparing] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function refreshAuth() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/lab/codex", { cache: "no-store" });
      if (!response.ok) throw new Error("잠시 후 다시 시도해주세요.");
      setAuth(await response.json());
    } catch {
      setAuth(null);
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
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(response.status === 401 || response.status === 410
          ? "초대 링크가 만료되었어요. 새 초대 링크로 다시 열어주세요."
          : response.status === 429 ? "이번 초대의 분석 횟수를 모두 사용했어요."
          : "사진을 정리하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "분석하지 못했어요.");
      setResult(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "분석하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function preparePhoto(selected: File) {
    setPreparing(true);
    setResult(null);
    setError("");
    const url = URL.createObjectURL(selected);
    try {
      if (!selected.size || selected.size > 40 * 1024 * 1024) {
        throw new Error("사진 용량이 너무 커요. 해상도를 낮춰 다시 촬영해주세요.");
      }
      const image = new Image();
      image.src = url;
      await image.decode();
      // Normalize camera formats, orientation and size before uploading.
      const scale = Math.min(1, 3000 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("사진을 읽지 못했어요. 다시 촬영해주세요.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob || blob.size > 10 * 1024 * 1024) throw new Error("사진 용량이 너무 커요. 다시 촬영해주세요.");
      setFile(new File([blob], "whiteboard.jpg", { type: "image/jpeg" }));
    } catch (failure) {
      setFile(null);
      setError(failure instanceof Error && failure.message.includes("촬영")
        ? failure.message : "사진을 읽지 못했어요. 다시 촬영해주세요.");
    } finally {
      URL.revokeObjectURL(url);
      setPreparing(false);
    }
  }

  const ready = auth?.ready;
  const pending = busy || preparing;
  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="brand"><span className="brand-mark"><BookOpen size={19} /></span>Slimboard</span>
      </header>
      <div className="section-stack">
        <section className="panel">
          <div className="section-heading">
            <h1 className="note-title">사진을 노트로</h1>
            <p className="muted">화이트보드를 찍으면 글과 핵심 내용을 정리해드려요.</p>
          </div>
          {!checking && !ready ? <div className="form-stack" role="status">
            <p className="inline-message">지금은 노트를 만들 수 없어요. 잠시 후 다시 시도해주세요.</p>
            <button className="button" onClick={refreshAuth} disabled={pending}><RefreshCw size={18} />다시 연결</button>
          </div> : null}
        </section>
        <section className="panel capture-panel">
          <input ref={input} hidden type="file" accept="image/*" capture="environment" aria-label="화이트보드 촬영" disabled={pending}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (!selected) return;
              void preparePhoto(selected);
            }} />
          <div className="upload-preview">
            {preview ? <img src={preview} alt="촬영한 화이트보드" style={{ objectFit: "contain" }} /> :
              <div className="upload-empty"><Camera size={28} /><strong>화이트보드를 촬영해주세요</strong></div>}
          </div>
          <button className="button full-width" disabled={pending} onClick={() => {
            if (!input.current) return;
            input.current.value = "";
            input.current.click();
          }}><Camera size={18} />{file ? "다시 촬영" : "사진 촬영"}</button>
          <button className="button primary full-width" disabled={!file || !ready || pending || checking} onClick={analyze}>
            {pending || checking ? <LoaderCircle size={18} /> : <Sparkles size={18} />}{busy ? "내용을 읽고 있어요…" : preparing ? "사진 준비 중…" : checking ? "준비 중…" : "노트 만들기"}
          </button>
          {error ? <p className="inline-message" role="alert">{error}</p> : null}
        </section>
        {result ? <section className="panel form-stack" aria-live="polite">
          <span className="eyebrow">분석 완료{result.elapsedMs ? ` · ${(result.elapsedMs / 1000).toFixed(1)}초` : ""}</span>
          <h2>{result.analysis.title}</h2>
          <strong>핵심 요약</strong><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{result.analysis.summary}</p>
          <strong>사진 속 원문</strong><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{result.analysis.rawText}</p>
          <strong>검색 키워드</strong><p className="muted">{result.analysis.keywords.join(", ")}</p>
        </section> : null}
      </div>
    </main>
  );
}
