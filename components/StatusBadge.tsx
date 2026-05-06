import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";

import type { NoteStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: NoteStatus }) {
  const label =
    status === "completed" ? "완료" : status === "failed" ? "실패" : "처리 중";
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "failed"
        ? AlertCircle
        : LoaderCircle;

  return (
    <span className={`status-badge ${status}`}>
      <Icon size={15} />
      {label}
    </span>
  );
}
