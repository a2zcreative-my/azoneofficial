import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  /* v1.172.0 (Next.js 16.3): `next dev` writes an AGENTS.md and upserts a
     managed block into CLAUDE.md unless told not to. CLAUDE.md is this
     repository's binding contract and PUSH.bat refuses a dirty worktree, so
     the framework may not edit either file. Off, explicitly. */
  agentRules: false,
  /* v1.11.1: pin the workspace root. A stray package-lock.json sitting in the
     Windows user folder made Next infer the wrong root and print a warning on
     every build. */
  outputFileTracingRoot: path.join(__dirname),
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
