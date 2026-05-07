export type AppEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  geminiApiKey: string;
  siteUrl: string;
};

export function getOptionalEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  };
}

export function getEnv(): AppEnv {
  const env = getOptionalEnv();
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey],
    ["GEMINI_API_KEY", env.geminiApiKey],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.map(([name]) => name).join(", ")}`,
    );
  }

  return {
    supabaseUrl: env.supabaseUrl!,
    supabaseAnonKey: env.supabaseAnonKey!,
    supabaseServiceRoleKey: env.supabaseServiceRoleKey!,
    geminiApiKey: env.geminiApiKey!,
    siteUrl: env.siteUrl,
  };
}

export function hasCoreEnv() {
  const env = getOptionalEnv();

  return Boolean(
    env.supabaseUrl &&
      env.supabaseAnonKey &&
      env.supabaseServiceRoleKey &&
      env.geminiApiKey,
  );
}
