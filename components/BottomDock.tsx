"use client";

import Link from "@/components/AppLink";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HomeIcon, Search, UserRound } from "lucide-react";

export type DockTab = "home" | "search" | "me";

type BottomDockProps = {
  active: DockTab;
};

const dockItems = [
  { key: "home", href: "/", label: "홈", Icon: HomeIcon },
  { key: "search", href: "/search", label: "검색", Icon: Search },
  { key: "me", href: "/me", label: "나의 슬림보드", Icon: UserRound },
] as const;

export function BottomDock({ active }: BottomDockProps) {
  const router = useRouter();

  useEffect(() => {
    dockItems.forEach((item) => router.prefetch(item.href));
  }, [router]);

  return (
    <nav className="bottom-dock" aria-label="주요 이동">
      {dockItems.map(({ key, href, label, Icon }) => {
        const current = active === key;
        return (
          <Link
            className={`dock-item ${current ? "active" : ""}`}
            href={href}
            aria-current={current ? "page" : undefined}
            key={key}
            onMouseEnter={() => router.prefetch(href)}
            onTouchStart={() => router.prefetch(href)}
          >
            <Icon size={24} strokeWidth={current ? 2.6 : 2} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
