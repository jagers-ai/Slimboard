# Code review and modularization — 2026-10-24

Reviewed baseline: `bbcb3223a62b0babd1d70c747b257f383e4ed603`.
Scope: the new camera/records/notebook flow, shared note UI, client photo lifetime, and saved-note mutation paths used by those screens. This is not a complete deployment security audit.

## Findings fixed

| Priority | Finding | Change |
| --- | --- | --- |
| P1 | `deleteNoteForUser` accepted a workspace-readable note and removed its images before the owner-filtered database delete. A non-owner could delete photos even though the note row did not match. A database failure could also leave a visible note with missing originals. | Check ownership first, confirm the owner-filtered row was actually removed, then clean up images. Failure/zero-row tests prove images are untouched. |
| P1 | Saved-note reanalysis checked read access and ignored the initial owner-filtered update result before calling the paid analysis API. | Require ownership and a successful processing-state write before downloading/analyzing. The UI only offers mutations to the owner, matching the existing server write filters. |
| P2 | Lab state reused one `file` for both the unfinished draft and the open record. Opening an old record silently replaced the new photo. | Explicit session reducer keeps `draft`, `notes`, and `view` independent; visiting records never changes the draft. |
| P2 | React state alone guarded analysis/upload submission. Multiple events before a render could pass the same stale `busy` guard. | A synchronous ref lock prevents a second operation until the first settles. Browser regression issued two clicks in one event-loop turn and observed one POST. No automatic API retry was introduced. |
| P2 | The UI trusted any successful JSON response; malformed analysis fields could fail rendering/search. | A client API module validates the display payload before creating a record and normalizes invitation/quota failures regardless of response content type. |

## Structure

- `components/CodexLab.tsx`: screen composition and input/focus wiring (61 lines, previously 223).
- `components/camera/`: header, records, photo review, and actions.
- `hooks/useCameraSession.ts`: readiness checks, single-operation execution, abort/unmount handling, and unload protection.
- `lib/camera-session.ts`: explicit state transitions, indexed search, and session note creation; testable without the browser.
- `lib/camera-api.ts`: HTTP boundary and validated result shape; injectable fetch for tests.
- `components/NoteDocument.tsx`: one reading view shared by the lab and server-rendered saved notes.
- `hooks/useObjectUrl.ts`: shared preview URL allocation/revocation, including the saved-photo uploader; a changed source cannot momentarily show the previous image.
- `lib/note-date.ts`: reusable date formatters with an explicit Korea time zone.
- `lib/note-mutations.ts`: ownership boundary and deletion ordering, isolated for failure-path tests.
- `app/notebook.css`: notebook-specific styles separated from global foundations, preserving import order and appearance.

## Optimization boundaries

Searchable text is built once when a note is created; the normalized query is computed once per filter and filtered results are memoized. Empty queries reuse the existing array. The list does not allocate the full-screen preview URL; thumbnail URLs are released when unmounted and thumbnails use lazy loading. Date formatter instances are reused. Session records retain only analysis display fields, not extra API metadata. No dependency was added and no API model, prompt, pricing, image quality, or analysis policy was changed.

These are structural and work-reduction improvements. No percentage speedup or lower model latency is claimed without a benchmark.

## Verification

- 15 new automated regression tests; 74 total passed.
- Typecheck and production build passed.
- All 8 lab HTTP smoke checks passed, including external Host, cross-origin, and invalid-image rejection.
- Browser regression used a test-only mocked POST response (no additional paid API request): two synchronous clicks produced exactly one POST; original record image remained 1600×1000, and the new rotated-photo draft remained 3000×2250 after visiting that record and resuming review.
- Existing design and mobile layouts were checked after CSS extraction; no horizontal overflow at 320px and 402px.
- Test-only browser fetch instrumentation was removed after verification.

## Remaining boundaries

- Supabase is not configured in this Mac lab. Ownership/deletion behavior is covered with dependency-based failure tests plus static/type/build checks; it still needs an authenticated Supabase integration run before deployment.
- Database deletion and storage cleanup are not one transaction. If storage cleanup fails after a confirmed row deletion, the operation reports note deletion success and emits a sanitized operational warning; unreferenced storage objects need separate cleanup. This avoids deleting photographs while their database record remains visible.
- Session-only lab records still disappear on reload. Browser unload prompts are best-effort, particularly on phones.
- Physical iPhone/Android capture was not repeated for this refactor.
