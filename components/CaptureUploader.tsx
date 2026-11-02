"use client";
import { PhotoZoom } from "@/components/PhotoZoom";
import { readNoteResponse } from "@/lib/note-api";

import { useEffect, useRef, useState } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useRouter } from "next/navigation";
import { Camera, Images, LoaderCircle, X } from "lucide-react";

import Link from "@/components/AppLink";
import { AppFrame } from "@/components/AppFrame";
import { useCaptureDraft } from "@/hooks/useCaptureDraft";
import { useUnloadWarning } from "@/hooks/useSessionDraft";

/** Photo review: large uncropped preview, retake/album, and one "AI로 변환" action. */
export function CaptureUploader({ userId }: { userId: string }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { draft, setDraft, clearDraft, choose, preparing, error } = useCaptureDraft(userId);
  const { file } = draft;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useUnloadWarning(Boolean(file));
  const previewUrl = useObjectUrl(file);
  useEffect(() => {
    if (!file) return;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest(".app-scroll")?.scrollTo({ top: 0 });
  }, [file]);
  const submitting = useRef(false);
  const [stage, setStage] = useState<"idle" | "uploading" | "analyzing" | "saving">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!file || !draft.noteId || submitting.current) return;
    submitting.current = true;
    setMessage(null);
    try {
      if (!draft.uploaded) {
        setStage("uploading");
        const formData = new FormData();
        formData.append("image", file);
        formData.append("noteId", draft.noteId);
        const upload = await fetch("/api/notes", { method: "POST", body: formData });
        const payload = await readNoteResponse(upload);
        if (!upload.ok) throw new Error(payload.error ?? "사진을 저장하지 못했어요.");
        setDraft(current => ({ ...current, uploaded: true }));
      }
      setStage(draft.recovery ? "saving" : "analyzing");
      const response = await fetch(`/api/notes/${draft.noteId}/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.recovery ? { recovery: draft.recovery } : {}),
      });
      const payload = await readNoteResponse(response);
      if (payload.recovery) { const recovery = payload.recovery; setDraft(current => ({ ...current, recovery })); }
      if (!response.ok) throw new Error(payload.error ?? "노트를 만들지 못했어요.");
      clearDraft();
      if (mounted.current) router.push(`/notes/${draft.noteId}`);
    } catch (cause) {
      if (mounted.current) setMessage(cause instanceof Error ? cause.message : "연결이 끊겼어요. 사진은 그대로 있으니 다시 시도해 주세요.");
    } finally {
      submitting.current = false;
      if (mounted.current) setStage("idle");
    }
  }

  async function handleFile(nextFile: File | undefined) {
    if (submitting.current) return;
    setMessage(null);
    await choose(nextFile);
  }

  function openPicker(input: HTMLInputElement | null) {
    if (!input) return;
    input.value = "";
    input.click();
  }

  const busy = stage !== "idle" || preparing;
  const notice = message ?? error;
  const actionLabel = preparing ? "사진 준비 중" : stage === "uploading" ? "사진 올리는 중" : stage === "analyzing" ? "AI가 정리하는 중" : stage === "saving" ? "노트 저장 중" : draft.recovery ? "노트 저장 다시 시도" : "AI로 변환";

  const footer = file ? <button className="button primary full-width" type="button" onClick={submit} disabled={busy}>
    {busy ? <LoaderCircle size={20} className="spinner" aria-hidden="true" /> : null}
    {actionLabel}
  </button> : undefined;

  return (
    <AppFrame active="home" className="capture-shell" footer={footer}>
      <header className="screen-header">
        <Link className="text-button icon-button" href="/" aria-label="홈으로"><X size={24} aria-hidden="true" /></Link>
        <h1 ref={headingRef} tabIndex={-1}>{file ? "사진 확인" : "새 노트 만들기"}</h1>
        <span aria-hidden="true" />
      </header>

      <input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" aria-label="화이트보드 촬영" disabled={busy}
        onChange={(event) => void handleFile(event.target.files?.[0])} />
      <input ref={uploadInputRef} hidden type="file" accept="image/*" aria-label="앨범에서 사진 고르기" disabled={busy}
        onChange={(event) => void handleFile(event.target.files?.[0])} />

      <section className={`capture-review ${file ? "has-photo" : "is-empty"}`} aria-busy={busy}>
        {file ? <>
          <div className="upload-preview">
            {previewUrl ? <PhotoZoom alt="고른 화이트보드 사진" src={previewUrl} downloadUrl={previewUrl} className="capture-photo-zoom" /> : null}
          </div>
          <p className="capture-hint">글씨가 흐리면 다시 찍어주세요. 사진을 누르면 확대돼요.</p>
        </> : <div className="capture-placeholder">
          <Camera size={40} aria-hidden="true" />
          <p>화이트보드 사진을 찍거나 앨범에서 골라주세요.<br />AI가 노트로 정리해 드려요.</p>
        </div>}

        <div className="capture-actions">
          <button className={file ? "button outline-quiet" : "button primary"} type="button" onClick={() => openPicker(cameraInputRef.current)} disabled={busy}>
            <Camera size={20} aria-hidden="true" />
            {file ? "다시 찍기" : "카메라로 찍기"}
          </button>
          <button className="button outline-quiet" type="button" onClick={() => openPicker(uploadInputRef.current)} disabled={busy}>
            <Images size={20} aria-hidden="true" />
            앨범에서 고르기
          </button>
        </div>

        {busy ? <p role="status" className="session-caption">{preparing ? "사진을 준비하고 있어요." : stage === "uploading" ? "사진을 올리고 있어요." : stage === "saving" ? "정리된 노트를 저장하고 있어요." : "AI가 사진 속 내용을 정리하고 있어요."}</p> : null}
        {draft.uploaded && draft.noteId ? <Link className="text-button" href={`/notes/${draft.noteId}`}>저장된 사진 확인</Link> : null}
        {notice ? <p className="inline-message" role="status">{notice}</p> : null}
      </section>
    </AppFrame>
  );
}
