"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, FileText, Image as ImageIcon, LoaderCircle } from "lucide-react";

import Link from "@/components/AppLink";
import { AppFrame } from "@/components/AppFrame";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import {
  GOODNOTES_DEFAULT_PEN, GOODNOTES_PENS, GoodnotesExportError, changeGoodnotesPen, isGoodnotesPen, prepareGoodnotesFile,
  type GoodnotesFailure, type GoodnotesFile, type GoodnotesPen,
} from "@/lib/goodnotes-export";

type Stage =
  | { name: "preparing" | "empty" | "unfinished" | GoodnotesFailure }
  | { name: "ready"; prepared: GoodnotesFile; shareable: boolean };

const messages: Record<Exclude<Stage["name"], "ready">, string> = {
  preparing: "글씨를 옮기는 중이에요",
  empty: "사진에서 글씨를 찾지 못했어요.",
  unfinished: "노트 변환이 끝나면 보낼 수 있어요.",
  "photo-missing": "이 노트에는 사진이 없어요.",
  photo: "사진을 불러오지 못했어요.",
  ink: "글씨를 옮기지 못했어요.",
};

const penNames: Record<GoodnotesPen, string> = { fountain: "만년필", brush: "붓" };
// A per-device convenience: without storage the screen starts with the default pen.
const penStorageKey = "slimboard.goodnotes-pen";

function readStoredPen(): GoodnotesPen {
  try {
    const stored = window.localStorage.getItem(penStorageKey);
    if (isGoodnotesPen(stored)) return stored;
  } catch (error) {
    console.warn("Goodnotes pen choice unavailable", error);
  }
  return GOODNOTES_DEFAULT_PEN;
}

function storePen(pen: GoodnotesPen) {
  try {
    window.localStorage.setItem(penStorageKey, pen);
  } catch (error) {
    console.warn("Goodnotes pen choice not remembered", error);
  }
}

/** Prepares the handwriting as soon as it opens, so one tap can open the share sheet. */
export function GoodnotesExport({ noteId, title, photoUrl, completed }: {
  noteId: string; title: string; photoUrl: string | null; completed: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<Stage>({ name: "preparing" });
  // The pen tapped on this screen; until then the file keeps the pen it was prepared with.
  const [chosenPen, setChosenPen] = useState<GoodnotesPen | null>(null);
  const stage: Stage = !photoUrl ? { name: "photo-missing" } : !completed ? { name: "unfinished" } : progress;
  const prepared = stage.name === "ready" ? stage.prepared : null;
  const pen = chosenPen ?? prepared?.pen ?? GOODNOTES_DEFAULT_PEN;
  // Rewriting the file for another pen: the action waits for the new file.
  const rewriting = prepared !== null && prepared.pen !== pen;

  useEffect(() => {
    if (!photoUrl || !completed) return;
    const abort = new AbortController();
    // The last pen chosen on this device (also on this screen, since a choice is stored before it applies).
    prepareGoodnotesFile({ photoUrl, title, signal: abort.signal, pen: readStoredPen() }).then(prepared => {
      if (!abort.signal.aborted) setProgress(prepared ? { name: "ready", prepared, shareable: canShare(prepared.file) } : { name: "empty" });
    }, error => {
      if (abort.signal.aborted) return;
      console.error("Goodnotes export failed", error, error instanceof Error ? error.cause : undefined);
      setProgress({ name: error instanceof GoodnotesExportError ? error.failure : "ink" });
    });
    return () => abort.abort();
  }, [attempt, completed, photoUrl, title]);

  // Only the latest choice may replace the file: a newer choice or a new preparation drops an older rewrite.
  useEffect(() => {
    if (!prepared || prepared.pen === pen) return;
    let current = true;
    changeGoodnotesPen(prepared, pen).then(next => {
      if (current) setProgress({ name: "ready", prepared: next, shareable: canShare(next.file) });
    }, error => {
      if (!current) return;
      console.error("Goodnotes pen change failed", error, error instanceof Error ? error.cause : undefined);
      setProgress({ name: error instanceof GoodnotesExportError ? error.failure : "ink" });
    });
    return () => { current = false; };
  }, [pen, prepared]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest(".app-scroll")?.scrollTo({ top: 0 });
  }, [stage.name]);

  const share = useShare();
  const saveUrl = useObjectUrl(stage.name === "ready" && !stage.shareable && !rewriting ? stage.prepared.file : null);
  const noteUrl = `/notes/${noteId}`;

  function choosePen(next: GoodnotesPen) {
    storePen(next);
    setChosenPen(next);
  }

  function retry() {
    setProgress({ name: "preparing" });
    setAttempt(current => current + 1);
  }

  let action;
  if (stage.name === "preparing" || rewriting) {
    action = <button className="button primary full-width" type="button" disabled>준비 중</button>;
  } else if (stage.name === "photo" || stage.name === "ink") {
    action = <button className="button primary full-width" type="button" onClick={retry}>다시 시도</button>;
  } else if (stage.name !== "ready") {
    action = <Link className="button primary full-width" href={noteUrl}>노트로 돌아가기</Link>;
  } else if (stage.shareable) {
    const { prepared } = stage;
    action = <button className="button primary full-width" type="button" aria-disabled={share.busy || undefined}
      onClick={() => void share.send(prepared)}>굿노트로 보내기</button>;
  } else {
    action = <a className="button primary full-width" href={saveUrl} download={stage.prepared.file.name}>파일로 저장</a>;
  }

  const footer = <div className="goodnotes-actions">
    <div role="status">{share.failed ? <p className="inline-message">보내지 못했어요. 다시 눌러 주세요.</p> : null}</div>
    {action}
  </div>;

  return <AppFrame active="home" className="goodnotes-shell" footer={footer}>
    <header className="screen-header">
      <Link className="text-button icon-button" href={noteUrl} aria-label="노트로 돌아가기"><ChevronLeft size={24} aria-hidden="true" /></Link>
      <h1 ref={headingRef} tabIndex={-1}>굿노트로 보내기</h1>
      <span aria-hidden="true" />
    </header>
    <section className={stage.name === "ready" ? "goodnotes-export" : "capture-placeholder goodnotes-state"} aria-busy={stage.name === "preparing"}>
      {stage.name === "ready" ? <>
        <InkPaper preview={stage.prepared.preview} />
        <PenChoice pen={pen} onChange={choosePen} />
      </>
        : stage.name === "preparing" ? <LoaderCircle size={40} className="spinner" aria-hidden="true" />
        : stage.name === "photo" || stage.name === "photo-missing" ? <ImageIcon size={40} aria-hidden="true" />
        : <FileText size={40} aria-hidden="true" />}
      <p className={stage.name === "ready" ? "capture-hint" : undefined} role="status">
        {stage.name !== "ready" ? messages[stage.name]
          : stage.shareable ? <><span>공유 화면에서 Goodnotes를 골라 주세요.</span> <span>안 보이면 더 보기에 있어요.</span></>
          : "저장한 파일을 굿노트에서 열어 주세요."}
      </p>
    </section>
  </AppFrame>;
}

function PenChoice({ pen, onChange }: { pen: GoodnotesPen; onChange: (pen: GoodnotesPen) => void }) {
  const id = useId();
  return <fieldset className="choice-group">
    <legend className="sr-only">펜</legend>
    {GOODNOTES_PENS.map(option => <span className="choice-option" key={option}>
      <input className="choice-input" type="radio" id={`${id}-${option}`} name={`${id}-pen`} value={option}
        checked={pen === option} onChange={() => onChange(option)} />
      <label htmlFor={`${id}-${option}`}>{penNames[option]}</label>
    </span>)}
  </fieldset>;
}

function InkPaper({ preview }: { preview: GoodnotesFile["preview"] }) {
  return <svg className="goodnotes-paper" role="img" aria-label="사진에서 옮긴 글씨"
    viewBox={`0 0 ${preview.width} ${preview.height}`}
    style={{ "--paper-ratio": preview.width / preview.height } as React.CSSProperties}>
    {preview.fills.map((fill, index) => <path key={`fill-${index}`} d={fill.d} fill={fill.color} />)}
    {preview.paths.map((path, index) => <path key={index} d={path.d} fill="none" stroke={path.color}
      strokeWidth={path.width} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

function canShare(file: File) {
  try {
    return typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

function useShare() {
  const running = useRef(0);
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Some iOS versions never settle share() after switching to the other app.
    const release = () => {
      if (document.visibilityState !== "visible") return;
      running.current = 0;
      setBusy(false);
    };
    document.addEventListener("visibilitychange", release);
    return () => document.removeEventListener("visibilitychange", release);
  }, []);

  // iOS opens the share sheet only straight from the tap: nothing may be awaited before share().
  async function send({ file }: GoodnotesFile) {
    if (running.current) return;
    const id = running.current = ++sequence.current;
    setBusy(true);
    setFailed(false);
    try {
      // Files only: with a title, iOS also saves the title as a text file next to it.
      await navigator.share({ files: [file] });
    } catch (error) {
      if (running.current === id && !(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Share failed", error);
        setFailed(true);
      }
    } finally {
      if (running.current === id) {
        running.current = 0;
        setBusy(false);
      }
    }
  }

  return { busy, failed, send };
}
