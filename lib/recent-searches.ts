import { createAdminClient } from "@/lib/supabase/admin";

export type RecentSearch = {
  query: string;
  last_searched_at: string;
};

export function normalizeRecentSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export async function listRecentSearchesForUser(userId: string, limit = 10) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("user_recent_searches")
    .select("query,last_searched_at")
    .eq("user_id", userId)
    .order("last_searched_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingRecentSearchesTable(error)) {
      return [];
    }

    throw error;
  }

  return (data ?? []) as RecentSearch[];
}

export async function saveRecentSearchForUser(userId: string, query: string) {
  const trimmedQuery = query.trim().replace(/\s+/g, " ");
  const normalizedQuery = normalizeRecentSearchQuery(trimmedQuery);

  if (!normalizedQuery) {
    return null;
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("user_recent_searches")
    .upsert(
      {
        user_id: userId,
        query: trimmedQuery,
        normalized_query: normalizedQuery,
        last_searched_at: now,
      },
      { onConflict: "user_id,normalized_query" },
    )
    .select("query,last_searched_at")
    .single();

  if (error) {
    if (isMissingRecentSearchesTable(error)) {
      return null;
    }

    throw error;
  }

  return data as RecentSearch;
}

export async function deleteRecentSearchForUser(userId: string, query: string) {
  const normalizedQuery = normalizeRecentSearchQuery(query);

  if (!normalizedQuery) {
    return;
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_recent_searches")
    .delete()
    .eq("user_id", userId)
    .eq("normalized_query", normalizedQuery);

  if (error) {
    if (isMissingRecentSearchesTable(error)) {
      return;
    }

    throw error;
  }
}

export async function clearRecentSearchesForUser(userId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("user_recent_searches").delete().eq("user_id", userId);

  if (error) {
    if (isMissingRecentSearchesTable(error)) {
      return;
    }

    throw error;
  }
}

function isMissingRecentSearchesTable(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    Boolean(error.message?.includes("user_recent_searches"))
  );
}
