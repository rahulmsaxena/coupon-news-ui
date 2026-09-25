// GET /api/dates -> { dates: ["2026-09-24", "2026-09-23", ...] } newest first,
// backed by the news:index list the fetch script maintains.

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/lrange/news:index/0/59`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ dates: body.result || [] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch dates", detail: String(err) });
  }
}
