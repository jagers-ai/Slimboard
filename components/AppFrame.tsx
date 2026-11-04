"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { visibleViewportBounds } from "@/lib/visible-viewport";
import { BottomDock, type DockTab } from "@/components/BottomDock";

/**
 * The content scrolls inside its own row; the bottom row (tab bar or a
 * screen's action bar) never overlays it. `overlay` floats above the bottom
 * row (the home "새 노트" button) without scrolling with the content.
 */
export function AppFrame({ children, active, className = "", footer, overlay }: {
  children: ReactNode;
  active: DockTab;
  className?: string;
  /** Replaces the tab bar with a fixed action bar (photo review, note detail). */
  footer?: ReactNode;
  overlay?: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  // Measure before paint so a newly mounted screen never shows the tab bar off the bottom.
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    let request = 0;
    const resize = () => {
      if (!frame.current) return;
      // Let native pinch-zoom pan freely instead of continually resizing content.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const bounds = visibleViewportBounds(window.innerHeight, document.documentElement.clientHeight, viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0);
      frame.current.style.setProperty("--app-viewport-height", `${bounds.height}px`);
      frame.current.style.setProperty("--app-viewport-top", `${bounds.top}px`);
    };
    const schedule = () => { cancelAnimationFrame(request); request = requestAnimationFrame(resize); };
    window.addEventListener("resize", schedule);
    window.addEventListener("pageshow", schedule);
    resize();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(request);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, []);

  const classes = ["app-shell", "docked-shell", overlay ? "has-overlay" : "", className].filter(Boolean).join(" ");
  return <main ref={frame} className={classes}>
    <div className="app-scroll">{children}</div>
    {overlay ? <div className="app-overlay">{overlay}</div> : null}
    {footer ? <div className="action-bar">{footer}</div> : <BottomDock active={active} />}
  </main>;
}
