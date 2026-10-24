"use client";
import type { ComponentProps } from "react";
import { useRouter } from "next/navigation";

// Vinext beta's next/link dynamic module import loses named navigation exports
// in this production bundle. Use its supported router hook directly, retaining
// soft navigation and account-scoped in-memory drafts without prefetching.
export default function AppLink({ href, onClick, target, ...props }: ComponentProps<"a"> & { href: string }) {
  const router = useRouter();
  return <a {...props} href={href} target={target} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (target && target !== "_self") || event.currentTarget.hasAttribute("download")) return;
    const destination = new URL(href, window.location.href);
    if (destination.origin !== window.location.origin || !["http:", "https:"].includes(destination.protocol)) return;
    event.preventDefault();
    router.push(destination.pathname + destination.search + destination.hash);
  }} />;
}
