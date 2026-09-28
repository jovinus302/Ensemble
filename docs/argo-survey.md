# Argo 저장소 조사 보고서

- 조사일: 2026-09-28
- 대상: `C:\Users\siheon.ryu\Desktop\workspace\R2P\argo` (GitHub `beyondworks/argo` 클론, HEAD `c674412e`, 2026-09-27)
- 목적: **Ensemble 컨셉 참고 + 코드 참고**. Ensemble 정의: "사람과 AI Agent가 하나의 팀으로 일하는 프로젝트 공간. AI PM이 목표에 맞는 팀 구성을 돕고, 일을 배정하며, 결정과 결과를 다음 작업으로 연결한다." 초기 형태는 Slack 컨셉이며 PM 에이전트가 채팅에 참여해 에이전트 배정과 사람 협업을 함께 수행한다.
- 방법: 읽기 전용. Explore 에이전트 4개(개요·배포·이력 / 코어 엔진·API·인증 / 앱·데스크톱·DB·통합·테스트 / Messenger 협업 모델 심층)와 architect 1개(Ensemble 관점 판단)의 보고를 종합. 파일 경로는 저장소 루트 기준. 직접 열어 확인하지 못한 추정은 "추정"으로 표시.

---

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 한 줄 정의 | "The AI agent company that remembers everything" — 프롬프트 한 줄로 AI 크루(에이전트)를 영입하고, 폴더 단위 장기 기억(vault)으로 일을 시키는 개인용 "AI 회사" 제품 |
| 도메인 용어 | 사용자 = **사장(boss)**, 워크스페이스 = **회사(company)**, AI 에이전트 = **크루(crew)**, 기억 저장소 = **vault**, 다중 크루 토론 = **회의실(room)**, 승인 = **결재(approval)** |
| 제품 구성 | Argo 본체(Next.js 웹 콘솔 + Tauri 데스크톱 셸) / **Argo Messenger**(사람+크루 팀 메신저, 데스크톱·iOS·Android) / **Argo Office**(위키 페이지·메일·기록판, PWA, 초기 단계) / integrations(외부 에이전트 봇 어댑터) |
| 핵심 설계 원칙 | 로컬 우선(러너·기억·오케스트레이션은 사용자 PC에서 실행, 클라우드는 동기화·메신저 전용), BYOK/BYOA(사용자 본인 자격으로 LLM 연결, 중간 키 없음), 크루형 협업(위임·to/cc·초안 경쟁·회의실·루틴) |
| 기술 스택 | Node 22 / Next 15 App Router / React 19 / Tauri 2(Rust) / Supabase(Auth, Postgres+RLS, Realtime, Edge Functions) / `@anthropic-ai/claude-agent-sdk` / node:test |
| 규모·활동 | 파일 약 1,594개, 커밋 1,593개(2026-07-10 ~ 09-27, 11주), 릴리스 v0.1.88(거의 매일 패치), 실질 기여자 1~2명 |

---

## 2. 프로젝트 정체와 제품 구성

- **North Star**(`CLAUDE.md`): "일반 사용자가 가입해 프롬프트 한 줄로 AI 직원 회사를 만들고, 폴더 단위 기억으로 일 시키는 SaaS". 구 코드네임 crewbase. 네이밍은 그리스 신화 아르고호(전문 영웅 승선) 모티프, 디자인은 네이비+골드.
- **핵심 가치**(`README.md`, `CLAUDE.md`)
  - 로컬 우선: 러너·기억·오케스트레이션 전부 로컬. Supabase는 기기 간 동기화와 메신저용.
  - BYOK: Claude(Agent SDK 또는 구독 OAuth), Codex, Gemini, GLM, Kimi, OpenRouter, Grok, Antigravity를 사용자 계정으로 연결. 미들맨 키 없음.
  - 크루형 협업: 크루 간 to/cc·인박스·위임, 초안 경쟁(compete), 회의실(room) 토론, 예약 루틴.
  - 텔레그램/슬랙으로 대화 핸드오프(PC가 리더 기기).
- **하위 제품**
  - Argo 본체: `app/`(Next.js 웹 UI + API) + `src/`(코어 엔진) + `src-tauri/`(데스크톱 셸, macOS/Windows 배포).
  - Argo Messenger(`apps/messenger/`, v0.1.42): 사람과 크루가 같은 채널에서 일하는 팀 메신저. Vite+React+Tauri2, iOS/Android 포함, Supabase 직결.
  - Argo Office(`apps/office/`, v0.0.1): 메일·페이지·메신저 기록을 한 화면에 모아 크루에게 위임하는 웹 오피스(PWA). 최근 개발 최우선 트랙.
  - `landing/`: 랜딩 사이트이나 이 저장소에는 `privacy` 페이지만 추적됨(추정: 본체는 별도 관리).
  - `integrations/`: hermes-argo-msgr, openclaw-argo-msgr, server-connect.
- **제품 간 관계**: 본체가 크루 실행·기억·러너 오케스트레이션 코어, Messenger는 조직 커뮤니케이션 레이어, Office는 생산성 레이어로 Messenger 데이터(크루·결재·산출물·일지)와 연결. 셋 다 같은 Supabase 계정/DB를 공유. 소스 저장소(`beyondworks/argo`)와 배포 저장소(`beyondworks/argo-agent`, `beyondworks/argo-messenger`)가 분리됨.

---

## 3. 기술 스택과 저장소 구조

### 3.1 최상위 디렉터리

| 경로 | 역할 |
|---|---|
| `app/` | Next.js App Router. 웹 UI(`app/c/[ws]/…` 회사 콘솔)와 백엔드 API(`app/api/…`) |
| `apps/messenger/`, `apps/office/` | 하위 앱 |
| `src/` | 코어 엔진(.mjs): 채팅·러너 오케스트레이션, 엔진, 게이트웨이, 스케줄러, 동기화, 권한 게이트, 청구 |
| `src-tauri/` | Rust/Tauri 데스크톱 셸 |
| `supabase/` | DB 마이그레이션(117개) + Edge Functions(4개) |
| `integrations/` | 외부 에이전트 프레임워크용 봇 어댑터 |
| `vendor/` | Windows용 busybox-w32(`busybox64u.exe`) — 크루의 Bash 도구 기본 실행기 |
| `scripts/` | 빌드·스테이징·DB·E2E·스모크·시드·인시던트 대응 스크립트 |
| `test/` | node:test 테스트 392개 |
| `public/` | 정적 자산(부트 페이지, 폰트, 데스크톱 셸 부팅 JS) |
| `docs/` | selfhost, privacy-sync, routine-notifications 문서 |

### 3.2 패키지·설정

- `package.json`: `argo` v0.1.88, ESM. 스크립트: `dev`/`build`/`start`, `demo`(`demo.mjs` P0 수직 슬라이스), `service`(상시 구동 서비스 설치), `stage:sidecar`/`app:build`(Tauri 빌드), `test`(node --test), `smoke:standalone`, `test:pg`, `lint`, `prepare`(git hooksPath 자동 설정).
- 주요 의존성: `@anthropic-ai/claude-agent-sdk`, `@supabase/ssr` + `supabase-js`, `@tauri-apps/*`, `next ^15.5`, `react ^19`, `marked`, `d3-force`(기억 그래프), `json5`/`yaml`/`smol-toml`, `zod`. dev: eslint 10, espree, express.
- `next.config.mjs`: Agent SDK·MCP SDK는 서버 외부 패키지로 번들 제외(서브프로세스 스폰용), `ARGO_STANDALONE=1`이면 standalone 출력(데스크톱/워커 패키징), 보안 헤더(CSP 등) 전역 적용, `images: unoptimized`.
- `middleware.js`: 인증 게이트. Supabase env 없으면 로컬 무인증 단일 사용자 모드(loopback 아닌 Host는 421로 차단해 DNS 리바인딩 방지). 공개 경로는 `/login`, `/legal`, `/api/ping`, `/api/billing/webhook`, `/auth*`, `/api/auth/pair*`, `/api/device/*`만.
- `eslint.config.mjs`: 규칙은 `no-undef` 하나만(미정의 식별자 차단 목적, 스타일 규칙 의도적 배제).
- `instrumentation.js` / `instrumentation-node.mjs`: Next 부팅 훅. nodejs 런타임에서 스케줄러(루틴), 게이트웨이(텔레그램/슬랙 폴러), 동기화, 고아 턴 스위퍼 상시 기동. `ARGO_PARENT_PID`로 Tauri 부모 종료 시 고아 방지.

---

## 4. 코어 엔진 (`src/`)

### 4.1 모듈 맵

| 경로 | 역할 |
|---|---|
| `src/chat.mjs` (1,962줄) | **핵심 대화 엔진**. 진입점 `chat(wsId, slug, message, sessionId, opts)`. 시스템 프롬프트 조립(`systemPromptFor`), 도구 게이트, 러너 디스패치, 자가치유(러너 장애 시 다음 러너로 전환), 산출물 수집 |
| `src/engine/session.mjs` | 네이티브 세션 전사 저장·절단(`.sessions/native/<slug>.json`, 400,000자 예산, 오래된 이미지 우선 삭제, tool_use/tool_result 짝 검증) |
| `src/engine/native-query.mjs` | Argo 자체 도구 루프. SDK와 동일한 메시지 스트림을 흉내내 하류 코드 무변경 |
| `src/engine/native-flags.mjs` | 네이티브 엔진 대상 러너 판정 |
| `src/engine/builtin-tools.mjs`, `browser-tools.mjs`, `computer-tools.mjs` | 내장 도구 스펙 |
| `src/engine/mcp-client.mjs`, `crew-mcp.mjs` | 외부 MCP 접속, 크루 간 위임 도구 다리 |
| `src/engine/messages-http.mjs`, `responses-wire.mjs`, `gemini-wire.mjs` | 벤더별 HTTP 와이어 |
| `src/engine/shell-backend.mjs` | Bash 도구 실행기(Windows는 vendor busybox) |
| `src/runners/catalog.mjs` | 러너·모델 카탈로그, `pickRunner`(명시 지정 > 회사 기본 > 연결 순서 폴백) |
| `src/runners/creds.mjs` | BYOK/BYOA 자격 저장·env 조립(`sdkEnvFor`) |
| `src/runners/exec.mjs`, `codex*.mjs`, `gemini.mjs`, `grok.mjs`, `webauth.mjs`, `process-tree.mjs` | CLI 탐지·조달, Codex/Gemini/Grok 통합, 브라우저 로그인 대행, kill-tree |
| `src/runners/error-class.mjs` | 오류 분류표(aborted / auth_expired / subscription_blocked / quota / vendor_overloaded / endpoint_not_found / cli_missing / model_unavailable / crash / unknown) |
| `src/runners.mjs` | 위 모듈의 facade. `externalExec`(CLI 러너 1턴), `resolveRunner`, `runnerStatus`, `isBilledRunner`(apikey만 과금), `CLI_CHAT_TURN_TIMEOUT_MS = 30분` |
| `src/gateway.mjs` (1,330줄) + `src/gateway/*` | 텔레그램/슬랙 브리지, 디스크 큐, 팀 메신저 서버측, 오피스 번역 |
| `src/prompts/castra-posture.mjs` | 유일 파일. 러너·모델 무관 공통 "실행 계약" 프롬프트 |
| `src/room.mjs` | 회의실(다중 크루 그룹챗), `runLimited`로 동시 발언 제한 |
| `src/permission-gate.mjs` | 도구 호출 하드라인(격리 홈·타 회사 워크스페이스·금고 제어 파일 접근 차단) |
| `src/devicesession.mjs`, `src/pairing.mjs` | "이 기기 = 이 계정" 기기 세션(`.device-session.json`, 0600, 토큰 자체 회전), `argo-pair.v1.<base64>` 페어링 코드 |

### 4.2 호출 흐름 (웹 채팅 1턴)

`app/c/[ws]/crew/[slug]/page.jsx`(클라이언트, 3초 폴링) → `POST app/api/companies/[ws]/chat/route.js` → `guardCompany` 인증 → `src/chat.mjs` `chat()` → `resolveRunner` → 실행 경로 4가지 중 하나 → 도구 호출은 `permission-gate.mjs` 경유 → 응답을 `thread.mjs`(스레드 파일)에 저장 → 클라이언트가 GET 폴링(mtime dedup)으로 수신. **채팅 응답 자체는 스트리밍이 아니라 폴링 기반**(주석: "3초 폴마다 800KB JSON"). 팀 메신저(`msgr.mjs`)와 오피스 번역은 Supabase Realtime broadcast 사용.

### 4.3 실행 경로와 러너

| 경로 | 러너 | 방식 |
|---|---|---|
| SDK | claude | `@anthropic-ai/claude-agent-sdk`의 `query()` |
| sdk-compat | kimi, glm, openrouter, grok | Anthropic 호환 `/v1/messages` 엔드포인트를 같은 SDK 배관으로 |
| CLI 래핑 | codex, gemini(oauth/host), antigravity | `externalExec`가 서브프로세스 spawn, stdin으로 프롬프트, `--output-last-message` 파일로 회수. codex는 danger-full-access, gemini는 `--approval-mode yolo` |
| 네이티브 엔진 | API 키 러너 기본 경로 | `native-query.mjs` 자체 도구 루프 |

- 모델(`src/runners/catalog.mjs`): claude — Fable 5.1/5, Opus 5.5/5/4.8/4.7/4.6(+1M), Sonnet 5, Haiku 4.5. 인증 타입 apikey(`sk-ant-`) / oauth(`sk-ant-oat01-`, 구독 토큰) / host(이 컴퓨터 CLI 로그인). codex — GPT-5.6 계열, GPT-6 Astra, GPT-5.5. gemini — 2.5 Pro/Flash, 3.x(gated). 2026-09-06부터 Gemini 신규 연결은 API 키만.
- **과금 차단 규칙**: `src/gateway/office-translate.mjs:21` `ONLY = { runner: 'claude', types: ['oauth','host'] }` — 오피스 메일 번역은 메일 주인의 Claude 구독으로만, apikey 배제. `src/runners/creds.mjs:427` `sdkEnvFor`가 번역 전용 모드에서 `CLAUDE_CODE_USE_BEDROCK`/`VERTEX` env를 비워 우회 과금 차단. 청구 판정 단일 진실은 `src/runners.mjs:302` `billedByType`/`isBilledRunner`.
- Bedrock/Vertex 1급 지원 UI는 없음(추정: Agent SDK가 지원하는 경로가 호스트 env로 통과될 수 있음을 전제한 방어 코드).
- 자동 조달(스캐빈징) 금지: 사장이 명시 연결한 자격만 사용.

### 4.4 상태·동시성·오류

- 세션: SDK 러너는 SDK 자체 세션 저장소, 네이티브는 `src/engine/session.mjs` 로컬 파일.
- 동시성: `src/gateway/queue.mjs` 디스크 기반 at-least-once 큐, `GW_MAX_INFLIGHT=2`, `.claimed` 파일로 선점, 5분 초과 시 죽은 워커 잔재 회수·재실행.
- 오류: `error-class.mjs` 분류 + `classifyRunnerError`. 인증 실패 시 `markRunnerAuthFail`로 해당 턴 러너를 제외하고 다음 러너로 자동 전환(자가치유). CLI 도구 잠김은 재조달 후 1회 재시도.

### 4.5 게이트웨이 두 가지

1. **외부 메신저 브리지**(`src/gateway.mjs`): 텔레그램(long-poll `getUpdates`)·슬랙을 회사 "정문"으로 연결. 회사 봇(사장 대표) + 크루 직통 봇(1크루=1봇). 페어링은 6자리 코드 TOFU(최초 발신자 고정). 결재는 인라인 버튼 콜백 또는 텍스트("승인/거절 ap-xxx"). 메시지는 디스크 큐 → 워커 드레인 → 결과 회신.
2. **팀 메신저 서버측**(`src/gateway/msgr.mjs`, 1,561줄): 회사 내 여러 크루·기기 간 실시간 협업. Supabase Realtime(WebSocket), 기기 세션 JWT 인증, RLS가 "자기 크루 명의로만 발화·결재 확정"을 서버에서 강제. `@멘션` 릴레이, 위임(delegate), 순서 대기(`ORDER_WAIT_MS` = 2분). (상세는 14.2절)

### 4.6 프롬프트

- `src/prompts/castra-posture.mjs`: "Castra 실행 계약"(영문). 결과 중심 사고, 실패 경계 추적, 관련 사용자 플로우 전체 닫기, 지속 권한 내 실행, 재현 가능한 검증, 동료·위임 협업, 증거 기반 종료 선언. `ARGO_CASTRA` env로 온/오프, 모든 크루 시스템 프롬프트에 기본 주입.
- 실제 페르소나 카드는 회사 워크스페이스의 `agents/*.md`(런타임 데이터, 저장소 코드 아님). `src/chat.mjs` `systemPromptFor`가 카드 + 스킬 + 운영 규칙 + 안전 한계 + Castra 계약을 조립하는 "시스템 프롬프트 엔진".

---

## 5. 웹 앱 (`app/`)

### 5.1 회사 콘솔 `app/c/[ws]/`

| 경로 | 화면 |
|---|---|
| `page.jsx` | "데크"(Deck) 대시보드 — 메트릭·영입·기억 그래프·명판 |
| `crew/[slug]/page.jsx` | 크루와 1:1 채팅 |
| `room/page.jsx` | 다중 크루 회의실 |
| `activity`, `compete`, `import`, `mail`, `market`, `routines`, `settings`, `vault` | 활동 로그, 초안 경쟁, 옵시디언 가져오기, 크루메일, MCP·스킬 마켓, 예약 작업, 설정, 기억 문서 뷰어 |

### 5.2 API 요약 (`app/api/`)

| 경로 | 역할 |
|---|---|
| `/api/ping`, `/api/update-check`, `/api/runners`, `/api/feedback` | 부팅 마커, 업데이트 확인, 러너 상태, 피드백 |
| `/api/billing/webhook` | Lemon Squeezy 결제 웹훅(HMAC 검증) |
| `/api/device/{login,link,guest}`, `/api/pair/accept`, `/api/auth/pair(+/bind)` | 기기 로그인·연동·게스트, 페어링, 앱↔웹 로그인 브리지 |
| `/api/account/{claim,keys}`, `/api/me/*` | 계정 클레임, 계정 스코프 러너 자격, 내 정보·E2EE·결제·클라우드 내보내기 |
| `/api/companies`, `/api/companies/[ws]` | 회사 CRUD |
| `/api/companies/[ws]/chat(+/sessions,/upload,/abort)` | 크루 채팅 본체 |
| `/api/companies/[ws]/agents(+/[slug],/telegram)` | 크루 CRUD |
| `/api/companies/[ws]/{room,msgr,approvals,vault,keys,connections,connectors,devices,market,routines,compete,mail}` | 회의실, 팀 메신저, 결재, 기억, 러너 자격, 메신저 연결, 커넥터, 기기, 마켓, 루틴, 초안 경쟁, 크루메일 |
| `/api/companies/[ws]/{corrections,tasks,trash,files,workroots,local-assets,activity,boss-profile,export,import/obsidian}` | 교정 감지, 작업, 휴지통, 파일, 작업 폴더, 활동 로그, 사장 프로필, 내보내기, 옵시디언 가져오기 |

전 라우트가 `app/auth.mjs`의 `currentUser` / `guardCompany`로 소유권 검증.

### 5.3 인증·세션·권한

- 인증: Supabase Auth(이메일 매직링크, `app/auth/callback`, `/confirm`). env 없으면 인증이 꺼지고 로컬 1인 모드(`AUTH_ON`, `app/authmsg.mjs:10`).
- 세션 3계층(`app/auth.mjs:39`): ① 브라우저 `sb-*` 쿠키 ② 기기 세션 파일 ③ 게스트 모드(`gueststate.mjs`).
- **권한 모델: RBAC 없음.** 회사 단위 단일 소유자(`company.json.ownerId === user.id`). 1계정이 여러 회사를 소유하는 구조이며 멀티유저 협업이 아님. 예외: `ARGO_TENANT_OWNER`(클라우드 워커 1대=1계정), `ARGO_ADOPT_OWNER`(로컬→클라우드 이행).
- CSRF: `Sec-Fetch-Site` 헤더 기반 자체 가드(`app/authmsg.mjs:44`).

---

## 6. 하위 앱

### 6.1 Argo Messenger (`apps/messenger/`, v0.1.42)

- 목적: "사람과 크루가 같은 채널에서 일하는 조직 공간". 조직·채널·DM·메시지·@멘션·첨부·결재·크루 부재중·타이핑 지원(`App.jsx:1` 주석).
- 스택: React 19 + Vite 7(상태는 커스텀 hooks, Redux 없음), Tauri v2(데스크톱+모바일), `@supabase/supabase-js` 직결. 루트 앱의 `@argo/globals.css`·`@argo/i18n`·`@argo/theme` 재사용(`main.jsx:1-6`).
- 구조: `src/main.jsx` → `App.jsx`(단일 대형 컴포넌트). 주석: "데이터는 Supabase 직결, 실시간은 private topic `org:<id>` 방송" — **별도 백엔드 없이 RLS가 권한 경계**.
- 모듈: `work-panel.jsx`(작업 패널), `crew-face.mjs`(크루 아바타 SVG), `panes.mjs`, `graph3d.jsx`(3D 활동 그래프), `invite-dialog.jsx`, `mobile-auth-runtime.js`/`mobile-update.jsx`, `push.js`/`notify.js`.
- AI 연결: 메신저 자체는 LLM을 호출하지 않음. 크루는 채널 봇 참가자로 (a) 데스크톱 Argo 러너가 응답하거나 (b) 외부 에이전트(Hermes/OpenClaw)가 `msgr-bot` Edge Function을 봇 토큰으로 폴링해 응답. `apps/messenger/src-tauri/src/agents.rs`가 로컬 hermes/openclaw CLI를 찾아 원클릭 연동.

### 6.2 Argo Office (`apps/office/`, v0.0.1)

- 목적: "메일·페이지·메신저 업무 기록을 한 화면에 모으고 크루에게 일을 맡기는 웹 사무실(PWA)".
- 기능: TipTap 위키 에디터(`pages/Editor.jsx`, `PageView.jsx`), 공유·게시·버전·휴지통, 비공개 블록, Gmail 통합(`pages/Mail.jsx`, `api/mail/[op].js`, `server/gmail.js`), 메일 번역, 메신저 기록판(`pages/Records.jsx` — `msgr_work_runs`, `msgr_crew_approvals`, `msgr_attachments` 표시), 조직 공용 문서.
- 권한(`supabase/migrations/20260927170000_office_pages.sql`): 공간 `me`/`org`. `office_page_access(page)`가 부모 32단계까지 판정(소유자·관리자 전체, 게스트는 공유분만). 목록은 `office_page_list()` RPC로 후보를 먼저 좁힌 뒤 권한 판정.
- 번역(`…174000_office_translate_channel.sql`, `src/core/translate.js`): 메일 주인 계정이 로그인된 기기 한 대가 본인 Claude 구독으로 수행. 사용자 전용 Realtime 토픽 `ot:<uid>`(DB에 본문 미저장). 여러 기기면 claim 프로토콜로 첫 기기만 응답.
- 사람 통제: 크루는 메일 초안까지만(`Mail.jsx:1`), 발송은 사람이 버튼을 눌러야 함.

---

## 7. 데스크톱·모바일 (Tauri)

- **루트 `src-tauri/`**: `tauri 2.11.3` + log/opener/dialog/shell, 데스크톱 전용 updater/process. `src/lib.rs`는 UI가 아니라 **내장 Node + Next standalone 서버를 로컬 사이드카로 스폰**하는 셸. 포트 3001→3011→3021 시도, `/api/ping` 신원 마커+버전 대조 후 붙거나 새로 스폰. 앱 종료 시 사이드카 kill. `save_download` 커맨드(웹뷰 다운로드 우회). `identifier: com.beyondworks.argo`, 창 1280×820, CSP는 로컬 포트+Supabase만. 자동 업데이트는 GitHub Releases(`beyondworks/argo-agent`) `latest.json` + minisign 서명. capabilities는 최소 권한(opener URL 화이트리스트 등). `Info.plist`에 macOS TCC 문구(크루가 지정 폴더에서 일하기 위해). 실제 파일 I/O와 CLI 스폰은 Node 사이드카가 담당.
- **`apps/messenger/src-tauri/`**: `com.beyondworks.argo.messenger`. 플랫폼 분기 — macOS 네이티브 알림(`notify_mac.rs`), Android/iOS deep-link·push, iOS 커스텀 플러그인 web-auth(`ASWebAuthenticationSession`, `WebAuthPlugin.swift`), Android 커스텀 플러그인 apk-installer(`ApkInstallerPlugin.kt`, 스토어 미발행 단계 자가 업데이트). `agents.rs`가 hermes/openclaw 플러그인을 `~/.hermes/plugins`, `~/.openclaw/extensions`에 설치하고 `.env`에 봇 토큰을 쓰고 게이트웨이를 재시작.
- 모바일 네이티브 프로젝트는 없고 Tauri Mobile이 `gen/{android,apple}`에 자동 생성. `.caf`(iOS/macOS APNs 커스텀 사운드)·`.wav`(웹·데스크톱) 수신음 5종.

---

## 8. 데이터베이스 (Supabase)

- 마이그레이션 117개(`supabase/migrations/`). 주요 테이블군:

| 영역 | 테이블 |
|---|---|
| 조직/멤버 | `msgr_orgs`, `msgr_org_members`, `msgr_org_policies`, `msgr_org_docs`, `msgr_org_announcements`, `msgr_org_entitlements` |
| 채널/메시지 | `msgr_channels`, `msgr_channel_members`, `msgr_channel_prefs`, `msgr_messages`, `msgr_attachments`, `msgr_reactions`, `msgr_reads` |
| 크루(AI) | `msgr_crews`, `msgr_crew_approvals`, `msgr_crew_requests`, `msgr_crew_routines`(+`routine_edits`), `msgr_bots`, `msgr_executions`, `msgr_work_runs` |
| DM/친구 | `msgr_friends`, `msgr_friend_links`, `msgr_dm_grants` |
| 알림/결재 라우팅 | `msgr_notification_routes`(+`route_nodes`, `deliveries`), `msgr_push_tokens`/`sent`, `msgr_target_prefs` |
| 계정/보안 | `account_keys`, `device_keys`, `entitlements`, `wrapped_deks`, `recovery_wraps`, `key_mailbox`, `msgr_ai_consent`(AI 동의) |
| 자동화 | `msgr_automations`, `msgr_automation_runs`, `msgr_automation_scheduler` |
| Office | `office_pages`, `office_page_versions`, `office_shares`, `office_private_blocks`, `office_space_layouts`/`user_layouts`, `office_mail_accounts`, `office_mail_secrets` |

- **RLS**: 거의 모든 사용자 데이터 테이블에 적용(30개 마이그레이션에서 활성화). **쓰기는 `security definer` RPC 함수로만** — 테이블 직접 insert/update 정책은 거의 없음("표에 직접 쓰는 정책은 두지 않는다" 주석 다수).
- **Edge Functions**(`supabase/functions/`, Deno/TS): `ls-portal`(구독 포털 URL), `ls-webhook`(결제 웹훅, `entitlements` 유일 쓰기 경로), `msgr-bot`(외부 에이전트 봇 API, HTTP↔`msgr_bot_*` RPC 변환만, `verify_jwt=false`, 봇 토큰이 자격), `msgr-push`(APNs/FCM, `pg_net` 트리거).
- **Realtime**: private broadcast 토픽(`org:<id>`, `u:<uid>`, `ot:<uid>`), `realtime.messages` 테이블 RLS로 채널별 송수신 제한.
- `scripts/sql/msgr-automation-scheduler.sql`은 운영 수동 실행용(정본은 migrations).

---

## 9. 외부 통합 (`integrations/`)

| 경로 | 언어 | 역할 |
|---|---|---|
| `hermes-argo-msgr/` | Python(stdlib) | "Hermes Agent"(외부 에이전트 프레임워크, 추정)를 메신저 봇으로 연결. `getUpdates` 롱폴 → Hermes 세션 실행 → `sendMessage`(원글 답글). 설치 `~/.hermes/plugins/argo-msgr/`, 설정 `ARGO_MSGR_URL`/`ARGO_MSGR_BOT_TOKEN` |
| `openclaw-argo-msgr/` | TypeScript | "OpenClaw"(외부 에이전트 게이트웨이, 추정) 채널 플러그인. `index.ts` 15줄로 SDK를 얇게 감쌈. `.argo-msgr/outbox`에 발신 전 보존 |
| `server-connect/connect.py` | Python(stdlib) | VPS 콘솔에서 `curl | python3 -`로 실행. 원격 서버의 Hermes/OpenClaw 탐지, 봇 토큰 생성, 플러그인·`.env`·게이트웨이 재시작. `scripts/build-server-connect.mjs`가 플러그인을 임베드해 배포본 생성 |

- **공통 봇 프로토콜**: 실행권(`execution_attempt`) 발급, 크루 간 핸드오프(`MSGR: handoff` / `MSGR: done`), CC 참조 전달, 재시도 정책(401=중지, 408/429=재시도). 접근 판정은 Argo 서버(`msgr-bot` → DB RPC)가 매 응답마다 재판정.

---

## 10. 배포·운영·CI

- `Dockerfile`: "Argo 클라우드 워커"(node:22-slim 멀티스테이지). 인스턴스 1대 = 계정 1개(`ARGO_TENANT_OWNER`). 이미지에 워크스페이스·`.secrets.json`·`.env*`·`connections.json` 잔존 시 **빌드 실패**시키는 스캔 게이트 포함.
- `fly.toml`: `argo-worker-lean`, 도쿄(nrt), `/data` 볼륨, `auto_stop_machines=false`(폴러·스케줄러 상주), healthcheck `GET /login`.
- `.github/workflows/test.yml`: 모든 push/PR — macOS+Windows 매트릭스로 lint + test + Messenger 빌드·테스트 + standalone 스모크. 별도 `pg-drill` job(실 Postgres 17).
- `.github/workflows/release.yml`: `v*` 태그 — 버전 정합 게이트 → 테스트 → 신규 기기 스모크 → Tauri 빌드 → macOS 코드서명·공증·스테이플(tauri v2 secure timestamp 미부착 우회 재서명) → `beyondworks/argo-agent`에 draft 릴리스. Windows는 미서명(SmartScreen 경고 명시). `release-messenger.yml`은 `messenger-v*` 태그로 동일 절차.
- `.githooks/pre-commit`: 시크릿 커밋 차단(벤더별 키 시그니처, JWT, DB 접속 문자열, PEM 등 정규식). `prepare` 스크립트가 자동 활성화.
- 환경변수(코드 grep 기준, `.env.example` 없음): `ARGO_ROOT`, `ARGO_TENANT_OWNER`, `ARGO_STANDALONE`, `ARGO_PARENT_PID`, `ARGO_PORT/HOST`; `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; `ARGO_SYNC*`; `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `GEMINI_API_KEY`, `GLM_*`, `KIMI_*`, `OPENROUTER_BASE_URL`, `GROK_BASE_URL`, `ARGO_CLAUDE_BASE_URL`, `ARGO_CODEX_ENGINE`; `ARGO_ROOM_CONCURRENCY`, `ARGO_MAIL_CONCURRENCY`; `NEXT_PUBLIC_LS_CHECKOUT_*`; CI 서명 시크릿(`TAURI_SIGNING_PRIVATE_KEY`, `APPLE_*`, `RELEASE_TOKEN`); `ARGO_MODEL_CATALOG(_URL)`.

---

## 11. 보안 모델 (`SECURITY.md`)

- 로컬 우선·단일 테넌트 개인 에이전트 제품. **"프로세스 안에는 적대적 모델에 대한 보안 경계가 없다"**고 명시.
- `src/permission-gate.mjs` 하드라인(실행 중 코드, 격리 홈·벤더 자격, 타 회사 워크스페이스, 회사 금고 제어 파일)은 **SDK 러너 도구 호출에만** 경로 정규화로 강제. 외부 CLI 러너(Codex/Gemini/Antigravity)는 게이트를 지나지 않고 프로세스 샌드박스만 의존.
- 인정된 한계: Bash 필터는 문자열 필터로 우회 가능, 프롬프트 인젝션은 코드로 못 막음, `skills/*.md`가 다음 턴 시스템 프롬프트에 자동 붙어 결재 없는 지속 주입 경로가 됨. "유일한 진짜 경계는 OS 격리인데 아직 출하하지 않았다".
- 자격증명(`.secrets.json`, `connections.json`, `mcp.json`)은 호스티드 동기화에서 구조적 제외. 회사 데이터는 AES-256-GCM 봉투 암호화로 동기화되나 봉투 열쇠가 같은 클라우드에 있어 **운영자 복호화 가능(E2EE 아님, v3 진행 중)**. 팀 메신저 데이터는 평문.
- 제보 범위 안: 하드라인 우회, 자격 유출 동기화 경로, 교차 사용자 접근, CSRF/DNS 리바인딩, 업데이터 무결성, XSS. 범위 밖: 프롬프트 인젝션 단독, Bash 필터 우회, 악성 MCP 등.

---

## 12. 테스트·품질·개발 규칙

- 테스트: Node 내장 `node:test`(`node --test test/*.test.mjs`). 루트 392개, 메신저 79개, 오피스 6개. 커버: 메신저 백엔드(`msgr-*` 압도적), 러너(`runner-*`, `codex-*`, `native-*`), 빌링, 결재, 오피스 PG 통합.
- E2E/스모크(`scripts/`): 격리 서버 기동 후 러너 패리티·메신저 브리지·회의실 등 실측(`e2e-*.mjs`), `smoke-fresh-device.mjs`, `messenger-dist-smoke.mjs`, `contrast-audit.mjs`(WCAG), `mobile-only-guard.mjs`, 인시던트 대응 스크립트(2026-09-23).
- `CLAUDE.md` 절대 규칙(사고 이력 기반):
  - "변경 안전 절차"(2026-07-15): 격리 워크트리+임시 `ARGO_ROOT`/포트, 읽고 나서 쓰기, 최소 변경, 자기 승인 금지·분리 검수.
  - "인접 회귀 방지"(2026-08-28): 변경 전 소비자 전수 grep, 인접 행동 핀테스트 먼저, PR 본문에 "문맥 행렬" 영향 반경, 큰 변경은 옵트인 플래그+구경로 폴백.
  - "검증 범위 = 문맥 행렬"(2026-08-19): `OS×셸×인증×러너×플랜×산출물` 축. 확인 못한 축은 "미검증"이 아니라 "미완".
  - 벤더 축 분리(2026-09-06, Grok 400 사고), 모바일 발행 게이트(2026-09-11), "보안 판정 겉핥기 금지", "못 한 검증은 정직하게"(완료·무결 도장 금지).
  - i18n: 모든 UI 문자열은 `app/i18n.jsx` 사전 경유, ko/en 동시 등록. 삭제류는 `DangerModal`(Tauri에서 `window.confirm` 무동작).
  - `AGENTS.md`는 `CLAUDE.md`의 포인터(과거 사본 분기 사고 후).

---

## 13. 개발 이력·활동성

- 커밋 1,593개, 첫 커밋 2026-07-10, 최근 2026-09-27(11주). 기여자: beyondworks 1,558 / leankim 672(브랜치 전체 합산, 추정: 동일인 다른 아이덴티티) / 외부 기여 1건(#308, CVE-2026-69192 보안 픽스).
- 태그 `v0.1.3` ~ `v0.1.88`, `messenger-v*` 별도. 원격 브랜치 400개 이상(`feat/*`, `fix/*`, `chore/release-*`, `codex/*`, `claude/*`), 절반 이상이 메신저 관련.
- 최근 방향(2026-09-27 커밋 30개): ① Argo Office 신규 구축 최우선(메일 번역, 공용 문서, 기록판, 비공개 블록, 공유), ② Messenger 검수 마감형 안정화(동의 게이트, DB 보존 정리, iOS 폴리시), ③ 거의 매 묶음마다 릴리스 커밋(v0.1.87→0.1.88, Messenger 0.1.40→0.1.42).

---

## 14. Ensemble 참고 관점

Ensemble 정의: "사람과 AI Agent가 하나의 팀으로 일하는 프로젝트 공간. AI PM이 목표에 맞는 팀 구성을 돕고, 일을 배정하며, 결정과 결과를 다음 작업으로 연결한다." 초기 형태는 Slack 컨셉, PM 에이전트가 채팅에 참여해 에이전트 배정과 사람 협업을 함께 수행.

### 14.1 컨셉 참고 포인트 (Ensemble 정의 요소별)

| Ensemble 요소 | Argo의 방식 | 근거 경로 | Ensemble 적용 아이디어 | 주의점 |
|---|---|---|---|---|
| **사람+에이전트 팀 구성** | 프롬프트 한 줄로 크루 영입. 페르소나 카드(`agents/*.md`)가 역할 정의. 시스템 프롬프트를 "페르소나 → 스킬 → 운영 규칙 → 안전 한계 → 공통 실행 계약(Castra)" 순으로 계층 조립 | `src/chat.mjs` `systemPromptFor`, `src/prompts/castra-posture.mjs`, `app/api/companies/[ws]/agents` | 에이전트 정의를 "역할 카드(책임) + 스킬 + 조직 공통 계약" 3계층으로. AI PM이 목표를 받아 카드 초안을 제안하고 사람이 승인하면 영입 | Argo는 사장 1인이 영입. Ensemble은 "누가 에이전트를 추가할 수 있나"를 권한으로 정의해야 함 |
| **업무 배정** | to/cc 지정과 인박스(`src/crewmail.mjs`, `CC_MAX=4`), 크루 간 위임을 MCP 도구로 노출(`crew-mcp.mjs`), 메신저 DM의 to/cc 위임 원장(`msgr_dm_grants`), 정기 루틴, 여러 크루 초안 경쟁(compete), 다중 크루 회의실(room) | `src/engine/crew-mcp.mjs`, `src/crewmail.mjs`, `supabase/migrations/20260913122421_msgr_dm_thread_delegation.sql`, `app/c/[ws]/compete`, `src/room.mjs` | to/cc는 멘션·담당자 지정으로 직역 가능. "위임을 도구로 노출"은 PM 에이전트 구현에 그대로 적용. compete(같은 초안을 여러 에이전트에 맡기고 PM·사람이 선택)는 차별점 후보 | 위임 연쇄는 비용·루프 위험. Argo도 `HOP_MAX=8`, 10분당 `AUTO_MAX=20`, DM 위임 10턴 상한을 둠. 위임 깊이 제한과 예산 표시 필수 |
| **결정 → 다음 작업 연결** | ① 팀 업무(Work Run) 상태 머신 `running→blocked/completed/cancelled`. 크루 답변 마지막 줄 `WORK: completed|blocked` 마커를 DB 트리거가 파싱해 상태 자동 전이 ② 결재 `pending→approved/rejected/expired`, 승인 후 `resolveWithFollowUp`으로 후속 처리 ③ corrections(사람이 결과를 고친 내용 감지) ④ 크루 답글 전부를 일지(`journal/<day>.md`)로 자동 적재 | `supabase/migrations/20260913010000_msgr_work_runs.sql`(`msgr_work_create`, `msgr_work_terminal`, `msgr_work_result`), `src/gateway/msgr.mjs:797-811`, `app/api/companies/[ws]/corrections`, `…20260927150000`(`msgr_channel_journal`) | "결정 레코드(누가·언제·무엇을·근거)"를 1급 객체로 두고, 승인되면 후속 작업을 자동 생성하는 규칙. corrections는 사람의 수정을 에이전트 기억으로 환류하는 패턴으로 가치 큼 | Argo는 텍스트 마커로 상태를 신호하고, 일지는 "결정만" 아닌 전량 적재. Ensemble은 구조화 이벤트 + 결정 선별 저장이 필요 |
| **사람의 통제권** | 승인 게이트, 채팅 안 인라인 결재 카드·버튼, "크루는 메일 초안까지만, 발송은 사람", 채널·사람 단위 AI 처리 동의(`msgr_ai_consent`), 도구 호출 하드라인 | `src/gateway.mjs`(텔레그램 인라인 버튼), `apps/messenger/src/approval-display.js`, `apps/office/src/pages/Mail.jsx:1`, `msgr_ai_consent`, `src/permission-gate.mjs` | "외부 영향(발송·배포·결제)은 반드시 사람이 승인" 원칙 + 채팅 내 인라인 승인 카드. AI 동의는 멀티유저 조직에서 필수("이 채널을 AI가 읽어도 되는가") | Argo의 게이트는 SDK 러너에만 걸리고 CLI 러너는 우회(SECURITY.md). Ensemble은 모든 실행 경로에 공통 정책 엔진 |

### 14.2 Slack형 협업 모델: Argo Messenger 심층 (가장 비중)

설계 의도(`src/gateway/msgr.mjs:1-20`): 메신저는 "텔레그램·슬랙 옆의 새 채널 종류". 정본은 Supabase `msgr_*` 테이블. 브리지 프로세스는 **크루 소유자의 기기 세션(JWT)으로 로그인한 한 명의 사용자**로 동작하고, RLS가 "자기 크루 명의로만 발화·결재 확정"을 서버에서 강제. 프로토콜은 텔레그램 오프셋 규율과 동형: 폴(15초)·Realtime 방송으로 drain → 디스크 큐 적재 직후 커서 전진(at-least-once) → 워커가 `chat()` 실행 → `client_msg_id='reply:<crew>:<msg>'` 유니크로 중복 답글을 DB가 차단.

#### (1) 채널·스레드·DM 모델과 스키마

대화 단위는 **조직(`msgr_orgs`) > 채널(`msgr_channels`, kind: public/private/dm) > 메시지(`msgr_messages`, `thread_root`로 스레드)** 3층. 기준 마이그레이션 `supabase/migrations/20260903120000_msgr.sql`(이후 컬럼 추가).

| 테이블 | 주요 컬럼 | 비고 |
|---|---|---|
| `msgr_orgs` | id, name, slug, owner_user_id | :15-22 |
| `msgr_org_members` | org_id, user_id, **role(owner/admin/member/guest)** | 좌석 게이트 트리거(free 3석) :270-286 |
| `msgr_channels` | id, org_id, kind, name, topic, crew_memory | 채널 개수 게이트(free 공개 1개) :301-313 |
| `msgr_channel_members` | channel_id, **member_kind(user/crew)**, member_id | 사람·크루가 **같은 멤버십 테이블**, kind로 구분 :97-104 |
| `msgr_crews` | id, org_id, owner_user_id, ws_id, slug, **hosting(local/resident/bot)**, status, allow(all/list/owner), cursor_msg_id | :134-150 |
| `msgr_messages` | id(bigint identity), channel_id, **author_kind(user/crew/system)**, author_user_id, crew_id, **kind(text/approval_card/system)**, body(≤20,000), mentions jsonb, reply_to, thread_root, client_msg_id, meta jsonb | :154-182 |
| `msgr_attachments` | message_id, org_id, storage_path, name, mime, bytes | Storage 버킷 `msgr` |
| `msgr_crew_approvals` | crew_id, approval_id, action, status(pending/approved/rejected/expired), decided_by | :197-211 |
| `msgr_bots` | crew_id(unique), token_hash, kind(hermes/openclaw/custom) | `20260908120000_msgr_bots.sql:72-85` |
| `msgr_executions` | crew_id + source_msg_id(PK), attempt, state(running/completed) | **중복 실행 방지 lease** `20260909120000:2-11` |
| `msgr_work_runs` | channel_id, goal, completion_criteria, lead_crew_id, status, root_message_id | `20260913010000:3-20` |
| `msgr_dm_grants` | root_message_id, crew_id, role(to/cc), source_message_id | DM 위임 원장 `20260913122421:3-10` |
| `msgr_reads` / `msgr_reactions` / `msgr_channel_prefs` | 읽음 커서, 반응, 음소거 | `20260909004000` |
| `msgr_journal_entries` | org_id, channel_id, day, source_author_id, line | 크루 기억용 일지, 7일 보존 `20260927150000:28-37` |
| `msgr_audit_log` | actor, action, target | 직접 insert 정책 없음(트리거 전용) |

RLS 요지: 채널 읽기(`msgr_can_read_channel`, :107-119)는 public이면 owner/admin/member, private/dm이면 `channel_members` 등록자만. 메시지 쓰기는 `author_kind='user'`면 `auth.uid()` 본인, `author_kind='crew'`면 **그 크루의 `owner_user_id = auth.uid()`이고 크루가 active**(:519-525). 즉 크루의 발화 권한은 "크루를 소유한 사람의 로그인 세션"에 귀속. DM은 트리거 `msgr_dm_shape`(:482-496)로 사람 ≤2, 크루 ≤1로 고정. 결재 확정은 크루 소유자만, `pending`에서만 전이(:547-552).

**Ensemble 시사점**: 조직 > 채널 > 메시지(스레드) 3층과 사람·에이전트 공용 멤버십 테이블(kind 구분)은 그대로 개념 차용 가치가 높다. 다만 "크루의 권한 = 소유자 1인의 세션"은 PM 에이전트가 조직 차원에서 행동하는 Ensemble과 맞지 않는다. 에이전트를 조직 소속 주체(서비스 계정)로 두고 채널·프로젝트 단위 권한을 별도로 부여해야 한다.

#### (2) 에이전트가 채팅 참여자로 들어오는 방식

- **신원 분리**: 사람은 `auth.users` + `msgr_org_members`, 크루는 `msgr_crews`(사람 계정 없음), 외부 봇은 `msgr_crews(hosting='bot')` + `msgr_bots`(토큰 해시). 채널 멤버십만 `msgr_channel_members`에서 `member_kind`로 통합.
- **참여 경로**: 관리자·채널 생성자가 멤버로 초대, 또는 채널 안 카드 → `msgr_crew_requests`(pending/done/failed) → 상주 노드가 등록 후 자동 join(`20260903120000:1120-1133, 1177-1179`).
- **@멘션 → 크루 턴 트리거**: `drain()`(`msgr.mjs:609`)이 크루별 커서 이후 메시지를 읽음 → `targetsCrew()`(:155-171)가 대상 판정(mentions의 role='to' 매칭; DM은 멘션 없어도 기본 대상; 크루 답글에 사람이 멘션 없이 답글만 달아도 대상) → RPC `msgr_crew_context`로 실행 허가 봉투 획득 → `enqueue()`(:778) 디스크 큐 → 워커(:990~)가 프롬프트 조립 후 `runChat()` → `src/chat.mjs` `chat()` → `finishMessengerExecution`으로 멱등 insert(:1174-1187).
- **크루 → 크루 릴레이**: 답변 본문의 `@이름`만 통로(`mentionsIn()`, :174-185, 긴 이름 우선, 동명이인 제외). `meta.origin`(사람 출처)이 있어야 함(:168). 루프 방지: `HOP_MAX=8`(:58, 초과 시 `hopcap:` 시스템 메시지), 10분당 조직 전체 자동 턴 `AUTO_MAX=20`(:59-60). 순서 표기 `@A > @B`(`RELAY_RE`, :64)일 때만 순차 대기(`ORDER_WAIT_MS=120_000`, 워커 DEFER :1008-1010), 그 외 동시 멘션은 병렬 응답. DM 고급 위임은 `msgr_dm_grants` 기반으로 `msgr_delivery_allowed`(to, 실행권)와 `msgr_cc_delivery_allowed`(cc, 수신만)를 구분(`20260913122421:54-97`), 10턴 상한(:83).
- **서버 강제**: 클라이언트 `allowedToInstruct()`(:73-79)는 폴백. 정본은 DB 함수 `msgr_instruct_check`(`20260908120000:31-47`, allow all/list/owner)와 트리거(`msgr_messages_crew_scope_guard`, `msgr_dm_message_guard`).
- **외부 봇 프로토콜**(`supabase/functions/msgr-bot`, `integrations/*`): `getUpdates`/`sendMessage`(텔레그램식), `execution_attempt` 실행권, `MSGR: handoff` / `MSGR: done` 마커, CC 전달, 401 중지 / 408·429 재시도.

**Ensemble 시사점**: "봇을 채널 멤버로 다루는 모델 + 실행권(lease)"은 PM 에이전트가 채팅에 참여하는 구조와 정확히 맞고, 같은 메시지에 여러 에이전트가 중복 응답하는 문제를 막는 핵심 장치다. 홉 상한·시간당 자동 턴 상한·순차 대기 표기는 그대로 규칙으로 옮길 만하다. 텍스트 마커(`MSGR: done`) 대신 구조화 이벤트로 바꿔야 한다.

#### (3) 채팅 안에서 작업을 만들고 배정하는 흐름

- **결재(승인 카드)**: `kind='approval_card'` 메시지 + `msgr_crew_approvals` 미러 행. `pending→approved/rejected/expired`. 서버 확정 후 브리지 `syncApprovals()`(`msgr.mjs:797-811`)가 큐를 우회해 `resolveWithFollowUp`으로 반영(데드락 방지). 렌더는 `approval-display.js`가 payload.plain.{purpose, task, need}를 문장화, `risk==='high'`면 기본 펼침.
- **팀 업무(Work Run)**: `msgr_work_runs`가 명시적 작업 단위. `msgr_work_create` RPC가 총괄(lead) 크루를 역할 문구 정규식(`총괄|조율|coordinator|lead`, :52)으로 자동 선정. `running→blocked/completed/cancelled`. 크루 답변 마지막 줄 `WORK: completed|blocked` 마커를 `msgr_work_terminal`(fence-aware 정규식, :126-145)이 파싱해 트리거(`msgr_work_message_guard`/`msgr_work_result`, :148-195)가 상태 전이. `msgr_work_resume`로 blocked 재개. 하트비트 10분 초과 시 "실행 상태 불명" 시스템 메시지(`execution-unknown`, `msgr-work-runs.sql:317`).
- **크루 생성 요청 카드**: `msgr_crew_requests`도 같은 큐 패턴.
- **tasks API와의 연결**: `app/api/companies/[ws]/tasks`와 `msgr.mjs` 사이 상호 참조 없음(grep으로 확인). 별도 시스템.
- **to/cc 인박스**: 메신저 DM은 `msgr_dm_grants`, 로컬 CLI는 `src/crewmail.mjs`(파일 큐 `mail/<slug>/…`, `CC_MAX=4`). 두 경로가 분리돼 있고 통합 근거는 못 찾음(추정).
- **회의실 → 기억**: `src/room.mjs`는 로컬 CLI 전용(`chats/room-main.json`), msgr 채널과 무관. 메신저 쪽 "결론 저장"은 `msgr_channel_journal` 트리거(`20260927150000:48-94`)가 크루의 **모든 답글**을 `msgr_org_docs`(`journal/<day>.md`)와 `msgr_journal_entries`에 적재. 결정만 선별 저장하는 개념은 아님.

**Ensemble 시사점**: Work Run(목표·완료 기준·총괄 에이전트·상태·루트 메시지)은 Ensemble "작업" 엔티티의 좋은 출발점이다. "총괄을 역할 문구로 자동 선정"은 PM 에이전트 배정 로직의 원시형이며, Ensemble은 이를 PM의 명시적 판단으로 승격해야 한다. 결정 → 후속 작업 자동 생성은 Argo에 없다(마커 기반 상태 전이만 있음).

#### (4) 사람·에이전트 협업 UX

| 항목 | Argo 처리 | 근거 |
|---|---|---|
| 타이핑·진행 표시 | 서버가 `typing`/`progress` 브로드캐스트. 상태 파일을 1.5초 주기로 폴링하되 크루당 최소 4초 간격 전송. 클라이언트 `typing-state.js`가 답변 직후 늦게 도착한 typing 무시(1.5초) | `msgr.mjs:1202-1233`, `:67`, `App.jsx:993,996,1295-1296` |
| 스트리밍 | **없음.** "메신저에는 사고 과정·도구 단계를 싣지 않는다(2026-09-24 결정) — '답변 준비 중'만. 궤적은 주인 쪽 활동 로그가 정본." 답변을 통째로 한 번에 insert | `msgr.mjs:1150, 1138, 1174-1187`, 커밋 a44551c4 |
| 산출물 표시 | `deliverAttachments`가 vault 파일을 Storage에 업로드 → `msgr_attachments` insert → 채널에 파일로 노출. 도구 실행 카드 같은 별도 UI는 확인 안 됨 | `msgr.mjs` |
| 승인 요청 | 승인 카드 메시지 + 버튼. 위 (3) 참고 | `approval-display.js` |
| 실패·중단 | 일반 실패는 `roomTurnFailure()`(원문 비공개, 회사 로그에만). 정지 버튼은 `roomTurnStopped(누른 사람)`. 하트비트 초과 시 "실행 상태 불명" | `msgr.mjs:1152-1166` |
| 읽음 표시 | 메시지별 읽음자 목록이 아니라 **채널 단위 안읽음 배지**(`msgr_reads` + `msgr_unread()` RPC, 최대 99) | `20260909004000:6-35` |
| 알림·사운드 | 푸시 `msgr_push_tokens`/`msgr_push_sent`. "PC 화면을 보고 있는 사람"은 수신자에서 제외(`msgr_on_desktop` + `msgr_presence`). 수신음 `.wav`(웹) + 동일 세트 `.caf`(iOS/macOS) | `20260912150000`, `20260916170000:38-51`, `apps/messenger/public/sounds/`, `src-tauri/sounds/` |

**Ensemble 시사점**: "채팅에는 결과만, 사고 과정은 활동 로그로" 분리는 채널 소음을 줄이는 의도적 결정으로 참고 가치가 있다. 다만 Ensemble에서 PM 에이전트가 배정·진행을 조율한다면 진행 상태(누가 무엇을 하고 있나)는 카드·상태 뷰로 보여야 하므로, 스트리밍 없음과 진행 표시 최소화를 그대로 따르면 안 된다.

#### (5) 실시간 전송과 저장 구조

- **Realtime**: **Broadcast(private topic)만 사용, Presence 미사용**(`msgr.mjs:18`). 메시지·결재·반응·편집·타이핑·진행 전부 DB 트리거 `realtime.send(payload, event, 'org:<org_id>', true)`(`20260903120000:330-355`)로 방송. payload는 본문 없이 id·멘션 메타만 → 실제 데이터는 PostgREST RLS 재조회로 보호. 방 단위는 `dm:<channel_id>`(`App.jsx:1293-1299`), 개인 전용은 `u:<uid>`(`msgr.mjs:819-822`).
- **클라이언트 구독**: `apps/messenger/src/App.jsx:988-997`(조직), `:1040-1046`(교차 공간·개인), `:1293-1299`(열린 방).
- **서버측 쓰기**: 크루 러너는 supabase-js로 직접 insert(크루 소유자 JWT, service role 미사용, RLS 통과). 외부 봇은 SECURITY DEFINER RPC(`msgr_bot_send`/`msgr_bot_finish`)로 anon 토큰 인증 후 같은 정책 재검증.
- **재접속 동기화**: 크루 커서 `msgr_crews.cursor_msg_id`(적재 후에만 전진, :790). 사람 커서 `msgr_reads.last_read_id`. UI 페이지네이션 파라미터는 미확인.
- **순서·중복**: `msgr_messages.id` bigint identity로 전역 순서. `(channel_id, author_kind, coalesce(crew_id, author_user_id), client_msg_id)` 부분 유니크 인덱스(:179-180)로 리더 교체 시 중복 답글 차단(23505). 동시 실행은 `msgr_executions` lease로 1회만.
- **첨부**: Storage 버킷 `msgr`, 경로 `<org_id>/<channel_id>/<message_id>/<file>`, **채널 단위 RLS**(:594-605), DM 위임 크루 전용 정책 추가(`dm_thread_delegation:372-407`).
- **보존**: 코어 메시지·첨부는 시간 기반 삭제 없음(soft delete만). 파생 로그만 pg_cron 정리 — `msgr_journal_entries` 7일(`20260927150000:132-144`), 자동화 실행 기록·루틴 편집 기록도 유사(커밋 메시지 기준).

**Ensemble 시사점**: "브로드캐스트에는 메타만, 본문은 RLS 재조회"는 권한 경계를 한 곳에 모으는 좋은 패턴이다. 조직·채널·개인 토픽 분리, identity 기반 전역 순서, `client_msg_id` 멱등 키, 실행 lease는 Slack형 구조에 그대로 적용할 수 있는 개념이다.

### 14.3 코드 참고 포인트

아래 분류는 Ensemble(멀티유저 Slack, SaaS 우선 가정)에 대한 설계 적합성 기준이다.

| 경로 | 무엇인가 | 분류 | 이유 |
|---|---|---|---|
| `src/runners/catalog.mjs`, `src/runners.mjs` | 러너·모델 카탈로그, pickRunner/resolveRunner | 패턴만 | 멀티벤더 BYOK 추상화는 유용. 로컬 CLI 러너 전제는 서버 실행 기본인 Ensemble과 안 맞음 |
| `src/runners/error-class.mjs` | 오류 분류표 | **패턴만(강추)** | 분류 체계가 재시도·전환 정책의 기반. 목록은 새로 설계 |
| `src/chat.mjs` 자가치유 | 러너 장애 시 다음 러너로 전환 | 패턴만 | 개념은 좋으나 1,962줄 단일 파일 구조는 따르지 않음 |
| `src/gateway/queue.mjs` | 디스크 at-least-once 큐 | 패턴만 | Ensemble은 DB/큐 서비스 기반 at-least-once + 멱등 키. 로컬 디스크 큐는 단일 기기 전제 |
| `src/permission-gate.mjs` | 도구 호출 하드라인 | 패턴만 | 모든 러너 경로에 공통 적용되도록 재설계 |
| `src/prompts/castra-posture.mjs` | 공통 실행 계약 프롬프트 | 패턴만 | "조직 공통 계약 레이어" 개념을 차용 |
| `src/engine/*`(native-query, wire, mcp-client) | 자체 도구 루프, 벤더 wire | 가져오지 말 것 | 벤더 SDK·공개 라이브러리로 대체 가능. 유지보수 부담 큼 |
| `src/engine/crew-mcp.mjs` | 크루 간 위임 도구 | 패턴만 | "위임을 MCP 도구로 노출"은 PM 에이전트 구현에 적용 |
| `integrations/*`, `supabase/functions/msgr-bot` | 봇 어댑터 프로토콜 | 패턴만 | 텔레그램식 봇 API는 외부 에이전트 연결의 좋은 표준형. 롱폴 외 웹훅·SSE 병행, 텍스트 마커 대신 구조화 필드 |
| `supabase/migrations/*`(msgr_*) | 채널·멤버·메시지·크루·실행·결재·동의 스키마 | 패턴만 | 테이블 분할은 좋은 체크리스트. SQL은 새로 작성 |
| RLS + security definer RPC 쓰기 | 쓰기를 RPC로만 허용 | **패턴만(강추)** | 클라이언트 직결 구조에서 권한 경계를 한곳에 모음. RPC 권한 검사 누락이 곧 취약점이므로 테스트 필수 |
| Realtime private broadcast(`org:`, `dm:`, `u:`) + 메타만 방송 | 토픽 단위 실시간 | 패턴만 | Slack형 구조에 적합 |
| `msgr_executions` lease, `client_msg_id` 멱등 인덱스 | 중복 실행·중복 답글 방지 | **패턴만(강추)** | 다중 에이전트 채팅의 필수 장치 |
| `msgr_work_runs` + 마커 파싱 트리거 | 작업 상태 머신 | 패턴만 | 엔티티 구조는 참고, 마커 파싱은 구조화 이벤트로 대체 |
| `src/devicesession.mjs`, `src/pairing.mjs` | 기기=계정, 페어링 | 가져오지 말 것 | Ensemble은 사용자 계정 + SSO/조직 멤버십 기본 |
| 회사 단일 소유자(ownerId), `guardCompany` | 코어 콘솔 권한 모델 | 가져오지 말 것 | 멀티유저 모델과 근본 충돌. 처음부터 owner/admin/member/guest 역할 기반(메신저 쪽 `msgr_org_members.role`이 오히려 참고 대상) |
| `src-tauri` 사이드카 | Node+Next standalone 내장 | 가져오지 말 것(초기) | 로컬 우선 제품용. SaaS 우선이면 복잡도만 증가 |
| `test/`(node:test), `scripts/e2e-*` | 테스트 전략 | 패턴만 | 경량 node:test와 격리 서버 E2E는 참고 |
| `CLAUDE.md` 개발 규칙 | 문맥 행렬, 소비자 전수 grep, "미검증은 미완" | **패턴만(강추)** | 코드가 아닌 프로세스 원칙. 자체 규칙으로 다시 작성 |

### 14.4 빌리지 말아야 할 것 / 반면교사

| Argo의 한계·부채 | 근거 | Ensemble 회피 방안 |
|---|---|---|
| 프로세스 내 적대적 모델 경계 없음, 프롬프트 인젝션 범위 밖, CLI 러너 게이트 우회, 메신저 평문, E2EE 미완 | `SECURITY.md` | 에이전트 실행을 샌드박스로 분리. 모든 도구 호출이 단일 정책 엔진 경유. 채팅 내 외부 입력은 비신뢰 데이터로 표시. 암호화 수준을 처음부터 명시 |
| 1,500~2,000줄 단일 파일(`chat.mjs`, `gateway.mjs`, `msgr.mjs`), `App.jsx` 4,901줄 단일 컴포넌트 | 파일 크기 | 도메인 모듈(채널·메시지·에이전트 런타임·배정·승인)을 초기부터 분리 |
| 콘솔 채팅 3초 폴링, 메신저 스트리밍 없음 | `app/api/companies/[ws]/chat/route.js`, `msgr.mjs:1150` | 처음부터 스트리밍(SSE/WebSocket) + Realtime |
| RBAC 부재, 단일 소유자(코어), 크루 권한 = 소유자 세션 | `app/auth.mjs`, `20260903120000:519-525` | 조직·프로젝트·채널 3단계 역할과 ACL. 에이전트를 조직 소속 주체로 |
| 코어 콘솔(1인)과 메신저(다인)가 서로 다른 권한·데이터 모델로 분리 | `app/` vs `apps/messenger` | 하나의 조직·프로젝트 모델 위에 채팅·작업·기억을 올림 |
| 텍스트 마커 기반 상태 전이(`WORK: completed`, `MSGR: done`) | `msgr_work_terminal`, 봇 프로토콜 | 구조화된 상태 머신·이벤트 |
| 실질 1~2인 개발, 11주 1,593 커밋, 원격 브랜치 400+ | git 이력 | 포크·외부 의존 금지. 개념만 참고. Argo API·프로토콜 호환 약속 금지 |
| 일지에 크루 답글 전량 적재(결정 선별 없음) | `msgr_channel_journal` | 결정 레코드를 별도 1급 객체로 |

### 14.5 Ensemble 컨셉과의 갭

| Ensemble 요소 | Argo 유사 요소 | 된 것 / 빠진 것 |
|---|---|---|
| **AI PM**(팀 구성 제안·배정 주체) | 크루 간 위임, room, compete, Work Run의 총괄 크루 자동 선정(역할 문구 정규식) | 위임 수단과 "총괄" 개념은 있음. 목표를 해석해 누구에게 줄지 판단하고 진행을 추적하는 **전담 조정자 역할은 없음.** 사장(사람)이 조정자 |
| **목표 기반 팀 구성** | 프롬프트 한 줄 영입 | 크루를 하나씩 영입은 가능. 목표에서 필요한 역할 집합을 도출해 제안하는 기능 없음 |
| **결정·결과 → 다음 작업 자동 연결** | approvals, Work Run 상태 전이, corrections, 일지 | 기록·기억·상태 전이는 있음. 결정 객체와 후속 작업을 자동 생성하는 규칙 엔진은 없음 |
| **멀티유저 한 조직 협업** | 메신저 `msgr_orgs`/`org_members(role)`/`channels` | 메신저는 다수 사람 지원(좌석 게이트 있음). 코어 콘솔은 단일 소유자라 **제품이 둘로 쪼개져 있음** |
| **프로젝트 단위 공간** | vault `projects/` 폴더, 채널, Work Run | 프로젝트가 기억 폴더·채널 수준. 목표·멤버·작업·결정을 묶는 **프로젝트 엔티티 없음** |

### 14.6 종합 판단과 다음 단계

Argo는 "혼자 쓰는 사장 + AI 크루" 제품에 팀 메신저를 덧붙인 구조다. Ensemble은 이를 뒤집어 멀티유저 채널을 먼저 두고, 그 위에 PM 에이전트와 프로젝트·결정 객체를 1급으로 세우는 설계가 맞다.

**Argo에서 가져갈 가장 가치 있는 개념 5가지**

1. 봇(에이전트)을 채널 멤버로 다루는 모델 + 실행권(lease) + 멱등 키로 중복 응답 차단
2. 외부 에이전트 봇 API 프로토콜(getUpdates/sendMessage, 실행권, 핸드오프, 재시도 정책)
3. 오류 분류표와 러너 자동 전환(자가치유), 홉·시간당 자동 턴 상한
4. 인라인 승인 카드와 "외부 영향은 사람이 승인" 원칙, 채널 단위 AI 동의
5. RLS + security definer RPC 전용 쓰기, 브로드캐스트에는 메타만 싣고 본문은 RLS 재조회

**다음 단계 제안**

- 설계: 14.2의 스키마 표를 체크리스트로 Ensemble 자체 스키마 초안 작성(조직·프로젝트·채널·멤버십(kind)·메시지·작업·결정·승인·실행 lease·동의).
- PM 에이전트: Argo의 "총괄 자동 선정 + 위임 도구" 원시형을 참고해 PM의 배정 판단·진행 추적·결정→후속 작업 생성 규칙을 명세.

---

## 부록: 미확인·추정 사항

- `MESSENGER-DESIGN.md`(msgr.mjs 주석이 언급) 부재. `apps/messenger/design/README.md`, `docs/*.md`는 미열람.
- "Hermes Agent", "OpenClaw"의 정체는 외부 서드파티 에이전트 프레임워크로 추정(README 문구 "코어 수정 없음, 플러그인 SDK만 사용" 기준).
- `app/api/companies/[ws]/tasks`와 메신저 사이 연결 없음(grep 확인). `src/crewmail.mjs`(로컬 to/cc)와 `msgr_dm_grants`(메신저 to/cc)의 통합 여부는 미확인(분리로 추정).
- `src/room.mjs` 회의실은 로컬 CLI 전용, 메신저 채널과 무관.
- 메신저 UI 페이지네이션 파라미터, `App.jsx` 세부 렌더링, `scripts/qa/routine-layout.mjs` 내용은 미확인.
- 기여자 `leankim`이 `beyondworks`와 동일인인지는 추정.
- Bedrock/Vertex는 1급 지원이 아니라 Agent SDK env 통과에 대한 방어 코드만 존재(추정).
- 대형 파일(`chat.mjs`, `gateway.mjs`, `msgr.mjs`, `App.jsx`)은 발췌 열람. 함수 단위 세부가 필요하면 추가 조사.
