import { AppFrame } from "@/components/AppFrame";
import type { DockTab } from "@/components/BottomDock";

type AppLoadingProps = {
  active: DockTab;
  variant?: "home" | "list" | "detail" | "search";
};

/** Uses the same frame as the loaded screen so the tab bar never moves between them. */
export function AppLoading({ active, variant = "list" }: AppLoadingProps) {
  return (
    <AppFrame active={active} className={`loading-shell loading-${variant}`}>
      {variant === "search" ? (
        <div className="loading-search-input skeleton-block" />
      ) : (
        <header className="topbar">
          <div className="loading-brand skeleton-block" />
          <div className="loading-action skeleton-block" />
        </header>
      )}

      <section className="loading-stack" aria-label="페이지를 불러오는 중">
        <div className="loading-title skeleton-block" />
        <div className="loading-subtitle skeleton-block" />
        {variant === "detail" ? <div className="loading-image skeleton-block" /> : null}
        {Array.from({ length: variant === "home" ? 2 : 3 }).map((_, index) => (
          <div className="loading-card skeleton-block" key={index} />
        ))}
      </section>
    </AppFrame>
  );
}
