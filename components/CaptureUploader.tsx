"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, LoaderCircle, Sparkles, X } from "lucide-react";

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
      router.refresh();
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
    <section className="panel">
      <span className="eyebrow">Capture</span>
      <h2>화이트보드 저장</h2>
      <p className="muted">
        모바일에서는 바로 촬영하고, 데스크톱에서는 사진 파일을 올릴 수 있어요.
      </p>

      <input
        ref={cameraInputRef}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <input
        ref={uploadInputRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      <div className="upload-preview">
        {previewUrl ? <img alt="선택한 화이트보드" src={previewUrl} /> : "사진을 선택해주세요"}
      </div>

      <div className="actions">
        <button
          className="button"
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={busy}
        >
          <Camera size={18} />
          촬영
        </button>
        <button
          className="button"
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          disabled={busy}
        >
          <ImageUp size={18} />
          업로드
        </button>
        {file ? (
          <button className="button icon-only" type="button" onClick={clearFile} disabled={busy}>
            <X size={18} />
          </button>
        ) : null}
      </div>

      <button className="button primary" type="button" onClick={submit} disabled={!file || busy}>
        {busy ? <LoaderCircle size={18} /> : <Sparkles size={18} />}
        {stage === "uploading" ? "저장 중" : stage === "analyzing" ? "분석 중" : "노트 만들기"}
      </button>

      {message ? <p className="muted">{message}</p> : null}

      <p className="privacy-note">
        원본 사진은 private cloud storage에 저장되고, 분석용 리사이즈 이미지는 Gemini
        API로 전송됩니다.
      </p>
    </section>
  );
}
