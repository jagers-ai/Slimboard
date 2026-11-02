# Slimboard Mobile Design

Direction: a warm, friendly feed of whiteboard notes. Photographs and readable records carry the identity.
The approved November 2, 2026 concept (list-first Home, "A안") replaces the October 24 capture-first Home:
the saved-note feed is Home, a floating `새 노트` button starts capture, then photo review and a readable note.

## Scope and implementation

This is the shared design contract for all Slimboard user-facing pages and features,
including the camera lab and the signed-in application. Read it before UI work;
`AGENTS.md` defines the implementation and verification obligations.

- Reuse the shared variables and foundations in `app/globals.css`, notebook patterns
  in `app/notebook.css`, and existing components under `components/`. For example,
  `NoteDocument` is the shared note-reading view and `components/camera/` contains
  the camera flow's screen parts.
- Primary color tokens live in `app/globals.css`: `--primary` (`#e9631a`, button and
  FAB fills with white 18px bold labels), `--primary-pressed`, `--primary-ink`
  (`#b4460c`, orange text and focus rings; passes 4.5:1 on white) and `--primary-soft`
  (`#fff1e7`, tags and highlights). Legacy names `--blue`, `--blue-dark` and
  `--blue-soft` are aliases of these, not a blue palette. Never put white text on
  `--primary` below 18px bold, and never use `--primary` itself for small text.
- An old screen or isolated hard-coded value does not override this document.
  When touching an inconsistent area, align the affected UI with these rules and
  check its shared consumers without expanding into an unrelated redesign.
- Extend shared patterns for new features. Document a reusable addition here in
  the same change; keep design-direction changes within the user's requested scope.
- Include applicable empty, loading, error, retry, and disabled states. State
  what happened and provide a clear next action; preserve recoverable user input.

## Visual system

- White canvas, near-black text (`#1a1c20`), body text (`#2b2e33`), muted secondary text (`#6b7079`), thin dividers (`#eaebee`), soft grey fills (`#f2f3f6`).
- Warm orange is reserved for primary actions, the floating `새 노트` button, status tags, search highlights and focus indicators.
- Use the platform system sans-serif; no external font dependency. Body 16px; screen titles 20px bold, note titles 22px bold, list titles 16px medium, meta 13px muted.
- Corners: 8px buttons and thumbnails, 12px photo panels, 16px sheet tops, round FAB. Only the FAB and bottom sheet cast a shadow; no card shadows, decorative gradients, sparkle icons or colorful keyword pills.
- One mobile column, 480px maximum normally, 16px side gutters.
- Lists are feed rows: 100px photo thumbnail (84px under 360px), title up to two lines, time, one-line excerpt, an optional quiet status tag, and a fine divider. No cards.

## Flow and controls

- Tabs: `홈` (`/`), `검색` (`/search`), `나의 슬림보드` (`/me`). `/notes` redirects to Home.
- Home: the saved-note feed under a `슬림보드` header with a search icon; never seed fake records. A floating `새 노트` button sits above the tab bar and opens a bottom sheet (`카메라로 찍기`, `앨범에서 고르기`, `취소`). A prepared photo continues on `/capture`. When a picked photo is still waiting, Home shows a notice with `이어서 하기` and `지우기`.
- Review (`/capture`): X back to Home (keeps the photo), large uncropped photo, `다시 찍기` / `앨범에서 고르기`, and one primary `AI로 변환` in the fixed bottom action bar. Without a photo it shows a quiet placeholder and the two sources.
- Result (note detail): full-width photo first with round back and download buttons over it, then `date · AI 정리`, the editable title, `보드 내용` (editable transcription) and a collapsed `AI 요약`. Keywords remain stored and searchable but are not rendered.
- Saved notes are a continuous editable document, not a separate `노트 수정` form. Use borderless auto-growing fields, a fixed bottom action bar with `다시 변환` and the primary `저장`, and a quiet `노트 삭제` at the end of the document. Keep explicit labels, visible focus and pending/error/draft behavior.
- `나의 슬림보드`: account row, `모든 노트`, `최근 검색어 지우기` and `로그아웃` as 56px menu rows.
- The standalone lab keeps records only in React memory for the current tab. State this plainly. Do not imply permanent storage or add sensitive photos to browser storage.
- Keep selected photos on failure or when returning to the list. Warn about accidental page unload when there is session content.

## Mobile and accessibility

- Support Safari/iOS and Chrome/Android through responsive layout, not device detection.
- Keep camera capture and album inputs separate. Preserve client image preparation and orientation handling in the lab.
- Honor all four safe-area insets, allow zoom, use at least 48px touch targets and 16px form fields.
- Use `AppFrame` for the main app: the content scrolls in a dedicated row, and the bottom row is either the tab bar or a screen's action bar (`footer`: photo review, note detail, signed-out start). `overlay` holds the floating `새 노트` button just above the bottom row, and the feed reserves space for it. Follow the visible viewport when the keyboard opens; never overlay controls or crop enlarged text.
- Allow 200% text and long content to wrap; landscape remains scrollable.
- Use visible keyboard focus, real labels, live status, disabled actions during work, and focus the heading on stage changes.
- Respect reduced motion. Do not add fake OS chrome or model/authentication explanations to the product screen.
- Bottom sheets use a native modal `dialog`: focus stays inside, Escape and a backdrop tap close it, focus returns to the button that opened it. Keep file inputs outside the sheet so the OS picker can open after it closes.

## Verification boundary

Responsive browser checks do not establish physical phone behavior. Record the exact browser, viewport sizes, and tested flow in `docs/mobile-testing.md`. Report device capture separately.

## Saved records and mobile navigation

- Saved records use one analysis JPEG for the feed thumbnail and the detail photo. Never promise original resolution or automatic photo-library saving.
- Keep the tab bar visible in its own `AppFrame` row on Home, Search and 나의 슬림보드. Photo review and note detail replace it with their action bar in the same row. Content scrolls above it; neither may cover editing controls with a keyboard or 200% text.
- Photo and editor drafts are account-scoped memory only, retained through in-app navigation and cleared on sign-out. Failed result saves offer `노트 저장 다시 시도`, which must not start another AI request.

## Signed-out home layout

Centre a compact introduction (88px orange mark, `화이트보드를 노트로`, one short
paragraph) in the scrolling row, and put the full-width `Google로 시작하기`
button in the bottom action bar. No tab bar before sign-in. Enlarged text and
landscape scroll; the button never covers the introduction.

## KakaoTalk entry

On mobile KakaoTalk entry, show a compact external-browser guidance screen
before the normal app UI: Safari on iOS, Chrome on Android. Detection is only
a UI hint, never an authentication or authorization check. Browser switching
requires a tap; do not auto-redirect or transfer login codes/session tokens.
Offer default-browser handoff, link copying and selectable-address recovery.
Regular browsers keep the existing flow. Physical-device app switching remains
a separate acceptance check from browser emulation.

## Photo review

`/capture` shows the uncropped preview first, then retake/album controls; the
primary `AI로 변환` stays in the bottom action bar. Bound the preview height to
the viewport so normal portrait layouts show the photo and both controls
without scrolling; landscape and enlarged text scroll above the action bar.
The home sheet and the review screen share `useCaptureDraft`, so the
account-scoped photo draft survives leaving and returning.

## Photo enlargement

Use shared `PhotoZoom` for capture review, saved-note photos and the camera lab.
Tapping the photo opens a native modal dialog above the entire app and dock.
Start at viewport width; provide zoom in/out, fit-to-screen, and close controls.
Allow drag/scroll panning, preserve the underlying scroll position and drafts,
and return keyboard focus to the invoking photo on close. Download uses only
the existing authorized image endpoint or the selected local analysis image.
The modal must support Escape, focus containment, safe areas, enlarged text,
loading/error/retry states and at least 48px controls.

## 사용자에게 보이는 문구

- 화면에는 사용자의 행동·진행 상태·결과·복구에 필요한 문구만 쓴다.
- 저장 위치, 이미지 처리 크기, 원본 보관 방식, 모델/API/토큰, 서버 응답,
  내부 설정과 중복 요청 방지 같은 구현 설명을 상시 안내로 노출하지 않는다.
- 내부 원인을 설명하기보다 무엇이 안 됐는지와 다음 행동을 쉽게 안내한다.
- 동작 이름은 화면의 버튼과 맞춘다. 사진 정리는 ‘AI로 변환’, 반복 실행은 ‘다시 변환’.
  사진 가져오기는 ‘카메라로 찍기’·‘앨범에서 고르기’·‘다시 찍기’로 통일한다.
- ‘AI가 정리해 드려요’, ‘AI가 정리하는 중’, ‘AI 요약’처럼 사용자가 얻는 결과로 AI를
  말할 수 있다. 어떤 모델·API를 쓰는지, 글씨를 어떻게 읽는지 같은 처리 과정은 쓰지 않는다.
- 슬로건이나 말장난 대신 화면이 하는 일을 짧은 해요체로 쓴다.
- 삭제·덮어쓰기 확인, 미저장 내용, 일시 보관 기록의 소멸, 오류/재시도 안내,
  접근성 레이블처럼 사용자의 판단과 데이터 보존에 필요한 문구는 유지한다.
- 사용자가 작성한 제목/본문 및 저장된 기록은 문구 정리 대상으로 일괄 수정하지 않는다.

## Android 하단 시스템 영역 — 수정 대기

현재 코드의 Android 고정 48px 보정은 사용자 실기기에서 과도한 여백을 만들었다.
이 보정을 새 화면의 디자인 기준으로 재사용하지 않는다. `docs/handoff.md`의
미해결 사항에 따라 실제 기기 측정과 브라우저의 표준 안전 영역 처리를 기준으로
교체해야 한다. 화면 높이와 안전 영역을 중복 반영하지 않으며, PC 화면 모사만으로
시스템 바 겹침이나 여백 문제가 해결됐다고 판단하지 않는다.
