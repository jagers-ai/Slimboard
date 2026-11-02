import { redirect } from "next/navigation";
import { ChevronRight, NotebookText } from "lucide-react";

import { AccountBoundary } from "@/components/AccountBoundary";
import Link from "@/components/AppLink";
import { AppFrame } from "@/components/AppFrame";
import { ClearRecentSearchesButton } from "@/components/ClearRecentSearchesButton";
import { SignOutButton } from "@/components/SignOutButton";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  if (!hasCoreEnv()) {
    redirect("/");
  }

  const user = await requireUser();
  const email = user.email ?? "";
  const initial = (email.trim()[0] ?? "슬").toLocaleUpperCase("ko-KR");

  return (
    <AccountBoundary key={user.id} userId={user.id}><AppFrame active="me">
      <header className="home-header">
        <h1 className="home-brand">나의 슬림보드</h1>
      </header>

      <section className="profile-row" aria-label="로그인한 계정">
        <span className="profile-avatar" aria-hidden="true">{initial}</span>
        <span className="profile-email">{email || "로그인한 계정"}</span>
      </section>

      <div className="section-gap" aria-hidden="true" />
      <nav className="menu-list" aria-label="노트 관리">
        <Link className="menu-row" href="/">
          <NotebookText size={22} aria-hidden="true" />
          <span>모든 노트</span>
          <ChevronRight size={20} className="menu-chevron" aria-hidden="true" />
        </Link>
        <ClearRecentSearchesButton />
      </nav>

      <div className="section-gap" aria-hidden="true" />
      <div className="menu-list">
        <SignOutButton />
      </div>
    </AppFrame></AccountBoundary>
  );
}
