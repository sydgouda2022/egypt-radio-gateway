# Egypt Radio Gateway (audited version 2)

This Cloudflare Worker gives The Radio App a stable URL for **public direct audio** only. A player page, Dailymotion metadata, HTTP 200 by itself, and a radio site's pause button are not evidence of playable audio.

Endpoints:
- / — discover actual radio stations, not television channels; candidate streams are explicitly marked unverified
- /api/stations — radio-only registry
- /health/general — *live* checks of HTTP status, MIME type **and audio bytes**; no cached false positives
- /stream/general — validated MP3/AAC/OGG upstream streamed with backpressure over HTTPS, or HTTP 503 plain text if all sources fail
- /api/sync-status — latest scheduled official catalogue scan

**There is no confirmed working General Program upstream yet.** Previous hosts returned HTTP 526, 404 and timeouts. The candidate URLs must pass live validation; neither the presence of a route nor a successful Cloudflare deployment means audio is playable. The gateway intentionally does not circumvent Dailymotion authorization or domain restrictions.

The D1 database is bound as DB in wrangler.jsonc; the Worker creates its own tables on first use. Scheduled scans run every six hours. A malformed catalogue scan makes no changes. Missing stations are marked unavailable after three valid scans and retired after seven days, without deleting IDs or changing their slugs.

GitHub main is connected to Cloudflare Workers Builds; commits deploy via npx wrangler deploy. Run npm test and npm run check (Node 22+) for local validation.
