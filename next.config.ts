import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  /* v1.11.1: pin the workspace root. A stray package-lock.json sitting in the
     Windows user folder made Next infer the wrong root and print a warning on
     every build. */
  outputFileTracingRoot: path.join(__dirname),
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
