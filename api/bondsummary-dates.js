// Add alongside bondsummary.js in the same coupon-news-ui/api/ folder.
//
// GET /api/bondsummary-dates -> { dates: ["2026-09-25", "2026-09-24", ...] }
// newest first, backed by the bondsummary:index list publishBondSummary()
// maintains in Apps Script.

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/lrange/bondsummary:index/0/89`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ dates: body.result || [] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch dates", detail: String(err) });
  }
}
