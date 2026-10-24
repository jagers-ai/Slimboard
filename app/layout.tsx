import type { Metadata, Viewport } from "next";
import { KakaoBrowserGate } from "@/components/KakaoBrowserGate";

import "./globals.css";
import "./notebook.css";

export const metadata: Metadata = {
  title: "Slimboard",
  description: "화이트보드 사진을 노트로 정리합니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body><KakaoBrowserGate>{children}</KakaoBrowserGate></body>
    </html>
  );
}
