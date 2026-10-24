"use client";

import { useEffect, useRef, useState } from "react";
import { CameraActions } from "@/components/camera/CameraActions";
import { CameraHeader } from "@/components/camera/CameraHeader";
import { CameraPhotoReview } from "@/components/camera/CameraPhotoReview";
import { CameraRecords } from "@/components/camera/CameraRecords";
import { NoteDocument } from "@/components/NoteDocument";
import { useCameraSession } from "@/hooks/useCameraSession";
import { useObjectUrl } from "@/hooks/useObjectUrl";

export function CodexLab() {
  const session = useCameraSession();
  const [query, setQuery] = useState("");
  const { state, activeNote, pending, status, availability, navigate } = session;
  const screen = state.view.kind;
  const preview = useObjectUrl(screen === "note" ? activeNote?.photo ?? null : screen === "photo" ? state.draft : null);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [screen, activeNote?.id]);

  function choosePhoto(element: HTMLInputElement | null) {
    if (!element || pending) return;
    element.value = "";
    element.click();
  }

  return (
    <main className="app-shell camera-shell notebook-shell" aria-busy={pending}>
      <CameraHeader screen={screen} pending={pending}
        onSearch={() => search.current?.focus()}
        onBack={() => navigate({ kind: "list" })}
        onChoose={() => choosePhoto(album.current)} />
      <input ref={camera} hidden type="file" accept="image/*" capture="environment" aria-label="화이트보드 촬영" disabled={pending}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void session.preparePhoto(file); }} />
      <input ref={album} hidden type="file" accept="image/*" aria-label="사진 첨부" disabled={pending}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void session.preparePhoto(file); }} />
      {screen === "list" ? (
        <CameraRecords query={query} onQueryChange={setQuery} notes={state.notes} hasDraft={Boolean(state.draft)} disabled={pending}
          headingRef={heading} searchRef={search}
          onOpen={(id) => navigate({ kind: "note", id })}
          onResume={() => navigate({ kind: "photo" })} />
      ) : screen === "photo" ? (
        <CameraPhotoReview preview={preview} headingRef={heading} />
      ) : activeNote ? (
        <NoteDocument key={activeNote.id} analysis={activeNote.analysis} createdAt={activeNote.createdAt}
          photoUrl={preview} includeTime headingRef={heading} />
      ) : null}
      <CameraActions screen={screen} operation={state.operation} availability={availability} status={status} error={state.error}
        onReconnect={session.refreshAvailability} onAnalyze={session.analyze}
        onCamera={() => choosePhoto(camera.current)} onAlbum={() => choosePhoto(album.current)} />
      <p className="sr-only" role="status" aria-atomic="true">{status}</p>
    </main>
  );
}
