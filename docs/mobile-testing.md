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

## Editable document UI — 2026-10-25

Approved preview applied: conversion action `변환`, file action `사진 첨부`,
borderless auto-growing title and raw-text inputs, explicit top-right Save,
raw text initially open, summary below it initially collapsed, no separate edit
panel. Keywords are hidden in the document and editor but remain in stored data
and search_text. Analysis-image download uses the existing owner-checked image
endpoint with attachment disposition, private no-store caching and no public URL.

Chrome local preview checked at 320x740, 402x874, 412x915 and 874x402 with 16px
and 32px root text: no horizontal overflow, no clipped title/raw text, controls
at least 48px high. Summary expansion resizes its field correctly. An anonymous
Save failure retained the changed title; the fixture never touched user data.
An observed ResizeObserver feedback warning was fixed by scheduling resize in
an animation frame and observing a font-sized measure element for text zoom.
The temporary preview route and synthetic public image were removed before build.

23 live Supabase HTTP checks passed, including owner download, other-account
404, anonymous 401, and hidden keyword search after editing/recovery replay.
83 automated checks and one actual Worker runtime integration passed. No AI
analysis calls were needed for this UI change. Physical device camera behavior
is outside this desktop verification.

## Signed-out home spacing — 2026-10-25

Scoped the approved top-aligned landing layout to `.landing-shell`. Removed the
360px minimum-height/bottom-aligned hero and extra horizontal hero/feature padding.
Brand, introduction and features now share a gutter. Header gap is 28px; flexible
space goes below the features, before the normal-flow bottom navigation.

Chrome local preview: 320x740, 402x874, 412x915 and 874x402 at 16px and 32px
root text (8 combinations). All have matching left alignment, a 28px header gap,
no horizontal overflow, >=48px controls, and navigation below the feature list.
No authentication, API, saved-note or signed-in records behavior changed.

## 카카오톡 외부 브라우저 안내 — 2026-10-25

- 모바일 User-Agent의 KAKAOTALK 표식과 OS를 확인해 안내 화면을 표시한다.
  일반 Safari·Chrome·삼성 인터넷과 데스크톱에서는 기존 화면을 유지한다.
- iOS HTTPS: 사용자 클릭으로 `x-safari-https:` Safari 실행을 시도한다.
  이 주소 방식은 모든 iOS/카카오톡 버전에서 보장되는 공개 표준이 아니므로
  카카오톡 기본 브라우저 열기와 링크 복사·수동 주소 선택을 함께 제공한다.
- Android: `intent:`에서 Chrome 패키지를 지정한다. 실행되지 않으면 동일
  사이트의 도움말 화면으로 돌아오는 fallback을 제공한다. 기본 브라우저
  열기는 삼성 인터넷을 포함한 사용자의 설정을 따를 수 있다.
- 페이지 진입만으로 앱을 실행하지 않는다. 외부 브라우저에서는 홈페이지부터
  로그인을 다시 시작하며 인증 코드·토큰·원래 쿼리·개별 노트 주소를 전달하지 않는다.
- 검증: 관련 단위 검사 7개 포함 자동 검사 총 90개, 타입 검사 통과.
  Chrome에서 iOS/Android 카카오톡 User-Agent를 모사하여 안내 분기 확인.
  320x740, 402x874, 412x915, 874x402 × 글자 16/32px × OS 2종의 16개 조합에서
  가로 넘침 없음, 표시되는 조작 요소 높이 48px 이상. 도움말 펼침도 포함한다.
- 링크 복사 성공, 클립보드 실패를 모사했을 때 수동 복사 입력란 표시,
  `externalBrowser=help`로 돌아왔을 때 도움말 자동 펼침을 확인했다.
- 미검증: 실제 아이폰/갤럭시 카카오톡에서 Safari/Chrome 앱으로 전환,
  Chrome 미설치 상태의 실제 fallback, 외부 브라우저 로그인·촬영·분석·저장.
  브라우저 식별 정보 모사는 해당 실기기 검증을 대체하지 않는다.
- 참고: https://developer.chrome.com/docs/android/intents
  https://devtalk.kakao.com/t/ios-url-scheme/140411
  https://bugzilla.mozilla.org/show_bug.cgi?id=1986355

## 홈 촬영 전용 화면과 상시 하단 메뉴 — 2026-10-25

- 홈의 기록 조회·목록·검색을 제거하고 촬영/사진 첨부 및 선택한 사진 확인에
  집중한다. 기록 목록과 검색 진입은 노트 탭에 표시한다.
- AppFrame에서 본문 스크롤 영역과 하단 메뉴 영역을 분리한다. 사진, 긴 목록,
  긴 편집 문서가 메뉴 아래로 겹치지 않는다. visualViewport의 크기 변화에
  맞춰 높이를 갱신하고, 핀치 확대 중에는 레이아웃을 재배치하지 않는다.
- 로컬 임시 화면에서 실제 CaptureUploader, NoteList, NoteEditor, AppFrame을
  사용해 Chrome 320x740, 402x874, 412x915, 874x402 × 글자 16/32px × 3개 상태
  (사진 확인/긴 목록/긴 편집 문서), 총 24개 조합을 검사했다.
  모든 조합에서 하단 메뉴가 보이고 본문과 겹치지 않으며 가로 넘침이 없었다.
  일반 글자 크기의 세로 화면 3종에서 변환 버튼이 첫 화면에 보였다.
  가로 화면과 200% 글자에서는 본문을 스크롤해 조작한다.
- 사진 선택은 테스트용 File/변경 이벤트로 모사했다. 임시 노트 화면으로
  앱 내부 이동 후 돌아와도 선택한 사진이 유지되는 것을 확인했다.
  402x420으로 표시 영역을 줄이고 제목 입력에 포커스를 둔 검사도 통과했다.
- 임시 검사 페이지는 빌드 전에 삭제했다. 시험 데이터를 DB에 저장하거나
  실제 사진 분석 API를 호출하지 않았다. 실제 아이폰·안드로이드의 키보드,
  주소창 높이 변화, 재촬영 및 사진 선택은 별도 실기기 확인이 필요하다.
