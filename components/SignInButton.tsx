"use client";

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";

import { useBrowserValue } from "@/hooks/useBrowserValue";
import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const authFailed = useBrowserValue(() => new URLSearchParams(window.location.search).has("authError"), false);
  const message = failure ?? (authFailed ? "로그인을 완료하지 못했어요. 다시 시도해주세요." : null);

  useEffect(() => {
    // Back from Google can restore this page from the browser's back/forward
    // cache with the button still disabled.
    const reset = (event: PageTransitionEvent) => { if (event.persisted) setIsLoading(false); };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function signIn() {
    setIsLoading(true);
    let failed: boolean;
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      failed = Boolean(error);
    } catch {
      failed = true;
    }

    if (failed) {
      setIsLoading(false);
      setFailure("로그인 연결에 실패했어요. 잠시 뒤 다시 시도해주세요.");
    }
  }

  return (
    <div className="sign-in">{message ? <p className="inline-message" role="alert">{message}</p> : null}<button className="button primary full-width" onClick={signIn} disabled={isLoading}>
      <LogIn size={20} aria-hidden="true" />
      {isLoading ? "연결 중" : "Google로 시작하기"}
    </button></div>
  );
}
