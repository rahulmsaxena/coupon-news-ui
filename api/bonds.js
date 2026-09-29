// GET /api/bonds -> every outstanding Treasury with curve-based estimates, written on weekdays by fetch_bonds.py (Finance-NewsFeed-Aggregator).
// Read by point75.io/bonds (point75-site/bonds/bonds.js).


export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/bonds:latest`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();

    if (!body.result) {
      res.status(404).json({ error: "No bond data yet" });
      return;
    }

    const payload = JSON.parse(body.result);
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bonds", detail: String(err) });
  }
}
