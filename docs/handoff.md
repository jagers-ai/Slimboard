# 다른 Mac에서 이어서 개발하기

기준일: 2026-10-25 (한국 시간). 아래 작업 위치와 공개 버전은 2026-11-20에 갱신했다. 이 문서를 먼저 읽고 실제 GitHub/Sites 상태를 다시 확인한다.

## 현재 작업 위치

- 저장소: https://github.com/jagers-ai/Slimboard
- **기준 브랜치: `main`.** 2026-11-20에 `design/karrot-style`을 병합해 공개 버전 24의 코드와 그 뒤의 문서 기록을 담았다.
- 최근 기능 작업은 `design/karrot-style`에서 했다. 이어서 작업하기 전에 `main`과 `design/karrot-style` 중 어느 쪽이 앞서 있는지 확인한다.
- `experiment/chatgpt-sites`는 2026-10-25 이후 갱신하지 않았고, `experiment/chatgpt-plan-ocr`는 Sites 이전의 개발 이력이다. 두 브랜치에서 새 작업을 시작하지 않는다.
- 공개 사이트: https://slimboard-jagers.beliandeve.chatgpt.site/
- Sites 프로젝트 ID: `appgprj_6adca501365c8191a5b295f20cc879e2`
- 현재 공개 버전: **24**, ChatGPT 로그인 없이 접속 가능. 개인 기록은 Google 로그인 필요.
- 마지막 기능 변경의 GitHub 커밋: `b38a3cc21d7207f5921c68a90295c4f9ef2ab6e3`
- 같은 기능 상태의 Sites 소스 커밋: `cea8f0c9d45d3a69d0863d6f77402405f18b2278`
- 위 두 해시는 이후 인수인계 문서 커밋을 포함하지 않는 기능 기준점이다.
- 공개 서비스는 ChatGPT Sites로만 배포한다. GitHub에 연결된 Vercel은 푸시마다 배포를 시도하지만, 2026-11-20 기준 계정 차단(`Account is blocked.`)으로 실패한다. 마지막 Vercel Production 배포는 2026-05-07의 `main`(`23cde99`)이다.

## 가장 먼저 이어서 할 일: 하단 여백 문제

**2026-11-04 `design/karrot-style`에서 Android 고정 48px 보정을 제거했다. 실제 기기 확인은 남아 있다.**

1. 처음 사용자는 Android Chrome에서 홈·검색·노트 메뉴의 아래 글자가 휴대폰 3버튼 영역에 가려진 스크린샷을 제공했다.
2. `--navigation-min-bottom: 48px` 보정을 적용했으나, 사용자가 다시 제공한 화면에서는 하단 메뉴가 과도하게 위로 떠 있었다.
3. 사용자는 고정 숫자로 추정하는 보정을 거부하고, 표준 안전 영역 처리와 실제 기기 측정을 요청했다.
4. 공식 문서 조사 및 Android/iPhone 원격 검사 방법 안내까지 완료했다. **48px 제거, 표준 방식으로의 교체, 실기기 측정 및 그에 따른 추가 배포는 아직 하지 않았다.**
5. 2026-11-04 사용자가 목록형 홈 배포 화면(Android Chrome, 3버튼)에서 하단 메뉴가 떠 있는 스크린샷을 다시 제공하고 바닥에 붙여 달라고 요청했다.
   `AppFrame`·`PhotoZoom`의 Android 판별과 `--navigation-min-bottom`을 지우고, 탭 바·사진 도구 아래 여백을
   `max(8px, env(safe-area-inset-bottom))`만 쓰도록 바꿨다. Chrome 공식 문서상 웹 화면이 시스템 바 아래로
   확장되는 경우는 제스처 막대뿐이며 이때 안전 영역 값이 보고된다. **이 변경의 배포와 실제 Android(3버튼·제스처)·iPhone 확인은 아직 하지 않았다.**
   원래의 3버튼 가림이 다시 나타나면 위 실측 항목으로 원인을 확인하고, 고정 높이를 다시 넣지 않는다.

관련 코드:

- `components/AppFrame.tsx`: 표시 영역 높이·위치 계산. (Android 48px 설정은 2026-11-04 제거)
- `components/PhotoZoom.tsx`: 사진 모달 표시 영역 계산. (48px 설정 제거)
- `app/notebook.css`: 하단 메뉴/사진 도구의 padding, 미리보기 높이, 고정 프레임.
- `lib/visible-viewport.ts`: 표시 높이와 레이아웃 높이의 작은 값 및 top 범위 제한.
- `app/layout.tsx`: `viewportFit: cover`, `interactiveWidget: resizes-content`.
- `app/globals.css`: `env(safe-area-inset-*)` 변수.

다음 작업에서는 안전 영역과 표시 높이를 중복으로 빼거나 더하지 않는지 확인한다.
Android라는 이유만으로 일정 높이를 추가하지 않는다. 48px만 지운 뒤 원래 가림이
해결됐다고 단정하지 말고, 실제 기기가 보내는 값과 메뉴의 위치를 확인한다.

실측 항목: OS/브라우저 버전, 3버튼/제스처 모드, 화면 방향, `innerHeight`,
`documentElement.clientHeight`, `visualViewport.height/offsetTop/scale`,
계산된 safe-area inset과 메뉴/라벨의 실제 경계. 주소창 펼침/접힘과 검색 키보드를
열었다 닫은 상태를 각각 확인한다. 웹페이지가 운영체제 버튼 높이를 언제나 직접
알아내는 것은 아니다. 스크린샷과 수치를 함께 본다.

- Android: 폰의 USB 디버깅을 사용자가 켜고 연결 승인을 직접 한 뒤,
  Mac Chrome `chrome://inspect/#devices`에서 실제 휴대폰의 슬림보드 탭 검사.
- iPhone: 폰 Safari의 웹 속성 검사기와 Mac Safari의 개발자 기능을 켜고,
  케이블 연결/신뢰 승인 후 Mac Safari 개발자용 메뉴에서 해당 페이지 검사.
- USB가 어렵다면 별도의 임시 진단 링크로 수치를 확인하는 방안을 검토한다.
  일반 사용자 화면에 개발용 수치를 표시하거나 로그인 정보/노트 내용을 수집하지 않는다.

공식 참고:

- https://developer.chrome.com/docs/css-ui/edge-to-edge
  - 하단 고정 요소는 안전 영역을 반영한다. 최신 Chrome은 동적 inset과 최대 inset을
    조합하는 패턴을 설명한다. `safe-area-max-inset-bottom` 지원 범위도 확인한다.
- https://developer.chrome.com/docs/devtools/device-mode#limitations
- https://developer.chrome.com/docs/devtools/remote-debugging/
- https://webkit.org/web-inspector/enabling-web-inspector/

이전 16개 화면 검사는 가상의 48px 가림을 전제로 한 모사 검사였다. 실제 기기의
가림/과도한 여백을 해결했다는 증거로 재사용하지 않는다.

## 현재 구현된 기능과 유지할 결정

- 홈: 사진 촬영·첨부·확인·변환. 기록 목록은 노트 탭에만 표시.
- 하단 메뉴는 본문과 별도 영역으로 항상 표시. 본문만 스크롤.
- 노트 제목과 전체 원문은 바로 수정 가능. 요약은 아래에 접힌 상태.
- 키워드는 화면에서 숨기되 저장/검색에는 유지.
- 사진을 누르면 전체 화면으로 열림. 확대·축소·화면 맞춤·드래그·닫기·다운로드.
- 새 기록은 분석용 JPEG 한 벌과 노트를 Supabase에 저장. 원본은 별도 보관하지 않음.
- 기존 기록/사용자 데이터는 보존. Google 로그인, 소유자 확인, 중복 요청 방지,
  저장만 재시도 및 삭제 정리 흐름을 유지.
- 계정별 사진 분석 횟수 제한(시간당 10회, 하루 30회)은 2026-11-20 사용자 결정으로 없앴다
  (`b38a3cc`, `supabase/migrations/20261119170221_remove_note_analysis_limits.sql`). 임의로 되살리지 않는다.
  같은 노트를 동시에 두 번 분석하는 것은 계속 막고, 분석 요청 기록(`note_analysis_requests`)도 남긴다.
- 카카오톡 모바일 감지 시 외부 브라우저 안내. iOS Safari/Android Chrome 열기,
  기본 브라우저 열기와 링크 복사 제공. 실제 OS 앱 전환의 전 기기 보장은 아님.
- 사용자 화면에서 이미지 처리 크기·클라우드·서버 응답 등 내부 설명은 제거/간소화.
  삭제 확인·미저장 내용·복구 안내 등 필요한 정보는 유지.
- `gpt-6.2-sol`, reasoning effort `medium`, service tier `ultrafast`. 실제 토큰과 단가로 계산한 비용은 비공개 기록에 남긴다.
- 웹앱과 ChatGPT Sites 유지. Vercel/PWA/하이브리드로 임의 전환하지 않는다.
- 이전 화이트보드 사진 두 장의 모델 병렬 비교를 시작하지 않는다.
- API 키를 채팅/GitHub에 노출하지 않는다. 크레딧 만료일은 조회하지 않는다.
- **커밋 제목과 본문은 한글. 과거 커밋 이력은 재작성하지 않는다.**

## 다른 Mac의 시작 절차

1. 기존 폴더가 있다면 `git status`와 브랜치/원격을 먼저 확인하고 사용자 변경을 보존한다.
   `reset --hard`, 강제 checkout, 폴더 덮어쓰기를 하지 않는다.
2. 최신 `main` 브랜치를 받는다. 새 폴더에 복제할 때의 예:

   ```sh
   git clone --branch main https://github.com/jagers-ai/Slimboard.git Slimboard
   cd Slimboard
   ```

   기존 저장소에서는 변경 사항을 보존한 뒤 fetch하고, `main`과 `design/karrot-style` 중
   앞선 브랜치로 안전하게 전환/갱신한다. 과거 Mac이 `03abcae`에 머물러 있어도 이력을 초기화하지 않는다.
3. `AGENTS.md`, `DESIGN.md`, 이 문서, `docs/sites-deployment.md`,
   `docs/openai-api.md`, `docs/code-review-2026-10-24.md`, `docs/mobile-testing.md`를 읽는다.
4. **Node.js 24** 사용 여부를 확인한다. 현재 Sites 브랜치는 Vinext/Workers 기반이다.

   ```sh
   node --version
   npm run install:ci
   npm run typecheck
   npm run lab:test
   npm run dev
   ```

   개발 주소는 기본 `http://127.0.0.1:5173/`. `install:ci`는 이 환경용 `npm ci`
   래퍼다. 예전 브랜치의 `lab:start`/`lab:phone` 명령을 현재 브랜치에 가정하지 않는다.
   로그인/저장/변환에는 아래 환경 설정이 필요하다. `npm run build`는 프로덕션 빌드,
   `npm start`는 빌드 후 로컬 Worker 실행이며 터미널에 표시된 주소를 사용한다.

## 키와 환경 설정

`.env.local`, `.dev.vars`와 로컬 도구 상태는 Git에서 제외되어 다른 Mac으로 자동
이동하지 않는다. 기존 Mac의 값이 있으면 안전하게 재사용하고, 값은 출력하지 않는다.
필수 환경 변수 이름은 다음과 같다. 값은 이 문서에 적지 않는다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — 서버 전용
- `OPENAI_API_KEY` — 서버 전용
- `NEXT_PUBLIC_SITE_URL` — 실행 환경에 맞는 주소

현재 구성은 공개 빌드 값은 `.env.local`, 로컬 Worker용 값은 `.dev.vars`를 사용한다.
Sites의 배포 환경 비밀 값은 이미 설정되어 있으며 로컬 파일과 별개다.
`npm start`의 빌드 후 Wrangler 실행은 `dist/server/wrangler.json` 기준이라
비밀 파일 탐색 위치가 개발 서버와 다르다. 이전 로컬 검증에서는
`dist/server/.dev.vars`를 임시로 사용했다. 이 방식을 쓰면 빌드 폴더의 임시
비밀 파일을 반드시 지운 뒤 배포 아카이브를 만들고, 값이 포함되지 않았는지
검사한다. 원래 루트의 로컬 설정 파일은 보존한다.
다른 Mac에서 키가 없으면 연결된 OpenAI Developers/Supabase 플러그인의 안전한
절차를 사용한다. 기존 키가 있다는 이유로 새 키를 자동 발급하거나 폐기하지 않는다.
새 키 발급이 필요한 경우에만 사용자에게 확인하고, 키를 채팅에 붙여넣으라고 하지 않는다.
Google 로그인 검사는 callback 허용 주소도 확인해야 한다. 현재 공개 callback은
`https://slimboard-jagers.beliandeve.chatgpt.site/auth/callback`이며 로컬 주소 허용을
완료했다고 가정하면 안 된다.

## Sites 소스와 GitHub 이력이 다른 점

**GitHub 저장소와 Sites 내부 소스 저장소는 같은 코드 트리를 별도 커밋 이력으로
보관한다. 서로 다른 커밋 ID가 정상이며, 강제로 서로 덮어쓰면 안 된다.**

배포 작업 시에는 연결된 Sites 플러그인의 최신 SKILL.md를 읽는다.
기존 프로젝트 ID를 그대로 사용해 `get_site`와 소스 쓰기 자격 증명을 받고,
플러그인의 소스 열기 절차로 **비어 있는 별도 폴더**에 기존 Sites 소스를 받는다.
GitHub 복제 폴더에서 소스 열기를 실행하면 이력 차이로 충돌할 수 있다.

Sites 체크아웃과 GitHub 최신 코드/인수인계 문서를 비교해 필요한 변경만 반영한다.
GitHub의 `.env`/로컬 도구 상태를 무작정 복사하지 않는다. 기존 프로젝트를 새로
만들거나 audience를 바꾸지 않는다. 한글 메시지로 먼저 커밋하고 공식 소스
헬퍼로 빌드/동기화/패키징한 뒤, 정확한 소스 SHA와 아카이브를 저장·배포한다.

GitHub 동기화 시에는 작업 중인 브랜치(현재 `main` 또는 `design/karrot-style`)의 HEAD를 확인하고 그 부모를
이어가는 일반 커밋을 만든다. Sites의 다른 이력을 강제 push하지 않는다.
이 Mac에서는 `git commit-tree`로 Sites의 같은 트리를 GitHub 이력에 연결했다.
다른 Mac에서도 트리와 부모를 확인하고 일반 push의 동시 변경 검사를 유지한다.
배포마다 Sites의 새 버전 ID/URL/상태를 실제 도구 응답으로 확인한다.

유지해야 할 호환 수정:

- `components/AppLink.tsx`: 일반 next/link로 되돌리면 Sites의 이전 모듈 문제와
  메모리 초안 유실이 재발할 수 있다.
- Worker fetch의 `redirect: manual` 및 비정상 응답 거부.
- 복구 암호화 입력의 명시적 UTF-8 바이트 변환.
- 비공개 사용량 로그의 D1 바인딩 `DB`와 서버 비밀 키의 브라우저 유출 방지.

## 검증과 이슈 상태

마지막 기능 변경에서 자동 검사 98개, 타입 검사, 프로덕션 빌드 통과.
사진 확대 8개 조합, 홈/노트/편집 24개 조합 등의 과거 모사 기록은
`docs/mobile-testing.md`에 있다. **실제 기기 검증과 구분한다.**

실제 iPhone/Android의 재촬영, 키보드/주소창, 시스템 바, 터치 확대/다운로드,
카카오톡→외부 브라우저 전환은 추가 검증이 남아 있다. 과거 실제 Google 로그인·
분석·저장 검증 기록이 모든 현재 모바일 동작의 검증을 뜻하지는 않는다.

#6 저장기능과 #7 모바일 레이아웃 최적화는 사용자 요청으로 닫았다.
문서 작성 시 열린 이슈는 0개. 닫힌 이슈에 실기기 미검증 사항을 명시했으며,
이슈가 닫혔다는 사실을 하단 여백 문제까지 해결됐다는 뜻으로 해석하지 않는다.

## 굿노트 연동 작업 (2026-11-26, 브랜치 `claude/slimboard-goodnotae-handwriting-9c2525`)

노트 사진의 판서를 굿노트에서 지우고 옮길 수 있는 펜 획으로 옮기는 기능이다.
`main`에 병합하지 않았고 Sites에 배포하지 않았다. 범위는 아이폰과 아이패드(iOS 공유 시트)다.

확정한 결정과 근거:

- PDF는 쓰지 않는다. 아이패드 굿노트에서 PDF 안의 글씨(Ink 주석 포함)는 지우개와 올가미가
  먹지 않았다(사용자 실기기 확인). 굿노트 파일(`.goodnotes`)을 직접 만들어 공유 시트로 넘긴다.
- 파일 형식은 공개 문서가 없어 LambertAlpha/natural-ink, Taylor-Nilsen/goodnotes-codec(둘 다 MIT)의
  사실을 바탕으로 직접 구현했다(`lib/goodnotes-file*.ts`). goodparse(GPL) 코드는 옮기지 않았다.
- 시험 파일 A, B, C를 실기기에서 비교해 B(codec 프로필, 페이지 단위 = pt × 11/6)를 기본으로 정했다.
  굿노트는 배경 PDF 1pt를 페이지 단위 11/6개로 그린다(`lib/goodnotes-export-format.ts` 주석).
- 공유할 때 `navigator.share`에 `files`만 넘긴다. `title`을 넘기면 파일에 저장할 때 텍스트 파일이 함께 생긴다(iPad 시뮬레이터 확인).
- 글씨를 가운데 선(골격선)으로 옮기는 지금 방식(`lib/ink-strokes.ts`)은 작은 글씨가 뭉친다.
  글자 윤곽을 그대로 따서 굿노트 볼펜 획 여러 개로 채우는 방식(시험 파일 D2)으로 바꾸기로 했다.
  사용자가 D2 실기기 확인을 생략하고 된다고 가정하고 진행하라고 했다. **D2는 실기기 미확인이다.**

진행 상태:

- 커밋 완료: `.goodnotes` 쓰기 모듈, 보내기 화면(`/notes/[id]/goodnotes`), 중심선 방식 개선.
- 커밋 완료(2026-11-26): `lib/ink-outline.ts`(사진 → 윤곽)와 `lib/goodnotes-fill.ts`(윤곽 → 볼펜 채움 획),
  각 전용 테스트(`scripts/ink-outline.test.mjs`, `scripts/goodnotes-fill.test.mjs`, `lab:test`에 등록).
  - 윤곽: 흐린 20px 글씨 획 소실 14.3% → 0.09%, 빈 보드 가짜 조각 0, Mac Node 최대 약 2.1초.
    미달: 흐린 20px 글자 구멍 보존 87%(목표 95%), 흐린 28px 94%.
  - 채움: 합성 글자 IoU 24/12/7pt 0.970/0.967/0.975, 실제 판서 A4 0.50MB, 채움 약 0.9초.
    실제 사진 IoU는 0.87에 머문다. 펜 굵기 하한 0.8pt(`goodnotes-export-format.ts`) 때문에 가는 글씨가
    두꺼워지는 것이 주원인이며, 하한을 낮출지는 정하지 않았다.
- 연결(2026-11-26): 보내기 화면이 윤곽 방식을 쓴다. Worker(`lib/goodnotes-ink.ts`의 `readInk`)가 윤곽 추출과
  펜 채움(`outlineToInk`, `lib/goodnotes-export-format.ts`)을 모두 하고, 화면은 문서 쓰기와 미리보기만 한다.
  분석 해상도는 긴 변 2560(`INK_LONG_SIDE`, 저장 사진을 줄이지 않음). 합성 2560 사진 IoU 0.93(2000은 0.89~0.91,
  1600은 0.90). 실제 판서 사진(1500×2000)은 Mac Chrome에서 준비 완료까지 약 2.4초다(`docs/mobile-testing.md`).
- 사용자 기준(2026-11-26): 변환 처리 시간은 휴대폰 기준 15초까지 괜찮고 정확도가 우선이다.
  결과 판단은 사용자가 직접 찍은 실제 판서 사진을 가장 중요하게 본다.
- 남은 확인: D2 방식 실기기, 로그인한 실제 노트와 저장된 사진(긴 변 2560)으로 처리 시간과 파일 크기,
  실제 아이폰과 아이패드 공유 시트.
- 작업 중 쓴 시험 사진과 비교 그림, 조사 자료는 세션 임시 폴더에만 있고 저장소에 넣지 않았다.
  사용자가 준 실제 판서 사진은 개인 자료라 저장소와 외부에 올리지 않는다.
