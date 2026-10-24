# 다른 Mac에서 이어서 개발하기

기준일: 2026-10-25 (한국 시간). 이 문서를 먼저 읽고 실제 GitHub/Sites 상태를 다시 확인한다.

## 현재 작업 위치

- 저장소: https://github.com/jagers-ai/Slimboard
- **최신 작업 브랜치: `experiment/chatgpt-sites`**
- `experiment/chatgpt-plan-ocr`는 Sites 이전의 개발 이력이다. 최신 UI 작업을 그 브랜치에서 시작하지 않는다.
- 공개 사이트: https://slimboard-jagers.beliandeve.chatgpt.site/
- Sites 프로젝트 ID: `appgprj_6adca501365c8191a5b295f20cc879e2`
- 현재 공개 버전: **11**, ChatGPT 로그인 없이 접속 가능. 개인 기록은 Google 로그인 필요.
- 마지막 기능 변경의 GitHub 커밋: `bf58b8b9777e9573d950647fff7b007e0559c9f7`
- 같은 기능 상태의 Sites 소스 커밋: `6fa14e91864d2a77f630b339aa6f179e385b35b7`
- 위 두 해시는 이후 인수인계 문서 커밋을 포함하지 않는 기능 기준점이다.

## 가장 먼저 이어서 할 일: 하단 여백 문제

**아직 해결되지 않았다. 현재 배포에는 Android 고정 48px 보정이 남아 있다.**

1. 처음 사용자는 Android Chrome에서 홈·검색·노트 메뉴의 아래 글자가 휴대폰 3버튼 영역에 가려진 스크린샷을 제공했다.
2. `--navigation-min-bottom: 48px` 보정을 적용했으나, 사용자가 다시 제공한 화면에서는 하단 메뉴가 과도하게 위로 떠 있었다.
3. 사용자는 고정 숫자로 추정하는 보정을 거부하고, 표준 안전 영역 처리와 실제 기기 측정을 요청했다.
4. 공식 문서 조사 및 Android/iPhone 원격 검사 방법 안내까지 완료했다. **48px 제거, 표준 방식으로의 교체, 실기기 측정 및 그에 따른 추가 배포는 아직 하지 않았다.**

관련 코드:

- `components/AppFrame.tsx`: Android 식별 시 48px 설정, 표시 영역 높이·위치 계산.
- `components/PhotoZoom.tsx`: 사진 모달에도 같은 48px 설정.
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
- 기존 기록/사용자 데이터는 보존. Google 로그인, 소유자 확인, 요청 제한,
  중복 요청 방지, 저장만 재시도 및 삭제 정리 흐름을 유지.
- 카카오톡 모바일 감지 시 외부 브라우저 안내. iOS Safari/Android Chrome 열기,
  기본 브라우저 열기와 링크 복사 제공. 실제 OS 앱 전환의 전 기기 보장은 아님.
- 사용자 화면에서 이미지 처리 크기·클라우드·서버 응답 등 내부 설명은 제거/간소화.
  삭제 확인·미저장 내용·복구 안내 등 필요한 정보는 유지.
- `gpt-6.1-sol`, reasoning effort `medium`. 실제 토큰/단가 비용은 비공개 로그.
- 웹앱과 ChatGPT Sites 유지. Vercel/PWA/하이브리드로 임의 전환하지 않는다.
- 이전 화이트보드 사진 두 장의 모델 병렬 비교를 시작하지 않는다.
- API 키를 채팅/GitHub에 노출하지 않는다. 크레딧 만료일은 조회하지 않는다.
- **커밋 제목과 본문은 한글. 과거 커밋 이력은 재작성하지 않는다.**

## 다른 Mac의 시작 절차

1. 기존 폴더가 있다면 `git status`와 브랜치/원격을 먼저 확인하고 사용자 변경을 보존한다.
   `reset --hard`, 강제 checkout, 폴더 덮어쓰기를 하지 않는다.
2. 최신 `experiment/chatgpt-sites` 브랜치를 받는다. 새 폴더에 복제할 때의 예:

   ```sh
   git clone --branch experiment/chatgpt-sites https://github.com/jagers-ai/Slimboard.git Slimboard
   cd Slimboard
   ```

   기존 저장소에서는 변경 사항을 보존한 뒤 fetch하고 해당 브랜치를 안전하게
   전환/갱신한다. 과거 Mac이 `03abcae`에 머물러 있어도 이력을 초기화하지 않는다.
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

GitHub 동기화 시에는 기존 `experiment/chatgpt-sites` HEAD를 확인하고 그 부모를
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
