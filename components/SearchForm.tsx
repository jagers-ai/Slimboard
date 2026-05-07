"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Search, X } from "lucide-react";

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
    <form className="search-page-form" onSubmit={submit}>
      <div className="search-input-wrap">
        <Search aria-hidden="true" size={25} />
        <input
          autoFocus
          className="search-page-input"
          placeholder="전체 검색"
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
            <X size={17} />
          </button>
        ) : null}
      </div>
      <Link className="search-cancel" href="/search">
        취소
      </Link>
    </form>
  );
}
