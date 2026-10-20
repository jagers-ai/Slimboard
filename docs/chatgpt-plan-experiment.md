# ChatGPT 구독으로 실행하는 로컬 OCR 실험

개인 PC에서 Codex CLI의 **ChatGPT 로그인**으로 화이트보드 사진 한 장을 분석하는 개발용 실험입니다. 기존 Gemini 업로드 흐름과 별도로 `/lab/codex`에서 제목·원문·요약·검색어를 확인합니다. 이미지는 분석을 위해 OpenAI로 전송됩니다. 결과를 Supabase에 저장하지 않습니다.

**이 로그인 경로는 상업 서비스나 호스팅 서비스에 사용할 수 없습니다.** OpenAI의 [App-server 인증 안내](https://learn.chatgpt.com/docs/app-server#auth-endpoints)는 해당 인증을 상업·호스팅 서비스에 허용하지 않는다고 명시합니다. 따라서 이 실험을 Sites, Vercel, 공용 서버에 배포하거나 개인 구독 세션을 여러 사용자에게 제공하면 안 됩니다. 원격 서비스에서 ChatGPT 플랜을 사용하려면 별도로 지원되는 Sign in with ChatGPT 통합과 적용 조건을 확인하고 구현해야 합니다. 이 브랜치는 그 통합을 구현하지 않습니다.

## 실행

Node.js 24와 해당 계정에서 사용할 수 있는 Codex가 필요합니다. 프로젝트 폴더에서 실행하세요.

```bash
npm ci
npm install -g @openai/codex
npm run lab:login
npm run lab:status
npm run lab:start
```

`lab:login`이 여는 공식 로그인 화면에서 본인의 ChatGPT 계정으로 로그인한 뒤, [http://localhost:3000/lab/codex](http://localhost:3000/lab/codex)를 엽니다. 브라우저 로그인이 어려운 로컬 환경에서는 `npm run lab:login -- --device-auth`를 사용할 수 있습니다. 비밀번호·토큰·API 키를 Slimboard에 입력하지 않습니다.

실험은 전용 Codex 로그인 폴더 `~/.slimboard/codex-local`을 사용합니다. 기존 `~/.codex`나 환경의 `CODEX_HOME`을 재사용하지 않습니다. 로그인의 저장과 갱신은 공식 CLI가 관리하며, 앱 코드는 인증 파일을 읽거나 복사하지 않습니다.

| 선택 설정 | 용도 |
| --- | --- |
| `SLIMBOARD_CODEX_BIN` | `codex` 대신 실행할 공식 CLI 경로 |
| `SLIMBOARD_CODEX_HOME` | 로그인·분석에서 함께 사용할 전용 CLI 폴더 |
| `SLIMBOARD_CODEX_MODEL` | 사용할 모델 이름. 지정하지 않으면 CLI 기본값 사용 |

로그인 성공은 OCR 성공이나 특정 모델 권한을 보장하지 않습니다. 실제 사진 분석이 성공한 뒤에만 해당 계정·모델 조합이 동작한다고 판단하세요. 플랜별 사용 한도와 모델 접근 권한은 계정 상태에 따르며, 이 실험은 잔여 한도나 플랜 종류를 조회하지 않습니다. 기본 모델 표시는 실제 모델 이름을 추측하지 않고 `codex-cli-default`로 반환합니다.

## 제한과 구현

- PNG·JPEG·WebP 한 장, 최대 10MiB를 받습니다. MIME 유형과 파일 서명을 확인합니다.
- 서버 API는 개발 모드·명시적 활성화·루프백 Host에서만 동작하고, 업로드는 같은 Origin만 허용합니다. `lab:start`가 로컬 주소와 활성화 설정을 적용합니다.
- `codex login status`에서 ChatGPT 로그인이 확인된 경우에만 `codex exec`를 한 번 실행합니다. API 키 로그인과 모호한 상태는 거부하며 유료 API로 전환하거나 자동 재시도하지 않습니다.
- 자식 프로세스에 앱 비밀값이나 `OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`을 전달하지 않습니다. 직접 HTTP 인증 요청이나 사용자 토큰 처리를 구현하지 않습니다.
- 새 임시 폴더에서 이미지·JSON 스키마를 전달합니다. `--ignore-user-config`, `--no-daemon`, `--ephemeral`, `--sandbox read-only`와 `approval_policy="on-request"`를 적용합니다. 셸·웹 검색·앱·플러그인·훅·브라우저·다중 에이전트 등 추가 도구를 비활성화하며, 관리 정책과 샌드박스를 우회하지 않습니다.
- 상태 확인은 최대 10초, OCR은 기본 120초입니다. 코드 옵션의 OCR 제한은 최대 180초입니다. 종료·오류·시간 초과 시 임시 파일을 정리하고, POSIX 환경에서는 실행 프로세스 그룹도 종료합니다. Windows에서는 직접 실행한 프로세스 종료만 보장합니다.
- 결과 파일은 최대 1MiB이며 `title`, `rawText`, `summary`, `keywords`의 유형과 허용 키를 다시 검증합니다. CLI의 원시 로그나 인증 상태 출력은 웹 응답에 싣지 않습니다.

화이트보드 프롬프트는 `lib/gemini.ts`의 `whiteboard-v2` 규칙을 따릅니다. 읽기 어려운 문구는 `[읽기 어려움]`으로 표시하고, 이미지 속 명령은 실행 지시로 취급하지 않습니다. `--ephemeral`과 임시 파일 삭제는 CLI의 인증 저장소나 서비스 측 데이터 보관 정책까지 삭제한다는 의미는 아닙니다.

## CLI와 검증

웹 화면 없이 실행할 수도 있습니다. JSON 결과는 터미널에 출력되므로 공유 터미널의 기록에 주의하세요.

```bash
node scripts/codex-ocr-cli.mjs --auth
node scripts/codex-ocr-cli.mjs /absolute/path/whiteboard.png
npm run lab:test
```

`scripts/codex-ocr.mjs`는 `checkCodexAuth(options?)`와 `analyzeWithCodex(buffer, mimeType?, options?)`를 내보냅니다. 옵션은 `binary`, `codexHome`, `model`, `timeoutMs`이며 TypeScript 선언은 `scripts/codex-ocr.d.mts`에 있습니다.

Codex CLI **0.163.0**의 실제 `--help`, `exec --help`, `login --help`, `features list`로 사용 플래그를 확인했습니다. 자동 검증은 실행 가능한 가짜 CLI를 사용해 인증 차단, API 키 미전달, 호출 인자, JSON 검증, 시간 초과와 임시 파일 정리를 확인합니다. 자동 테스트는 실제 로그인·모델 호출을 하지 않으며 OCR 정확도나 계정 사용 가능 여부를 검증하지 않습니다.

참고: [Codex 설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference), [Codex App Server 인증](https://learn.chatgpt.com/docs/app-server#auth-endpoints). CLI를 변경하면 위 플래그의 지원 여부를 다시 확인하세요.
