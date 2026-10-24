"use client";
import { readNoteResponse } from "@/lib/note-api";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Save, Trash2 } from "lucide-react";

import type { WhiteboardNote } from "@/lib/types";

type NoteEditorNote = Pick<
  WhiteboardNote,
  "id" | "title" | "raw_text" | "summary" | "keywords" | "error_message"
>;

import { useSessionDraft, useUnloadWarning } from "@/hooks/useSessionDraft";
export function NoteEditor({ note, userId }: { note: NoteEditorNote; userId: string }) {
  const router = useRouter();
  const [draft, setDraft, clearDraft] = useSessionDraft(`${userId}:note:${note.id}`, { title: note.title, rawText: note.raw_text, summary: note.summary, recovery: null as string | null });
  const { title, rawText, summary, recovery } = draft;
  const setTitle = (title: string) => setDraft(current => ({ ...current, title }));
  const setRawText = (rawText: string) => setDraft(current => ({ ...current, rawText }));
  const setSummary = (summary: string) => setDraft(current => ({ ...current, summary }));
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [saved, setSaved] = useState({ title: note.title, rawText: note.raw_text, summary: note.summary });
  const dirty = title !== saved.title || rawText !== saved.rawText || summary !== saved.summary;
  useUnloadWarning(dirty || Boolean(recovery));
  const [message, setMessage] = useState<string | null>(note.error_message);
  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function save() {
    if (pending.current) return;
    pending.current = true;
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, rawText, summary }),
      });
      const payload = await readNoteResponse(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "저장에 실패했어요.");
      }

      clearDraft();
      setSaved({ title, rawText, summary });
      setMessage("클라우드에 저장됐어요.");
      if (mounted.current) router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 중 문제가 생겼어요.");
    } finally {
      pending.current = false;
      setIsSaving(false);
    }
  }

  async function analyze() {
    if (pending.current) return;
    if (!recovery && !window.confirm("사진을 다시 분석할까요? 현재 수정 내용이 새 분석 결과로 바뀝니다.")) return;
    pending.current = true;
    setIsAnalyzing(true);
    setMessage(recovery ? "정리된 노트를 저장하고 있어요." : "다시 분석하고 있어요.");

    try {
      const response = await fetch(`/api/notes/${note.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recovery ? { recovery } : { force: true }),
      });
      const payload = await readNoteResponse(response);

      if (payload.recovery) { const recovery = payload.recovery; setDraft(current => ({ ...current, recovery })); }
      if (!response.ok) {
        throw new Error(payload.error ?? "분석에 실패했어요.");
      }

      if (!payload.note) throw new Error("저장된 노트를 확인하지 못했어요.");
      setDraft({ title: payload.note.title, rawText: payload.note.raw_text, summary: payload.note.summary, recovery: null });
      clearDraft();
      setSaved({ title: payload.note.title, rawText: payload.note.raw_text, summary: payload.note.summary });
      setMessage("노트가 클라우드에 저장됐어요.");
      if (mounted.current) router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "분석 중 문제가 생겼어요.");
    } finally {
      pending.current = false;
      setIsAnalyzing(false);
    }
  }

  async function remove() {
    if (pending.current || !window.confirm("이 노트와 저장된 사진을 삭제할까요?")) {
      return;
    }

    pending.current = true;
    setIsDeleting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await readNoteResponse(response);
        throw new Error(payload.error ?? "삭제에 실패했어요.");
      }

      clearDraft();
      if (mounted.current) router.push("/notes");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제 중 문제가 생겼어요.");
      pending.current = false;
      setIsDeleting(false);
    }
  }

  const busy = isSaving || isAnalyzing || isDeleting;

  return (
    <section className="detail-panel editor-panel" aria-busy={busy}>
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
            className="input" disabled={busy || Boolean(recovery)}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rawText">원문</label>
          <textarea
            id="rawText"
            className="textarea" disabled={busy || Boolean(recovery)}
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="summary">요약</label>
          <textarea
            id="summary"
            className="textarea" disabled={busy || Boolean(recovery)}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

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
          <button className="button primary" type="button" onClick={save} disabled={busy || Boolean(recovery)}>
            {isSaving ? <LoaderCircle size={18} /> : <Save size={18} />}
            저장
          </button>
          <button className="button" type="button" onClick={analyze} disabled={busy}>
            {isAnalyzing ? <LoaderCircle size={18} /> : <RefreshCw size={18} />}
            {recovery ? "노트 저장 다시 시도" : "재분석"}
          </button>
          <button className="button danger" type="button" onClick={remove} disabled={busy}>
            <Trash2 size={18} />
            삭제
          </button>
        </div>

        {message ? <p className="inline-message" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
