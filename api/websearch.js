// GET /api/websearch?q=... -> recent news from outside the daily Coupon feed, for topics the feed
// doesn't cover. Read by the search box on point75.io/news (point75-site p75.js).
// Sources, in order: NewsData.io and Marketaux (same accounts as fetch_news.py; set NEWSDATA_API_KEY /
// MARKETAUX_API_KEY in Vercel), then GDELT (free, no key) if those return nothing.
// Results are cached at the edge for 30 minutes per query so repeat searches don't use API credits.

function withTimeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

function norm(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function gdeltDate(s) {
  // 20260929T121500Z -> ISO
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

const STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "at", "by", "with", "about", "is", "are", "what", "how", "why",
  "market", "markets", "news", "latest", "today", "update", "updates", "report"]);
function stem(w) {
  const r = w.replace(/(ilities|ility|ities|ations|ation|ity|ies|ied|ing|ers|er|ed|es|e|s|ly)$/, "");
  return r.length >= 3 ? r : w;
}
// Keep articles that actually talk about the topic: every key word (by its root) in the title or summary,
// or, if that leaves fewer than 3, at least one key word. Best matches first, then newest.
function relevant(items, q) {
  const keys = q.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(w => w && !STOP.has(w)).map(stem);
  if (!keys.length) return items;
  const scored = items.map(a => {
    const words = (a.title + " " + (a.summary || "")).toLowerCase().split(/[^a-z0-9-]+/);
    const n = keys.filter(k => words.some(w => w.startsWith(k))).length;
    return { a, n };
  });
  let keep = scored.filter(x => x.n === keys.length);
  if (keep.length < 3) keep = scored.filter(x => x.n > 0);
  return keep.sort((x, y) => (y.n - x.n) || (y.a.date || "").localeCompare(x.a.date || "")).map(x => x.a);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = String(req.query.q || "").replace(/[<>]/g, "").trim().slice(0, 80);
  if (q.length < 2) {
    res.status(400).json({ error: "Query too short" });
    return;
  }
  const enc = encodeURIComponent(q);
  const { NEWSDATA_API_KEY, MARKETAUX_API_KEY } = process.env;
  const out = [];
  const used = [];

  const jobs = [];
  if (NEWSDATA_API_KEY) {
    jobs.push(
      fetch(`https://newsdata.io/api/1/news?apikey=${NEWSDATA_API_KEY}&q=${encodeURIComponent(q.includes(" ") ? '"' + q + '"' : q)}&language=en`, { signal: withTimeout(6000) })
        .then(r => r.json())
        .then(j => {
          (j.results || []).forEach(x => out.push({
            title: x.title, url: x.link, source: x.source_name || x.source_id || "",
            date: x.pubDate ? x.pubDate.replace(" ", "T") + "Z" : null, summary: x.description || "",
          }));
          used.push("NewsData.io");
        })
        .catch(() => {})
    );
  }
  if (MARKETAUX_API_KEY) {
    jobs.push(
      fetch(`https://api.marketaux.com/v1/news/all?api_token=${MARKETAUX_API_KEY}&search=${enc}&language=en&limit=10`, { signal: withTimeout(6000) })
        .then(r => r.json())
        .then(j => {
          (j.data || []).forEach(x => out.push({
            title: x.title, url: x.url, source: x.source || "", date: x.published_at || null, summary: x.description || x.snippet || "",
          }));
          used.push("Marketaux");
        })
        .catch(() => {})
    );
  }
  await Promise.all(jobs);

  if (!out.length) {
    try {
      const g = await fetch(
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q + " sourcelang:english")}&mode=artlist&format=json&maxrecords=15&sort=datedesc&timespan=14d`,
        { signal: withTimeout(8500) }
      ).then(r => r.json());
      (g.articles || []).forEach(x => out.push({ title: x.title, url: x.url, source: x.domain || "", date: gdeltDate(x.seendate), summary: "" }));
      used.push("GDELT");
    } catch (e) { /* no results */ }
  }

  const seen = new Set();
  const clean = out
    .filter(a => a.title && /^https?:\/\//.test(a.url || ""))
    .filter(a => { const k = norm(a.title); if (seen.has(k)) return false; seen.add(k); return true; });
  const items = relevant(clean, q)
    .slice(0, 10)
    .map(a => ({ ...a, summary: String(a.summary || "").replace(/\s+/g, " ").slice(0, 280) }));

  // cache real results for 30 minutes; never cache an empty answer (a source may just have been slow)
  res.setHeader("Cache-Control", items.length ? "public, s-maxage=1800, stale-while-revalidate=3600" : "no-store");
  res.status(200).json({ q, sources: used, items });
}
