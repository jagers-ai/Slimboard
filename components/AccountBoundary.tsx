"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearAllDrafts } from "@/lib/session-drafts";

export function AccountBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const leave = () => {
      clearAllDrafts();
      setBlocked(true);
      window.location.replace("/");
    };
    const verify = async () => {
      if (document.visibilityState === "hidden") return;
      setBlocked(true);
      setCheckError(false);
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      document.documentElement.style.visibility = "";
      if (error && error.status !== 401 && error.name !== "AuthSessionMissingError") {
        // A temporary network failure must not erase the selected photo/draft.
        setCheckError(true);
        return;
      }
      if (!data.user || data.user.id !== userId) leave();
      else setBlocked(false);
    };
    retry.current = () => { void verify(); };
    const onPageHide = () => { document.documentElement.style.visibility = "hidden"; };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void verify(); };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setBlocked(true);
      else void verify();
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) leave();
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      document.documentElement.style.visibility = "";
    };
  }, [userId]);

  // Keep file inputs mounted while the OS camera/photo picker hides the browser.
  // Unmounting here would discard the picker's pending change event.
  return <>
    <div hidden={blocked}>{children}</div>
    {blocked ? <main className="app-shell">
      <p role="status">{checkError ? "로그인 상태를 확인하지 못했어요. 연결을 확인하고 다시 시도해주세요." : "로그인 상태를 확인하고 있어요."}</p>
      {checkError ? <button className="button" onClick={() => retry.current()}>다시 확인</button> : null}
    </main> : null}
  </>;
}
