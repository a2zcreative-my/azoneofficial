import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the workspace packages — they ship TypeScript source, not builds,
  // so a change in packages/ui is picked up without a separate build step.
  transpilePackages: ["@azone/ui", "@azone/cms", "@azone/seo", "@azone/forms"],
  output: "export",
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
