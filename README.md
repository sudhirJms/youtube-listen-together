# YouTube Listen Together

Free-first Cloudflare Worker + Durable Object synchronized YouTube rooms.

## Run
1. `npm install`
2. `npx wrangler login`
3. `npm run dev`
4. `npm run deploy`

The Worker serves the static PWA and `/room/<code>` WebSockets. Durable Objects hold ephemeral room state.

### Important
- YouTube media is never downloaded, proxied, scraped, or re-hosted.
- The official IFrame Player API plays videos in each browser.
- For production, review Cloudflare account limits and configure a custom domain in the Cloudflare dashboard.
- Optional YouTube Data API search is intentionally omitted; pasted URLs work without an API key.
- Password verification and approval-mode workflows can be expanded without exposing secrets; this starter enforces authorization for private/invite rooms.
