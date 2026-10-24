# ChatGPT Sites deployment

This deployment is based on jagers-ai/Slimboard commit
8fdf321e7667dda1360b602cc9d6b77074660194 (experiment/chatgpt-plan-ocr).
The original Mac checkout is preserved. This checkout runs the same app through
Vinext and the supported Sites Worker integration.

## Audience and identity

The Site audience is public. ChatGPT sign-in is not required. Personal note
access uses the existing Supabase Google OAuth/PKCE session and owner checks.
The exact permitted callback is
https://slimboard-jagers.beliandeve.chatgpt.site/auth/callback.
No private API key is sent to the browser. Runtime values are Sites secrets;
only Supabase's public URL/publishable key are compiled into browser assets.
Local .env.local/.dev.vars and outputs are ignored and never published.

## Hosting adaptations

- Browser canvas decodes/orients input and resizes to a 2560px maximum edge,
  using JPEG quality .86 (then .8/.7 only if needed to stay below 10 MiB).
- Server validates JPEG structure/dimensions, strips APP/COM metadata, and
  stores that analysis image only. Original camera/album files are not stored.
  Native Sharp is not part of the Worker runtime.
- AI token/cost accounting uses a private D1 table, not an ephemeral filesystem.
  It stores the existing metadata-only record without photos, note content,
  prompts, account identifiers or keys. No public route exposes this table.
- Model gpt-6.1-sol, medium reasoning, Standard tier, no automatic paid retries.
- Existing Supabase notes, ownership filters, encrypted recovery receipts,
  request limits and deletion queue remain in place.

## Verification

2026-10-24: 82 automated tests passed, including the image and durable usage
adaptations. Actual built Worker on loopback passed 17 live Supabase checks
(upload, idempotence, owner image access, other-account denial, receipt recovery,
edit preservation and deletion); disposable fixtures were cleaned, no AI calls.
Type checking and the production Worker build passed. Original repo changes
remain untouched. Physical iPhone/Galaxy camera testing is separate from
browser testing and is not established by viewport simulation.

Worker fetch uses manual redirects and rejects non-2xx responses, so credentials
are not forwarded to another destination. A local workerd reproduction confirmed
that the original redirect:error option throws before sending a request.

The recovery cipher accepts explicit UTF-8 bytes for Worker/Node compatibility.
`npm run test:sites-runtime` exercises actual workerd request construction,
structured analysis parsing, D1 accounting and receipt encryption/decryption
with a fake provider response (no paid API call).
