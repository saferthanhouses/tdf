# Farm site

Static farm website built with [Astro](https://astro.build). Pages are Markdown, the theme is a single CSS file of tokens, and interactivity can be added component-by-component.

## Run it

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static site in dist/
npm run check    # type-check .astro/.ts files
```

Requires Node 22+.

## Where things live

| To change…                    | Edit                                   |
| ----------------------------- | -------------------------------------- |
| Farm name, email, nav links   | `src/site.config.ts`                   |
| Colors, fonts, spacing        | `src/styles/theme.css` (fonts link in `src/layouts/BaseLayout.astro`) |
| Homepage                      | `src/pages/index.astro`                |
| Simple pages (About, FAQ…)    | `src/content/pages/*.md`               |
| Products                      | `src/content/products/*.md`            |
| Market schedule               | `src/data/markets.json`                |
| Photos                        | `public/images/` → reference as `/images/name.jpg` |

### Add a new page

1. Create `src/content/pages/faq.md`:
   ```md
   ---
   title: FAQ
   lede: Answers to common questions.
   ---
   ## Do you ship?
   Not yet — find us at market.
   ```
2. It's live at `/faq`. Add `{ label: "FAQ", href: "/faq" }` to `nav` in `src/site.config.ts` if it belongs in the header.

For a page that needs custom layout, create `src/pages/whatever.astro` instead.

Copy any file in `src/content/products/`, rename it (the filename becomes the URL, e.g. `/products/lamb-shanks`), and edit the frontmatter. Fields are validated by `src/content.config.ts` — a typo in `category` fails the build with a clear message. Set `featured: true` to show it on the homepage (first three by `order`).

## Adding interactivity

Three levels, use the lightest that works:

1. **Plain `<script>` in a component** — Astro bundles it. See `MarketSchedule.astro` (highlights the next market day) and `Header.astro` (mobile menu).
2. **Framework islands** — `npx astro add react`, then use a component with a hydration directive, e.g. `<OrderForm client:visible />`. Only that component ships JS.
3. **Server routes** — `npx astro add netlify` (or `cloudflare`, `vercel`, `node`). Then add `src/pages/api/*.ts` endpoints, or mark individual pages `export const prerender = false`. The rest stays static.

## Deploy

Push to GitHub, then connect the repo in Netlify, Cloudflare Pages or Vercel — all detect Astro automatically (build: `npm run build`, output: `dist`). Free tiers are plenty for a farm site. Set `site` in `astro.config.mjs` to your domain.
