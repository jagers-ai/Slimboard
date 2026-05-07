"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, HomeIcon, Search } from "lucide-react";

type BottomDockProps = {
  active: "home" | "search" | "notes";
};

const dockItems = [
  { key: "home", href: "/", label: "홈", Icon: HomeIcon },
  { key: "search", href: "/search", label: "검색", Icon: Search },
  { key: "notes", href: "/notes", label: "노트", Icon: FileText },
] as const;

export function BottomDock({ active }: BottomDockProps) {
  const router = useRouter();

  useEffect(() => {
    dockItems.forEach((item) => router.prefetch(item.href));
  }, [router]);

  return (
    <nav className="bottom-dock" aria-label="주요 이동">
      {dockItems.map(({ key, href, label, Icon }) => (
        <Link
          className={`dock-item ${active === key ? "active" : ""}`}
          href={href}
          key={key}
          onMouseEnter={() => router.prefetch(href)}
          onTouchStart={() => router.prefetch(href)}
        >
          <Icon size={22} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
