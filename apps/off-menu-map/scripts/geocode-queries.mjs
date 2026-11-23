// Nominatim queries to try for one recommendation, most specific first.
export function queriesFor(rec) {
  const qs = [];
  if (rec.geocode_query) qs.push(rec.geocode_query);
  if (rec.venue && rec.location) {
    qs.push(`${rec.venue}, ${rec.location.replace(/^Chain:\s*/i, "")}`);
  }
  return [...new Set(qs.map((q) => q.trim()).filter(Boolean))];
}
