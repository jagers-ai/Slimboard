import type { ReactNode, Ref } from "react";
import { PhotoZoom } from "@/components/PhotoZoom";
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
  titleContent?: ReactNode;
  rawContent?: ReactNode;
  summaryContent?: ReactNode;
  downloadUrl?: string;
  /** Round buttons laid over the top of the photo (back, download). */
  heroActions?: ReactNode;
};

/** Shared reading view; safe for both server-rendered saved notes and the client lab. */
export function NoteDocument({ analysis, createdAt, photoUrl, includeTime = true, headingRef, status, children, titleContent, rawContent, summaryContent, downloadUrl, heroActions }: NoteDocumentProps) {
  return (
    <article className="notebook-document" aria-labelledby="analysis-title">
      {photoUrl ? (
        <div className="note-hero">
          <PhotoZoom className="note-hero-photo" src={photoUrl} alt="노트에 저장된 사진" downloadUrl={downloadUrl} />
          {heroActions ? <div className="note-hero-actions">{heroActions}</div> : null}
        </div>
      ) : heroActions ? <div className="note-hero-actions is-plain">{heroActions}</div> : null}
      <p className="note-meta"><time dateTime={createdAt}>{formatNoteDate(createdAt, includeTime)}</time> · AI 정리</p>
      <h1 id="analysis-title" ref={headingRef} tabIndex={-1}>{titleContent ?? analysis.title}</h1>
      {status ? <div className="note-status">{status}</div> : null}
      <section className="document-section" aria-labelledby="board-content-title">
        <h2 id="board-content-title" className="document-label">보드 내용</h2>
        {rawContent ?? <p>{analysis.rawText || "아직 읽은 내용이 없어요."}</p>}
      </section>
      <details className="document-disclosure">
        <summary>AI 요약<ChevronDown size={20} aria-hidden="true" /></summary>
        {summaryContent ?? <p>{analysis.summary || "아직 정리된 내용이 없어요."}</p>}
      </details>
      {children}
    </article>
  );
}
