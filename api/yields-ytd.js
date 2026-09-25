// Add alongside bondsummary.js in the same coupon-news-ui/api/ folder.
//
// GET /api/yields-ytd -> { generated_at, yields: { DGS10: { label, history: [{date, value}, ...] }, ... } }
//
// Written once a day by fetch_news.py's fetch_ytd_yields() / write_ytd_yields().

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/yields:ytd`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();

    if (!body.result) {
      res.status(404).json({ error: "No YTD yield data available yet" });
      return;
    }

    const payload = JSON.parse(body.result);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch YTD yields", detail: String(err) });
  }
}
