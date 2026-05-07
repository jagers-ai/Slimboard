"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import type { RecentSearch } from "@/lib/recent-searches";

type RecentSearchesProps = {
  recentSearches: RecentSearch[];
};

export function RecentSearches({ recentSearches }: RecentSearchesProps) {
  const router = useRouter();

  async function remove(query: string) {
    await fetch(`/api/recent-searches?query=${encodeURIComponent(query)}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  async function clearAll() {
    await fetch("/api/recent-searches?all=true", {
      method: "DELETE",
    });
    router.refresh();
  }

  if (recentSearches.length === 0) {
    return (
      <div className="search-empty">
        <strong>최근 검색 내역이 없어요.</strong>
        <p>화이트보드에 포함된 단어, 노트 제목 등을 검색해보실 수 있어요.</p>
      </div>
    );
  }

  return (
    <section className="recent-searches">
      <div className="recent-searches-head">
        <h2>최근 검색어</h2>
        <button type="button" onClick={clearAll}>
          전체 삭제
        </button>
      </div>
      <div className="recent-search-list">
        {recentSearches.map((item) => (
          <div className="recent-search-row" key={item.last_searched_at + item.query}>
            <Link href={`/search?q=${encodeURIComponent(item.query)}`}>{item.query}</Link>
            <button
              aria-label={`${item.query} 검색어 삭제`}
              type="button"
              onClick={() => remove(item.query)}
            >
              <X size={24} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
