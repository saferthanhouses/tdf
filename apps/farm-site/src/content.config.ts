// Content collections: typed, validated content from Markdown / JSON files.
// Docs: https://docs.astro.build/en/guides/content-collections/
import { defineCollection } from "astro:content";
import { glob, file } from "astro/loaders";
import { z } from "astro/zod";

// Any .md file in src/content/pages/ becomes a page at /<filename>.
const pages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    eyebrow: z.string().optional(),
    lede: z.string().optional(),
    description: z.string().optional(),
  }),
});

// One .md file per product in src/content/products/.
const products = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/products" }),
  schema: z.object({
    name: z.string(),
    category: z.enum(["Meat", "Eggs", "Farm Kitchen", "Fruit"]),
    summary: z.string(),
    price: z.string().optional(), // free text, e.g. "$14 / lb" or "Market price"
    seasonal: z.string().optional(), // e.g. "July – August"
    image: z.string().optional(), // path under /public, e.g. "/images/pot-pie.jpg"
    featured: z.boolean().default(false),
    order: z.number().default(100), // lower sorts first
    available: z.boolean().default(true),
  }),
});

// Market schedule lives in one JSON file.
const markets = defineCollection({
  loader: file("./src/data/markets.json"),
  schema: z.object({
    name: z.string(),
    location: z.string(),
    // 0 = Sunday … 6 = Saturday
    days: z.array(z.number().int().min(0).max(6)),
    hours: z.string(),
    season: z.string(), // human-readable, e.g. "Year-round" or "May – November"
    // Optional month range (1–12) used by the "next market" widget
    startMonth: z.number().int().min(1).max(12).optional(),
    endMonth: z.number().int().min(1).max(12).optional(),
    url: z.string().url().optional(),
    note: z.string().optional(),
  }),
});

export const collections = { pages, products, markets };
