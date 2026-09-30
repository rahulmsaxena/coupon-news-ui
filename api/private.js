// GET /api/private -> owner-only licensed data written daily by fetch_private.py
// (Finance-NewsFeed-Aggregator): ICE BofA credit spreads and the Freddie Mac mortgage rate.
//
// These series may NOT be shown publicly (ICE: "for your internal use only"), so this endpoint
// only answers when the request carries the password set in the Vercel env var PRIVATE_VIEW_TOKEN:
//   Authorization: Bearer <PRIVATE_VIEW_TOKEN>
// No CORS header on purpose: only private.html on this same site can call it from a browser.
// If PRIVATE_VIEW_TOKEN is not set, the endpoint is closed to everyone.

import { createHash, timingSafeEqual } from "node:crypto";

function same(a, b) {
  const h = s => createHash("sha256").update(String(s)).digest();
  return timingSafeEqual(h(a), h(b));
}

export default async function handler(req, res) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, PRIVATE_VIEW_TOKEN } = process.env;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const auth = String(req.headers.authorization || "");
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!PRIVATE_VIEW_TOKEN || PRIVATE_VIEW_TOKEN.length < 12 || !given || !same(given, PRIVATE_VIEW_TOKEN)) {
    await new Promise(r => setTimeout(r, 800)); // slow down password guessing
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    const r = await fetch(`${UPSTASH_REDIS_REST_URL}/get/private:latest`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } });
    if (!r.ok) {
      res.status(502).json({ error: "Upstash request failed", status: r.status });
      return;
    }
    const body = await r.json();
    if (!body.result) {
      res.status(404).json({ error: "No private data yet. Run the 'Private data' workflow once." });
      return;
    }
    res.status(200).json(JSON.parse(body.result));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch private data" });
  }
}
