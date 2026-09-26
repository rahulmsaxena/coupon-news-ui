# Coupon — daily rates/bonds briefing UI

A static page + two tiny serverless functions that read the feed your
`fetch_news.py` script writes to Upstash Redis. Deploys free on Vercel.

## Why a serverless function instead of the browser talking to Upstash directly
A page published straight to the browser would need to embed your Upstash
token in client-side JavaScript for anyone who loads the page to see (view
source, browser devtools). Routing reads through `/api/news` and `/api/dates`
keeps `UPSTASH_REDIS_REST_TOKEN` server-side only, set as an environment
variable in Vercel's dashboard, never shipped to the browser.

## Files
```
index.html      - the whole frontend (HTML + CSS + JS, no build step)
api/news.js     - GET /api/news[?date=YYYY-MM-DD] -> that day's articles
api/dates.js    - GET /api/dates -> available dates for the date picker
bond_summary.html          - Bond Summary page (chart, headline list, single-page reader)
api/bondsummary-list.js    - GET /api/bondsummary-list -> all bond summaries in one call,
                             labeled by the trading day they cover (market_date), not the
                             run date. Honors a "market_date" field if Apps Script sends one.
api/bondsummary.js, api/bondsummary-dates.js, api/yields-ytd.js - unchanged
package.json    - minimal, no dependencies (uses the platform's built-in fetch)
```

## Deploy to Vercel (free)

### Option A: Vercel CLI
```bash
npm install -g vercel
cd coupon-news-ui
vercel
```
Follow the prompts (link or create a project). This deploys a preview first;
run `vercel --prod` once you're happy with it.

### Option B: GitHub + Vercel dashboard (recommended if you want auto-deploys)
1. Push this folder to a GitHub repo (can be the same repo as your fetch
   script, or a separate one — either works).
2. Go to [vercel.com](https://vercel.com) → New Project → import that repo.
3. Framework preset: choose "Other" / leave as static — no build command
   needed, Vercel auto-detects the `api/` folder as serverless functions.
4. Deploy.

Either way, every future `git push` redeploys automatically if you used
Option B.

## Required environment variables
In the Vercel project → Settings → Environment Variables, add the same two
Upstash values your Python script uses:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

These only need to be set once. No Marketaux/NewsData keys are needed here —
this UI only reads what the daily script already wrote to Redis.

### Use a read-only token if you can
Upstash lets you generate a separate **read-only** REST token per database,
in addition to the main read-write one. If you generate one, use it here
instead of the main token — this page never needs to write to Redis, so a
read-only token limits what's exposed if it were ever compromised. (Your
`fetch_news.py` script and its GitHub secret should keep using the
read-write token, since it needs to write.)

## Local testing before deploying
```bash
npm install -g vercel
cd coupon-news-ui
vercel dev
```
This runs the static page and the serverless functions locally (reading
from a local `.env` file if you create one with the two Upstash vars),
so you can check it before pushing anything live.

## What you get
- A single-column briefing page: headline, source, region, relative time,
  summary, linking out to the original article.
- Filter by region, filter by source, free-text search — all client-side,
  instant, no reload.
- A date picker backed by `news:index`, so you can look back at previous
  days once a few runs have accumulated.
- A "Refresh" button, plus 5-minute edge caching on the API responses so
  repeat visits are fast without hammering Upstash.

## Once deployed
Vercel gives you a URL like `https://coupon-news-ui.vercel.app` — that's
your "access it from anywhere" link. Bookmark it, add it to your phone's
home screen, whatever's convenient. No further hosting cost as long as
you're on Vercel's free (Hobby) tier, which comfortably covers a
single-reader personal dashboard like this.

## Next refinements, whenever you want them
- A "days ago" grouping / section headers instead of one flat list
- Tag-based filtering (the articles already carry `tags` from the source config)
- A lightweight auth gate if you ever want to share the link without making
  it fully public
