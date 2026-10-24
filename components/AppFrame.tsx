"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { visibleViewportBounds } from "@/lib/visible-viewport";
import { BottomDock } from "@/components/BottomDock";

/** The content scrolls inside its own row; navigation never overlays it. */
export function AppFrame({ children, active, className = "" }: {
  children: ReactNode; active: "home" | "search" | "notes"; className?: string;
}) {
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    // Some Android browsers report no bottom inset for three-button navigation.
    frame.current?.style.setProperty("--navigation-min-bottom", /Android/i.test(navigator.userAgent) ? "48px" : "0px");
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

  return <main ref={frame} className={`app-shell docked-shell ${className}`}>
    <div className="app-scroll">{children}</div>
    <BottomDock active={active} />
  </main>;
}
