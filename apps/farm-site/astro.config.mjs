// @ts-check
import { defineConfig } from "astro/config";

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // Set this to your real domain before deploying (used for canonical URLs / sitemap).
  site: "https://example.com",
  // Static output by default. When you need server routes (order forms, etc.),
  // add an adapter: `npx astro add netlify` (or cloudflare / vercel / node).
  output: "static",
});
