"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Save, Trash2 } from "lucide-react";

import type { NoteWithImageUrl } from "@/lib/types";

export function NoteEditor({ note }: { note: NoteWithImageUrl }) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [rawText, setRawText] = useState(note.raw_text);
  const [summary, setSummary] = useState(note.summary);
  const [message, setMessage] = useState<string | null>(note.error_message);
  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function save() {
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, rawText, summary }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "저장에 실패했어요.");
      }

      setMessage("저장됐어요.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 중 문제가 생겼어요.");
    } finally {
      setIsSaving(false);
    }
  }

  async function analyze() {
    setIsAnalyzing(true);
    setMessage("다시 분석하고 있습니다.");

    try {
      const response = await fetch(`/api/notes/${note.id}/analyze`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "분석에 실패했어요.");
      }

      setTitle(payload.note.title);
      setRawText(payload.note.raw_text);
      setSummary(payload.note.summary);
      setMessage("재분석이 완료됐어요.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "분석 중 문제가 생겼어요.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function remove() {
    if (!window.confirm("이 노트와 원본 사진을 삭제할까요?")) {
      return;
    }

    setIsDeleting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "삭제에 실패했어요.");
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제 중 문제가 생겼어요.");
      setIsDeleting(false);
    }
  }

  const busy = isSaving || isAnalyzing || isDeleting;

  return (
    <section className="detail-panel editor-panel">
      <div className="section-heading compact">
        <span className="eyebrow">정리된 노트</span>
        <h2>원문과 요약</h2>
        <p className="muted">필요한 내용을 수정한 뒤 저장할 수 있습니다.</p>
      </div>
      <div className="form-stack">
        <div className="field">
          <label htmlFor="title">제목</label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rawText">원문</label>
          <textarea
            id="rawText"
            className="textarea"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="summary">요약</label>
          <textarea
            id="summary"
            className="textarea"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        {note.visual_context ? (
          <div className="field">
            <label>시각적 맥락</label>
            <p className="privacy-note">{note.visual_context}</p>
          </div>
        ) : null}

        {note.keywords.length > 0 ? (
          <div className="meta-list">
            {note.keywords.map((keyword) => (
              <span className="chip" key={keyword}>
                {keyword}
              </span>
            ))}
          </div>
        ) : null}

        <div className="split-actions stacked">
          <button className="button primary" type="button" onClick={save} disabled={busy}>
            {isSaving ? <LoaderCircle size={18} /> : <Save size={18} />}
            저장
          </button>
          <button className="button" type="button" onClick={analyze} disabled={busy}>
            {isAnalyzing ? <LoaderCircle size={18} /> : <RefreshCw size={18} />}
            재분석
          </button>
          <button className="button danger" type="button" onClick={remove} disabled={busy}>
            <Trash2 size={18} />
            삭제
          </button>
        </div>

        {message ? <p className="inline-message">{message}</p> : null}
      </div>
    </section>
  );
}
