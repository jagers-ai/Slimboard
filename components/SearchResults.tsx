import { NoteList } from "@/components/NoteList";
import type { NotePreview } from "@/lib/types";

type SearchResultsProps = {
  notes: NotePreview[];
  query: string;
};

export function SearchResults({ notes, query }: SearchResultsProps) {
  if (notes.length === 0) {
    return (
      <div className="search-empty">
        <strong>찾는 노트가 없어요</strong>
        <p>다른 단어로 검색해 보세요.</p>
      </div>
    );
  }

  return (
    <section className="search-results" aria-labelledby="search-results-title">
      <h2 id="search-results-title" className="list-caption">노트 {notes.length}개</h2>
      <NoteList notes={notes} query={query} />
    </section>
  );
}
