import { BottomDock } from "@/components/BottomDock";
import { RecentSearches } from "@/components/RecentSearches";
import { SearchForm } from "@/components/SearchForm";
import { SearchResults } from "@/components/SearchResults";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { listNotesForUser } from "@/lib/notes";
import { listRecentSearchesForUser } from "@/lib/recent-searches";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  if (!hasCoreEnv()) {
    return (
      <main className="app-shell search-shell">
        <SearchForm />
        <div className="search-empty">
          <strong>앱 설정이 필요합니다.</strong>
          <p>현재 Slimboard를 사용할 수 없습니다. 관리자에게 문의해주세요.</p>
        </div>
        <BottomDock active="search" />
      </main>
    );
  }

  const user = await requireUser();
  await ensurePersonalWorkspace(user);

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
    <main className="app-shell search-shell">
      <SearchForm initialQuery={q} />

      {q ? <SearchResults notes={notes} query={q} /> : <RecentSearches recentSearches={recentSearches} />}

      <BottomDock active="search" />
    </main>
  );
}
