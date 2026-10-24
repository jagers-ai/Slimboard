# Cloud storage MVP — issues #6 and #7

## Storage and access

New records reserve an owner-scoped row using a stable browser-generated UUID,
then upload only `user/note/analysis.jpg`. Repeated upload requests resume that
record. `original_image_path` is null for new records. Migration 003 keeps all
historical originals; it does not transform or delete old records. The browser
normalizes camera/album input to a maximum 3000px JPEG; the server rotates, strips
metadata and stores a maximum 2560px JPEG at quality 86. Actual handwriting
legibility still needs representative photo review.

Lists, detail, editing, deletion, analysis and image delivery require ownership.
Photos are served by `/api/notes/:id/image` with an authenticated owner check and
`private, no-store`, rather than a reusable signed image link. The bucket stays
private. Account changes clear volatile drafts and reload the app. The local dev
identity is disabled unless explicitly opted into during development; production
cannot enable it. The lab remains loopback-only and has no cloud persistence.

Apply `supabase/migrations/003_cloud_storage.sql` before deploying this code.
The migration was applied to the existing slimboard project on 2026-10-24.
Existing records remained: 3 notes, 6 image objects, 2 users. Original files were
not removed. Two server-only operational tables intentionally have RLS with no
client policies. Existing pg_trgm schema and password-protection advisor warnings
were not changed as part of this work.

## Analysis and recovery

`claim_note_analysis` serializes requests per owner in PostgreSQL, verifies image
readiness and ownership, and rejects concurrent/uncertain requests. Default
completed-note retries return the saved result. Explicit reanalysis is a separate
user action. The initial limits are 10 dispatched attempts/hour and 30/day per
account, including failed attempts. No model or prompt changes were made.

After AI success, the server retries only the conditional DB write once. If both
writes fail, it returns an encrypted, owner/note/attempt-bound recovery receipt.
The client holds it in account-scoped memory and offers a save-only retry. The
receipt expires after seven days and depends on the existing server secret.
A repeated receipt returns an already completed record without overwriting later
human edits. Recovery never calls the model.

Limit: if the process dies before returning/persisting the result, or the browser
loses an unpersisted recovery receipt, there is no guaranteed result recovery.
An uncertain in-flight attempt is deliberately not auto-reclaimed into another
paid request. Operators must investigate before clearing an abandoned attempt;
there is no claim of exactly-once delivery across an external AI API and DB.

Deleting a note enqueues its image paths transactionally. After DB deletion, the
server removes images and acknowledges the queue entry. Cleanup failures leave
retryable work instead of a live note with missing images. To inspect/run cleanup:

```sh
node --env-file=.env.local scripts/storage-cleanup.mjs
node --env-file=.env.local scripts/storage-cleanup.mjs --apply
```

The default is dry-run. The helper consumes only queued deletions, never unrelated
historical originals. It prints counts, not paths, keys, or note content.

## Verification

- 8 added unit tests cover JPEG-only output/rotation/metadata, invalid photos,
  encrypted recovery/tampering, DB-only retries, legacy/single-image deletion,
  same-origin OAuth return paths and account-scoped draft clearing.
- `scripts/cloud-storage.integration.sql` passed on the real migrated DB inside
  a rolled-back transaction: ownership/RLS, incomplete upload, duplicate claim,
  completed retry, rate gate, restricted mutation privileges, cleanup queues.
- `node --env-file=.env.local scripts/cloud-storage.http.mjs --run` passed 17
  checks with disposable accounts and a synthetic image: authenticated upload,
  one JPEG object/no original, idempotent upload, A/B isolation, encrypted result
  save, retry after a human edit, completed analysis retry and deletion cleanup.
  All test fixtures were removed. No paid OpenAI calls were made.
- Type checking, production build, browser checks and lab smoke were run locally.
  See mobile-testing.md for the exact browser scope.

Google provider is enabled and existing production callbacks point to
`https://slimboard.vercel.app`. Local callback additions were prepared but NOT
saved, pending hosting selection. Google OAuth end-to-end, Sites/Vercel deployment,
physical-phone capture and representative handwriting quality remain to verify.
The Mac's ignored .env.local holds existing OpenAI and Supabase credentials (0600).
Never copy it into Git or a hosting archive; provision runtime secrets separately.

## Hosting review

ChatGPT Sites public access is available on the current account, and public access
is separate from in-app sign-in. No Slimboard Site was created or published.
The current Next.js Node runtime uses native Sharp and local filesystem usage logs.
Sites runs Workers/Vinext; those paths need migration and Google OAuth compatibility
needs a deployment check. Supabase HTTP access is compatible in principle.
Public access alone does not complete that port or validate the login flow.

Sources: [Sites sharing](https://learn.chatgpt.com/docs/sites/publishing-and-sharing),
[Sites management](https://learn.chatgpt.com/docs/sites/managing-a-site), and the
installed Sites runtime/identity references reviewed on 2026-10-24.
