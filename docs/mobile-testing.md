# Mobile camera validation

Validated locally on 2026-10-24. This is the temporary camera lab, without
Supabase or saved-note storage. Mobile layout sizes below are CSS pixels,
not claims of testing physical handsets.

## Behavior

- Separate rear-camera capture and album controls use standard file inputs on
  iOS and Android. The browser and operating system choose the native picker.
- `viewport-fit=cover` and all four safe-area insets protect the interface.
  `100svh` avoids a full-screen height based on a collapsed browser toolbar.
- The camera screen has no fixed action bar. It remains scrollable in landscape
  and with enlarged text. At normal text size, its buttons are at least 54px tall.
- Zoom remains enabled. Controls stack at 200% text size, and reduced motion
  disables smooth scrolling, shimmer, and spinner animation.
- Photo preparation keeps the browser-decoded orientation, bounds the longest
  edge to 3000px, and exports a JPEG no larger than 10MiB. Temporary canvas memory
  is released after conversion. Original photos stay on the user's device.
- HEIC/HEIF decoding depends on the browser. Safari supports it from version 17;
  unsupported or damaged files receive a short message asking for a JPG or a new
  camera photo. No universal HEIC decoder or new package has been added.

## Completed checks

| Check | Result |
| --- | --- |
| Chromium layout at 320×568, 360×740, 402×874, 412×915, 440×956 | No horizontal overflow; controls remain usable |
| Landscape layout at 874×402 | Single scrollable flow with bounded preview |
| Simulated top/bottom safe areas (59px/34px) | Applied to page padding |
| Text at 200% in a 402px viewport | Full-width stacked controls; no horizontal overflow |
| Long unbroken title/URL at 200% text | Result remains within the viewport |
| 48MP JPEG with EXIF orientation 6 | Converted to an upright 3000×2250 preview |
| Damaged JPEG | Rejected in the browser with a Korean message |
| Same photo selected twice | Both selections prepare a fresh preview |
| Simulated lost network | Korean error and retry controls remain available |
| macOS Safari upload and live API analysis | Successful, 6.0 seconds for the synthetic text fixture |
| HTTPS idle for 70 seconds after selecting a photo | Same document and photo retained; no automatic reload |
| Updated HTTPS screen, upload and live analysis | Successful, 6.3 seconds for the synthetic text fixture |

These checks do not replace physical iPhone 18 Pro or Android camera testing.
Native camera permissions, the album picker, HEIC decoding, and OS text-size
settings should be checked on the target phones. The earlier phone capture test
was confirmed by the user before this layout update; its device model was not
recorded.

The HTTPS preview also terminates Next's browser HMR connection at the gateway
without forwarding it. Blocking every upgrade caused Next to reload after
repeated failures, clearing a selected photo or completed result. Automated
checks verify authentication, Origin/Host validation, expiry, bounded messages,
and that nothing reaches the upstream app through this connection.

## Phone check after an update

Reload the full HTTPS invitation. Take a portrait photo, select a landscape
photo from the album, and create a note. Rotate the device and enlarge browser
text, then confirm that the controls and complete result remain reachable.
Cancel the picker once and select the same photo again. For supported Safari
versions, include a HEIC photo; on Android, include the camera's normal format.

References: [WebKit safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/),
[mobile viewport units](https://web.dev/blog/viewport-units),
[Safari 17 image formats](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).

## 2026-10-24 — notebook redesign

Implemented the approved white-canvas, forest-green, restrained notebook direction in the shared design system. The lab now has separate records, photo review, and note-reading stages. Its records/search are tab-memory only, with explicit refresh-loss copy and an unload warning. Saved-note routes use the same row layout and reading-first detail screen; editing remains available in a disclosure.

Verified on the Mac:

- Chromium/IAB: actual synthetic photo selection → review → OpenAI analysis → readable note → records → text search → reopen, without another analysis call. The single API request completed in 5,091 ms using gpt-6.1-sol / medium; the existing usage ledger recorded the request.
- Selected photo survives returning to records and resuming. Invalid replacement image shows a readable error while retaining the previous photo.
- Original photograph and full transcription disclosures work. Heading focus moves after stage changes; controls disable during analysis.
- Result layout at 320×568, 360×740, 402×874, 412×915, 440×956, and landscape 874×402: document width equals its scroll width. Visible buttons and disclosures have at least 48px height.
- At 320px, 200% root text plus simulated 59px top / 34px bottom safe areas: no horizontal overflow; content remains scrollable. Temporary overrides restored.
- macOS Safari: records screen, native album picker, prepared-photo preview, and enabled analysis button. Closing the test tab produced the expected unload warning. No additional paid analysis was run in Safari.
- Active protected HTTPS tunnel: new UI loaded; album upload and invalid-image recovery passed. The old tests-announces URL is obsolete. Tunnel URLs remain temporary, not deployment endpoints.
- 59 automated tests, typecheck, production build, and all 8 lab HTTP checks passed, including external Host rejection and cross-origin rejection.

Limitations: physical iPhone/Android capture was not repeated after this redesign. macOS Safari is not a physical iOS device. The saved-note Supabase screens were type/build checked, but their authenticated storage flow cannot be end-to-end tested without the separate Supabase configuration.

Local evidence (ignored by Git): `.local-checks/redesign-list.jpg`, `redesign-photo.jpg`, `redesign-note.jpg`, `redesign-tests.log`, `redesign-build.log`.

## 2026-10-24 — issues #6 / #7 implementation

Target phones: Galaxy S25+ (Chrome / Samsung Internet), iPhone 18 Pro (Safari).
The CSS sizes below are test viewports, not measured device specifications.

Implemented shared in-flow bottom navigation, safe-area layout, wrapping controls,
search label/focus/cancel target, 16px inputs, readable status colors, camera JPEG
preparation, account-scoped in-memory photo/editor drafts, and save-only recovery.
Photo pickers stay mounted when account verification temporarily hides the page.
No photo or draft is written to browser persistent storage.

Verified on local Chromium through Playwright, Node 24:
- Real CaptureUploader, NoteEditor, SearchForm and NoteDocument in a temporary
  local component harness: 320×740, 402×874, 412×915, 874×402, each at 16px and
  32px root text (200%). All 32 combinations had no horizontal overflow; visible
  buttons/links met 48px minimum height. Long unbroken editor titles included.
- Editing → other screen → editing preserved the draft. Two synchronous save
  clicks made one PATCH. A mocked save failure retained the input.
- Photo selection → editing → photo preserved the prepared photo. Two synchronous
  submit clicks made one upload and one analysis submission. A mocked result-save
  failure offered save-only retry with its receipt, without another upload.
- Browser mocks used synthetic photos and were removed. The temporary harness
  route was removed and is absent from the production build.
- Lab HTTP smoke: all 8 checks passed; no paid analysis was dispatched.

Actual Supabase verification is described in cloud-storage.md. Google OAuth
completion, phone camera/HEIC behavior, real soft keyboards/address bars,
VoiceOver/TalkBack and device font/display settings remain unverified. No physical
Galaxy S25+ or iPhone 18 Pro was connected to this Mac for this change.

## ChatGPT Sites public deployment — 2026-10-24

Deployment URL: https://slimboard-jagers.beliandeve.chatgpt.site
Source starts at original repository commit 8fdf321; Sites uses a separate checkout.

- Unauthenticated HTTP without ChatGPT cookies: landing 200; personal notes API
  401; disabled lab page/API 404. No ChatGPT login required.
- Chrome 156/macOS: real Google account selection, consent, PKCE callback and
  return to the signed-in records page succeeded.
- One synthetic, non-personal JPEG was placed into the album input with the
  supported developer testing interface. The extension's OS file-chooser upload
  was unavailable, so this does not establish OS file-picker or phone-camera behavior.
- Browser preparation -> photo review -> upload -> real OpenAI analysis ->
  completed Supabase note -> reload persisted title/summary all succeeded.
- Final successful analysis: gpt-6.1-sol/medium, 5.824 seconds, 1,990 actual
  tokens. Private D1 accounting confirmed. Original is null, exactly one
  analysis.jpg object; temporary synthetic note/image cleaned afterwards.
- One earlier call was rejected before dispatch due to an unsupported Worker
  redirect option. Another analysis completed but receipt encryption failed;
  the synthetic fixture was explicitly unlocked after diagnosis. Both runtime
  incompatibilities are fixed and reproduced in the actual workerd test.
- Deployed note view: 320x740, 402x874, 412x915 and 874x402, no horizontal overflow.
  Temporary viewport override reset after verification.
- 83 automated tests, one actual workerd integration, type checking, production
  build and 17 live deployed-site Supabase HTTP checks passed. Test accounts and
  HTTP fixtures cleaned. No private keys in tracked source or deployment archive.
- Physical iPhone/Galaxy capture, HEIC selection and handwriting legibility remain
  device acceptance tests. Browser emulation is not represented as phone testing.

Final navigation check: a production next/link lazy-import failure was reproduced
and replaced by the shared AppLink using the router hook directly. On the live
site, home -> search -> home navigation succeeded and the selected synthetic
photo remained present, with no additional AI request. The draft was cleared and
sign-out was checked after testing. This is soft navigation, not a persistence
change; photos remain memory-only until the user submits analysis.
