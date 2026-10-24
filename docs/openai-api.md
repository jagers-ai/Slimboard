# OpenAI API photo analysis

Both saved notes and the camera lab use the OpenAI Responses API. The default is
`gpt-6.1-sol` with `medium` reasoning. There is no OAuth or Codex CLI
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
Choose **앨범 선택** to use an existing photo instead. Both controls allow
selecting the same photo again after an error or cancellation.
On desktop the same button opens a file picker. The phone's browser determines
its camera UI; the rear-camera capture attribute remains enabled.

The layout supports mobile Safari and Android Chrome without device detection.
Safe-area insets protect content near display cutouts and the home indicator;
small-viewport units keep the layout stable as browser toolbars change. Zoom is
enabled, buttons wrap and stack with larger text, and reduced-motion preferences
are respected. See [mobile validation](mobile-testing.md) for the verified scope.

The lab stays on `127.0.0.1:3000`. Only an authenticated invitation gateway on
`127.0.0.1:3001` is tunneled. Each invitation expires after four hours and permits
at most ten submitted analysis requests (including unsuccessful requests).
The gateway requires an exact HTTPS origin for writes, uses a signed HttpOnly,
Secure, SameSite=Strict cookie, and exposes only the camera lab and its assets.
The API key stays in the Next server; the tunnel subprocess does not inherit it.
The invite fragment is exchanged for a cookie and removed from the address bar.
The lab disables Next's React debug channel. The gateway never forwards
development WebSocket traffic to Next. It holds an inert, authenticated HMR
connection so Next's client does not periodically reload and discard the photo.
This endpoint discards messages, accepts at most 4KiB per message, requires the
same invitation cookie and exact HTTPS Origin, and closes at session expiry.
No source, debug information, commands, or application responses pass through it.

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

## Usage and cost records

Every dispatched API analysis from the lab or saved notes app appends a JSONL
record under `~/.slimboard/usage/openai-YYYY-MM.jsonl` (UTC month). Directory
permissions are 0700; files are 0600. Photo bytes, filenames, transcription,
summaries, prompts, user identifiers, and API keys are never included.

Records contain a local accounting ID, timestamp, requested and returned model,
reasoning effort, actual response service tier, API response/request IDs,
source, completion/error code, elapsed time, and the API's actual usage counts:
input, cache read, cache write by lifetime, output, reasoning, and total tokens.
Reasoning tokens are a subset of output and are never charged twice. Invalid
model output can still be billed and is recorded with its reported usage.
Network errors and HTTP errors with no usage are recorded with null usage/cost,
not zero. Validation rejected before dispatch does not create a usage record.

```bash
npm run lab:usage
npm run lab:usage -- --json
```

The request explicitly selects Standard (`service_tier: default`). Cost uses the
response model and tier with the official rate card verified on 2026-10-24:
Sol 6.1 Standard input $2, cached input $0.10, 30m cache write $2.50, 12h cache
write $5, output $10 per million tokens. The prior Astra model is also recognized.
Rate snapshots, long-context thresholds and service-tier multipliers are stored
with each estimate. If a nonzero cache-write total lacks a lifetime breakdown,
the recorder uses this request's unchanged API default TTL of 30m and labels
that fallback. Unknown models/tiers or malformed usage leave cost null.

USD cost is calculated from actual tokens, not an invoice amount. KRW is a
reference conversion at 1,400 KRW/USD, not live exchange or the card settlement
rate; taxes and account-specific discounts are excluded. Pricing changes require
updating the rate card; existing records keep their original price snapshot.
If a file write fails, the server emits a sanitized warning and a successful
analysis reports `accounting.recorded: false` instead of discarding the result
or repeating a paid request. The camera UI remains focused on the note.

This is a durable local-Mac log. A future hosted/serverless deployment requires
persistent private storage for the same records. Past calls cannot be backfilled
from the old app because it did not retain usage.

References: [pricing](https://developers.openai.com/api/docs/pricing),
[cache-write accounting](https://developers.openai.com/api/docs/guides/prompt-caching),
[reasoning usage](https://developers.openai.com/api/docs/guides/reasoning).

References: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create),
[vision input](https://developers.openai.com/api/docs/guides/images-vision),
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs).
