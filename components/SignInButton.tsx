"use client";

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("authError")) setMessage("로그인을 완료하지 못했어요. 다시 시도해주세요.");
  }, []);

  async function signIn() {
    setIsLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setIsLoading(false);
      setMessage("로그인 연결에 실패했어요. 잠시 뒤 다시 시도해주세요.");
    }
  }

  return (
    <div><button className="button primary" onClick={signIn} disabled={isLoading}>
      <LogIn size={18} />
      {isLoading ? "연결 중" : "Google로 시작"}
    </button>{message ? <p className="inline-message" role="alert">{message}</p> : null}</div>
  );
}
