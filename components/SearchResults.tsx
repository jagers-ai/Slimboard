import Link from "next/link";
import { Mic } from "lucide-react";
import type { ReactNode } from "react";

import type { NoteWithImageUrl } from "@/lib/types";

type SearchResultsProps = {
  notes: NoteWithImageUrl[];
  query: string;
};

export function SearchResults({ notes, query }: SearchResultsProps) {
  if (notes.length === 0) {
    return (
      <div className="search-empty">
        <strong>검색 결과가 없어요.</strong>
        <p>다른 단어로 다시 검색해보세요.</p>
      </div>
    );
  }

  return (
    <section className="search-results">
      <h2>
        <span>전체</span> 검색 결과
      </h2>
      <div className="search-result-list">
        {notes.map((note) => (
          <Link className="search-result-card" href={`/notes/${note.id}`} key={note.id}>
            <div className="search-result-title">
              <span>
                <Mic size={16} />
              </span>
              <strong>{highlightText(note.title, query)}</strong>
            </div>
            <p>{highlightText(getResultSnippet(note), query)}</p>
            <div className="search-result-meta">{formatDate(note.created_at)} · 전체 노트</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function getResultSnippet(note: NoteWithImageUrl) {
  return note.summary || note.raw_text || note.visual_context || "분석이 진행 중입니다.";
}

function highlightText(text: string, query: string) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return text;
  }

  const lowerText = text.toLocaleLowerCase("ko-KR");
  const lowerQuery = normalizedQuery.toLocaleLowerCase("ko-KR");
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);
  let key = 0;

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }

    const end = matchIndex + normalizedQuery.length;
    parts.push(<mark key={key++}>{text.slice(matchIndex, end)}</mark>);
    cursor = end;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
