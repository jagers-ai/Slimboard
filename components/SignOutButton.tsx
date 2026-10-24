"use client";

import { useState } from "react";
import { clearAllDrafts } from "@/lib/session-drafts";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) { setError("로그아웃하지 못했어요. 다시 시도해주세요."); setBusy(false); return; }
    clearAllDrafts();
    window.location.replace("/");
  }

  return (
    <><button className="button" onClick={signOut} title={email} disabled={busy}>
      <LogOut size={18} />
      로그아웃
    </button>{error ? <p role="alert">{error}</p> : null}</>
  );
}
