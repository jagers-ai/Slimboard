"use client";

import { useState } from "react";
import { LoaderCircle, SearchX } from "lucide-react";

export function ClearRecentSearchesButton() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function clearAll() {
    if (state === "busy" || !window.confirm("최근 검색어를 모두 지울까요?")) return;
    setState("busy");
    try {
      const response = await fetch("/api/recent-searches?all=true", { method: "DELETE" });
      setState(response.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return <>
    <button className="menu-row" type="button" onClick={clearAll} disabled={state === "busy"}>
      {state === "busy" ? <LoaderCircle size={22} className="spinner" aria-hidden="true" /> : <SearchX size={22} aria-hidden="true" />}
      <span>최근 검색어 지우기</span>
    </button>
    <p className={state === "done" || state === "error" ? "menu-message" : "sr-only"} role="status">
      {state === "done" ? "최근 검색어를 지웠어요." : state === "error" ? "지우지 못했어요. 다시 시도해 주세요." : ""}
    </p>
  </>;
}
