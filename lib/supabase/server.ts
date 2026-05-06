import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getOptionalEnv } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();
  const env = getOptionalEnv();

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase browser credentials are not configured.");
  }

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server components cannot always mutate cookies. Route handlers and
          // middleware still refresh sessions through this same helper shape.
        }
      },
    },
  });
}
