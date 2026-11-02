import type { NoteStatus } from "@/lib/types";

const labels: Record<NoteStatus, string> = {
  processing: "AI가 정리하는 중",
  completed: "정리 완료",
  failed: "변환 실패",
};

/** A small quiet tag; only unfinished notes show one in lists. */
export function StatusBadge({ status }: { status: NoteStatus }) {
  return <span className={`status-badge ${status}`}>{labels[status]}</span>;
}
