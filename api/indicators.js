// GET /api/indicators -> Economic Indicators snapshot written on weekdays by fetch_indicators.py (Finance-NewsFeed-Aggregator).
// Read by point75.io/economic-indicators (point75-site/indicators/indicators.js).


export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/indicators:latest`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();

    if (!body.result) {
      res.status(404).json({ error: "No indicator data yet" });
      return;
    }

    const payload = JSON.parse(body.result);
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch indicators", detail: String(err) });
  }
}
