"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Camera, ImageUp, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { prepareCameraPhoto } from "@/lib/prepare-camera-photo";

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
  const albumInput = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

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

  useEffect(() => {
    // Already-authorized browsers may inherit the invitation fragment through
    // a redirect. Keep it out of the camera screen's address and share sheet.
    if (new URLSearchParams(window.location.hash.slice(1)).has("invite")) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    void refreshAuth();
  }, []);
  useEffect(() => { if (result) resultHeading.current?.focus({ preventScroll: true }); }, [result]);
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
      setError(failure instanceof TypeError
        ? "연결이 끊겼어요. 인터넷 연결을 확인한 뒤 다시 시도해주세요."
        : failure instanceof Error ? failure.message : "분석하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function preparePhoto(selected: File) {
    setPreparing(true);
    setResult(null);
    setError("");
    try {
      setFile(await prepareCameraPhoto(selected));
    } catch (failure) {
      setFile(null);
      setError(failure instanceof Error ? failure.message : "사진을 읽지 못했어요. 다시 촬영해주세요.");
    } finally {
      setPreparing(false);
    }
  }

  const ready = auth?.ready;
  const pending = busy || preparing;
  const status = busy ? "내용을 읽고 있어요…" : preparing ? "사진 준비 중…" : checking ? "준비 중…" : result ? "노트가 완성되었어요." : "";
  function choosePhoto(element: HTMLInputElement | null) {
    if (!element || pending) return;
    element.value = "";
    element.click();
  }
  return (
    <main className="app-shell camera-shell">
      <header className="topbar">
        <span className="brand"><span className="brand-mark"><BookOpen size={19} /></span>Slimboard</span>
      </header>
      <div className="section-stack">
        <section className="camera-intro" aria-labelledby="camera-title">
          <h1 id="camera-title">사진을 노트로</h1>
          <p className="muted">화이트보드를 찍으면 글과 핵심 내용을 정리해드려요.</p>
          {!checking && !ready ? <div className="form-stack" role="status">
            <p className="inline-message">지금은 노트를 만들 수 없어요. 잠시 후 다시 시도해주세요.</p>
            <button className="button" onClick={refreshAuth} disabled={pending}><RefreshCw size={18} />다시 연결</button>
          </div> : null}
        </section>
        <section className="panel capture-panel" aria-label="사진 선택과 분석" aria-busy={pending}>
          <input ref={input} hidden type="file" accept="image/*" capture="environment" aria-label="화이트보드 촬영" disabled={pending}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (!selected) return;
              void preparePhoto(selected);
            }} />
          <input ref={albumInput} hidden type="file" accept="image/*" aria-label="앨범에서 사진 선택" disabled={pending}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void preparePhoto(selected);
            }} />
          <div className="upload-preview">
            {preview ? <img src={preview} alt="촬영한 화이트보드" style={{ objectFit: "contain" }} /> :
              <div className="upload-empty"><Camera size={28} /><strong>화이트보드를 촬영해주세요</strong></div>}
          </div>
          <div className="photo-actions">
            <button type="button" className="button" disabled={pending} onClick={() => choosePhoto(input.current)}>
              <Camera size={18} aria-hidden="true" />{file ? "다시 촬영" : "사진 촬영"}
            </button>
            <button type="button" className="button" disabled={pending} onClick={() => choosePhoto(albumInput.current)}>
              <ImageUp size={18} aria-hidden="true" />앨범 선택
            </button>
          </div>
          <button type="button" className="button primary full-width" disabled={!file || !ready || pending || checking} onClick={analyze}>
            {pending || checking ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}{pending || checking ? status : "노트 만들기"}
          </button>
          {error ? <p className="inline-message" role="alert">{error}</p> : null}
        </section>
        <p className="sr-only" role="status" aria-atomic="true">{status}</p>
        {result ? <section className="panel form-stack analysis-result" aria-labelledby="analysis-title">
          <span className="eyebrow">분석 완료{result.elapsedMs ? ` · ${(result.elapsedMs / 1000).toFixed(1)}초` : ""}</span>
          <h2 id="analysis-title" ref={resultHeading} tabIndex={-1}>{result.analysis.title}</h2>
          <dl>
            <div><dt>핵심 요약</dt><dd><p>{result.analysis.summary}</p></dd></div>
            <div><dt>사진 속 원문</dt><dd><p>{result.analysis.rawText}</p></dd></div>
            <div><dt>검색 키워드</dt><dd><ul className="analysis-keywords">{result.analysis.keywords.map((word) => <li className="chip" key={word}>{word}</li>)}</ul></dd></div>
          </dl>
        </section> : null}
      </div>
    </main>
  );
}
