"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, LoaderCircle, X } from "lucide-react";

export function CaptureUploader() {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    if (!file || stage !== "idle") {
      return;
    }

    setMessage(null);
    setStage("uploading");

    try {
      const formData = new FormData();
      formData.append("image", file);

      const uploadResponse = await fetch("/api/notes", {
        method: "POST",
        body: formData,
      });
      const uploadPayload = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload.error ?? "업로드에 실패했어요.");
      }

      const noteId = uploadPayload.note.id as string;
      setStage("analyzing");

      const analyzeResponse = await fetch(`/api/notes/${noteId}/analyze`, {
        method: "POST",
      });

      if (!analyzeResponse.ok) {
        setMessage("분석이 실패했지만 사진은 저장됐어요. 상세 화면에서 다시 시도할 수 있어요.");
      }

      router.push(`/notes/${noteId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "처리 중 문제가 생겼어요.");
      setStage("idle");
    }
  }

  function handleFile(nextFile: File | undefined) {
    if (!nextFile) {
      return;
    }

    setFile(nextFile);
    setMessage(null);
  }

  function clearFile() {
    setFile(null);
    setMessage(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  }

  const busy = stage !== "idle";

  return (
    <section className="panel capture-panel" id="capture">
      {file ? <div className="section-heading compact"><h2>사진 확인</h2><p className="muted">글씨가 잘 보이는지 확인해 주세요.</p></div> : null}

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
        {stage === "uploading" ? "저장 중" : stage === "analyzing" ? "분석 중" : "내용 정리"}
      </button> : null}

      {message ? <p className="inline-message">{message}</p> : null}
    </section>
  );
}
