# ChatGPT Sites deployment

For current branch, known issues and another-Mac setup, read [handoff.md](handoff.md) first. The verification counts below describe earlier milestones, not the latest state.

This deployment is based on jagers-ai/Slimboard commit
8fdf321e7667dda1360b602cc9d6b77074660194 (experiment/chatgpt-plan-ocr).
The original Mac checkout is preserved. This checkout runs the same app through
Vinext and the supported Sites Worker integration.

## Audience and identity

The Site audience is public. ChatGPT sign-in is not required. Personal note
access uses the existing Supabase Google OAuth/PKCE session and owner checks.
The exact permitted callback is
https://slimboard-jagers.beliandeve.chatgpt.site/auth/callback.
No private API key is sent to the browser. Runtime values are Sites secrets;
only Supabase's public URL/publishable key are compiled into browser assets.
Local .env.local/.dev.vars and outputs are ignored and never published.

### 배포용 브라우저 설정 확인

별도 Sites 체크아웃에서 빌드할 때는 기존에 동작한 체크아웃의
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를
Git에서 제외된 `.env.local`에 연결한다. 이 값이 없으면 서버에서 로그인 상태가
확인되어도 브라우저에서 로그인 및 사진 선택 화면을 초기화할 수 없다.
패키징 뒤 공개 설정이 브라우저 번들에 있는지, 환경 파일이 배포 파일에 들어 있지
않은지 확인한다. Sites는 같은 소스 커밋으로 다시 저장할 때 기존 아카이브를
재사용할 수 있다. 공개 설정을 바로잡아 교체할 때는 새 커밋으로 버전을 저장하고
로그인이 유지된 브라우저에서 확인한다.

## Hosting adaptations

- Browser canvas decodes/orients input and resizes to a 2560px maximum edge,
  using JPEG quality .86 (then .8/.7 only if needed to stay below 10 MiB).
- Server validates JPEG structure/dimensions, strips APP/COM metadata, and
  stores that analysis image only. Original camera/album files are not stored.
  Native Sharp is not part of the Worker runtime.
- AI token/cost accounting uses a private D1 table, not an ephemeral filesystem.
  It stores the existing metadata-only record without photos, note content,
  prompts, account identifiers or keys. No public route exposes this table.
- Model gpt-6.2-sol, medium reasoning, Ultrafast tier, no automatic paid retries.
- Existing Supabase notes, ownership filters, encrypted recovery receipts,
  request limits and deletion queue remain in place.

## Verification

2026-10-24: 82 automated tests passed, including the image and durable usage
adaptations. Actual built Worker on loopback passed 17 live Supabase checks
(upload, idempotence, owner image access, other-account denial, receipt recovery,
edit preservation and deletion); disposable fixtures were cleaned, no AI calls.
Type checking and the production Worker build passed. Original repo changes
remain untouched. Physical iPhone/Galaxy camera testing is separate from
browser testing and is not established by viewport simulation.

Worker fetch uses manual redirects and rejects non-2xx responses, so credentials
are not forwarded to another destination. A local workerd reproduction confirmed
that the original redirect:error option throws before sending a request.

The recovery cipher accepts explicit UTF-8 bytes for Worker/Node compatibility.
`npm run test:sites-runtime` exercises actual workerd request construction,
structured analysis parsing, D1 accounting and receipt encryption/decryption
with a fake provider response (no paid API call).

## Public verification completed

The public Google OAuth round trip and real analysis/save/reload were verified
on 2026-10-24. Anonymous access requires no ChatGPT login. See mobile-testing.md
for exact tests and remaining physical-device checks. Final test counts are
83 automated checks plus one actual workerd integration. A successful deployed
analysis and durable private cost log were confirmed; test-only data was removed.

The shared AppLink calls the supported router hook directly, avoiding a Vinext
beta production dynamic-import issue in next/link. Navigation stays within the
current document so in-memory photo/editor drafts are retained.
