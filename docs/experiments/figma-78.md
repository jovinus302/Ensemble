# Figma ↔ Space 양방향 참여 실험 기록 (#78)

기준: 2026-10-07. 제품 의도는 [#78](https://github.com/jovinus302/Ensemble/issues/78)과 [intent.md](../../intent.md)를 따른다. 이 문서는 연결 수단(EXPERIMENT)의 선택과 현재까지의 증거를 기록한다.

**결론: 실제 Figma 댓글 흐름에서 질문 게시 → 사람 답글 수신 → Space 후속 항목 연결까지 한 번 왕복을 관찰했다.** 2026-10-07 테스트 파일(사용자 계정으로 만든 테스트용 파일 1개)에서 `live-figma.ts` preflight·post를 실행했고, 2026-10-08 같은 스레드에 단 사람 역할 답글을 poll이 받아 기록했다. PM 댓글과 답글은 같은 Figma 계정(사용자 본인)에서 나왔고, 이는 제품 전제대로다(아래 '작성 주체 구분').

### 실제 관찰 기록 (2026-10-07 ~ 10-08)

| 단계 | 결과 |
|---|---|
| preflight (읽기만) | `GET /v1/me` 성공(사용자 본인 계정). 파일 이름·`version`·`lastModified`(06:44:51Z) 조회, 첫 페이지 첫 FRAME `1:2` 발견, 기존 댓글 0개. 토큰 값은 출력되지 않음 |
| post | `figma_inspected`(version·프레임 발견) 후 `POST /comments` 성공. Figma가 댓글 id `1955923874`를 반환해 `awaiting_reply`. 본문에 `[ensemble-req:figma-838d006a0bdf7ad4]` 태그 |
| poll (답글 전) | post 후 약 6시간 동안, 그리고 2026-10-08 08:2x에 다시 실행했으나 새 답 0 → `awaiting_reply` |
| 사람 역할 답글 | 2026-10-08 08:23:23Z, 사용자 결정에 따라 Codex 워커가 Orca 브라우저의 사용자 Figma 세션(PM과 같은 계정)으로 댓글 `1955923874` 스레드에 답글: "프레임 1:2 버튼 색상은 유지, 라벨만 변경해 주세요." (태그 없음) |
| poll 1회차 | 08:28:25Z 관찰. `new=1 skippedOwn=0 duplicates=0`, 상태 `reply_received`. 원장에 `figma_reply_received`(답 id `1958022831`, parent `1955923874`, 작성자 id·handle(PM이 붙어 쓰는 계정과 같음), `createdAt`·`observedAt`)와 `figma_followup_linked`(`figma-followup:<fileKey>:1958022831`, `verification=claimed`)가 쌓이고 Space 보기에 미해결 후속 항목 1개가 나타남 |
| poll 2회차 | `new=0 duplicates=1`. figma 이벤트 수 6 → 6으로 변화 없음(재수신 중복 없음). 두 poll 모두 `figma_comment_attempted`/`posted`를 새로 남기지 않음 — PM은 답글이나 자기 댓글에 다시 쓰지 않음 |

PM 댓글은 원장에 기록된 comment id `1955923874`로, 답글 `1958022831`은 원장에 없는 id로 구분됐다. 같은 계정이어도 작성 주체 구분에는 문제가 없다(아래 '작성 주체 구분').

당시 원장의 `figma_reply_received`에는 `sameAccountAsPm=true` 필드가 있었으나, 같은 계정이 전제이므로 이 필드는 이후 제거했다(작성자 id·handle은 그대로 기록).

## 선택한 경로와 이유

| 후보 | 판단 |
|---|---|
| **Figma REST API 댓글 + 주기 확인(polling)** | **채택.** 토큰 하나로 파일/프레임 읽기, 댓글 읽기·쓰기, 본인 식별(`/v1/me`)이 된다. 디자이너가 이미 보는 댓글 스레드가 응답 자리다. MCP·플러그인 설치를 전제하지 않는다. |
| webhook (`FILE_COMMENT`, `FILE_VERSION_UPDATE`) | 후속. 공개 수신 URL과 팀 단위 등록이 필요하다. 반복 확인을 줄이는 수단이며 첫 왕복의 필수 조건이 아니다(#78 범위). |
| 브라우저 자동화 | 보류. 로그인 세션과 화면 구조에 의존하고, 관찰한 버전·댓글 id를 안정적으로 남기기 어렵다. |
| 플러그인 | 보류. 사람이 파일을 열고 실행해야 동작하므로 PM Agent가 스스로 확인하는 경로가 아니다. |
| MCP | 보류. 설치를 전제하지 않는다는 이슈 조건과 맞지 않고, 댓글 쓰기 경로는 확인하지 않았다. |

사용하는 엔드포인트(공식 문서 기준, 실제 응답은 미관찰):

- `GET /v1/me` — PM이 붙어 동작하는 사용자 계정의 id·handle. 확인 기록(`figma_inspected.pm`)과 결과 불명 쓰기의 재확인 범위를 좁히는 데 쓴다. 자기 댓글 판별에는 쓰지 않는다.
- `GET /v1/files/:key/nodes?ids=<node>&depth=1` — 링크의 프레임 이름·종류와 파일 `version`·`lastModified`. 프레임이 없으면 `null`.
- `GET /v1/files/:key/comments` — 프레임의 기존 댓글, PM 댓글 스레드의 답.
- `POST /v1/files/:key/comments` — `message`, 프레임 고정 `client_meta: { node_id, node_offset }`. 답글은 `comment_id`(루트 댓글만 가능).
- 인증 헤더 `X-Figma-Token`. 토큰은 `FIGMA_ACCESS_TOKEN`에서만 읽고 오류·로그·직렬화에 남기지 않는다.

## 흐름과 코드 위치

Space는 기존 프로젝트 원장이다. Figma 기록은 같은 원장에 `figma_*` 이벤트로 남는다.

| 단계 | 함수 | 남기는 것 |
|---|---|---|
| 1. 링크 + 질문 공유 | `FigmaBridge.shareLink` | `figma_request_opened`: 파일 키·프레임 id·질문, 공유한 참여자(Agent)와 대신하는 사람, 원 메시지 id |
| 1'. Space 결정 전달 | `FigmaBridge.relayDecision` | 같은 기록, 출처 `space_decision`과 `decisionId` |
| 2. PM이 직접 확인 | `FigmaBridge.inspect` | `figma_inspected`: 파일 버전·`lastModified`·관찰 시각, 프레임 발견 여부·이름, 프레임의 기존 댓글 id, PM이 쓰는 사용자 계정, 함께 읽은 Space 목표·결정 id |
| 3. Figma 댓글 전달 | `FigmaBridge.deliver` | `figma_comment_attempted`(초안) → `figma_comment_posted`(Figma가 돌려준 댓글 id) 또는 `figma_comment_failed` |
| 4. 응답 수신 | `FigmaBridge.pollReplies` | `figma_reply_received`(답 댓글 id·작성자·시각) + `figma_followup_linked`(Space의 미해결 항목) |
| 4'. 반영 재확인 | `FigmaBridge.recheck` | `figma_followup_rechecked`: 요청 당시 버전 대비 파일 변경 여부 |
| 5. 반영/막힘 보고 | `FigmaBridge.reportFollowUp` | `figma_followup_reported`: 참여자의 주장 |
| Space 보기 | `figmaRequests`, `figmaSpaceItems` | 요청별 상태·문제·후속 항목 |

코드: [app/packages/orchestrator/src/figma/](../../app/packages/orchestrator/src/figma/) — `link.ts`(링크 해석), `client.ts`(인터페이스·REST), `fake.ts`, `ledger.ts`(기록·투영), `bridge.ts`(흐름). 테스트: [app/test/figma-bridge.test.ts](../../app/test/figma-bridge.test.ts). 실제 왕복 스크립트: [live-figma.ts](../../app/packages/orchestrator/scripts/live-figma.ts).

### 설계 판단

- **core `EventPayloads`에 넣지 않았다.** `project()`는 모르는 이벤트를 무시하므로 Figma 기록이 기존 작업·결정·자동화 한도에 영향을 주지 않는다(테스트로 확인). 경로가 실제 계정에서 검증되면 core 편입을 다시 판단한다. #79·#80 작업과 공유 파일 충돌도 피한다.
- **orchestrator 진입점(`index.ts`)에 아직 노출하지 않았다.** 호스트는 `src/figma/index.ts`를 직접 가져온다.
- **PM 댓글 추적:** 본문 끝에 `— Ensemble PM Agent · Space <projectId> [ensemble-req:<requestId>]`를 붙인다. 호출자가 준 본문(모델 초안 등)에 다른 태그가 있으면 지운다.
- **전달 성공 판정:** Figma가 돌려준 댓글 id가 기록된 때만 `awaiting_reply`다. 초안(`attempted`)이나 대시보드 표시는 전달이 아니다.
- **결과를 모르는 쓰기:** 네트워크 오류·5xx는 `delivery_unknown`으로 남긴다. 다시 전달하기 전에 댓글 목록에서 같은 태그 (b)의 루트 댓글을 찾고(원장에 아직 comment id가 없으므로. 작성자가 토큰 계정인지는 범위를 좁히는 조건일 뿐이다), 있으면 그 id로 확정(`reconciled`)한다. 목록을 읽지 못하면 새로 쓰지 않는다.
- **중복 방지:** 같은 공유·결정 전달은 같은 요청 id로 모이고, 답은 Figma 댓글 id로 한 번만 기록된다. 같은 프로세스 안의 동시 전달은 요청별로 직렬화한다.
- **설계 원칙 — 같은 계정 전제:** PM Agent는 각 사용자의 기존 툴 계정에 붙어서 동작한다. 그래서 PM 댓글과 사람의 답글이 같은 Figma 계정에서 나오는 것이 정상이며, PM 전용 계정을 요구하지 않는다. 작성 주체는 계정(Figma user id)이 아니라 (a) 원장에 `figma_comment_posted`로 기록된 PM 게시 comment id, (b) PM 댓글 본문의 `[ensemble-req:<requestId>]` 태그로 구분한다(아래 '작성 주체 구분').
- **자기 댓글:** PM은 Figma 댓글에 자동으로 답하지 않는다. poll은 (a) 원장의 PM 게시 comment id만 자기 댓글로 건너뛴다. user id로 거르면 같은 계정인 사람의 답이 모두 버려지고, 태그로 거르면 사람이 태그를 인용한 답이 버려지기 때문이다.
- **새 최상위 댓글은 처리하지 않는다:** poll은 PM 댓글 스레드의 답만 읽는다. 사람이 PM 태그 없이(또는 태그를 붙여서라도) 프레임에 새 최상위 댓글을 쓰면 PM은 그 댓글을 기록하지도, 후속 항목으로 만들지도, 답하지도 않는다(테스트로 고정). 그런 댓글은 이후 `inspect`를 다시 실행하면 `relatedCommentIds`(프레임의 기존 루트 댓글 id)에 id가 남을 수 있을 뿐이다. 최상위 댓글 수신은 후속 과제다.
- **확인과 주장의 구분:** 답은 `claimed`다. 재확인은 파일 버전이 바뀌었는지만 본다(`file_changed_unconfirmed` / `no_change_observed`). 디자인 반영 완료를 코드가 확정하는 상태는 없다. 참여자의 반영 보고도 검증 등급을 올리지 않는다.
- **확인하지 못한 프레임에는 쓰지 않는다:** 접근 실패(`access_failed`), 프레임 없음(`frame_not_found`)이면 전달을 거절한다.

### 상태

`opened` → `inspected` | `access_failed` | `frame_not_found` → `delivering` → `awaiting_reply` | `delivery_failed` | `delivery_unknown` → `reply_received`. 마지막 실패는 `problem`(단계·종류·HTTP 상태·설명)으로 남고, 같은 단계가 성공하면 지워진다. 전달 후의 조회 실패(예: 429)도 `problem`으로 드러난다.

## 완료 기준별 현황

| 완료 기준 | 판정 | 근거 |
|---|---|---|
| 개인 Agent가 Space에서 맥락을 읽고 질문/링크를 직접 공유 | **미검증** (#81 의존) | `shareLink`는 Agent를 기록 주체로 남기는 최소 진입점이다. 실제 개인 Agent가 Space에 접속하는 경로는 #81 범위이며 HTTP/UI 진입점은 만들지 않았다. |
| PM이 허용된 Figma 원본에 접근해 확인 범위와 출처를 남김 | **실제 검증** (테스트 파일 1개) | `figma_inspected`: 실제 파일 version·lastModified·프레임 `1:2`·관찰 시각을 기록. |
| PM 질문과 상대 응답이 실제 Figma 댓글에서 한 번 왕복 | **실제 검증** | 댓글 `1955923874` 게시 → 답글 `1958022831` 수신 → 후속 항목 연결. PM 댓글과 답글은 같은 계정(제품 전제)이며 comment id로 구분됐다. |
| Space에서 시작한 조율도 Figma에 도달, 응답이 다음 행동으로 연결 | 응답→후속 항목은 실제 검증, 나머지는 fake (일부) | 실제 답글이 `figma_followup_linked`(Space 미해결 항목)로 기록됨. `relayDecision` → 댓글은 fake만. 기존 작업·결정 요청으로의 변환은 미구현. |
| 파일/프레임·댓글·버전·관찰 시각·참여자 식별 보존, 재수신 중복 없음, 자기 댓글에 답하지 않음 | **실제 검증** (스레드 안 PM 댓글 건너뛰기는 fake) | 실제: 댓글 id·parent·작성자 id/handle·작성 시각·관찰 시각 기록, Space 쪽 공유자(Agent)·대신하는 사람 기록, 원장 comment id로 PM 댓글과 답글 구분, 재poll 시 이벤트 증가 0, poll이 댓글을 쓰지 않음. 스레드 안에 PM 댓글이 섞인 경우의 건너뛰기는 fake 테스트(실제 스레드에 PM 답글이 없었음). |
| 접근 실패·전달 실패·미반영 상태 노출, 결과·수동 단계·미검증 기록 | 구현 + fake 검증, 이 문서 | 403·401·프레임 없음·쓰기 거절·결과 불명·429 테스트. |

검증 명령: `app/`에서 `npm test`, `npm run typecheck`. fake 테스트는 실제 Figma를 호출하지 않는다.

## 실제 왕복 수동 단계

1. **토큰 만들기 (사람):** PM이 붙어 동작할 사용자 본인 계정에서 발급한다(별도 PM 계정은 필요 없다). Figma 설정 → Security → Personal access tokens에서 아래 스코프로 발급한다.
   - `current_user:read`, `file_content:read`, `file_comments:read`, `file_comments:write`
2. **테스트 파일 (사람):** 그 계정이 댓글을 쓸 수 있는 시험용 Figma 파일의 프레임 하나를 고른다. 프레임 링크(`?node-id=` 포함)를 복사한다.
3. **실행 (단계별, 비대화식):** `app/`에서 실행한다. 저장소 루트와 `app/`의 `.env.local`(git 제외)을 먼저 읽으며 이미 설정된 환경변수가 우선한다. 값은 출력하지 않고 읽은 키 이름만 출력한다.
   - 토큰: `FIGMA_ACCESS_TOKEN` 또는 별칭 `FIGMA_TOKEN`
   - 대상: `FIGMA_TEST_FILE_URL`, 또는 `FIGMA_TEST_FILE_KEY`(+ 선택 `FIGMA_TEST_NODE_ID`). 프레임 id가 없으면 첫 페이지의 첫 최상위 FRAME을 읽기 API로 골라 id·이름을 출력한다.
   - 선택: `FIGMA_TEST_QUESTION`, `FIGMA_TEST_GOAL`, `ENSEMBLE_FIGMA_LIVE_DIR`(기본 `<저장소>/.local/figma-live/`, `.local/`은 git 제외)

   ```powershell
   # 1) 읽기만: 계정 handle/id, 파일 이름·버전, 고른 프레임, 댓글 수. 아무것도 쓰지 않는다.
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=preflight
   # 2) 실제 댓글 1개 작성: 공유 → 확인 → 전달. 원장은 .local/figma-live/ledger.sqlite, 요청은 state.json에 남는다.
   $env:ENSEMBLE_FIGMA_LIVE = '1'
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=post
   # 3) Figma에서 그 댓글에 답한 뒤 한 번 조회: 답·후속 항목·상태를 출력하고 원장에 기록한다. 반복 실행해도 중복 기록하지 않는다.
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=poll
   ```

   `post`는 `ENSEMBLE_FIGMA_LIVE=1` 없이는 거절한다. 다시 실행하면 같은 요청을 이어 쓰며 이미 전달된 댓글을 다시 쓰지 않는다. 실패는 단계·종류·HTTP 상태·Figma 메시지 한 줄로 출력한다(토큰 제외). 단계별 보고서는 같은 폴더의 `report-<phase>.json`이다.
4. **응답 (사람/디자이너 Agent):** `post`가 출력한 댓글 id의 **스레드에 답글로** 답한다(같은 계정이어도 된다). 새 최상위 댓글은 수신하지 않는다. 태그를 인용해도 답으로 받는다.
5. **기록:** 보고서(원장의 `figma_*` 기록, 토큰 없음)와 Figma 화면을 대조해 아래를 이 문서에 남긴다.
   - 실제 `version`·`lastModified`, 프레임 응답 형태, 댓글 위치(프레임 고정 여부)
   - 실제 댓글 id와 답 댓글의 `parent_id`, 작성자 id/handle
   - 실패했다면 단계·HTTP 상태·메시지(스코프 부족 403 등)

### 작성 주체 구분 (같은 계정 전제)

PM Agent는 사용자의 기존 Figma 계정 토큰으로 동작하므로 PM 댓글과 사람의 답이 같은 Figma 계정에서 나온다. 이것은 한계가 아니라 제품 전제다. 구분 기준은 다음 둘이며, Figma user id는 쓰지 않는다.

- **(a) 원장의 PM 게시 comment id:** `figma_comment_posted`에 기록된 id만 PM이 쓴 댓글이다. poll은 이 id만 건너뛰고, 같은 계정의 다른 답(태그를 인용한 답 포함)은 응답으로 받는다.
- **(b) 본문 태그 `[ensemble-req:<requestId>]`:** PM 댓글이 어느 Space 요청에서 왔는지 표시한다. 원장에 comment id가 아직 없는 결과 불명 쓰기의 재확인에서만 PM 댓글을 찾는 데 쓴다.

같은 계정으로 원장 밖에서 쓴 댓글(사람이 직접 쓴 답)은 사람의 답으로 받아들여진다. 이것이 의도된 동작이다. 작성자 id·handle은 원장에 그대로 기록한다. 테스트: "PM and user share one Figma account: own comments are judged by ledger comment ids, human replies are kept"(같은 계정의 일반 답글·태그 인용 답글 수신, 원장의 PM 댓글 id 건너뛰기, 같은 계정의 새 최상위 댓글 무시).

## 미검증·한계·열린 결정

- 실제 Figma 응답: nodes 응답 구조, `client_meta` FrameOffset 수용, 권한 부족 시 403/404 구분, 댓글 길이 제한, 댓글 목록 반영 지연은 확인하지 않았다. 반영 지연이 있으면 결과 불명 쓰기의 재확인에서 중복 댓글이 생길 수 있다.
- 개인 Agent → Space 공유(#81): `shareLink`는 함수 호출뿐이다. 웹 API·대시보드(`apps/web/lib/runtime.ts`)에 연결하지 않았다.
- PM 댓글 본문은 코드 템플릿이다. PM 모델이 본문을 쓰는 경로(`deliver(…, { text })`)는 열어 두었지만 모델 호출은 연결하지 않았다.
- 후속 항목은 Figma 기록으로만 열린다. 기존 작업(`create_task`)이나 결정 요청(`decision_requested`)으로 바꾸려면 Coordinator 경로와 연결해야 한다.
- 응답 수집은 PM 댓글 스레드의 답만 본다. 새 최상위 댓글로 답한 경우는 받지 않는다(설계 판단 '새 최상위 댓글은 처리하지 않는다').
- 동시 전달 보호는 한 프로세스 안에서만 동작한다. 여러 서버 인스턴스는 고려하지 않았다.
- 429는 기록만 하며 재시도 간격 정책은 없다. 주기 확인은 스크립트의 단순 반복이며 서버 타이머·webhook은 후속이다.
