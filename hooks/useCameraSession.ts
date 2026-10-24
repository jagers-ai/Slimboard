"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { analyzeCameraPhoto, cameraErrorMessage, checkCameraReady } from "@/lib/camera-api";
import { cameraSessionReducer, createCameraNote, initialCameraSession } from "@/lib/camera-session";
import { prepareCameraPhoto } from "@/lib/prepare-camera-photo";

export function useCameraSession() {
  const [state, dispatch] = useReducer(cameraSessionReducer, initialCameraSession);
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable">("checking");
  const statusRequest = useRef<AbortController | null>(null);
  const activeOperation = useRef<AbortController | null>(null);

  const refreshAvailability = useCallback(async () => {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    setAvailability("checking");
    try {
      const ready = await checkCameraReady(controller.signal);
      if (!controller.signal.aborted) setAvailability(ready ? "ready" : "unavailable");
    } catch {
      if (!controller.signal.aborted) setAvailability("unavailable");
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has("invite")) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    void refreshAvailability();
    return () => {
      statusRequest.current?.abort();
      // Stop client work on unmount. This is not a guarantee of cancelling API billing.
      activeOperation.current?.abort();
    };
  }, [refreshAvailability]);

  const hasContent = Boolean(state.draft || state.notes.length);
  useEffect(() => {
    if (!hasContent) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasContent]);

  async function preparePhoto(photo: File) {
    // Ref lock takes effect before React renders disabled controls.
    if (activeOperation.current) return;
    const controller = new AbortController();
    activeOperation.current = controller;
    dispatch({ type: "start", operation: "preparing" });
    try {
      const prepared = await prepareCameraPhoto(photo);
      if (!controller.signal.aborted) dispatch({ type: "prepared", photo: prepared });
    } catch (failure) {
      if (!controller.signal.aborted) dispatch({ type: "failed", message: cameraErrorMessage(failure) });
    } finally {
      if (activeOperation.current === controller) activeOperation.current = null;
    }
  }

  async function analyze() {
    const photo = state.draft;
    if (!photo || state.view.kind !== "photo" || availability !== "ready" || activeOperation.current) return;
    const controller = new AbortController();
    activeOperation.current = controller;
    dispatch({ type: "start", operation: "analyzing" });
    try {
      const analysis = await analyzeCameraPhoto(photo, controller.signal);
      if (!controller.signal.aborted) dispatch({ type: "analyzed", note: createCameraNote(analysis, photo) });
    } catch (failure) {
      if (!controller.signal.aborted) dispatch({ type: "failed", message: cameraErrorMessage(failure) });
    } finally {
      if (activeOperation.current === controller) activeOperation.current = null;
    }
  }

  const activeId = state.view.kind === "note" ? state.view.id : undefined;
  const activeNote = activeId ? state.notes.find((note) => note.id === activeId) : undefined;
  const pending = state.operation !== "idle";
  const status = state.operation === "analyzing" ? "내용을 읽고 있어요…"
    : state.operation === "preparing" ? "사진 준비 중…"
    : availability === "checking" ? "준비 중…"
    : state.view.kind === "note" ? "노트가 완성되었어요." : "";

  return { state, activeNote, pending, status, availability, refreshAvailability, preparePhoto, analyze,
    navigate: (view: typeof state.view) => { if (!activeOperation.current) dispatch({ type: "navigate", view }); },
  };
}
