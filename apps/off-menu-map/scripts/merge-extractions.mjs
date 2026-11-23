// Merge per-episode extraction files into data/episodes.json.
//
//   node scripts/merge-extractions.mjs <manifest.json> <extraction-dir>...
//
// manifest.json: [{ id, num, title, guest, date }] for each transcript.
// Each extraction dir holds <id>.json files: { id, summary, recommendations }.
// Later dirs win when an episode appears twice. Quotes are capped at 45 words so
// only short excerpts of the transcripts are kept.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [manifestPath, ...dirs] = process.argv.slice(2);
if (!manifestPath || !dirs.length) {
  console.error("usage: merge-extractions.mjs <manifest.json> <extraction-dir>...");
  process.exit(1);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const COURSES = new Set(["water", "bread", "starter", "main", "side", "drink", "dessert", "extra", "mention"]);
const MAX_QUOTE_WORDS = 45;

const capQuote = (q) => {
  if (!q) return null;
  const words = q.trim().split(/\s+/);
  return words.length <= MAX_QUOTE_WORDS ? q.trim() : `${words.slice(0, MAX_QUOTE_WORDS).join(" ")}…`;
};

const extracted = new Map();
for (const dir of dirs) {
  for (const f of (await readdir(dir)).filter((f) => /^[a-z]\d+\.json$/.test(f))) {
    let d = JSON.parse(await readFile(join(dir, f), "utf8"));
    if (Array.isArray(d)) d = d[0];
    if (d?.id && Array.isArray(d.recommendations)) extracted.set(d.id, d);
  }
}

const episodes = [];
const missing = [];
for (const m of manifest) {
  const d = extracted.get(m.id);
  if (!d) {
    missing.push(m.id);
    continue;
  }
  episodes.push({
    id: m.id,
    number: m.num ?? null,
    title: m.title,
    guest: m.guest,
    date: m.date,
    summary: d.summary ?? null,
    recommendations: d.recommendations.map((r) => ({
      course: COURSES.has(r.course) ? r.course : "extra",
      item: r.item ?? "",
      venue: r.venue || null,
      venue_type: r.venue_type ?? "other",
      is_public_place: Boolean(r.is_public_place && r.venue),
      location: r.location || null,
      geocode_query: r.geocode_query || null,
      reason: r.reason ?? null,
      quote: capQuote(r.quote),
      speaker: r.speaker || null,
    })),
  });
}
episodes.sort((a, b) => a.date.localeCompare(b.date));
await writeFile(`${root}data/episodes.json`, `${JSON.stringify(episodes, null, 1)}\n`);
console.log(
  `${episodes.length} episodes, ${episodes.reduce((n, e) => n + e.recommendations.length, 0)} recommendations`,
);
if (missing.length) console.log(`missing extractions: ${missing.join(", ")}`);
