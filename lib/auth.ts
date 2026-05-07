import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AppUser = Pick<User, "id" | "email" | "user_metadata">;

const LOCAL_DEV_USER_ID = "d2f5848f-4070-47a2-a0b5-63bffbd1e49d";

const localDevUser: AppUser = {
  id: LOCAL_DEV_USER_ID,
  email: "local-dev@slimboard.local",
  user_metadata: {
    full_name: "Local Dev",
    name: "Local Dev",
  },
};

export async function getCurrentUser(request?: Request): Promise<AppUser | null> {
  if (await shouldUseLocalDevAuth(request)) {
    return localDevUser;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  return user;
}

export function isLocalDevUser(user: Pick<AppUser, "id"> | null | undefined) {
  return user?.id === LOCAL_DEV_USER_ID;
}

async function shouldUseLocalDevAuth(request?: Request) {
  const host = request ? getRequestHost(request) : await getHeaderHost();

  return isLocalDevAuthHost(host);
}

async function getHeaderHost() {
  try {
    const requestHeaders = await headers();

    return requestHeaders.get("host");
  } catch {
    return null;
  }
}

function getRequestHost(request: Request) {
  return request.headers.get("host") ?? new URL(request.url).host;
}

function isLocalDevAuthHost(host: string | null | undefined) {
  if (!host || process.env.VERCEL || process.env.VERCEL_URL) {
    return false;
  }

  const hostname = normalizeHostname(host);

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeHostname(host: string) {
  const value = host.split(",")[0]?.trim().toLowerCase() ?? "";

  if (value === "::1") {
    return value;
  }

  if (value.startsWith("[")) {
    return value.slice(1, value.indexOf("]"));
  }

  return value.split(":")[0] ?? "";
}
