/* Off Menu Map: series timeline, episode list, Leaflet map and a details panel.
   All data comes from data.json, built by scripts/build-site-data.mjs. */
(() => {
  "use strict";

  const COURSES = ["water", "bread", "starter", "main", "side", "drink", "dessert", "extra", "mention"];
  const COURSE_LABEL = {
    water: "Water",
    bread: "Poppadoms or bread",
    starter: "Starter",
    main: "Main course",
    side: "Side dish",
    drink: "Drink",
    dessert: "Dessert",
    extra: "Extra",
    mention: "Also recommended",
  };
  const NOT_ON_MAP = {
    home: "Someone's home",
    homemade: "Homemade",
    fictional: "Not a real place",
    chain: "Chain, no single branch",
  };

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return node;
  };
  const courseVar = (c) => `--course: var(--c-${COURSES.includes(c) ? c : "extra"})`;

  const fmtDate = (iso, opts = { day: "numeric", month: "short", year: "numeric" }) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  const fmtMonth = (iso) => fmtDate(iso, { month: "short", year: "numeric" });
  const epLabel = (ep) => (ep.number ? `Ep ${ep.number}` : "Special");

  // ---------- state ----------
  const state = {
    series: null, // null = all
    episodeId: null,
    placeId: null,
    recId: null,
    query: "",
  };
  let data, map, cluster;
  const episodesById = new Map();
  const recsById = new Map();
  const placesById = new Map();
  const markersByPlace = new Map();

  // ---------- boot ----------
  fetch("data.json")
    .then((r) => {
      if (!r.ok) throw new Error(`data.json returned ${r.status}`);
      return r.json();
    })
    .then(init)
    .catch((err) => {
      $("tagline").textContent = "Couldn't load the recommendations. Run the data build, then reload.";
      console.error(err);
    });

  function init(d) {
    data = d;
    for (const ep of data.episodes) {
      episodesById.set(ep.id, ep);
      for (const rec of ep.recommendations) {
        rec.episode = ep.id;
        recsById.set(rec.id, rec);
      }
    }
    for (const p of data.places) placesById.set(p.id, p);

    const totalRecs = data.episodes.reduce((n, e) => n + e.recommendations.length, 0);
    $("tagline").textContent =
      `${totalRecs.toLocaleString("en-GB")} recommendations from ${data.episodes.length} episodes, ` +
      `${data.places.length.toLocaleString("en-GB")} places on the map`;

    buildMap();
    buildTimeline();
    buildLegend();
    $("series-all").addEventListener("click", () => selectSeries(null));
    $("search").addEventListener("input", (e) => {
      state.query = e.target.value.trim().toLowerCase();
      renderEpisodeList();
      renderMarkers();
    });

    readHash();
    window.addEventListener("hashchange", readHash);
    if (!state.episodeId && !state.placeId) renderOverview();
  }

  // Shareable views: #ep-e123, #place-p45, #series-7
  function readHash() {
    const h = location.hash.slice(1);
    let m;
    if ((m = h.match(/^ep-(\w+)$/)) && episodesById.has(m[1])) {
      selectEpisode(m[1], { fromHash: true });
    } else if ((m = h.match(/^place-(\w+)$/)) && placesById.has(m[1])) {
      selectPlace(m[1], { fromHash: true });
    } else if ((m = h.match(/^series-(\d+)$/))) {
      selectSeries(Number(m[1]), { fromHash: true });
    } else {
      renderEpisodeList();
      renderMarkers();
      updateTimeline();
    }
  }
  function writeHash(h) {
    const next = h ? `#${h}` : " ";
    if (location.hash !== (h ? `#${h}` : "")) history.replaceState(null, "", next.trim() || location.pathname);
  }

  // ---------- filtering ----------
  const recText = (r) =>
    [r.item, r.venue, r.location, r.reason, r.quote].filter(Boolean).join(" ").toLowerCase();
  function episodeMatches(ep) {
    if (state.series != null && ep.series !== state.series) return false;
    if (!state.query) return true;
    if (ep.guest.toLowerCase().includes(state.query) || ep.title.toLowerCase().includes(state.query)) return true;
    return ep.recommendations.some((r) => recText(r).includes(state.query));
  }
  const visibleEpisodes = () => data.episodes.filter(episodeMatches);

  // ---------- timeline ----------
  function buildTimeline() {
    const first = data.series[0].first ?? data.series[0].start;
    const last = data.series.at(-1).last ?? data.series.at(-1).start;
    $("all-dates").textContent = `${fmtMonth(first)} – ${fmtMonth(last)}`;

    const t0 = Date.parse(`${first.slice(0, 4)}-${first.slice(5, 7)}-01`);
    const t1 = Date.parse(`${Number(last.slice(0, 4)) + 1}-01-01`);
    const pct = (iso) => ((Date.parse(iso) - t0) / (t1 - t0)) * 100;

    const track = $("track");
    data.series.forEach((s, i) => {
      const next = data.series[i + 1];
      // Series without transcripts still get a (disabled) slot so the timeline has no gaps.
      const begin = s.first ?? s.start;
      const end = s.last ?? (next ? new Date(Date.parse(next.start) - 864e5 * 30).toISOString().slice(0, 10) : s.start);
      const from = pct(begin);
      const to = pct(next ? next.start : end) - 0.25;
      const btn = el(
        "button",
        {
          type: "button",
          class: "seg",
          style: `left:${from}%;width:${Math.max(to - from, 3)}%`,
          "aria-pressed": "false",
          "data-series": s.series,
          disabled: !s.episodes,
          title: s.episodes
            ? `Series ${s.series}: ${fmtDate(begin)} – ${fmtDate(end)}, ${s.episodes} episodes with transcripts`
            : `Series ${s.series}: no transcripts published for this series`,
          onclick: () => selectSeries(s.series),
        },
        el("span", { class: "s-name" }, `S${s.series}`),
        el("span", { class: "s-dates" }, s.episodes ? `${fmtDate(begin, { month: "short" })}–${fmtDate(end, { month: "short" })} ’${end.slice(2, 4)}` : "no transcripts"),
      );
      track.append(btn);
    });

    const years = $("years");
    for (let y = Number(first.slice(0, 4)) + 1; y <= Number(last.slice(0, 4)); y++) {
      years.append(el("span", { style: `left:${pct(`${y}-01-01`)}%` }, y));
    }
  }
  function updateTimeline() {
    $("series-all").setAttribute("aria-pressed", String(state.series == null));
    for (const b of document.querySelectorAll(".seg")) {
      const on = Number(b.dataset.series) === state.series;
      b.setAttribute("aria-pressed", String(on));
      if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  function selectSeries(n, { fromHash = false } = {}) {
    state.series = n;
    state.episodeId = null;
    state.placeId = null;
    state.recId = null;
    if (!fromHash) writeHash(n == null ? "" : `series-${n}`);
    updateTimeline();
    renderEpisodeList();
    renderMarkers({ fit: true });
    renderOverview();
    $("episode-list").scrollTop = 0;
  }

  // ---------- episode list ----------
  function renderEpisodeList() {
    const list = $("episode-list");
    const eps = visibleEpisodes();
    list.replaceChildren();
    let lastSeries = null;
    for (const ep of eps) {
      if (state.series == null && ep.series !== lastSeries) {
        const s = data.series.find((x) => x.series === ep.series);
        list.append(
          el("li", { class: "series-divider" }, `Series ${ep.series} · ${fmtMonth(s.first)}–${fmtMonth(s.last)}`),
        );
        lastSeries = ep.series;
      }
      const pins = ep.recommendations.filter((r) => r.place).length;
      list.append(
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "ep-btn",
              "aria-current": String(ep.id === state.episodeId),
              "data-ep": ep.id,
              onclick: () => selectEpisode(ep.id),
            },
            el("span", { class: "ep-num" }, ep.number ?? "–"),
            el("span", { class: "ep-guest" }, ep.guest),
            el(
              "span",
              { class: "ep-meta" },
              el("span", {}, fmtDate(ep.date)),
              el("span", { class: "pins" }, pins ? `${pins} on map` : "nothing to map"),
            ),
          ),
        ),
      );
    }
    $("ep-count").textContent =
      `${eps.length} episode${eps.length === 1 ? "" : "s"}` +
      (state.series != null ? ` in series ${state.series}` : "") +
      (state.query ? ` matching “${state.query}”` : "");
    if (!eps.length) list.append(el("li", { class: "series-divider" }, "No episodes match"));
  }
  function markCurrentEpisode() {
    for (const b of document.querySelectorAll(".ep-btn")) {
      const on = b.dataset.ep === state.episodeId;
      b.setAttribute("aria-current", String(on));
      if (on) b.scrollIntoView({ block: "nearest" });
    }
  }

  // ---------- map ----------
  function buildMap() {
    map = L.map("map", { worldCopyJump: true, zoomControl: true }).setView([51.51, -0.12], 4);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40, spiderfyOnMaxZoom: true });
    map.addLayer(cluster);
  }

  // A place's colour is the course of its first recommendation.
  function placeIcon(place, active) {
    const course = recsById.get(place.recs[0])?.course ?? "extra";
    return L.divIcon({
      className: "",
      html: `<div class="pin${place.approximate ? " approx" : ""}${active ? " is-active" : ""}" style="${courseVar(course)}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  function visiblePlaces() {
    if (state.episodeId) {
      const ep = episodesById.get(state.episodeId);
      return [...new Set(ep.recommendations.map((r) => r.place).filter(Boolean))].map((id) => placesById.get(id));
    }
    const eps = new Set(visibleEpisodes().map((e) => e.id));
    return data.places.filter((p) => p.recs.some((rid) => eps.has(recsById.get(rid).episode)));
  }

  function renderMarkers({ fit = false } = {}) {
    cluster.clearLayers();
    markersByPlace.clear();
    const places = visiblePlaces();
    const markers = places.map((p) => {
      const recs = p.recs.map((id) => recsById.get(id));
      const guests = [...new Set(recs.map((r) => episodesById.get(r.episode).guest))];
      const m = L.marker([p.lat, p.lon], {
        icon: placeIcon(p, p.id === state.placeId),
        title: p.name,
        keyboard: true,
      });
      m.bindTooltip(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(guests.slice(0, 3).join(", "))}${guests.length > 3 ? "…" : ""}`, {
        direction: "top",
        offset: [0, -8],
      });
      m.on("click", () => selectPlace(p.id));
      markersByPlace.set(p.id, m);
      return m;
    });
    cluster.addLayers(markers);
    if (fit && markers.length) {
      const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  function refreshActiveIcons() {
    for (const [id, m] of markersByPlace) m.setIcon(placeIcon(placesById.get(id), id === state.placeId));
  }

  function flyToPlace(id) {
    const m = markersByPlace.get(id);
    if (!m) return;
    cluster.zoomToShowLayer(m, () => {
      map.panTo(m.getLatLng());
      m.openTooltip();
    });
  }

  function buildLegend() {
    const legend = $("legend");
    for (const c of COURSES) {
      if (c === "water") continue;
      legend.append(el("span", {}, el("i", { class: "dot", style: `background: var(--c-${c})` }), COURSE_LABEL[c]));
    }
  }

  // ---------- selection ----------
  function selectEpisode(id, { fromHash = false, focusRec = null } = {}) {
    const ep = episodesById.get(id);
    if (!ep) return;
    if (state.series != null && ep.series !== state.series) {
      state.series = ep.series;
      updateTimeline();
      renderEpisodeList();
    }
    state.episodeId = id;
    state.placeId = null;
    state.recId = focusRec;
    if (!fromHash) writeHash(`ep-${id}`);
    if (!document.querySelector(`.ep-btn[data-ep="${id}"]`)) {
      state.query = "";
      $("search").value = "";
      renderEpisodeList();
    }
    markCurrentEpisode();
    renderMarkers({ fit: !focusRec });
    renderEpisode(ep);
    if (focusRec) {
      const rec = recsById.get(focusRec);
      if (rec?.place) {
        state.placeId = rec.place;
        refreshActiveIcons();
        flyToPlace(rec.place);
      }
    }
  }

  function selectPlace(id, { fromHash = false } = {}) {
    const place = placesById.get(id);
    if (!place) return;
    state.placeId = id;
    if (!fromHash) writeHash(`place-${id}`);
    if (!markersByPlace.has(id)) {
      state.episodeId = null;
      state.series = null;
      updateTimeline();
      renderEpisodeList();
      renderMarkers();
    }
    refreshActiveIcons();
    flyToPlace(id);
    renderPlace(place);
  }

  // ---------- details panel ----------
  function setDetails(...nodes) {
    const inner = $("details-inner");
    inner.replaceChildren(...nodes.filter((n) => n != null && n !== false));
    $("details").scrollTop = 0;
  }

  function renderOverview() {
    const eps = visibleEpisodes();
    const s = state.series != null ? data.series.find((x) => x.series === state.series) : null;
    const recs = eps.flatMap((e) => e.recommendations);
    const mapped = recs.filter((r) => r.place).length;
    const counts = {};
    for (const r of recs) if (r.place) counts[r.place] = (counts[r.place] ?? 0) + 1;
    const top = Object.entries(counts)
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    setDetails(
      el("div", { class: "eyebrow" }, s ? `Series ${s.series}` : "Every series"),
      el("h2", {}, s ? `${fmtDate(s.first)} – ${fmtDate(s.last)}` : "The dream restaurant, mapped"),
      el(
        "p",
        { class: "summary" },
        `${eps.length} episodes with published transcripts, ${recs.length} recommendations, ${mapped} of them at real places you can visit. ` +
          "Pick an episode on the left to see the guest's whole menu, or tap a pin to see why it was recommended.",
      ),
      top.length
        ? el(
            "div",
            {},
            el("h3", {}, "Recommended more than once"),
            el(
              "ul",
              { class: "menu", style: "margin-top:8px" },
              top.map(([pid, n]) => {
                const p = placesById.get(pid);
                return el(
                  "li",
                  {},
                  el("button", { type: "button", class: "ep-link", onclick: () => selectPlace(pid) }, p.name),
                  ` · ${n} recommendations`,
                );
              }),
            ),
          )
        : null,
    );
  }

  function recCard(rec, { showEpisode = false } = {}) {
    const ep = episodesById.get(rec.episode);
    const notMapped = !rec.place;
    const why = notMapped
      ? NOT_ON_MAP[rec.venue_type] ?? (rec.venue ? "Location not found" : "No particular place")
      : null;
    return el(
      "li",
      { class: `rec${rec.id === state.recId ? " is-active" : ""}`, style: courseVar(rec.course), id: `rec-${rec.id}` },
      el(
        "div",
        { class: "rec-head" },
        el("span", { class: "course" }, COURSE_LABEL[rec.course] ?? rec.course),
        rec.place
          ? el(
              "button",
              {
                type: "button",
                class: "map-link",
                onclick: () => (showEpisode ? flyToPlace(rec.place) : selectPlace(rec.place)),
              },
              showEpisode ? "Show on map" : "Open place",
            )
          : el("span", { class: "tag" }, why),
      ),
      el("p", { class: "rec-item" }, rec.item),
      rec.venue || rec.location
        ? el(
            "div",
            { class: "venue" },
            rec.venue ? el("strong", {}, rec.venue) : null,
            rec.venue && rec.location ? " · " : null,
            rec.location ? el("span", { class: "loc" }, rec.location) : null,
          )
        : null,
      rec.reason ? el("p", { class: "reason" }, rec.reason) : null,
      rec.quote
        ? el(
            "blockquote",
            { class: "quote" },
            `“${rec.quote}”`,
            rec.speaker ? el("cite", {}, `— ${rec.speaker}`) : null,
          )
        : null,
      showEpisode
        ? el(
            "div",
            { class: "venue" },
            el(
              "button",
              { type: "button", class: "ep-link", onclick: () => selectEpisode(ep.id, { focusRec: rec.id }) },
              `${epLabel(ep)}: ${ep.guest}`,
            ),
            el("span", { class: "loc" }, ` · ${fmtDate(ep.date)}`),
          )
        : null,
    );
  }

  function renderEpisode(ep) {
    const order = (c) => (COURSES.indexOf(c) + 1 || 99);
    const recs = [...ep.recommendations].sort((a, b) => order(a.course) - order(b.course));
    setDetails(
      el(
        "div",
        { class: "eyebrow" },
        `${epLabel(ep)} · Series ${ep.series} · ${fmtDate(ep.date, { day: "numeric", month: "long", year: "numeric" })}`,
      ),
      el("h2", {}, ep.guest),
      ep.title.replace(/^Ep\s*\d+:\s*/, "") !== ep.guest
        ? el("div", { class: "venue loc" }, ep.title.replace(/^Ep\s*\d+:\s*/, ""))
        : null,
      ep.summary ? el("p", { class: "summary" }, ep.summary) : null,
      recs.length
        ? el("ol", { class: "menu" }, recs.map((r) => recCard(r)))
        : el("p", { class: "empty" }, "No recommendations were extracted from this episode."),
    );
    if (state.recId) document.getElementById(`rec-${state.recId}`)?.scrollIntoView({ block: "center" });
  }

  function renderPlace(place) {
    const recs = place.recs.map((id) => recsById.get(id));
    const back = state.episodeId
      ? el(
          "button",
          { type: "button", class: "back", onclick: () => selectEpisode(state.episodeId) },
          `← ${episodesById.get(state.episodeId).guest}'s menu`,
        )
      : null;
    setDetails(
      back,
      el("div", { class: "eyebrow" }, (place.venue_type ?? "place").replace("_", " ")),
      el("h2", {}, place.name),
      el(
        "div",
        { class: "venue loc" },
        place.address,
        place.approximate ? el("span", { class: "tag", style: "margin-left:6px" }, "Approximate location") : null,
      ),
      el(
        "div",
        { class: "venue" },
        el(
          "a",
          {
            href: `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=18/${place.lat}/${place.lon}`,
            target: "_blank",
            rel: "noopener",
          },
          "Open in OpenStreetMap",
        ),
      ),
      el("h3", {}, recs.length === 1 ? "Why it's recommended" : `Recommended ${recs.length} times`),
      el("ol", { class: "menu" }, recs.map((r) => recCard(r, { showEpisode: true }))),
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
})();
