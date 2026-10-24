"use client";
import { readNoteResponse } from "@/lib/note-api";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";

import Link from "@/components/AppLink";
import { DocumentField } from "@/components/DocumentField";
import { NoteDocument } from "@/components/NoteDocument";
import { StatusBadge } from "@/components/StatusBadge";
import type { WhiteboardNote } from "@/lib/types";

type NoteEditorNote = Pick<
  WhiteboardNote,
  "id" | "title" | "raw_text" | "summary" | "keywords" | "error_message" | "created_at" | "status"
>;

import { useSessionDraft, useUnloadWarning } from "@/hooks/useSessionDraft";
export function NoteEditor({ note, userId, photoUrl }: { note: NoteEditorNote; userId: string; photoUrl?: string | null }) {
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

      if (!payload.note) throw new Error("저장된 노트를 확인하지 못했어요.");
      const savedNote = { title: payload.note.title, rawText: payload.note.raw_text, summary: payload.note.summary };
      setDraft({ ...savedNote, recovery: null });
      clearDraft();
      setSaved(savedNote);
      setMessage("저장했어요.");
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
    if (!recovery && !window.confirm("사진을 다시 변환할까요? 지금까지 수정한 내용이 새 내용으로 바뀝니다.")) return;
    pending.current = true;
    setIsAnalyzing(true);
    setMessage(recovery ? "정리된 노트를 저장하고 있어요." : "사진을 다시 변환하고 있어요.");

    try {
      const response = await fetch(`/api/notes/${note.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recovery ? { recovery } : { force: true }),
      });
      const payload = await readNoteResponse(response);

      if (payload.recovery) { const recovery = payload.recovery; setDraft(current => ({ ...current, recovery })); }
      if (!response.ok) {
        throw new Error(payload.error ?? "사진을 변환하지 못했어요.");
      }

      if (!payload.note) throw new Error("저장된 노트를 확인하지 못했어요.");
      setDraft({ title: payload.note.title, rawText: payload.note.raw_text, summary: payload.note.summary, recovery: null });
      clearDraft();
      setSaved({ title: payload.note.title, rawText: payload.note.raw_text, summary: payload.note.summary });
      setMessage("노트를 저장했어요.");
      if (mounted.current) router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진을 변환하지 못했어요.");
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

  return <div className="document-editor" aria-busy={busy}>
    <header className="notebook-topbar">
      <Link className="text-button icon-button" href="/notes" aria-label="기록 목록으로"><ArrowLeft size={22} /></Link>
      <span>노트</span>
      <button className="text-button document-save" type="button" onClick={save} disabled={busy || Boolean(recovery)}>
        {isSaving ? <LoaderCircle size={18} className="spinner" /> : null}{isSaving ? "저장 중" : "저장"}
      </button>
    </header>
    <NoteDocument createdAt={note.created_at} photoUrl={photoUrl}
      downloadUrl={photoUrl ? `${photoUrl}?download=1` : undefined}
      analysis={{ title, rawText, summary, keywords: note.keywords }}
      titleContent={<DocumentField label="제목" title value={title} onChange={setTitle} disabled={busy || Boolean(recovery)} />}
      rawContent={<DocumentField label="전체 원문" value={rawText} onChange={setRawText} disabled={busy || Boolean(recovery)} />}
      summaryContent={<DocumentField label="요약" value={summary} onChange={setSummary} disabled={busy || Boolean(recovery)} />}
      status={note.status !== "completed" ? <StatusBadge status={note.status} /> : null}>
      <div className="document-tools">
        <button className="text-button" type="button" onClick={analyze} disabled={busy}>
          {isAnalyzing ? <LoaderCircle size={18} className="spinner" /> : <RefreshCw size={18} />}
          {recovery ? "노트 저장 다시 시도" : isAnalyzing ? "변환 중" : "다시 변환"}
        </button>
        <button className="text-button" type="button" onClick={remove} disabled={busy}><Trash2 size={18} />{isDeleting ? "삭제 중" : "삭제"}</button>
      </div>
      {message ? <p className="document-message" role="status">{message}</p> : dirty ? <p className="document-message" role="status">수정한 내용을 저장해 주세요.</p> : null}
    </NoteDocument>
  </div>;
}
