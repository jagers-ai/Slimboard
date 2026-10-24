# Slimboard 개발 지침

## 커밋 작성 규칙

- 이 저장소에서 앞으로 작성하는 커밋의 제목과 본문은 한글로 쓴다. 다른 컴퓨터나 에이전트에서 작업할 때도 같은 규칙을 따른다.
- 제목은 변경 목적을 짧고 구체적으로 적는다. 예: `수정: 홈 화면 상단 여백과 정렬 조정`.
- 본문에는 변경 이유, 주요 변경 내용, 실제 수행한 검증을 한글로 적는다. 문서만 바뀌었다면 변경 내역 확인 등 수행한 검증만 기록한다.
- 코드 식별자, 파일 경로, 명령어, 제품명과 오류 원문처럼 정확성이 필요한 표기는 원래 언어를 유지해도 된다.
- 자동화 도구를 사용하더라도 가능하면 실행 전에 한글 메시지로 커밋을 만들어 기본 영어 메시지가 생성되지 않도록 한다.
- 이 규칙을 적용하기 위해 이미 공유된 과거 커밋의 메시지나 이력을 다시 쓰지 않는다. 이력 변경은 사용자가 별도로 명시적으로 요청한 경우에만 검토한다.

## 디자인 기준

- 새 페이지·기능·컴포넌트를 만들거나 기존 UI를 수정하기 전에 루트의 `DESIGN.md`를 읽고 따른다. 이 기준은 실험실뿐 아니라 로그인, 기록, 검색, 상세, 편집 등 사용자에게 보이는 모든 화면에 적용한다.
- `DESIGN.md`를 디자인 판단의 기준으로 삼고, `app/globals.css`의 공통 스타일과 CSS 변수, `app/notebook.css`의 노트 화면 패턴, `components/`의 기존 구성요소를 먼저 확인한다. 비슷한 화면을 별도의 스타일로 다시 만들지 말고 기존 패턴을 재사용한다.
- 새 기능은 현재의 흰 배경·짙은 녹색 주요 동작·문서 중심 구성을 확장한다. 페이지별로 독자적인 색상, 글꼴, 그림자, 버튼, 간격 체계를 도입하지 않는다. 기존 코드에 남은 불일치는 새 화면의 근거로 복제하지 않는다.
- 반복해서 쓰일 새 패턴은 공통 구성요소나 공통 스타일로 추가하고 `DESIGN.md`에 사용 기준을 함께 기록한다. 디자인 방향을 바꾸는 작업은 사용자의 요청 범위 안에서만 진행하고 문서와 구현을 함께 갱신한다.
- 정상 화면뿐 아니라 해당 기능에 필요한 빈 상태, 로딩, 오류, 재시도, 작업 중 비활성 상태도 설계한다. 분석 실패나 화면 이동 때문에 선택한 사진 또는 작성 중인 내용이 의도치 않게 사라지지 않도록 한다.

## UI 작업 완료 기준

- 변경한 화면에서 기본 흐름과 관련 오류·빈 상태를 확인한다. 기존 공통 구성요소를 바꿨다면 이를 사용하는 영향받는 화면도 확인한다.
- 모바일 320px 및 약 400px 너비, 가로 화면, 글자 200% 확대에서 가로 넘침과 가려진 내용이 없는지 확인한다. 터치 영역 48px 이상, 입력 글자 16px 이상, 키보드 포커스와 레이블, 안전 영역을 지킨다.
- 브라우저에서 확인한 환경·크기·흐름과 결과를 `docs/mobile-testing.md`에 기록한다. 기존 검증 기록은 보존하고, 실제로 수행하지 못한 항목은 미검증으로 남긴다. 화면 크기 모사나 Mac Safari 확인을 실제 아이폰·안드로이드 촬영 검증으로 표현하지 않는다.
- 코드 변경에 맞는 테스트·타입 검사·빌드 등 필요한 검증을 수행한다. 문서만 바뀐 경우에는 문서와 변경 내역을 확인하며 불필요한 전체 테스트를 반복하지 않는다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
