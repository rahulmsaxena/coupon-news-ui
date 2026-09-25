// Vercel serverless function. Deployed alongside index.html, reachable at /api/news.
// Keeps the Upstash REST token server-side - the browser never sees it.
//
// GET /api/news            -> today's merged feed (news:latest)
// GET /api/news?date=YYYY-MM-DD -> a specific day's feed

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({
      error: "Server not configured",
      detail: "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set in the deployment's environment variables.",
    });
    return;
  }

  const date = typeof req.query.date === "string" ? req.query.date : null;
  const key = date ? `news:${date}` : "news:latest";

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();

    if (!body.result) {
      res.status(404).json({ error: `No data found for "${key}"` });
      return;
    }

    const payload = JSON.parse(body.result);

    // Cache at the edge for 5 minutes; the daily cron only writes once a day anyway.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch news", detail: String(err) });
  }
}
