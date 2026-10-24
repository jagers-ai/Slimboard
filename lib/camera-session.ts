import type { WhiteboardAnalysis } from "./types.ts";

export type CameraNote = {
  id: string;
  analysis: WhiteboardAnalysis;
  photo: File;
  createdAt: string;
  searchText: string;
};
export type CameraView = { kind: "list" } | { kind: "photo" } | { kind: "note"; id: string };
export type CameraOperation = "idle" | "preparing" | "analyzing";
export type CameraSession = {
  notes: CameraNote[];
  draft: File | null;
  view: CameraView;
  operation: CameraOperation;
  error: string;
};
export const initialCameraSession: CameraSession = {
  notes: [], draft: null, view: { kind: "list" }, operation: "idle", error: "",
};
export type CameraAction =
  | { type: "start"; operation: Exclude<CameraOperation, "idle"> }
  | { type: "prepared"; photo: File }
  | { type: "analyzed"; note: CameraNote }
  | { type: "failed"; message: string }
  | { type: "navigate"; view: CameraView };

export function cameraSessionReducer(state: CameraSession, action: CameraAction): CameraSession {
  switch (action.type) {
    case "start":
      if (state.operation !== "idle") return state;
      return { ...state, operation: action.operation, error: "" };
    case "prepared":
      return { ...state, draft: action.photo, view: { kind: "photo" }, operation: "idle", error: "" };
    case "analyzed":
      return {
        ...state, notes: [action.note, ...state.notes], draft: null,
        view: { kind: "note", id: action.note.id }, operation: "idle", error: "",
      };
    case "failed":
      return { ...state, operation: "idle", error: action.message };
    case "navigate": {
      if (state.operation !== "idle") return state;
      if (action.view.kind === "photo" && !state.draft) return state;
      if (action.view.kind === "note") {
        const targetId = action.view.id;
        if (!state.notes.some((note) => note.id === targetId)) return state;
      }
      // A viewed record is independent of the unfinished photo draft.
      return { ...state, view: action.view, error: "" };
    }
  }
}

export function createCameraNote(analysis: WhiteboardAnalysis, photo: File): CameraNote {
  return {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), analysis, photo,
    searchText: [analysis.title, analysis.summary, analysis.rawText, ...analysis.keywords].join(" ").toLocaleLowerCase("ko-KR"),
  };
}

export function filterCameraNotes(notes: CameraNote[], query: string): CameraNote[] {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  return normalized ? notes.filter((note) => note.searchText.includes(normalized)) : notes;
}
