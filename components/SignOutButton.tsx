"use client";

import { useState } from "react";
import { clearAllDrafts } from "@/lib/session-drafts";
import { LoaderCircle, LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/** A menu row on 나의 슬림보드. */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) { setError("로그아웃하지 못했어요. 다시 시도해 주세요."); setBusy(false); return; }
    clearAllDrafts();
    window.location.replace("/");
  }

  return (
    <><button className="menu-row" type="button" onClick={signOut} disabled={busy}>
      {busy ? <LoaderCircle size={22} className="spinner" aria-hidden="true" /> : <LogOut size={22} aria-hidden="true" />}
      <span>{busy ? "로그아웃하는 중" : "로그아웃"}</span>
    </button>{error ? <p className="inline-message menu-message" role="alert">{error}</p> : null}</>
  );
}
