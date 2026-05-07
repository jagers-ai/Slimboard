import Link from "next/link";
import { BookOpen } from "lucide-react";

import { StatusBadge } from "@/components/StatusBadge";
import type { NotePreview } from "@/lib/types";

type NoteListProps = {
  emptyText: string;
  notes: NotePreview[];
};

export function NoteList({ emptyText, notes }: NoteListProps) {
  if (notes.length === 0) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="notes-list">
      {notes.map((note) => (
        <Link className="note-card" href={`/notes/${note.id}`} key={note.id}>
          <div className="note-thumb">
            {note.image_url ? <img alt="" src={note.image_url} /> : <BookOpen size={24} />}
          </div>
          <div className="note-body">
            <h3>{note.title}</h3>
            <p>{note.summary || note.raw_text || "분석이 진행 중입니다."}</p>
            <StatusBadge status={note.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
