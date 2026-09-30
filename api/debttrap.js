// GET /api/debttrap -> Debt Trap snapshot written daily by fetch_debttrap.py (Finance-NewsFeed-Aggregator).
// GET /api/fedspeak -> Fed Watch, written daily by fetch_fedspeak.py (rewritten here by vercel.json as ?feed=fedspeak).
// One function serves both because the Vercel plan allows at most 12 functions. Only the keys below can be read.
const FEEDS = { debttrap: ["debttrap:latest", "Debt Trap"], fedspeak: ["fedspeak:latest", "Fed Watch"] };


export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const feed = FEEDS[req.query.feed] || FEEDS.debttrap;
  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/${feed[0]}`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();

    if (!body.result) {
      res.status(404).json({ error: `No ${feed[1]} data yet` });
      return;
    }

    const payload = JSON.parse(body.result);
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch ${feed[1]}`, detail: String(err) });
  }
}
