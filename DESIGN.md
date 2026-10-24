# Slimboard Mobile Design

Direction: a clear working notebook. Photographs and readable records carry the identity.
The approved October 24, 2026 concept uses three stages: records, photo review, and a readable note.

## Visual system

- White canvas, near-black text (`#18221d`), muted secondary text (`#68716c`), thin dividers (`#e4e8e5`).
- Deep green (`#205943`) is reserved for primary actions and focus indicators.
- Use the platform system sans-serif; no external font dependency. Body 16px with generous line height, headings 28–30px and weight 600.
- Small 4–6px corners, no card shadows, decorative gradients, sparkle icons, or colorful keyword pills.
- One mobile column, 480px maximum normally, 24px side gutters (16px on small screens).
- Lists use photographic thumbnails and fine row dividers. Results read like a document, not a form.

## Flow and controls

- Records: search, actual records, primary photo capture, secondary album selection. Never seed fake records.
- Review: large uncropped photo, clear reselect/back controls, one primary `내용 정리` action.
- Result: title and summary first; original image, full transcription, and keywords are disclosures.
- Saved notes expose editing through `노트 수정`; existing save, reanalysis, and deletion behavior remains available.
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
