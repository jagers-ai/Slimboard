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

- Home: photo capture and attachment only, followed immediately by photo review.
- Notes tab: saved records and a record-search entry. Never put the saved list above capture on Home; never seed fake records.
- Review: large uncropped photo, clear reselect/back controls, one primary `변환` action, with `사진 첨부` for album/file selection.
- Result: editable title, analysis photo with download, then an initially open editable full transcription. Summary comes below as a collapsed disclosure. Keywords remain stored and searchable but are not rendered.
- Saved notes are a continuous editable document, not a separate `노트 수정` form. Use borderless auto-growing fields, a top-right `저장` action, and quiet reanalysis/deletion actions. Keep explicit labels, visible focus and pending/error/draft behavior.
- The standalone lab keeps records only in React memory for the current tab. State this plainly. Do not imply permanent storage or add sensitive photos to browser storage.
- Keep selected photos on failure or when returning to the list. Warn about accidental page unload when there is session content.

## Mobile and accessibility

- Support Safari/iOS and Chrome/Android through responsive layout, not device detection.
- Keep camera capture and album inputs separate. Preserve client image preparation and orientation handling in the lab.
- Honor all four safe-area insets, allow zoom, use at least 48px touch targets and 16px form fields.
- Use `AppFrame` for the main app: the content scrolls in a dedicated row, and bottom navigation occupies a separate persistent row. Follow the visible viewport when the keyboard opens; never overlay controls or crop enlarged text.
- Allow 200% text and long content to wrap; landscape remains scrollable.
- Use visible keyboard focus, real labels, live status, disabled actions during work, and focus the heading on stage changes.
- Respect reduced motion. Do not add fake OS chrome or model/authentication explanations to the product screen.

## Verification boundary

Responsive browser checks do not establish physical phone behavior. Record the exact browser, viewport sizes, and tested flow in `docs/mobile-testing.md`. Report device capture separately.

## Saved records and mobile navigation

- Saved records use one analysis JPEG for preview and detail; label the disclosure `사진 보기`. Never promise original resolution or automatic photo-library saving.
- Keep bottom navigation visible in its own `AppFrame` row on Home, Notes, Search and note details. Content scrolls above it; navigation must not cover editing controls with a keyboard or 200% text.
- Photo and editor drafts are account-scoped memory only, retained through in-app navigation and cleared on sign-out. Failed result saves offer `노트 저장 다시 시도`, which must not start another AI request.

## Signed-out home layout

Keep the brand and introduction top-aligned with a shared left gutter. Use a
28px header-to-introduction gap and content-sized hero; no fixed-height hero
or bottom alignment inside it. Leave flexible space below the feature list
and above the bottom navigation in its separate persistent row.

## KakaoTalk entry

On mobile KakaoTalk entry, show a compact external-browser guidance screen
before the normal app UI: Safari on iOS, Chrome on Android. Detection is only
a UI hint, never an authentication or authorization check. Browser switching
requires a tap; do not auto-redirect or transfer login codes/session tokens.
Offer default-browser handoff, link copying and selectable-address recovery.
Regular browsers keep the existing flow. Physical-device app switching remains
a separate acceptance check from browser emulation.

## Home photo review

The empty Home screen has a clear heading, a quiet camera placeholder, and
large capture/attachment actions. After selection, show the uncropped preview
first, then reselect/remove controls and the primary conversion action. Bound
the preview height to the viewport so normal portrait layouts can show the
conversion button; landscape and enlarged text scroll above the dock. Preserve
the account-scoped photo draft across tab navigation.

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
- 동작 이름은 화면의 버튼과 맞춘다. 사진 정리는 ‘변환’, 반복 실행은 ‘다시 변환’.
- 삭제·덮어쓰기 확인, 미저장 내용, 일시 보관 기록의 소멸, 오류/재시도 안내,
  접근성 레이블처럼 사용자의 판단과 데이터 보존에 필요한 문구는 유지한다.
- 사용자가 작성한 제목/본문 및 저장된 기록은 문구 정리 대상으로 일괄 수정하지 않는다.

## Android 하단 시스템 영역 — 수정 대기

현재 코드의 Android 고정 48px 보정은 사용자 실기기에서 과도한 여백을 만들었다.
이 보정을 새 화면의 디자인 기준으로 재사용하지 않는다. `docs/handoff.md`의
미해결 사항에 따라 실제 기기 측정과 브라우저의 표준 안전 영역 처리를 기준으로
교체해야 한다. 화면 높이와 안전 영역을 중복 반영하지 않으며, PC 화면 모사만으로
시스템 바 겹침이나 여백 문제가 해결됐다고 판단하지 않는다.
