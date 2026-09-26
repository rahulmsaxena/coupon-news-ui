// GET /api/bondsummary-list -> every archived bond summary in ONE call, labeled by
// the trading day it covers (not the day the job ran).
//
// {
//   summaries: [
//     { market_date: "2026-09-25",   // trading session the summary covers
//       key: "2026-09-26",           // storage date (bondsummary:<key>), i.e. the run date
//       generated_at: "2026-09-26T12:47:46.662Z",
//       title: "Bond Market Repricing: ...",
//       preview: "The bond market is experiencing ...",
//       summary: "<full markdown, leading # title removed>" },
//     ...newest first
//   ]
// }
//
// Reads the same bondsummary:index list and bondsummary:<date> keys that
// publishBondSummary() (Apps Script) already writes, so nothing upstream has to change.
// If the Apps Script payload ever includes "market_date", that value wins.

const MAX_DAYS = 60;

// US bond market full-day closures (SIFMA recommendation). Add new years as needed.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
]);

// Summaries generated at or after this hour (New York time) on a trading day are
// treated as covering that same day; anything earlier covers the previous session.
const SESSION_CUTOFF_HOUR_ET = 16;

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

// Date + hour of a timestamp as seen in New York.
function newYorkParts(ts) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ts)).map(p => [p.type, p.value])
  );
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function marketDateFor(payload, key) {
  const explicit = payload.market_date || payload.marketDate;
  if (typeof explicit === "string" && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  if (payload.generated_at && !isNaN(new Date(payload.generated_at))) {
    const { iso, hour } = newYorkParts(payload.generated_at);
    return (isTradingDay(iso) && hour >= SESSION_CUTOFF_HOUR_ET) ? iso : previousTradingDay(iso);
  }
  // No timestamp: assume a morning run on the stored date.
  const runDate = String(payload.date || key).slice(0, 10);
  return previousTradingDay(runDate);
}

// Title = the leading "# Heading" if the summary has one; otherwise its first sentence.
function splitTitle(markdown) {
  const md = String(markdown || "").replace(/\r\n/g, "\n").trim();
  const m = md.match(/^#\s+(.+)\n*/);
  if (m) return { title: m[1].trim(), body: md.slice(m[0].length).trim(), fromSentence: false };
  const first = md.split(/\n{2,}/)[0].replace(/\*\*|__|[*_`]/g, "").trim();
  const sentence = (first.match(/^(.{20,140}?[.!?])(\s|$)/) || [])[1];
  return { title: sentence ? sentence.replace(/[.]$/, "") : null, body: md, fromSentence: !!sentence };
}

function preview(body, skipFirstSentence) {
  if (skipFirstSentence) body = body.replace(/^[^\n]*?[.!?](\s+|$)/, "");
  const para = body.split(/\n{2,}/).find(b => b.trim() && !/^\s*(#|[-*+]\s|\d+\.\s|>|\|)/.test(b)) || body;
  const text = para.replace(/\*\*|__|[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
  return text.length > 280 ? text.slice(0, 277).replace(/\s+\S*$/, "") + "…" : text;
}

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const auth = { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } };

  try {
    const idxResp = await fetch(`${UPSTASH_REDIS_REST_URL}/lrange/bondsummary:index/0/${MAX_DAYS - 1}`, auth);
    if (!idxResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: idxResp.status });
      return;
    }
    const keys = [...new Set(((await idxResp.json()).result || []).filter(Boolean))];

    let values = [];
    if (keys.length) {
      const path = keys.map(k => encodeURIComponent(`bondsummary:${k}`)).join("/");
      const mgetResp = await fetch(`${UPSTASH_REDIS_REST_URL}/mget/${path}`, auth);
      if (!mgetResp.ok) {
        res.status(502).json({ error: "Upstash request failed", status: mgetResp.status });
        return;
      }
      values = (await mgetResp.json()).result || [];
    }

    // Build entries; if two runs cover the same trading day, keep the newer one.
    const byDay = new Map();
    keys.forEach((key, i) => {
      if (!values[i]) return;
      let payload;
      try { payload = JSON.parse(values[i]); } catch { return; }
      const { title, body, fromSentence } = splitTitle(payload.summary ?? payload.markdown ?? payload.body ?? "");
      const entry = {
        market_date: marketDateFor(payload, key),
        key,
        generated_at: payload.generated_at || null,
        title: payload.title && !/^bond (market )?summary$/i.test(payload.title) ? payload.title : (title || "Bond market summary"),
        preview: preview(body, fromSentence),
        summary: body,
      };
      const prev = byDay.get(entry.market_date);
      if (!prev || String(entry.generated_at || "") > String(prev.generated_at || "")) byDay.set(entry.market_date, entry);
    });

    const summaries = [...byDay.values()].sort((a, b) => b.market_date.localeCompare(a.market_date));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ summaries });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bond summaries", detail: String(err) });
  }
}
