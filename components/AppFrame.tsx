"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { BottomDock } from "@/components/BottomDock";

/** The content scrolls inside its own row; navigation never overlays it. */
export function AppFrame({ children, active, className = "" }: {
  children: ReactNode; active: "home" | "search" | "notes"; className?: string;
}) {
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let request = 0;
    const resize = () => {
      if (!frame.current || viewport.height <= 0) return;
      // Let native pinch-zoom pan freely instead of continually resizing content.
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      frame.current.style.setProperty("--app-viewport-height", `${viewport.height}px`);
      frame.current.style.setProperty("--app-viewport-top", `${viewport.offsetTop}px`);
    };
    const schedule = () => { cancelAnimationFrame(request); request = requestAnimationFrame(resize); };
    resize();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(request);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
    };
  }, []);

  return <main ref={frame} className={`app-shell docked-shell ${className}`}>
    <div className="app-scroll">{children}</div>
    <BottomDock active={active} />
  </main>;
}
