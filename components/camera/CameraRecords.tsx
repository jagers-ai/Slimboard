import { useMemo, type Ref } from "react";
import { Search } from "lucide-react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { filterCameraNotes, type CameraNote } from "@/lib/camera-session";
import { formatNoteDate } from "@/lib/note-date";

type CameraRecordsProps = {
  query: string;
  onQueryChange: (query: string) => void;
  notes: CameraNote[];
  hasDraft: boolean;
  disabled: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  searchRef: Ref<HTMLInputElement>;
  onOpen: (id: string) => void;
  onResume: () => void;
};

export function CameraRecords({ query, onQueryChange, notes, hasDraft, disabled, headingRef, searchRef, onOpen, onResume }: CameraRecordsProps) {
  const filtered = useMemo(() => filterCameraNotes(notes, query), [notes, query]);
  const searching = Boolean(query.trim());
  return (
    <section className="notebook-content" aria-labelledby="records-title">
      <h1 id="records-title" className="page-title" tabIndex={-1} ref={headingRef}>기록</h1>
      <label className="notebook-search">
        <Search size={20} aria-hidden="true" />
        <input ref={searchRef} type="search" value={query} onChange={(event) => onQueryChange(event.target.value)}
          placeholder="기록 검색" aria-label="기록 검색어" />
      </label>
      <p className="session-caption">새로고침하거나 화면을 닫으면 기록이 사라져요.</p>
      {filtered.length ? (
        <div className="notes-list">
          {filtered.map((note) => (
            <button className="note-card session-note" key={note.id} onClick={() => onOpen(note.id)} disabled={disabled}>
              <SessionThumbnail photo={note.photo} />
              <span className="note-body">
                <strong>{note.analysis.title}</strong>
                <span className="note-excerpt">{note.analysis.summary}</span>
                <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt, true)}</time>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="notebook-empty">
          <h2>{searching ? "일치하는 기록이 없어요" : "지우기 전에, 한 장."}</h2>
          <p>{searching ? "다른 검색어로 찾아보세요." : "화이트보드의 생각을\n읽기 편한 노트로 남겨보세요."}</p>
        </div>
      )}
      {hasDraft ? <button className="text-button resume-photo" disabled={disabled} onClick={onResume}>선택한 사진 이어서 정리</button> : null}
    </section>
  );
}

function SessionThumbnail({ photo }: { photo: File }) {
  const url = useObjectUrl(photo);
  return <span className="note-thumb">{url ? <img src={url} alt="" loading="lazy" /> : null}</span>;
}
