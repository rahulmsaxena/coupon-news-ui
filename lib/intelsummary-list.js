// Intelligent Summary list handler -- NOT DEPLOYED YET, on purpose.
//
// It lives in lib/ rather than api/ because the Vercel Hobby plan allows at most 12
// serverless functions per deployment and api/ already has 12 (see api/debttrap.js).
// Until it is wired in, /api/intelsummary-list returns 404 and the page shows its sample
// editions. To go live once the generator writes editions, either:
//   - dispatch to it from an existing function, e.g. in api/debttrap.js:
//       import intelsummaryList from "../lib/intelsummary-list.js";
//       if (req.query.feed === "intelsummary") return intelsummaryList(req, res);
//     plus a vercel.json rewrite: /api/intelsummary-list -> /api/debttrap?feed=intelsummary
//   - or move it back to api/ after upgrading the Vercel plan.
//
// GET /api/intelsummary-list -> Intelligent Summary editions, newest first, in ONE call.
//
// { summaries: [ { market_date: "2026-10-02", key: "2026-10-02", edition: "close",
//                  generated_at, title, regime, conviction, takeaway, tape, fed, cross,
//                  drivers, macro, geo, events, interpretation, watch, sources }, ... ] }
//
// Storage (same Upstash database as Bond Summary, its own key prefix, so nothing that
// Bond Summary reads or writes is touched):
//   intelsummary:index   list of edition keys, newest first (LPUSH by the generator)
//   intelsummary:<key>   one edition as JSON, in the format documented in
//                        intellegent-summary/index.html ("EDITION FORMAT")
//
// Read-only. Until the generator writes editions this returns { summaries: [] } and the page
// shows its built-in sample editions.
//
// Optional query: ?limit=N (default 120, max 500) so the page history can grow past the
// 60-day window the Bond Summary list uses.

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 500;

// US bond market full-day closures (SIFMA recommendation). Kept in step with
// api/bondsummary-list.js; add new years to both.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
]);
const SESSION_CUTOFF_HOUR_ET = 16;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isoFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function isTradingDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(iso);
}
function previousTradingDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  do { t.setUTCDate(t.getUTCDate() - 1); }
  while (!isTradingDay(isoFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())));
  return isoFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function newYorkParts(ts) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ts)).map(p => [p.type, p.value])
  );
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// The trading day an edition covers. The generator should always send market_date;
// the fallbacks match Bond Summary's rules.
export function marketDateFor(payload, key) {
  if (typeof payload.market_date === "string" && ISO_DAY.test(payload.market_date)) return payload.market_date;
  if (payload.generated_at && !isNaN(new Date(payload.generated_at))) {
    const { iso, hour } = newYorkParts(payload.generated_at);
    return (isTradingDay(iso) && hour >= SESSION_CUTOFF_HOUR_ET) ? iso : previousTradingDay(iso);
  }
  const k = String(key).slice(0, 10);
  return ISO_DAY.test(k) ? k : null;
}

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const asked = parseInt(req.query && req.query.limit, 10);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
  const auth = { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } };

  try {
    const idxResp = await fetch(`${UPSTASH_REDIS_REST_URL}/lrange/intelsummary:index/0/${limit - 1}`, auth);
    if (!idxResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: idxResp.status });
      return;
    }
    const keys = [...new Set(((await idxResp.json()).result || []).filter(Boolean))];

    let values = [];
    if (keys.length) {
      const path = keys.map(k => encodeURIComponent(`intelsummary:${k}`)).join("/");
      const mgetResp = await fetch(`${UPSTASH_REDIS_REST_URL}/mget/${path}`, auth);
      if (!mgetResp.ok) {
        res.status(502).json({ error: "Upstash request failed", status: mgetResp.status });
        return;
      }
      values = (await mgetResp.json()).result || [];
    }

    // One entry per trading day and edition; a later run for the same day replaces the earlier one.
    const byDay = new Map();
    keys.forEach((key, i) => {
      if (!values[i]) return;
      let payload;
      try { payload = JSON.parse(values[i]); } catch { return; }
      if (!payload || typeof payload !== "object") return;
      const market_date = marketDateFor(payload, key);
      if (!market_date) return;
      const edition = payload.edition === "morning" ? "morning" : "close";
      const entry = Object.assign({}, payload, { market_date, key, edition, generated_at: payload.generated_at || null });
      const slot = `${market_date}|${edition}`;
      const prev = byDay.get(slot);
      if (!prev || String(entry.generated_at || "") > String(prev.generated_at || "")) byDay.set(slot, entry);
    });

    const summaries = [...byDay.values()].sort((a, b) =>
      b.market_date.localeCompare(a.market_date) || (a.edition === "close" ? -1 : 1));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ summaries });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Intelligent Summary editions", detail: String(err) });
  }
}
