import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  devIndicators: false,
  // The invitation gateway deliberately blocks development WebSockets.
  // Next 16.4's React debug stream otherwise leaves hydration waiting on HMR.
  ...(process.env.SLIMBOARD_ENABLE_CODEX_LAB === "1"
    ? { experimental: { reactDebugChannel: false } }
    : {}),
};

export default nextConfig;
