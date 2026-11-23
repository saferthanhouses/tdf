// Geocode every public venue in data/episodes.json with OpenStreetMap Nominatim.
// Results are cached in data/geocode-cache.json, keyed by query, so re-runs only
// look up new venues. Nominatim's usage policy allows one request per second.
//
//   node scripts/geocode.mjs            # look up anything not yet cached
//   node scripts/geocode.mjs --retry    # also retry queries that found nothing
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { queriesFor } from "./geocode-queries.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const episodesPath = `${root}data/episodes.json`;
const cachePath = `${root}data/geocode-cache.json`;
const retry = process.argv.includes("--retry");

const episodes = JSON.parse(await readFile(episodesPath, "utf8"));
let cache = {};
try {
  cache = JSON.parse(await readFile(cachePath, "utf8"));
} catch {
  // first run
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(q) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "off-menu-map/1.0 (static fan map of podcast recommendations)" },
    });
    if (res.ok) {
      const [hit] = await res.json();
      if (!hit) return { found: false };
      return {
        found: true,
        lat: Number(hit.lat),
        lon: Number(hit.lon),
        display_name: hit.display_name,
        category: hit.category,
        type: hit.type,
        place_rank: hit.place_rank,
      };
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`Nominatim kept failing for "${q}"`);
}

const todo = [];
for (const ep of episodes) {
  for (const rec of ep.recommendations) {
    if (!rec.is_public_place) continue;
    for (const q of queriesFor(rec)) {
      const hit = cache[q];
      if (!hit || (retry && !hit.found)) todo.push(q);
    }
  }
}
const unique = [...new Set(todo)];
console.log(`${unique.length} queries to look up`);

let n = 0;
for (const q of unique) {
  try {
    cache[q] = await lookup(q);
  } catch (err) {
    console.error(String(err));
  }
  n++;
  if (n % 25 === 0) {
    console.log(`${n}/${unique.length}`);
    await writeFile(cachePath, JSON.stringify(cache, null, 1));
  }
  await sleep(1100);
}
await writeFile(cachePath, JSON.stringify(cache, null, 1));
console.log("done");
