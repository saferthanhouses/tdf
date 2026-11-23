# Off Menu Map

A static map of the bars, restaurants and food shops recommended on the
[Off Menu](https://www.offmenupodcast.co.uk) podcast. For each recommendation it
shows what to order and why, with a short quote from the episode.

- A **series timeline** along the top filters by series (with release dates), or shows all series.
- The **episode list** on the left shows each guest; pick one to see their whole dream menu.
- **Pins** on the map open the details for that place, including every episode that recommended it.
- Recommendations that aren't a real public place (a parent's cooking, a homemade dish, a chain with no
  particular branch) appear in the episode's menu but not on the map.

Views can be linked to directly: `#ep-e123`, `#place-p45`, `#series-7`.

## Running it

It's plain HTML, CSS and JavaScript with Leaflet vendored in `site/vendor/`, so any static file server works:

```sh
cd apps/off-menu-map/site && python3 -m http.server 8000
```

Map tiles come from CARTO (OpenStreetMap data), fonts from Google Fonts.

## Data

| File | What it is |
|---|---|
| `data/episodes.json` | Extracted recommendations per episode (the source of truth) |
| `data/series.json` | The date each series started |
| `data/geocode-cache.json` | Nominatim results, keyed by search string |
| `site/data.json` | Built from the three files above; what the page loads |

Recommendations were extracted from the transcripts published on
[offmenupodcast.co.uk/transcripts](https://www.offmenupodcast.co.uk/transcripts), which cover the
episodes listed there, not every episode. Release dates come from the show's RSS feed. Quotes are capped at 35
words. Extraction and geocoding were automated, so expect the odd wrong pin; places Nominatim could only
find at town level are drawn with a dashed outline and labelled "approximate location".

To rebuild:

```sh
# 1. merge per-episode extraction files (one <id>.json per episode) into data/episodes.json
node scripts/merge-extractions.mjs manifest.json extractions/
# 2. look up new venues (one request a second, per Nominatim's usage policy)
node scripts/geocode.mjs
#    behind an HTTPS proxy, Node's fetch needs: NODE_USE_ENV_PROXY=1 node scripts/geocode.mjs
# 3. build site/data.json
node scripts/build-site-data.mjs
```
