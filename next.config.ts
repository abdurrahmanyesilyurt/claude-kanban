import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "better-sqlite3",
    "uuid",
    "playwright",
  ],
  turbopack: {
    root: "C:/Users/HP/source/repos/claude-kanban",
  },
};

export default nextConfig;
