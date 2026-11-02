"use client";

import Link from "@/components/AppLink";
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
        <strong>최근 검색한 단어가 없어요</strong>
        <p>노트 제목이나 화이트보드에 적힌 단어로 찾아보세요.</p>
      </div>
    );
  }

  return (
    <section className="recent-searches">
      <div className="recent-searches-head">
        <h2>최근 검색</h2>
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
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
