"use client";

import Link from "@/components/AppLink";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Images, LoaderCircle, Plus } from "lucide-react";

import { useCaptureDraft } from "@/hooks/useCaptureDraft";

/**
 * Floating "새 노트" button on Home. Opens a bottom sheet with the two
 * sources; a prepared photo continues on the review screen (/capture).
 * The file inputs live outside the sheet so the OS picker can close it.
 */
export function NewNoteButton({ userId }: { userId: string }) {
  const router = useRouter();
  const sheet = useRef<HTMLDialogElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const { choose, preparing, error } = useCaptureDraft(userId);

  useEffect(() => {
    const dialog = sheet.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function pick(input: HTMLInputElement | null) {
    // Close first, then open the picker in the same tap so the browser allows it.
    sheet.current?.close();
    setOpen(false);
    if (!input) return;
    input.value = "";
    input.click();
  }

  async function handle(file: File | undefined) {
    if (await choose(file)) router.push("/capture");
  }

  return <>
    <input ref={camera} hidden type="file" accept="image/*" capture="environment" aria-label="화이트보드 촬영" disabled={preparing}
      onChange={event => void handle(event.target.files?.[0])} />
    <input ref={album} hidden type="file" accept="image/*" aria-label="앨범에서 사진 고르기" disabled={preparing}
      onChange={event => void handle(event.target.files?.[0])} />

    {error ? <p className="fab-message" role="alert">{error}</p> : preparing ? <p className="sr-only" role="status">사진을 준비하고 있어요.</p> : null}
    <button ref={fab} className="fab" type="button" aria-haspopup="dialog" disabled={preparing} onClick={() => setOpen(true)}>
      {preparing ? <LoaderCircle size={22} className="spinner" aria-hidden="true" /> : <Plus size={22} strokeWidth={2.6} aria-hidden="true" />}
      {preparing ? "사진 준비 중" : "새 노트"}
    </button>

    <dialog ref={sheet} className="action-sheet" aria-labelledby="new-note-title"
      onClose={() => { setOpen(false); fab.current?.focus({ preventScroll: true }); }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="action-sheet-panel">
        <span className="action-sheet-handle" aria-hidden="true" />
        <h2 id="new-note-title">새 노트 만들기</h2>
        <p>사진을 고르면 AI가 노트로 정리해 드려요.</p>
        <button className="action-sheet-item" type="button" onClick={() => pick(camera.current)}>
          <span className="action-sheet-icon primary" aria-hidden="true"><Camera size={22} /></span>
          카메라로 찍기
        </button>
        <button className="action-sheet-item" type="button" onClick={() => pick(album.current)}>
          <span className="action-sheet-icon" aria-hidden="true"><Images size={22} /></span>
          앨범에서 고르기
        </button>
        <button className="button full-width action-sheet-cancel" type="button" onClick={() => setOpen(false)}>취소</button>
      </div>
    </dialog>
  </>;
}

/** Home notice when a picked photo is still waiting on the review screen. */
export function PendingPhotoNotice({ userId }: { userId: string }) {
  const { draft, discard } = useCaptureDraft(userId);
  if (!draft.file) return null;
  return <div className="pending-photo" role="status">
    <span>{draft.recovery ? "아직 저장하지 못한 노트가 있어요." : "고르던 사진이 있어요."}</span>
    <span className="pending-photo-actions">
      <button className="text-button" type="button" onClick={() => discard()}>지우기</button>
      <Link className="text-button pending-photo-resume" href="/capture">이어서 하기</Link>
    </span>
  </div>;
}
