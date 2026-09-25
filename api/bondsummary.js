// Add this file to the SAME Vercel project as Coupon (coupon-news-ui/api/).
// It reads the same Upstash database, just a different key, and keeps the
// token server-side exactly like api/news.js already does.
//
// GET /api/bondsummary -> { summary, generated_at }
//
// CORS note: unlike api/news.js (called from the same origin as its own
// index.html), this one gets called from point75.io - a *different*
// origin - so it needs an explicit Access-Control-Allow-Origin header or
// the browser will block the request.

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  // Lets point75.io's embedded script call this endpoint. Narrow this to
  // "https://point75.io" specifically once you've confirmed it works, so
  // only your own site can call it - "*" is fine for getting it working.
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/bondsummary:latest`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();

    if (!body.result) {
      res.status(404).json({ error: "No bond summary published yet" });
      return;
    }

    const payload = JSON.parse(body.result);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bond summary", detail: String(err) });
  }
}
