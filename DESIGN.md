# Slimboard Mobile Design

Direction: a clear working notebook. Photographs and readable records carry the identity.
The approved October 24, 2026 concept uses three stages: records, photo review, and a readable note.

## Scope and implementation

This is the shared design contract for all Slimboard user-facing pages and features,
including the camera lab and the signed-in application. Read it before UI work;
`AGENTS.md` defines the implementation and verification obligations.

- Reuse the shared variables and foundations in `app/globals.css`, notebook patterns
  in `app/notebook.css`, and existing components under `components/`. For example,
  `NoteDocument` is the shared note-reading view and `components/camera/` contains
  the camera flow's screen parts.
- Existing CSS has legacy variable names: `--blue` and `--blue-dark` currently mean
  the primary deep green (`#205943`), not a separate blue palette. Use the existing
  tokens consistently; do not introduce a second palette based on their names.
- An old screen or isolated hard-coded value does not override this document.
  When touching an inconsistent area, align the affected UI with these rules and
  check its shared consumers without expanding into an unrelated redesign.
- Extend shared patterns for new features. Document a reusable addition here in
  the same change; keep design-direction changes within the user's requested scope.
- Include applicable empty, loading, error, retry, and disabled states. State
  what happened and provide a clear next action; preserve recoverable user input.

## Visual system

- White canvas, near-black text (`#18221d`), muted secondary text (`#68716c`), thin dividers (`#e4e8e5`).
- Deep green (`#205943`) is reserved for primary actions and focus indicators.
- Use the platform system sans-serif; no external font dependency. Body 16px with generous line height, headings 28–30px and weight 600.
- Small 4–6px corners, no card shadows, decorative gradients, sparkle icons, or colorful keyword pills.
- One mobile column, 480px maximum normally, 24px side gutters (16px on small screens).
- Lists use photographic thumbnails and fine row dividers. Results read like a document, not a form.

## Flow and controls

- Records: search, actual records, primary photo capture, secondary album selection. Never seed fake records.
- Review: large uncropped photo, clear reselect/back controls, one primary `변환` action, with `사진 첨부` for album/file selection.
- Result: editable title, analysis photo with download, then an initially open editable full transcription. Summary comes below as a collapsed disclosure. Keywords remain stored and searchable but are not rendered.
- Saved notes are a continuous editable document, not a separate `노트 수정` form. Use borderless auto-growing fields, a top-right `저장` action, and quiet reanalysis/deletion actions. Keep explicit labels, visible focus and pending/error/draft behavior.
- The standalone lab keeps records only in React memory for the current tab. State this plainly. Do not imply permanent storage or add sensitive photos to browser storage.
- Keep selected photos on failure or when returning to the list. Warn about accidental page unload when there is session content.

## Mobile and accessibility

- Support Safari/iOS and Chrome/Android through responsive layout, not device detection.
- Keep camera capture and album inputs separate. Preserve client image preparation and orientation handling in the lab.
- Honor all four safe-area insets, allow zoom, use at least 48px touch targets and 16px form fields.
- Keep actions in normal document flow with a flex spacer: no overlay hiding content when the keyboard opens or text grows.
- Allow 200% text and long content to wrap; landscape remains scrollable.
- Use visible keyboard focus, real labels, live status, disabled actions during work, and focus the heading on stage changes.
- Respect reduced motion. Do not add fake OS chrome or model/authentication explanations to the product screen.

## Verification boundary

Responsive browser checks do not establish physical phone behavior. Record the exact browser, viewport sizes, and tested flow in `docs/mobile-testing.md`. Report device capture separately.

## Saved records and mobile navigation

- Saved records use one analysis JPEG for preview and detail; label the disclosure `사진 보기`. Never promise original resolution or automatic photo-library saving.
- Keep the shared bottom navigation in normal document flow. It must not cover editing controls with a keyboard or 200% text.
- Photo and editor drafts are account-scoped memory only, retained through in-app navigation and cleared on sign-out. Failed result saves offer `노트 저장 다시 시도`, which must not start another AI request.

## Signed-out home layout

Keep the brand and introduction top-aligned with a shared left gutter. Use a
28px header-to-introduction gap and content-sized hero; no fixed-height hero
or bottom alignment inside it. Leave flexible space below the feature list
and above the bottom navigation, which remains in normal document flow.

## KakaoTalk entry

On mobile KakaoTalk entry, show a compact external-browser guidance screen
before the normal app UI: Safari on iOS, Chrome on Android. Detection is only
a UI hint, never an authentication or authorization check. Browser switching
requires a tap; do not auto-redirect or transfer login codes/session tokens.
Offer default-browser handoff, link copying and selectable-address recovery.
Regular browsers keep the existing flow. Physical-device app switching remains
a separate acceptance check from browser emulation.
