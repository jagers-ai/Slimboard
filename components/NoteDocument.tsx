import type { ReactNode, Ref } from "react";
import { ChevronDown } from "lucide-react";
import { formatNoteDate } from "@/lib/note-date";
import type { WhiteboardAnalysis } from "@/lib/types";

type NoteDocumentProps = {
  analysis: WhiteboardAnalysis;
  createdAt: string;
  photoUrl?: string | null;
  includeTime?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  status?: ReactNode;
  children?: ReactNode;
};

/** Shared reading view; safe for both server-rendered saved notes and the client lab. */
export function NoteDocument({ analysis, createdAt, photoUrl, includeTime, headingRef, status, children }: NoteDocumentProps) {
  return (
    <article className="notebook-document" aria-labelledby="analysis-title">
      <time className="session-caption" dateTime={createdAt}>{formatNoteDate(createdAt, includeTime)}</time>
      <h1 id="analysis-title" ref={headingRef} tabIndex={-1}>{analysis.title}</h1>
      {status}
      {photoUrl ? (
        <details className="original-photo">
          <summary>
            <img src={photoUrl} alt="" />
            <span>원본 사진 보기</span>
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <img className="expanded-photo" src={photoUrl} alt="노트의 원본 사진" loading="lazy" />
        </details>
      ) : null}
      <section className="document-section">
        <h2>요약</h2>
        <p>{analysis.summary || "아직 정리된 내용이 없어요."}</p>
      </section>
      <details className="document-disclosure">
        <summary>전체 원문<ChevronDown size={20} aria-hidden="true" /></summary>
        <p>{analysis.rawText || "아직 읽은 내용이 없어요."}</p>
      </details>
      {analysis.keywords.length ? (
        <details className="document-disclosure">
          <summary>키워드<ChevronDown size={20} aria-hidden="true" /></summary>
          <p className="document-keywords">{analysis.keywords.join(" · ")}</p>
        </details>
      ) : null}
      {children}
    </article>
  );
}
