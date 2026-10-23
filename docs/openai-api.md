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

The capture button requests the rear camera on supported phones. Test the normal
signed-in app over HTTPS for mobile use. `localhost` on a phone refers to the
phone itself, not the Mac. The standalone lab remains loopback-only and is not
an unauthenticated public API. A phone-accessible deployment needs the server
key configured privately and the normal Supabase sign-in.

## Validation

`npm run lab:test` covers the API request/response contract, malformed photos,
provider errors, timeouts, and existing lab access controls. `npm run typecheck`
checks the app. Tests use fake transport and do not spend API credits.

The files `scripts/codex-ocr*` and `scripts/codex-lab.mjs` retain the previous
OAuth experiment for historical comparison. They are not imported by the app.

References: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create),
[vision input](https://developers.openai.com/api/docs/guides/images-vision),
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs).
