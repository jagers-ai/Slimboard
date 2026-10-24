"use client";
import { readNoteResponse } from "@/lib/note-api";

import { useEffect, useRef, useState } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, LoaderCircle, X } from "lucide-react";

import { prepareCameraPhoto } from "@/lib/prepare-camera-photo";
import { useSessionDraft, useUnloadWarning } from "@/hooks/useSessionDraft";

type PhotoDraft = { file: File | null; noteId: string | null; uploaded: boolean; recovery: string | null };
export function CaptureUploader({ userId }: { userId: string }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft, clearDraft] = useSessionDraft<PhotoDraft>(`${userId}:capture`, { file: null, noteId: null, uploaded: false, recovery: null });
  const { file } = draft;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useUnloadWarning(Boolean(file));
  const previewUrl = useObjectUrl(file);
  useEffect(() => { if (file) headingRef.current?.focus(); }, [file]);
  const submitting = useRef(false);
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading" | "analyzing" | "saving">("idle");
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
      if (!response.ok) throw new Error(payload.error ?? "처리하지 못했어요.");
      clearDraft();
      if (mounted.current) router.push(`/notes/${draft.noteId}`);
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "연결이 끊겼어요. 사진을 유지하고 있으니 다시 시도해주세요.");
    } finally {
      submitting.current = false;
      if (mounted.current) setStage("idle");
    }
  }

  async function handleFile(nextFile: File | undefined) {
    if (!nextFile || submitting.current) return;
    if (draft.recovery && !window.confirm("아직 저장되지 않은 분석 결과가 있어요. 새 사진을 선택할까요?")) return;
    submitting.current = true;
    setStage("preparing");
    setMessage(null);
    try {
      const prepared = await prepareCameraPhoto(nextFile);
      setDraft({ file: prepared, noteId: crypto.randomUUID(), uploaded: false, recovery: null });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진을 준비하지 못했어요.");
    } finally { submitting.current = false; setStage("idle"); }
  }

  function clearFile() {
    if (draft.recovery && !window.confirm("저장하지 못한 분석 결과가 사라져요. 선택을 지울까요?")) return;
    setDraft({ file: null, noteId: null, uploaded: false, recovery: null });
    clearDraft();
    setMessage(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  }

  const busy = stage !== "idle";

  return (
    <section className="panel capture-panel" id="capture" aria-busy={busy}>
      {file ? <div className="section-heading compact"><h2 ref={headingRef} tabIndex={-1}>사진 확인</h2><p className="muted">글씨가 잘 보이는지 확인해 주세요.</p></div> : null}

      <input
        ref={cameraInputRef}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="화이트보드 촬영"
        disabled={busy}
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <input
        ref={uploadInputRef}
        hidden
        type="file"
        accept="image/*"
        aria-label="앨범에서 사진 선택"
        disabled={busy}
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      {file ? <div className="upload-preview">
        {previewUrl ? (
          <img alt="선택한 화이트보드" src={previewUrl} />
        ) : (
          <div className="upload-empty">
            <ImageUp size={28} />
            <strong>사진을 선택해주세요</strong>
            <span>화이트보드가 선명하게 보이는 사진이 좋아요.</span>
          </div>
        )}
      </div> : null}

      <div className="split-actions">
        <button
          className={file ? "button" : "button primary"}
          type="button"
          onClick={() => {
            if (!cameraInputRef.current) return;
            cameraInputRef.current.value = "";
            cameraInputRef.current.click();
          }}
          disabled={busy}
        >
          <Camera size={18} />
          {file ? "다시 촬영" : "사진 촬영"}
        </button>
        <button
          className="button"
          type="button"
          onClick={() => {
            if (!uploadInputRef.current) return;
            uploadInputRef.current.value = "";
            uploadInputRef.current.click();
          }}
          disabled={busy}
        >
          <ImageUp size={18} />
          앨범에서 선택
        </button>
        {file ? (
          <button className="button icon-only" type="button" aria-label="선택한 사진 지우기" onClick={clearFile} disabled={busy}>
            <X size={18} />
          </button>
        ) : null}
      </div>

      {file ? <button className="button primary full-width" type="button" onClick={submit} disabled={!file || busy}>
        {busy ? <LoaderCircle size={18} className="spinner" /> : null}
        {stage === "preparing" ? "사진 준비 중" : stage === "uploading" ? "사진 저장 중" : stage === "analyzing" ? "내용 정리 중" : stage === "saving" ? "노트 저장 중" : draft.recovery ? "노트 저장 다시 시도" : "내용 정리"}
      </button> : null}

      {busy ? <p role="status" className="session-caption">{stage === "preparing" ? "사진을 준비하고 있어요." : stage === "uploading" ? "사진을 클라우드에 저장하고 있어요." : stage === "saving" ? "정리된 노트를 저장하고 있어요." : "사진 속 내용을 정리하고 있어요."}</p> : null}
      <p className="session-caption">사진은 분석에 필요한 크기로 저장됩니다. 원본 파일은 별도로 보관하지 않아요.</p>
      {draft.uploaded && draft.noteId ? <a className="text-button" href={`/notes/${draft.noteId}`}>저장된 사진 확인</a> : null}
      {message ? <p className="inline-message" role="status">{message}</p> : null}
    </section>
  );
}
