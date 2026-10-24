import type { ReactNode, Ref } from "react";
import { PhotoZoom } from "@/components/PhotoZoom";
import { ChevronDown, Download } from "lucide-react";
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
};

/** Shared reading view; safe for both server-rendered saved notes and the client lab. */
export function NoteDocument({ analysis, createdAt, photoUrl, includeTime, headingRef, status, children, titleContent, rawContent, summaryContent, downloadUrl }: NoteDocumentProps) {
  return (
    <article className="notebook-document" aria-labelledby="analysis-title">
      <time className="session-caption" dateTime={createdAt}>{formatNoteDate(createdAt, includeTime)}</time>
      <h1 id="analysis-title" ref={headingRef} tabIndex={-1}>{titleContent ?? analysis.title}</h1>
      {status}
      {photoUrl ? (
        <details className="original-photo" open>
          <summary>
            <img src={photoUrl} alt="" />
            <span>사진 보기</span>
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <PhotoZoom className="note-photo-zoom" src={photoUrl} alt="노트에 저장된 사진" downloadUrl={downloadUrl} />
          <p className="photo-zoom-hint">사진을 누르면 크게 볼 수 있어요.</p>
          {downloadUrl ? <div className="photo-download-row"><a className="text-button" href={downloadUrl} download><Download size={18} />사진 다운로드</a></div> : null}
        </details>
      ) : null}
      <details className="document-disclosure" open>
        <summary>전체 원문<ChevronDown size={20} aria-hidden="true" /></summary>
        {rawContent ?? <p>{analysis.rawText || "아직 읽은 내용이 없어요."}</p>}
      </details>
      <details className="document-disclosure">
        <summary>요약<ChevronDown size={20} aria-hidden="true" /></summary>
        {summaryContent ?? <p>{analysis.summary || "아직 정리된 내용이 없어요."}</p>}
      </details>
      {children}
    </article>
  );
}
