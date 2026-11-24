// Combine data/episodes.json, data/series.json and data/geocode-cache.json into
// site/data.json, the single file the map page loads.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { queriesFor } from "./geocode-queries.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = async (p) => JSON.parse(await readFile(`${root}${p}`, "utf8"));

const episodes = await read("data/episodes.json");
const seriesStarts = await read("data/series.json");
let cache = {};
try {
  cache = await read("data/geocode-cache.json");
} catch {
  console.warn("No geocode cache yet: nothing will be placed on the map.");
}

// Series n runs from its start date until the next series starts.
const starts = [...seriesStarts].sort((a, b) => a.start.localeCompare(b.start));
const seriesFor = (date) => {
  let s = starts[0].series;
  for (const x of starts) if (date >= x.start) s = x.series;
  return s;
};

const norm = (s) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");

// A hit at city level or broader only tells us roughly where the venue is.
const isApproximate = (hit) => hit.place_rank != null && hit.place_rank < 26;

const places = new Map();
let placed = 0;
const outEpisodes = episodes
  .map((ep) => {
    const series = seriesFor(ep.date);
    const recommendations = ep.recommendations.map((rec, i) => {
      const out = { ...rec, id: `${ep.id}-${i}` };
      delete out.geocode_query;
      if (!rec.is_public_place) return out;
      const hit = queriesFor(rec)
        .map((q) => cache[q])
        .find((h) => h?.found);
      if (!hit) return out;
      const key = `${norm(rec.venue)}@${hit.lat.toFixed(3)},${hit.lon.toFixed(3)}`;
      if (!places.has(key)) {
        places.set(key, {
          id: `p${places.size + 1}`,
          name: rec.venue,
          lat: hit.lat,
          lon: hit.lon,
          address: hit.display_name,
          approximate: isApproximate(hit),
          venue_type: rec.venue_type,
          recs: [],
        });
      }
      const place = places.get(key);
      place.recs.push(out.id);
      out.place = place.id;
      placed++;
      return out;
    });
    return { ...ep, series, recommendations };
  })
  .sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? 0) - (b.number ?? 0));

const series = starts.map((s) => {
  const eps = outEpisodes.filter((e) => e.series === s.series);
  return {
    series: s.series,
    start: s.start,
    first: eps[0]?.date ?? null,
    last: eps.at(-1)?.date ?? null,
    episodes: eps.length,
  };
});

const total = outEpisodes.reduce((n, e) => n + e.recommendations.length, 0);
await writeFile(
  `${root}site/data.json`,
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    series,
    episodes: outEpisodes,
    places: [...places.values()],
  }),
);
console.log(
  `${outEpisodes.length} episodes, ${total} recommendations, ${placed} on the map at ${places.size} places`,
);
