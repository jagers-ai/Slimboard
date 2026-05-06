"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  const [isLoading, setIsLoading] = useState(false);

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
      alert(error.message);
    }
  }

  return (
    <button className="button primary" onClick={signIn} disabled={isLoading}>
      <LogIn size={18} />
      {isLoading ? "연결 중" : "Google로 시작"}
    </button>
  );
}
