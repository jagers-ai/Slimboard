# OpenAI API photo analysis

Both saved notes and the camera lab use the OpenAI Responses API. The default is
`gpt-6-astra` with `low` reasoning (Astra Light). There is no OAuth or Codex CLI
login in the app's analysis path.

The server reads the existing `OPENAI_API_KEY`. Configure it through the secure
OpenAI Developers setup or your existing server secret manager. The key must
never be exposed through a `NEXT_PUBLIC_` variable, browser code, logs, or Git.
An ignored `.env.local` is supported for local development.

## Camera lab

Use Node.js 24 and install with `npm ci`. Run `npm run lab:start`, then open
`http://localhost:3000/lab/codex`. The old URL is retained for existing links.
Supabase is not required for this temporary camera lab; it is required for the
normal signed-in app and saved notes.

To reuse a key already in an environment file without copying it:

```bash
npm run lab:start -- --env-file /absolute/path/to/existing.env
```

Only `OPENAI_API_KEY` is loaded from that explicitly selected file, into the
server process. `npm run lab:status` checks configuration, not billing or access.

Optional server settings are `SLIMBOARD_OPENAI_MODEL` and
`SLIMBOARD_OPENAI_REASONING_EFFORT`. No automatic retries or model fallback are
performed. Images are sent directly to the Responses API with `store: false`,
strict structured output, original image detail, and a 120-second timeout.
`store: false` does not override OpenAI's other applicable data retention policies.

The camera screen accepts JPEG, PNG, or WebP up to 10 MiB after browser
normalization. Images and API responses are not written to disk by the lab.
The normal app continues to save notes and images in its existing private
Supabase storage.

## Phone testing

For temporary phone testing on a Mac, install Node.js 24 and
[cloudflared](https://developers.cloudflare.com/tunnel/downloads/), then run:

```bash
# Terminal 1, inside the repository
npm ci
npm run lab:start

# Terminal 2, inside the same repository
npm run lab:phone
```

Open the complete HTTPS invitation printed by the second command on your phone.
Choose **사진 촬영**, take a photo with the rear camera, then choose **노트 만들기**.
On desktop the same button opens a file picker. The phone's browser determines
its camera UI; the rear-camera capture attribute remains enabled.

The lab stays on `127.0.0.1:3000`. Only an authenticated invitation gateway on
`127.0.0.1:3001` is tunneled. Each invitation expires after four hours and permits
at most ten submitted analysis requests (including unsuccessful requests).
The gateway requires an exact HTTPS origin for writes, uses a signed HttpOnly,
Secure, SameSite=Strict cookie, and exposes only the camera lab and its assets.
The API key stays in the Next server; the tunnel subprocess does not inherit it.
The invite fragment is exchanged for a cookie and removed from the address bar.
The lab disables Next's React debug channel because the gateway does not expose
development WebSockets. Without that setting, Next 16.4 waits for debug data
before making the camera controls interactive.

Keep the entire invitation private. It is a bearer link: anyone receiving it can
use the remaining allowance. Keep the Mac awake and both commands running.
Ctrl+C in Terminal 2 closes phone access; rerunning it creates a new URL and
invitation. No Cloudflare account, domain, router port forwarding, or Supabase
setup is needed for this temporary lab. Cloudflare carries the HTTPS test traffic.
See [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

`localhost` on a phone refers to the phone itself. A Mac LAN IP does not bypass
the lab's loopback restriction. Normal signed-in app use and saved notes still
require Supabase and a separate production deployment.

## Validation

`npm run lab:test` covers the API request/response contract, malformed photos,
provider errors, timeouts, invitation limits, and lab access controls. `npm run typecheck`
checks the app. Tests use fake transport and do not spend API credits.

With the lab running, `npm run lab:smoke` also checks the actual HTTP server's
status, page, external Host rejection, cross-origin rejection and invalid-image
rejection. It sends no valid image and does not call the OpenAI API.

The files `scripts/codex-ocr*` and `scripts/codex-lab.mjs` retain the previous
OAuth experiment for historical comparison. They are not imported by the app.

References: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create),
[vision input](https://developers.openai.com/api/docs/guides/images-vision),
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs).
