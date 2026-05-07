import Link from "next/link";
import { FileText, HomeIcon, Search } from "lucide-react";

type BottomDockProps = {
  active: "home" | "search" | "notes";
};

export function BottomDock({ active }: BottomDockProps) {
  return (
    <nav className="bottom-dock" aria-label="주요 이동">
      <Link className={`dock-item ${active === "home" ? "active" : ""}`} href="/">
        <HomeIcon size={22} />
        <span>홈</span>
      </Link>
      <Link className={`dock-item ${active === "search" ? "active" : ""}`} href="/search">
        <Search size={22} />
        <span>검색</span>
      </Link>
      <Link className={`dock-item ${active === "notes" ? "active" : ""}`} href="/notes">
        <FileText size={22} />
        <span>노트</span>
      </Link>
    </nav>
  );
}
