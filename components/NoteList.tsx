import Link from "@/components/AppLink";
import { NotebookText } from "lucide-react";
import type { ReactNode } from "react";

import { formatNoteDate } from "@/lib/note-date";
import { StatusBadge } from "@/components/StatusBadge";
import type { NotePreview } from "@/lib/types";

type NoteListProps = {
  notes: NotePreview[];
  /** Highlights matches in titles and excerpts (search results). */
  query?: string;
  empty?: ReactNode;
};

/** Feed rows: photo thumbnail, title, time, one-line excerpt, quiet status tag. */
export function NoteList({ notes, query, empty }: NoteListProps) {
  if (notes.length === 0) {
    return <>{empty ?? null}</>;
  }

  return (
    <ul className="note-feed">
      {notes.map((note) => {
        const excerpt = noteExcerpt(note);
        return (
          <li key={note.id}>
            <Link className="note-row" href={`/notes/${note.id}`}>
              <span className="note-row-thumb">
                {note.image_url ? <img alt="" src={note.image_url} loading="lazy" /> : <NotebookText size={28} aria-hidden="true" />}
              </span>
              <span className="note-row-body">
                <strong className="note-row-title">{highlightText(note.title, query)}</strong>
                <time className="note-row-time" dateTime={note.created_at}>{formatNoteDate(note.created_at, true)}</time>
                {excerpt ? <span className="note-row-excerpt">{highlightText(excerpt, query)}</span> : null}
                {note.status !== "completed" ? <StatusBadge status={note.status} /> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function noteExcerpt(note: NotePreview) {
  if (note.status === "processing") return "";
  if (note.status === "failed") return "사진을 다시 변환해 주세요.";
  return note.summary || note.raw_text || "내용이 없는 노트예요.";
}

function highlightText(text: string, query?: string): ReactNode {
  const normalizedQuery = query?.trim();
  if (!normalizedQuery) return text;

  const lowerText = text.toLocaleLowerCase("ko-KR");
  const lowerQuery = normalizedQuery.toLocaleLowerCase("ko-KR");
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);
  let key = 0;

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    const end = matchIndex + normalizedQuery.length;
    parts.push(<mark key={key++}>{text.slice(matchIndex, end)}</mark>);
    cursor = end;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}
