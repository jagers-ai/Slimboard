"use client";

import Link from "@/components/AppLink";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";

type SearchFormProps = {
  initialQuery?: string;
};

export function SearchForm({ initialQuery = "" }: SearchFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const trimmedQuery = query.trim();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedQuery) {
      router.push("/search");
      return;
    }

    router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`);

    void fetch("/api/recent-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: trimmedQuery }),
    }).catch(() => {
      // 최근 검색어 저장 실패는 검색 이동을 막지 않습니다.
    });
  }

  return (
    <form className="search-page-form" role="search" onSubmit={submit}>
      <Link className="text-button icon-button" href="/" aria-label="홈으로"><ChevronLeft size={24} aria-hidden="true" /></Link>
      <div className="search-input-wrap">
        <Search aria-hidden="true" size={20} />
        <input
          aria-label="노트 검색"
          type="search"
          enterKeyHint="search"
          className="search-page-input"
          placeholder="노트 제목이나 보드 내용 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            aria-label="검색어 지우기"
            className="search-clear-button"
            type="button"
            onClick={() => setQuery("")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </form>
  );
}
