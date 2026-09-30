// GET /api/fedspeak -> Fed Watch (Fed Board speeches scored hawkish/dovish), written daily by fetch_fedspeak.py (Finance-NewsFeed-Aggregator).


export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const upstreamResp = await fetch(
      `${UPSTASH_REDIS_REST_URL}/get/fedspeak:latest`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } }
    );

    if (!upstreamResp.ok) {
      res.status(502).json({ error: "Upstash request failed", status: upstreamResp.status });
      return;
    }

    const body = await upstreamResp.json();

    if (!body.result) {
      res.status(404).json({ error: "No Fed Watch data yet" });
      return;
    }

    const payload = JSON.parse(body.result);
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Fed Watch", detail: String(err) });
  }
}
