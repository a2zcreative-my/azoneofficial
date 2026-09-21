/* v1.172.2 - Tailwind retired: no PostCSS plugin runs. The file stays so
   Next.js keeps its plugin list at exactly this (an absent config would make
   it apply its own defaults); the stylesheet is plain CSS that Next's
   bundler processes as is. Do not add @tailwindcss/postcss back - the guard
   tests/tailwind-retired.mjs fails the build if it returns. */
const config = {
  plugins: {},
};

export default config;
