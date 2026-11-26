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

## 사진 확대 보기 — 2026-10-25

- PhotoZoom 공통 컴포넌트를 사진 확인, 저장 노트, 카메라 실험실에 적용.
  한 번 눌러 화면 전체로 열고, 확대/축소/화면 맞춤 및 닫기를 제공한다.
  처음에는 너비 맞춤, 최대 화면 맞춤 비율의 6배까지 확대한다.
- native dialog로 배경과 하단 메뉴를 비활성화하고 사진만 확대한다.
  닫으면 기존 스크롤 위치·사진 초안을 유지하고 호출 버튼으로 포커스를 돌린다.
- Chrome 로컬에서 저장 노트 사진 및 선택한 분석 이미지(blob)로 열기 확인.
  확대/축소 시 실제 크기 변화, 마우스 드래그 이동, 화면 맞춤 시 전체 이미지
  표시, 닫기 후 스크롤 위치 동일 및 포커스 복원, Escape 닫기, 모달 내 Tab 확인.
- 320x740 / 402x874 / 412x915 / 874x402 × 글자 16/32px의 8개 조합에서
  헤더·하단 조작 노출, 이미지와 조작 영역 분리, 48px 이상 터치 높이,
  가로 넘침 없음, 화면 맞춤 시 전체 이미지 표시를 확인했다.
- 이미지 404 오류와 재시도 후 정상 로드 복구 확인. 선택한 사진을 확대해도
  업로드·분석은 실행하지 않는다. 다운로드는 기존 소유자 확인 이미지 경로
  또는 메모리의 분석 이미지 주소를 그대로 사용한다.
- 임시 검사 페이지와 이미지는 빌드 전 삭제. 실제 iOS/Android 터치 스크롤,
  기기 뒤로가기와 모바일 다운로드 동작은 별도 실기기 검증이 필요하다.

## 사용자 문구 정리와 Android 하단 가림 보정 — 2026-10-25

- 일반 페이지, 공통 컴포넌트, 카메라 화면, 화면에 전달되는 API/오류 문구와
  상태 메시지를 조사했다. 저장 크기/원본 보관 안내와 ‘분석용 이미지’를 삭제.
  클라우드·서버 응답·내부 설정·중복 요청 설명은 결과와 다음 행동 중심으로
  간소화했다. ‘재분석’은 ‘다시 변환’으로 통일. 사용자 작성 기록은 변경하지 않음.
- 미저장 내용, 삭제·덮어쓰기 확인, 일시 보관 기록의 소멸과 오류/재시도 안내,
  접근성 레이블은 유지했다. 실패/빈 노트를 진행 중이라고 표시하던 대체 문구도
  상태에 맞게 바꿨다. 사용자 문구 작성 규칙은 DESIGN.md에 추가.
- 사용자 제공 Android 스크린샷에서 하단 메뉴 글자가 OS 버튼 영역에 가려짐을
  확인. 실제 기기의 viewport 측정값은 확보하지 못했으므로 원인을 단정하지 않음.
- 고정 프레임/사진 모달의 높이와 top을 표시/레이아웃 범위로 제한하고 100dvh
  상한 적용. window resize/pageshow도 반영. Android 하단 최소 여백 48px과
  env(safe-area-inset-bottom) 중 큰 값을 사용해 시스템 영역과 8px 간격 확보.
- Chrome에서 Android 식별 정보를 사용해 320x740/402x874/412x915/874x402,
  글자 16/32px, 하단 inset 0/64px 총 16조합 검사: 메뉴/글자가 가정한 시스템
  영역 위에 있고 본문과 겹치지 않으며 가로 넘침 없음. 사진 모달도 동일 확인.
  402x420으로 축소한 뒤 402x874로 복귀할 때 프레임이 화면 범위 내에 위치.
- 내부 문구 제거, ‘다시 변환’ 버튼, 사진 다운로드 유지 확인. 검사용 페이지와
  이미지는 빌드 전 제거. 실제 Android OS 바와 키보드 종료 동작은 같은 폰에서
  재확인 필요. 모사 검사를 실제 기기 해결 확인으로 표현하지 않는다.
- 근거: https://developer.chrome.com/docs/css-ui/edge-to-edge
  https://developer.chrome.com/blog/viewport-resize-behavior

## 목록형 홈(A안) 개편 화면 확인 — 2026-11-02

- 브랜치 `design/karrot-style`(031f321 기준). `npm run dev`(127.0.0.1:5173)를 Claude 데스크톱 앱 내장
  브라우저(Chromium, macOS)에서 확인했다. Supabase 키가 없어 스크래치 폴더의 임시 모의 서버와
  합성 세션 쿠키로 실제 로그인 판별 경로를 태웠다. 데이터·사진은 합성이며 모의 서버는 커밋하지 않았다.
- 크기: 320×568, 402×874, 874×402(가로). 글자 200%는 각 크기에서 뿌리 글자를 32px로 올린 값이다.
- 화면 13개 상태: 홈 목록, 새 노트 선택 창, `/capture`(사진 없음·있음), 노트 상세
  (일반·긴 본문과 요약 펼침·끊기지 않는 긴 제목과 세로 사진·변환 실패·정리 중), 검색(최근 검색어·
  결과·결과 없음), `/me`. 로그인 전 화면은 6개 크기를 따로 확인했다.
- 측정 78개 조합을 Android UA(내장 브라우저의 모바일 모사)와 Mac Chrome UA로 각각 실행했다. 문서·본문 영역 가로
  넘침, 화면 밖 요소, 48px 미만 조작 요소, 16px 미만 입력란, 잘린 글자, 하단 막대와 본문 겹침,
  목록 끝의 `새 노트` 버튼 가림, 선택 창의 화면 이탈을 조사했다.
- 발견 1건: 최근 검색어 링크의 폭이 글자 폭뿐이라 48px 미만(`회의` 28×48)이었다. 행 전체를 누를 수
  있게 고쳤다. 수정 뒤 Mac Chrome UA 78개 조합에서 항목 없음. Android UA는 수정 전 측정이며 수정 뒤
  다시 돌리지 않았다.
- 320, 가로, 402 글자 200%는 주요 화면을 스크린샷으로도 확인했다. 가로 넘침이나 가림은 없다. 다만
  320의 `앨범에서 고르기`는 아이콘 아래로 글자가 내려가고, 402 글자 200%의 `나의 슬림보드` 탭은
  마지막 글자만 다음 줄로 넘어간다. 내용이 가려지지 않아 고치지 않았다.
- 동작 확인: 선택 창 첫 항목 포커스, Escape로 닫기와 `새 노트` 버튼으로 포커스 복귀. 앨범 입력 →
  `/capture` → 닫기 → 홈의 `고르던 사진이 있어요`(`지우기`·`이어서 하기` 48px 높이) → 이어서 하기로
  사진 복원 → 지우기. 빈 홈과 빈 최근 검색어, `/notes`의 홈 이동, 제목 수정 후 `저장했어요.`, 사진
  확대(조작 48px 이상)와 사진 실패 시 `다시 불러오기` 복구, `?authError=1` 로그인 오류 문구.
- 린트 수정으로 바뀐 코드도 확인: 카카오 안내(Android·iOS UA 주입, 제목 포커스, `?externalBrowser=help`
  도움말 펼침), 일반 브라우저 통과, 실험실 상태 확인 실패 → `다시 연결` → 복구.
- 내장 브라우저 창이 숨겨진 상태에서는 스크린샷 때 `로그인 상태를 확인하고 있어요.`가 잠깐 보였다.
  검사 환경의 화면 전환에 따른 기존 `AccountBoundary` 동작이며 곧 원래 화면으로 돌아왔다.
- Android 고정 48px 보정은 인수인계의 미해결 사항이라 건드리지 않았다. Android UA 측정의 탭 막대
  높이에는 이 값이 포함되어 있다(402×874에서 탭 막대 119px, Mac UA 71px). 과도한 여백 문제의 해결이나
  유지 근거로 쓰지 않는다.
- 미검증: 실제 iPhone·Android, OS 글자 크기 설정, 모바일 키보드와 주소창, 안전 영역 값, 카메라 촬영,
  실제 Supabase 저장과 Google 로그인, `AI로 변환` 실행, 사진 다운로드, 다시 변환, 노트 삭제.

## 하단 메뉴 바닥 붙임(Android 48px 보정 제거) — 2026-11-04

- 계기: 사용자의 실제 Android Chrome(3버튼 탐색) 배포 화면 스크린샷에서 하단 탭 바 아래에 큰 빈 여백이 있어 메뉴가 떠 보였다.
- 변경: Android 고정 48px(`--navigation-min-bottom`) 제거. 탭 바·사진 확대 도구 아래 여백은 `max(8px, env(safe-area-inset-bottom))`.
- 방법: 로컬 `npm run dev` + 합성 백엔드·합성 세션, 앱 내장 브라우저(Chromium, Android 모바일 UA 모사)에서 iframe 크기별 측정.
- 크기·상태: 320×568, 412×915, 812×375(가로) × 글자 100%/200% × 홈·검색·나의 슬림보드·노트 상세 = 24개 조합.
- 결과: 24개 모두 하단 막대 아래 끝이 화면 아래 끝과 일치, 가로 넘침 없음. 탭 바 아래 여백 8px(이전 Android UA 56px), 노트 상세 동작 바 12px, 탭 최소 높이 58px(200%에서 73px), `새 노트` 버튼은 탭 바 위 16px.
- `--safe-bottom: 34px`를 임의로 넣은 iPhone 유사 확인: 탭 바 여백이 34px로 늘고 바닥에 붙은 상태 유지. 실제 `env()` 값이 아니라 변수 대입 모사다.
- 사진 확대 화면(375×812): 대화상자·하단 도구가 화면 아래 끝에 붙고 여백 8px, `--navigation-min-bottom` 없음.
- 미검증: 실제 Android 3버튼·제스처 모드, 실제 iPhone Safari/홈 화면 앱의 홈 표시줄 위치, 주소창 접힘·키보드 상태. 원래의 3버튼 가림이 재발하지 않는지는 배포 후 실기기에서 확인해야 한다.

## 탭 이동 중 하단 메뉴 튐 — 2026-11-04

- 계기: 사용자가 실제 휴대폰에서 하단 탭으로 화면을 옮길 때 메뉴가 순간적으로 위로 올라간다고 알려 왔다.
- 원인: 탭 이동 중 잠깐 보이는 로딩 화면(`AppLoading`)이 `AppFrame`을 쓰지 않아 하단 메뉴가 화면 바닥이 아닌 내용 끝에 놓였다.
- 변경: `AppLoading`이 `AppFrame` 안에서 그려지도록 바꿨다. `AppFrame`의 화면 높이 측정은 그리기 전(`useLayoutEffect`)에 하도록 바꿨다.
- 방법: 로컬 `npm run dev` + 합성 백엔드·합성 세션, 앱 내장 브라우저(Chromium, Android 모바일 UA 모사). iframe 안에서 하단 탭으로 홈→검색→나의 슬림보드→홈을 오가며 8ms 간격으로 메뉴 위치를 기록했다.
- 수정 전(375×812): 로딩 중 메뉴 아래 끝이 537·663·731px로, 화면 아래 끝(812px)보다 81~275px 위에 있었다.
- 수정 후: 375×812 1,874개, 320×568(글자 100%/200%) 표본 모두에서 로딩·완료 화면의 메뉴 아래 끝이 화면 아래 끝과 같았다.
- 미검증: 실제 Android·iPhone에서의 체감 확인.

## 먼저 읽은 글자 — 2026-11-18

- Mac 앱 내장 Chromium에서 실제 사진을 JPEG로 준비하고 브라우저 OCR을 실행했다.
  업로드와 최종 저장 응답은 별도로 모사했다. AI로 변환을 누른 시점부터
  먼저 읽은 글자가 화면에 나타나기까지 402×874에서 428ms, 320×568에서
  447ms, 874×402에서 419ms, 402×874 글자 200%에서 445ms였다.
- 네 화면에서 인식 글자와 하단 버튼이 겹치지 않았고 가로 넘침도 없었다.
  요약이 도착한 뒤 최종 노트에 원문과 요약을 표시하는 흐름을 확인했다.
- 브라우저 Worker를 사용할 수 없는 환경을 모사해 기존 서버 변환으로
  결과를 받을 수 있는지도 확인했다.
- 로컬 자산을 사용한 Mac 측정이다. 초기 다운로드, 모바일 네트워크,
  실제 iPhone Safari와 Android Chrome의 속도는 별도로 확인해야 한다.

## 사진 저장과 분석 통합, 결과 화면 열기 (2026-11-20)

- 공개 Sites 버전 20에서 Mac Chromium으로 같은 한글 손글씨 사진을
  홈에서 선택해 세 번 변환했다. 변환 버튼을 누른 시점부터 측정했다.

  | 화면 및 조건 | 미리보기 | 원문과 요약 준비 |
  | --- | ---: | ---: |
  | 393×852, 캐시 사용 | 0.974초 | 4.126초 |
  | 393×852, 캐시 사용, 반복 | 1.338초 | 2.043초 |
  | 320×660, HTTP 캐시 비활성화 | 먼저 표시되지 않음 | 2.459초 |

- 세 번 모두 브라우저는 사진을 한 번 보냈다. 서버는 방금 저장한 JPEG를
  분석에 바로 넘겼고 결과 화면은 같은 응답을 받아 6~12ms 안에 나타났다.
  화면에 즉시 표시한 원문과 요약이 새로고침 뒤에도 일치했다. 홈으로
  뒤로 갔다가 앞으로 돌아와도 노트를 열 수 있었다.
- 결과 화면은 320×660, 393×852, 가로 852×393, 393×852에서 CSS 글자 크기
  200%로 확인했다. 검사한 화면에서 가로 넘침과 하단 버튼 겹침이 없었다.
  실제 iPhone과 Android, 모바일 연결에서의 소요 시간은 측정하지 않았다.

## 노트 저장 후 홈으로 이동 — 2026-11-20

- 계기: 노트 화면에서 저장을 누르면 같은 화면에 머물러, 저장 뒤 홈으로 자동 이동해 달라는 요청.
- 변경: `NoteEditor`의 저장이 성공하면 현재 화면을 새로고침하는 대신 홈(`/`)으로 이동한다. 저장 실패 시에는 화면에 남아 오류를 보여 준다. 다시 변환, 노트 저장 다시 시도는 기존처럼 결과 화면에 머문다.
- 확인: `tsc --noEmit`, `eslint components/NoteEditor.tsx` 통과.
- 미검증: 로그인한 브라우저에서 저장 후 홈 이동, 새로 변환한 결과 화면과 노트 목록에서 연 화면 각각의 이동, 실제 iPhone과 Android 확인.

## 캐시 없는 첫 방문에서 사진 변환 (2026-11-20)

- 공개 Sites 버전 24에서 Mac Chromium의 HTTP 캐시를 끄고 홈을 매번
  다시 열어 같은 한글 손글씨 사진을 세 번 변환했다. 표는 AI로 변환을
  누른 때부터 화면에 결과가 준비되기까지의 시간이다.

  | 화면 | 별도 미리보기 | 최종 원문과 요약 |
  | --- | ---: | ---: |
  | 393×852 | 1.994초 | 3.931초 |
  | 320×660 | 최종 결과가 먼저 표시됨 | 2.561초 |
  | 393×852 | 최종 결과가 먼저 표시됨 | 2.134초 |

- 별도 미리보기가 뜬 회차는 사진을 고른 때부터 5.048초가 걸렸다.
  세 회차 모두 OCR 파일 네 개를 네트워크로 다시 받았고, 같은 원문
  네 줄과 요약이 저장되어 새로고침 뒤에도 표시됐다.
- 저장 요청이 성공한 뒤 홈으로 이동하는 동작을 확인했다. 결과 화면을
  320×660, 393×852, 가로 852×393, CSS 글자 크기 200%에서 확인했다.
  가로 넘침과 하단 버튼 겹침이 없었다. 실제 휴대폰 속도는 미검증이다.

## 시연 전 코드 리뷰 수정 다섯 가지 — 2026-11-20

- 계기: 시연 전 코드 리뷰(GPT-6.2 Astra, Opus 5.5 각 세 영역)에서 확인된 문제.
- 저장/삭제 뒤 뒤로 가기: Vinext가 보관한 이전 화면 때문에 수정 전 내용이 보이고,
  그 상태에서 저장하면 옛 내용으로 덮어썼다. 홈 이동 뒤 `router.refresh()`로 보관 화면을
  비우고, 바뀐 내용이 없으면 저장 요청 없이 홈으로 이동한다. Vinext 코드 추적으로 확인했다.
- 긴 본문 입력 중 화면 튐: 입력칸 높이를 다시 잴 때 스크롤 위치를 보존한다. 앱과 같은
  스크롤 구조의 headless Chrome 재현에서 글자 하나 입력 시 1354→460으로 튀던 위치가
  수정 후 1354로 유지됐고, 내용을 지우면 새 최대값(468)으로 정상 조정됐다.
- 검색 입력칸: 최근 검색어를 눌러도 입력칸이 이전 값으로 남던 문제를 `key`로 고쳤다.
  Vinext가 `?q=`만 바뀔 때 화면을 유지하는 것은 코드로 확인했다.
- 네트워크 오류: `Load failed`, `Failed to fetch` 대신 한국어 연결 안내를 보여 준다.
- Google 로그인: 뒤로 가기로 페이지가 복원되면 버튼의 연결 중 상태를 푼다.
- 확인: `tsc --noEmit`, 변경 파일 eslint, `lab:test` 105개 통과, 기능별 Reviewer 검토.
- 미검증: 실제 iPhone Safari와 Android Chrome에서의 뒤로 가기, 입력, 로그인 복원 동작.

## 굿노트로 보내기 화면과 공유 흐름 — 2026-11-26

- 변경: 노트 상세 사진 아래 `굿노트로 보내기`, 새 화면 `/notes/[id]/goodnotes`, 처리 모듈
  `lib/goodnotes-export.ts`와 Web Worker. 확인 당시 보내는 파일은 PDF였다. 다른 형식으로 바꾸면
  파일과 공유 동작을 다시 확인해야 한다.
- 방법: 로그인 정보가 없는 환경이라 직접 그린 시험 사진(세로, 가로, 긴 세로, 빈 보드, 깨진 파일)과
  임시 페이지로 `GoodnotesExport`와 `NoteEditor`를 띄웠다. `npm run build` 결과를
  `npm run start`로 실행해 확인했고 임시 페이지와 사진은 지웠다.
- Mac headless Chrome: 준비 중, 준비 완료, 글씨 없음, 사진 실패와 다시 시도, 사진 없음, 변환이 끝나지 않은 노트,
  공유 미지원(`파일로 저장`) 화면을 확인했다. 공유 함수는 시험용으로 바꿔 끼웠다. 호출 시점에 사용자 탭이
  유효했고, 닫음은 메시지가 없고, 실패는 안내가 나오며, 공유 중 연속 세 번 탭은 한 번만 호출됐다.
- 화면을 떠나면 Worker가 종료되고 저장용 주소가 해제됐다. Worker 생성 실패, Worker 파일 404, Worker 미지원,
  OffscreenCanvas 미지원 응답에서는 화면 안 처리로 같은 준비 완료 화면이 나왔다.
- 크기: 320×660, 400×860, 852×393, 820×1180에서 글자 100%와 200%, 여덟 상태(64개 조합)와 노트 상세 세 크기
  (320×660, 400×860, 852×393)의 100%와 200%에서 가로 넘침, 하단 바 가림, 48px 미만 터치 영역이 없었다.
  안전 영역 값을 모사한 393×852와 852×393에서도 같았다. 320px 200%와 가로 화면은 스크롤로 안내 문구를 본다.
- 노트 상세: 변환이 끝난 노트에만 버튼이 보이고, 저장 중에는 눌러도 이동하지 않았다. 고친 내용은 임시 페이지 사이를
  소프트 이동했다가 돌아와도 유지됐다. 버튼은 `/notes/[id]/goodnotes`로 소프트 이동했다.
- iOS 27.2 시뮬레이터(iPhone 18 Pro) Safari: 준비 완료 화면에서 Worker 파일이 요청됐고, 버튼을 누르면 iOS 공유
  시트가 파일 이름과 함께 열렸다. 시트를 닫으면 메시지 없이 화면이 그대로였다. 시뮬레이터 확인이며 실제 기기 확인이 아니다.
- 미검증: 실제 iPhone과 iPad, Goodnotes 앱으로의 전달과 편집, 다른 앱으로 전환했다 돌아온 뒤의 동작,
  로그인한 실제 노트와 실제 보드 사진, 실제 `/notes/[id]/goodnotes` 라우트의 서버 렌더와 로딩 화면, VoiceOver.

## 굿노트로 보내기 파일을 `.goodnotes`로 교체 — 2026-11-26

- 변경: 보내는 파일을 PDF에서 `.goodnotes`(`application/zip`)로 바꿨다. 형식은
  `lib/goodnotes-export-format.ts` 한 곳에서 정한다. 1쪽은 흰 A4(사진이 가로면 가로)에 사진 비율 그대로 옮긴 획,
  2쪽은 원본 사진이다. 공유는 `navigator.share({ files: [file] })`로 파일만 넘긴다. 화면 문구는 바꾸지 않았다.
- 실기기 기록(사용자 확인, 아이패드 굿노트, 시험 파일 A): 획의 지우개와 올가미가 된다. 배경 PDF의 안내선은
  획보다 약 1.83배 크게 그려졌다(사진 눈대중 측정). 굿노트가 배경 PDF 1pt를 페이지 단위 11/6개로 그리는 것으로 보고,
  모든 쪽의 크기를 배경 PDF 크기 × 11/6으로 선언하도록 맞췄다. 맞춘 뒤의 파일은 실기기에서 아직 열어 보지 않았다.
- 방법: 직접 그린 시험 사진(1600×1200 가로, 1200×1600 세로, 4색 물결 48개)을 만드는 임시 페이지를 `npm run dev`로
  띄워 확인하고 임시 페이지는 지웠다. `npm run build`에서 `goodnotes-export.worker-*.js`가 클라이언트 청크에 포함되고
  화면 청크가 그 주소를 참조하는 것을 확인했다.
- 데스크톱 앱 브라우저(공유 미지원): `파일로 저장` 링크의 파일 이름이 `수학 판서.goodnotes`였고, 내용을 ZIP 읽기
  함수로 다시 열어 2쪽(1543.46×1091.34, 1543.67×1157.75 단위)과 획 49개, 사진 쪽 획 0개를 확인했다.
- 같은 브라우저, 공유 함수를 시험용으로 바꿔 끼움: 버튼을 누르면 `files` 하나만 넘어갔고(`title` 없음),
  파일은 `수학 판서.goodnotes`, `application/zip`이었으며 호출 시점에 사용자 탭이 유효했다.
- 문서 만드는 시간(메인 스레드, 획 500개와 153KB 사진): 다섯 번 25~37ms, 결과 파일 236KB. Worker로 옮기지 않았다.
- iOS 27.2 시뮬레이터(iPad mini (A20 Pro)) Safari: 준비 완료 화면에서 버튼을 누르면 공유 시트에 `수학 판서`,
  GOODNOTES 문서 아이콘, 210KB가 떴다. 시트를 닫으면 메시지 없이 화면이 그대로였다. 굿노트는 설치하지 않았다.
  시뮬레이터 확인이며 실제 기기 확인이 아니다.
- 실기기 확인(사용자, 아이패드 굿노트, 시험 파일 A·B·C, 2026-11-26): 세 파일 모두 열렸다. A(natural-ink, pt 단위)는
  획의 지우개와 올가미가 되지만 배경 안내선이 어긋났다. B(codec, 11/6 단위)와 C(natural-ink, 11/6 단위)는
  진한 선과 안내선이 정확히 겹치고 지우개와 올가미가 됐다. 이 결과로 B를 기본으로 정했다.
  아이패드 기종, iPadOS와 굿노트 버전은 기록하지 않았다.
- 미검증: 사진 쪽이 굿노트에서 꽉 차는지, `파일에 저장`에 텍스트 파일이 함께 생기지 않는지, 실제 보드 사진과
  로그인한 노트, 화면 크기별 확인(화면 코드는 공유 인자 말고 바뀌지 않아 이전 기록을 따름).

## 굿노트로 보내기를 윤곽과 볼펜 채움 방식으로 연결 — 2026-11-26

- 변경: 1쪽 획을 중심선 방식(`lib/ink-strokes.ts`)에서 윤곽(`lib/ink-outline.ts`)과 볼펜 채움(`lib/goodnotes-fill.ts`)으로
  바꿨다. Worker가 윤곽과 채움을 모두 하고 화면은 문서 쓰기와 미리보기만 한다. 분석 해상도는 긴 변 1600에서 2560으로
  올렸다. 미리보기는 파일에 들어가는 펜 획(같은 점, 색, 굵기)을 그린다. 화면 문구와 화면 코드는 바꾸지 않았다.
- 환경: Mac(Apple M5 Max) headless Chrome 158, `npm run build` 결과를 `npm run start`로 실행. 로그인 정보가 없어
  임시 페이지로 `GoodnotesExport`를 띄우고, 사진은 브라우저 요청 가로채기로 줬다. 시험 사진은 직접 그린 것(세로 1200×1600,
  가로 2560×1440, 빈 보드, 깨진 파일)과 사용자가 준 실제 판서 사진(1500×2000) 한 장이다. 임시 페이지는 확인 뒤 지웠다.
- 상태(400×860): 준비 중(스피너, `글씨를 옮기는 중이에요`, 비활성 `준비 중`), 준비 완료(미리보기, `굿노트로 보내기`),
  공유 미지원(`파일로 저장`), 글씨 없음, 사진 실패(`다시 시도`), 사진 404와 사진 없음, 변환이 끝나지 않은 노트가 이전과 같았다.
  미리보기 SVG의 하위 경로 수가 파일의 1쪽 획 수와 같았다(세로 57/57, 가로 57/57, 실제 사진 1119/1119).
- 파일: `파일로 저장` 링크의 파일을 ZIP 읽기 함수로 다시 열었다. 세 사진 모두 2쪽이고 1쪽은 A4(세로 1091.34×1543.46,
  가로 1543.46×1091.34 단위), 사진 쪽 획 0개였다. 실제 사진은 획 1119개, 파일 1.22MB, 미리보기 경로 문자 약 303KB였다.
  공유 함수를 바꿔 끼운 확인에서 `files` 하나만 넘어갔고 사용자 탭이 유효했으며, 닫음은 메시지가 없고 실패는 안내가 나왔다.
- Worker: 준비가 끝나면 Worker가 종료됐고, 처리 중 다른 화면으로 소프트 이동하면 종료됐다. Worker 생성 실패, Worker 파일 404,
  Worker 미지원, `unsupported` 응답에서는 화면 안 처리로 같은 준비 완료 화면이 나왔다.
- 처리 시간(Worker 경로, 페이지 이동부터 준비 완료까지, 캐시 끔, 3회): 실제 판서 사진 2.37~2.40초(Worker 안 2.18~2.21초,
  Worker 응답 1.0MB, 그 뒤 문서 쓰기와 미리보기 0.13초). 가로 2560×1440 시험 사진 0.67~0.69초. 휴대폰은 더 느릴 수 있다.
- 크기: 준비 완료 화면을 320×660, 400×860, 852×393에서 글자 100%와 200%로, 세로, 가로, 실제 사진 미리보기마다 확인했다.
  가로 넘침, 하단 바 가림, 48px 미만 터치 영역이 없었다. 320px 200%와 가로 화면은 이전처럼 스크롤로 안내 문구를 본다.
- 미검증: 실제 iPhone과 iPad에서의 처리 시간과 메모리, 저장된 노트 사진(긴 변 2560)의 실제 판서 사진, 굿노트에서 채움 획이
  보이는 모양(D2 방식 실기기 미확인), 로그인한 실제 노트와 `/notes/[id]/goodnotes` 라우트, iOS 시뮬레이터 공유 시트(이번에는 하지 않음).

## 굿노트로 보내기 펜 종류(볼펜 채움, 만년필, 붓) 연결 — 2026-11-27

- 변경: `GOODNOTES_EXPORT_PEN`(기본 `ballpoint`)에 따라 Worker가 윤곽을 볼펜 채움 획이나 만년필, 붓 가변 굵기 획으로
  바꾼다. 미리보기는 가변 굵기 획을 점마다 반폭 원을 잇는 채움 경로로 그린다. 화면 문구와 펜 선택 화면은 없다.
- 환경: Mac headless Chrome, 세션 임시 폴더에 저장소를 복사해 상수만 바꾸고 `npm run build`, `npm run start`로 펜마다
  따로 실행했다. 임시 페이지로 `GoodnotesExport`를 띄우고 사진은 요청 가로채기로 줬다. 시험 사진은 직접 그린 것
  (세로 1200×1600, 가로 2560×1440, 빈 보드)이다. 복사본과 임시 페이지는 확인 뒤 지웠다.
- 결과(만년필, 붓 각각): 400×860과 320×660에서 준비 완료 미리보기가 나왔고 가로 넘침, 하단 바 가림, 48px 미만
  터치 영역이 없었다. 미리보기 채움 하위 경로 수가 파일 1쪽 획 수와 같았다(세로 83/83, 가로 84/84). `굿노트로 보내기`는
  `files` 하나만 넘겼고 사용자 탭이 유효했다. `파일로 저장` 파일을 다시 열면 2쪽이고 1쪽 획은 모두 만년필 f3 1(또는 붓 f3 4)였다.
  빈 보드는 `사진에서 글씨를 찾지 못했어요.`가 나왔다. 기본값(볼펜)은 이전과 같이 57/57획, 볼펜 획이었다.
- 크기: 사용자가 준 실제 판서에서 앞서 뽑아 둔 윤곽 자료로 Node에서 쟀다(사진 자체는 이번에 열지 않았다). 만년필 2427획,
  미리보기 채움 경로 약 683KB(볼펜 미리보기는 이전 기록 약 303KB), 경로 만들기 약 0.05초, Chrome에서 그리기 약 0.03초.
  파일 중심선을 따로 칠한 기준과 4배 확대로 비교해 넓이 비 0.97, 겹침 0.90이었고 차이는 글씨 가장자리 테두리에만 있었다
  (구멍이나 빠진 획 없음, 페이지 단위 1은 휴대폰 화면 약 0.3px).
- 미검증: 굿노트 실기기에서 만년필과 붓 파일이 열리는지와 보이는 모양(그래서 기본값은 볼펜), 실제 iPhone과 iPad의 처리
  시간과 메모리, 실제 판서 사진으로 화면 전체 흐름, 글자 200% 확대와 가로 화면(이번에는 하지 않음), iOS 공유 시트.

## 굿노트로 보내기 펜 고르기(만년필, 붓) — 2026-11-27

- 변경: 준비 완료 화면의 미리보기 아래에 `만년필`(처음 값), `붓` 고르기를 뒀다(공통 `.choice-group`, 네이티브 라디오).
  고르기를 바꾸면 사진 분석 없이 이미 만든 획의 펜 종류만 바꿔 파일을 다시 쓴다(`withExportPen`, `changeGoodnotesPen`).
  다시 쓰는 동안 주요 버튼은 비활성 `준비 중`이다. 고른 값은 기기의 브라우저 저장소에 기억하고, 저장소가 막히면 만년필로 시작한다.
- 환경: Mac(Apple M5 Max) headless Chrome 158, `npm run dev`. 로그인 정보가 없어 임시 페이지로 `GoodnotesExport`를 띄우고
  사진은 요청 가로채기로 줬다. 시험 사진은 캔버스로 직접 그린 것(세로 1200×1600, 가로 2560×1440, 글씨가 많은 세로 1920×2560,
  빈 보드)만 썼다. 공유 함수는 시험용으로 바꿔 끼웠다. 임시 페이지는 확인 뒤 지웠다.
- 펜 바꾸기(400×860): 만년필 → 붓 → 만년필 → 붓 순서로 바꿀 때마다 공유된 파일을 다시 열었다. 1쪽 획이 모두 만년필 f3 1,
  붓 f3 4, 만년필 f3 1, 붓 f3 4였고 획 수(글씨 많은 사진 575, 세로 91)와 2쪽(사진 쪽 획 0)은 그대로였다. 바꾸는 동안
  버튼은 비활성 `준비 중`이었고, 바꾼 뒤 사진 요청과 Worker 요청은 0건이었다. 공유는 `files` 하나만 넘겼고 사용자 탭이 유효했다.
- 펜 바꾸는 시간(누름부터 버튼이 다시 켜질 때까지, 개발 서버): 글씨 많은 사진 575획 149~162ms, 세로 91획 52~82ms.
  처음 준비는 각각 약 2.9초, 0.8초였다. 실제 판서(약 2400획)와 휴대폰 시간은 재지 않았다.
- 경쟁 상태: 기다리지 않고 붓 → 만년필 → 붓을 누르면 마지막 붓 파일만 남았다(f3 4). 붓 → 만년필 → 붓 → 만년필로 되돌리면
  만년필 파일이었다. 공유가 끝나지 않은 채(시트가 열린 상태 모사) 붓으로 바꾸면 다시 쓰기는 끝나고 버튼은 여전히 눌리지 않았으며
  (`aria-disabled`, 추가 호출 0건), 공유가 끝난 뒤 누르면 붓 파일이 넘어갔다. 준비 중에는 고르기가 보이지 않는다.
- 공유 미지원(`파일로 저장`): 바꾸는 동안 저장 링크 대신 비활성 `준비 중`이 보였고, 저장 파일은 만년필 f3 1 → 붓 f3 4 →
  만년필 f3 1로 바뀌었다. 파일 이름은 `수학 판서.goodnotes` 그대로였다.
- 기억: 붓을 고르고 다시 열면 붓으로 시작했고 첫 파일이 f3 4였다. 저장된 값이 잘못되면(`ballpoint`) 만년필로 시작했다.
  저장소 읽기와 쓰기가 모두 예외를 내는 브라우저에서도 만년필로 시작했고 붓으로 바꾸기가 됐다(콘솔 경고만 남음).
- 다시 쓰기 실패(사진 바이트 읽기를 일부러 실패시킴): `글씨를 옮기지 못했어요.`와 `다시 시도`가 나왔고 원인은 콘솔에 남았다.
  다시 시도하면 고른 붓으로 준비가 끝났다(f3 4).
- 키보드와 레이블: 고르기는 `fieldset`과 숨긴 `legend`(펜) 안의 라디오 두 개이고 접근성 트리에서 이름 `만년필`, `붓`,
  그룹 이름 `펜`이었다. 제목 다음 Tab이 고른 라디오로 가고 다음 Tab이 주요 버튼이다. 화살표로 바꾸면 초점이 라디오에 남은 채
  파일이 다시 만들어졌고, 초점 테두리는 3px `--primary-ink`였다.
- 크기: 320×660, 400×860, 852×393에서 글자 100%와 200%(루트 글자 크기 200%), 글씨 많은 세로와 가로 사진(12개 조합)에서
  가로 넘침, 하단 바 가림, 48px 미만 터치 영역, 잘린 선택지 글자가 없었다. 고르기는 56px(200%에서 75px) 높이다.
  320×660 글자 200%와 852×393은 이전처럼 스크롤해서 고르기와 안내 문구를 보며, 끝까지 내리면 둘 다 하단 바 위에 보였다.
  세로 화면에서 고르기가 들어갈 자리만큼 미리보기 높이 상한을 68px 줄였다(320×660 세로 사진 264×352).
- 보이는 글자(준비 완료): `굿노트로 보내기`, `만년필`, `붓`, 안내 두 문장, 주요 버튼. 화면 읽기 프로그램용 `펜`.
- 미검증: 실제 iPhone과 iPad, 굿노트 실기기에서 만년필과 붓 파일이 열리는지와 모양, 휴대폰의 펜 바꾸는 시간,
  실제 판서 사진, 로그인한 실제 노트와 `/notes/[id]/goodnotes` 라우트, 프로덕션 빌드(`npm run start`)에서의 화면 흐름,
  iOS 공유 시트, VoiceOver.
