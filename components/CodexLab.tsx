"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, ChevronDown, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { prepareCameraPhoto } from "@/lib/prepare-camera-photo";

type AuthStatus = { ready: boolean };
type AnalysisResult = {
  analysis: { title: string; rawText: string; summary: string; keywords: string[] };
  model: string;
  elapsedMs?: number;
};

type SessionNote = { id: string; result: AnalysisResult; photo: File; createdAt: string };

export function CodexLab() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [screen, setScreen] = useState<"list" | "photo" | "note">("list");
  const [query, setQuery] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const screenHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    (screen === "note" ? resultHeading : screenHeading).current?.focus({ preventScroll: true });
  }, [screen]);
  useEffect(() => {
    // Session-only records: warn before an accidental reload discards a photo or notes.
    if (!file && notes.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [file, notes.length]);
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
      const timestamp = new Date().toISOString();
      setCreatedAt(timestamp);
      setResult(payload);
      setNotes((previous) => [{ id: crypto.randomUUID(), result: payload, photo: file, createdAt: timestamp }, ...previous]);
      setScreen("note");
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
    setError("");
    try {
      const prepared = await prepareCameraPhoto(selected);
      setFile(prepared);
      setResult(null);
      setScreen("photo");
    } catch (failure) {
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
  const filteredNotes = notes.filter(({ result: { analysis } }) =>
    [analysis.title, analysis.summary, analysis.rawText, ...analysis.keywords].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function openNote(note: SessionNote) {
    setFile(note.photo);
    setResult(note.result);
    setCreatedAt(note.createdAt);
    setError("");
    setScreen("note");
  }
  function backToList() { setScreen("list"); setError(""); }
  return (
    <main className="app-shell camera-shell notebook-shell" aria-busy={pending}>
      <header className={screen === "list" ? "topbar" : "notebook-topbar"}>
        {screen === "list" ? <>
          <span className="brand">슬림보드</span>
          <button className="text-button icon-button" aria-label="기록 검색" onClick={() => searchInput.current?.focus()}><Search size={22} /></button>
        </> : <>
          <button className="text-button icon-button" aria-label="기록 목록으로" disabled={pending} onClick={backToList}><ArrowLeft size={22} /></button>
          <span>{screen === "photo" ? "사진 확인" : "노트"}</span>
          {screen === "photo" ? <button className="text-button" disabled={pending} onClick={() => choosePhoto(albumInput.current)}>다시 선택</button> : <span />}
        </>}
      </header>
      <input ref={input} hidden type="file" accept="image/*" capture="environment" aria-label="화이트보드 촬영" disabled={pending}
        onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void preparePhoto(selected); }} />
      <input ref={albumInput} hidden type="file" accept="image/*" aria-label="앨범에서 사진 선택" disabled={pending}
        onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void preparePhoto(selected); }} />
      {screen === "list" ? <section className="notebook-content" aria-labelledby="records-title">
        <h1 id="records-title" className="page-title" tabIndex={-1} ref={screenHeading}>기록</h1>
        <label className="notebook-search">
          <Search size={20} aria-hidden="true" />
          <input ref={searchInput} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기록 검색" aria-label="기록 검색어" />
        </label>
        <p className="session-caption">이 탭에서 만든 기록이에요. 새로고침하면 사라집니다.</p>
        {filteredNotes.length ? <div className="notes-list">
          {filteredNotes.map((note) => <button className="note-card session-note" key={note.id} onClick={() => openNote(note)} disabled={pending}>
            <SessionThumbnail photo={note.photo} />
            <span className="note-body"><strong>{note.result.analysis.title}</strong><span className="note-excerpt">{note.result.analysis.summary}</span><time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time></span>
          </button>)}
        </div> : <div className="notebook-empty">
          <h2>{query ? "일치하는 기록이 없어요" : "지우기 전에, 한 장."}</h2>
          <p>{query ? "다른 검색어로 찾아보세요." : "화이트보드의 생각을\n읽기 편한 노트로 남겨보세요."}</p>
        </div>}
        {file && !result ? <button className="text-button resume-photo" disabled={pending} onClick={() => setScreen("photo")}>선택한 사진 이어서 정리</button> : null}
      </section> : screen === "photo" ? <section className="photo-review" aria-labelledby="photo-title">
        <h1 className="sr-only" id="photo-title" tabIndex={-1} ref={screenHeading}>사진 확인</h1>
        <div className="review-image">{preview ? <img src={preview} alt="정리할 사진" /> : null}</div>
        <p className="session-caption">글씨가 잘 보이는지 확인해 주세요.</p>
      </section> : result ? <article className="notebook-document" aria-labelledby="analysis-title">
        <time className="session-caption" dateTime={createdAt}>{formatDate(createdAt)}</time>
        <h1 id="analysis-title" ref={resultHeading} tabIndex={-1}>{result.analysis.title}</h1>
        <details className="original-photo" key={createdAt}>
          <summary>{preview ? <img src={preview} alt="" /> : null}<span>원본 사진 보기</span><ChevronDown size={20} aria-hidden="true" /></summary>
          {preview ? <img className="expanded-photo" src={preview} alt="노트의 원본 사진" /> : null}
        </details>
        <section className="document-section"><h2>요약</h2><p>{result.analysis.summary}</p></section>
        <details className="document-disclosure" key={createdAt + "text"}>
          <summary>전체 원문<ChevronDown size={20} aria-hidden="true" /></summary><p>{result.analysis.rawText}</p>
        </details>
        {result.analysis.keywords.length ? <details className="document-disclosure" key={createdAt + "keywords"}>
          <summary>키워드<ChevronDown size={20} aria-hidden="true" /></summary><p className="document-keywords">{result.analysis.keywords.join(" · ")}</p>
        </details> : null}
      </article> : null}
      <div className="notebook-actions">
        {!checking && !ready ? <div role="status"><p className="inline-message">지금은 노트를 만들 수 없어요. 잠시 후 다시 연결해주세요.</p><button className="text-button" onClick={refreshAuth} disabled={pending}><RefreshCw size={18} />다시 연결</button></div> : null}
        {error ? <p className="inline-message" role="alert">{error}</p> : null}
        {screen === "photo" ? <>
          <button className="button primary full-width" disabled={!file || !ready || pending || checking} onClick={analyze}>
            {pending || checking ? <LoaderCircle size={20} className="spinner" aria-hidden="true" /> : null}{pending || checking ? status : "내용 정리"}
          </button>
          <button className="text-button full-width" disabled={pending} onClick={() => choosePhoto(input.current)}>다시 촬영</button>
        </> : <>
          <button className={`button full-width ${screen === "list" ? "primary" : "outline"}`} disabled={pending} onClick={() => choosePhoto(input.current)}>
            {preparing ? <LoaderCircle size={20} className="spinner" aria-hidden="true" /> : <Camera size={20} aria-hidden="true" />}{preparing ? status : screen === "list" ? "사진 촬영" : "새 사진 촬영"}
          </button>
          <button className="text-button full-width" disabled={pending} onClick={() => choosePhoto(albumInput.current)}>앨범에서 선택</button>
        </>}
      </div>
      <p className="sr-only" role="status" aria-atomic="true">{status}</p>
    </main>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function SessionThumbnail({ photo }: { photo: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(photo);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo]);
  return <span className="note-thumb">{url ? <img src={url} alt="" /> : null}</span>;
}
