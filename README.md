# Egypt Radio Gateway

Cloudflare Worker that exposes stable station URLs for The Radio App.

- The official Maspero station catalogue is discovered live, so stations added or removed by Maspero appear automatically.
- `/stream/general` currently redirects to the verified public Zeno relay for **إذاعة البرنامج العام**.
- Dailymotion provider IDs are discovered from official Maspero station pages, but provider-restricted signed HLS URLs are not republished as unrestricted streams.
- `/health/<slug>` reports the currently known source state.

Deploy with Cloudflare Workers Builds or `npm install && npx wrangler deploy`.
