import { AccountBoundary } from "@/components/AccountBoundary";
import { AppFrame } from "@/components/AppFrame";
import { RecentSearches } from "@/components/RecentSearches";
import { SearchForm } from "@/components/SearchForm";
import { SearchResults } from "@/components/SearchResults";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { listNotesForUser } from "@/lib/notes";
import { listRecentSearchesForUser } from "@/lib/recent-searches";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  if (!hasCoreEnv()) {
    return (
      <AppFrame active="search" className="search-shell">
        <SearchForm />
        <div className="search-empty">
          <strong>잠시 이용할 수 없어요.</strong>
          <p>잠시 후 다시 시도해 주세요.</p>
        </div>
      </AppFrame>
    );
  }

  const user = await requireUser();

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const notes = q
    ? await listNotesForUser({
        userId: user.id,
        query: q,
        limit: 50,
      })
    : [];
  const recentSearches = q ? [] : await listRecentSearchesForUser(user.id);

  return (
    <AccountBoundary key={user.id} userId={user.id}><AppFrame active="search" className="search-shell">
      <h1 className="sr-only">노트 검색</h1>
      <SearchForm initialQuery={q} />

      {q ? <SearchResults notes={notes} query={q} /> : <RecentSearches recentSearches={recentSearches} />}

    </AppFrame></AccountBoundary>
  );
}
