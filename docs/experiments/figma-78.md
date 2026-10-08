# Figma ↔ Space 양방향 참여 실험 기록 (#78)

기준: 2026-10-07 (2026-10-08 멘션 질의·디자이너 Agent 왕복 추가). 제품 의도는 [#78](https://github.com/jovinus302/Ensemble/issues/78)과 [intent.md](../../intent.md)를 따른다. 이 문서는 연결 수단(EXPERIMENT)의 선택과 현재까지의 증거를 기록한다.

**결론: 실제 Figma 댓글 흐름에서 질문 게시 → 사람 답글 수신 → Space 후속 항목 연결까지 한 번 왕복을 관찰했다.** 2026-10-07 테스트 파일(사용자 계정으로 만든 테스트용 파일 1개)에서 `live-figma.ts` preflight·post를 실행했고, 2026-10-08 같은 스레드에 단 사람 역할 답글을 poll이 받아 기록했다. PM 댓글과 답글은 같은 Figma 계정(사용자 본인)에서 나왔고, 이는 제품 전제대로다(아래 '작성 주체 구분').

**2026-10-08 추가: 본문 `@ensemble` 멘션 질의 → PM 답글, Space 결정의 Figma 선제 전달, 디자이너 Agent(Claude Code CLI + Figma 원격 MCP)의 질의 → PM 답 → 캔버스 변경 → Space 공유를 실제로 한 번씩 관찰했다.** 아래 '멘션 질의·디자이너 Agent 실제 관찰'.

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

### 멘션 질의·디자이너 Agent 실제 관찰 (2026-10-08)

같은 테스트 파일·같은 원장(`.local/figma-live/ledger.sqlite`)·같은 계정(kevin, 제품 전제). 시각은 UTC.

| 단계 | 결과 |
|---|---|
| B. webhook 생성 시도 | 현재 PAT(스코프 `current_user:read`, `file_content:read`, `file_comments:read`, `file_comments:write`)로 `GET /v2/webhooks?context=file&context_id=<fileKey>` → 403 "requires the file_read or files:read or webhooks:read scope", `POST /v2/webhooks`(`FILE_COMMENT`, `context=file`, `status=PAUSED`, 더미 endpoint) → 403 "requires … webhooks:write scope". 생성되지 않았다. 공식 문서상 `webhooks:write`는 PAT에도 적용되는 스코프이고, 파일 webhook은 `Can edit` 권한자가 만들 수 있으며 `PAUSED`로 만들면 생성 시 PING을 보내지 않는다. 수신은 공개 URL이 필요하다(localhost 불가, ngrok 예시). 공개 엔드포인트가 없으므로 **poll 유지**. `webhooks:write` PAT 재발급 + 공개 URL은 후속 |
| E. Space 결정 선제 전달 (09:38:43) | `--phase=relay`: 원장에 Space 결정 `live-decision-1960511b0f`("프레임 1:2의 기본 버튼 라벨은 '시작하기'로 한다. 버튼 색상은 유지한다.", `decision_recorded`) 기록 → 요청 `figma-1ac47d0480f46194` → `inspect`(version `2407898605864866760`) → 프레임 1:2에 새 최상위 댓글 `1958184724` 게시, `awaiting_reply`. 사람이 먼저 묻지 않았는데 PM이 Figma에 알렸다. 이 결정은 실험용으로 스크립트가 기록한 것이며 실제 회의·Slack에서 나온 결정은 아니다 |
| C. 사람 역할 멘션 질의 (09:28:42) | 사용자 결정에 따라 Codex 워커가 사용자 Figma 세션(같은 계정)으로 프레임 1:2에 새 최상위 댓글 `1958164061` "@ensemble 이 화면 버튼 라벨 관련 결정된 게 있어?"(자동완성 멘션 없이 텍스트) 작성. 결정 기록(E)보다 10분 먼저 쓰였고 PM poll은 E 이후에 돌았다 |
| mentions dry run | `new=1`, 인용 예정 `live-decision-1960511b0f`, `figma-followup:<fileKey>:1958022831`. 아무것도 쓰지 않음 |
| mentions 1회차 | 처음 두 번은 프레임 자동 탐색용 `GET /v1/files/:key`가 429 "Rate limit exceeded"로 실패(문제로 출력, 쓰기 없음). `FIGMA_TEST_NODE_ID=1:2`로 그 호출을 생략하고 재실행 → `new=1 answered=1`. `figma_mention_received`(comment `1958164061`, root 동일, 작성자 id·handle) 후 답글 `1958187078`(09:39:49, parent `1958164061`) 게시. 본문은 [결정] `live-decision-1960511b0f`와 [미해결] Figma 답글 `1958022831`을 출처와 함께 인용하고 "디자인 반영 여부를 확인한 것은 아님"을 밝힘, 끝에 `[ensemble-req:figma-mention-c6010b992735ccd0]` |
| mentions 2회차 | `new=0 duplicates=1 answered=0` — 재수신 중복 없음, PM 답글 `1958187078`을 질의로 받지 않음 |
| D1. 디자이너 Agent 질의 (09:41:16) | Orca 터미널의 Claude Code CLI 세션(Opus, 이 워크트리, `claude mcp add --transport http --scope local figma https://mcp.figma.com/mcp`, OAuth는 코디네이터 측 Codex가 사용자 브라우저 세션으로 동의)이 REST로 스레드 `1958164061`에 답글 `1958190096` "@ensemble 프레임 1:2 버튼 라벨을 바꾸려고 해. 확정된 라벨 문구와 유지해야 할 조건 알려줘. (디자이너 Agent)" 작성. MCP에는 댓글 도구가 없어 REST를 썼다 |
| D2. PM 답 | mentions 3회차: `new=1 duplicates=1 answered=1`. 답글 멘션은 루트 `1958164061`에 답글 `1958191206`(09:41:46)으로 답함. 같은 결정·미해결 항목 인용 |
| D3. 캔버스 변경 | 디자이너 세션이 `--phase=thread`(읽기 전용)로 PM 답(`pm=yes (ledger id)`)을 읽고, Figma MCP `get_metadata` 1회 + `use_figma` 1회(+ MCP 리소스 `figma-use` 가이드 읽기 1회)로 변경. 프레임 1:2에 기존 버튼이 없어 auto-layout 프레임 `18:2` "Button / Primary"(354×52, #2563EB, 색은 디자이너 Agent가 정함)와 텍스트 `18:3` "Label" = "시작하기"를 새로 만들었다. 좌석·권한·한도 오류 없음. 독립 확인: REST `GET /nodes?ids=18:3,18:2` → `18:3 TEXT "시작하기"`, `18:2 FRAME`, 파일 version `2407927674209305652`, lastModified 09:43:27Z |
| D4. Space 공유 | `--phase=share`(`FIGMA_SHARE_BY=designer-claude`, 링크 `?node-id=18-2`): `figma_change_reported` `figma-change-30fc771e9e4d740b`(`claimed`, 요청 `figma-1ac47d0480f46194`, 멘션 `figma-mention-0b71f2cc55c101af`) → PM 재확인 `figma_change_rechecked` = `file_changed_unconfirmed`(version `2407898605864866760` → `2407927674209305652`). 내용 일치는 코드가 확정하지 않는다 |

한계: 디자이너 Agent의 Space 공유는 #81 HTTP(`POST /api/space/participants/:id/posts`)가 아니라 같은 원장에 쓰는 live 스크립트 `share` 단계로 했다(웹 서버·연결 확인 코드 절차 생략). 질의도 Space API가 아니라 Figma 댓글 경로만 썼다. PM 답이 `@ensemble`을 포함하지 않아, 원장 id로 "멘션이 든 PM 댓글"을 건너뛰는 경로(`skippedOwn`)는 실제로는 0건이었고 fake 테스트로만 확인했다.

## 선택한 경로와 이유

| 후보 | 판단 |
|---|---|
| **Figma REST API 댓글 + 주기 확인(polling)** | **채택.** 토큰 하나로 파일/프레임 읽기, 댓글 읽기·쓰기, 본인 식별(`/v1/me`)이 된다. 디자이너가 이미 보는 댓글 스레드가 응답 자리다. MCP·플러그인 설치를 전제하지 않는다. |
| webhook (`FILE_COMMENT`, `FILE_VERSION_UPDATE`) | 후속. 공개 수신 URL과 `webhooks:write` 스코프가 필요하다(2026-10-08 현재 PAT로 시도 → 403, 위 관찰 B). 반복 확인을 줄이는 수단이며 왕복의 필수 조건이 아니다. |
| 브라우저 자동화 | 보류. 로그인 세션과 화면 구조에 의존하고, 관찰한 버전·댓글 id를 안정적으로 남기기 어렵다. |
| 플러그인 | 보류. 사람이 파일을 열고 실행해야 동작하므로 PM Agent가 스스로 확인하는 경로가 아니다. |
| MCP | PM 경로에는 보류(설치 전제, 댓글 도구 없음). **디자이너 Agent 쪽 캔버스 쓰기 수단으로는 실제 확인**(원격 MCP `use_figma`, 위 관찰 D3). |

사용하는 엔드포인트(공식 문서 기준, 실제 응답은 미관찰):

- `GET /v1/me` — PM이 붙어 동작하는 사용자 계정의 id·handle. 확인 기록(`figma_inspected.pm`)과 결과 불명 쓰기의 재확인 범위를 좁히는 데 쓴다. 자기 댓글 판별에는 쓰지 않는다.
- `GET /v1/files/:key/nodes?ids=<node>&depth=1` — 링크의 프레임 이름·종류와 파일 `version`·`lastModified`. 프레임이 없으면 `null`.
- `GET /v1/files/:key/comments` — 프레임의 기존 댓글, PM 댓글 스레드의 답, 파일 전체의 `@ensemble`/`@pm_agent` 댓글.
- `POST /v1/files/:key/comments` — `message`, 프레임 고정 `client_meta: { node_id, node_offset }`. 답글은 `comment_id`(루트 댓글만 가능). 멘션 답변은 항상 이 답글 형태다.
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
| 6. Figma에서 PM에게 맥락 질의 | `FigmaBridge.pollMentions` (읽기만: `scanMentions`, 한 건 답: `answerMention`) | `figma_mention_received`(댓글 id·root/parent id·작성자 id/handle·`createdAt`·`observedAt`·질의 본문·파일 키·프레임) → `figma_mention_answer_attempted`(초안·인용한 Space 항목 id) → `figma_mention_answer_posted`(답 댓글 id) 또는 `figma_mention_answer_failed` |
| 7. 캔버스 변경 보고 + 재확인 | `FigmaBridge.reportChange`, `recheckChange` | `figma_change_reported`(보고자·요약·연결된 요청/멘션·보고 전 PM이 마지막으로 본 파일 버전, `claimed`) → `figma_change_rechecked`(`file_changed_unconfirmed` / `no_change_observed` / `no_baseline`) |
| Space 보기 | `figmaRequests`, `figmaSpaceItems`, `figmaMentions`, `figmaMentionItems`, `figmaChangeReports` | 요청별 상태·문제·후속 항목, 멘션 질의별 답변 상태·답 댓글 id·인용 항목, 변경 보고와 재확인 |

코드: [app/packages/orchestrator/src/figma/](../../app/packages/orchestrator/src/figma/) — `link.ts`(링크 해석), `client.ts`(인터페이스·REST), `fake.ts`, `ledger.ts`(기록·투영), `mentions.ts`(멘션 판별·Space 맥락 항목·답변 본문), `bridge.ts`(흐름). 테스트: [app/test/figma-bridge.test.ts](../../app/test/figma-bridge.test.ts). 실제 왕복 스크립트: [live-figma.ts](../../app/packages/orchestrator/scripts/live-figma.ts).

### 설계 판단

- **core `EventPayloads`에 넣지 않았다.** `project()`는 모르는 이벤트를 무시하므로 Figma 기록이 기존 작업·결정·자동화 한도에 영향을 주지 않는다(테스트로 확인). 경로가 실제 계정에서 검증되면 core 편입을 다시 판단한다. #79·#80 작업과 공유 파일 충돌도 피한다.
- **orchestrator 진입점(`index.ts`)에 아직 노출하지 않았다.** 호스트는 `src/figma/index.ts`를 직접 가져온다.
- **PM 댓글 추적:** 본문 끝에 `— Ensemble PM Agent · Space <projectId> [ensemble-req:<requestId>]`를 붙인다. 호출자가 준 본문(모델 초안 등)에 다른 태그가 있으면 지운다.
- **전달 성공 판정:** Figma가 돌려준 댓글 id가 기록된 때만 `awaiting_reply`다. 초안(`attempted`)이나 대시보드 표시는 전달이 아니다.
- **결과를 모르는 쓰기:** 네트워크 오류·5xx는 `delivery_unknown`으로 남긴다. 다시 전달하기 전에 댓글 목록에서 같은 태그 (b)의 루트 댓글을 찾고(원장에 아직 comment id가 없으므로. 작성자가 토큰 계정인지는 범위를 좁히는 조건일 뿐이다), 있으면 그 id로 확정(`reconciled`)한다. 목록을 읽지 못하면 새로 쓰지 않는다.
- **중복 방지:** 같은 공유·결정 전달은 같은 요청 id로 모이고, 답은 Figma 댓글 id로 한 번만 기록된다. 같은 프로세스 안의 동시 전달은 요청별로 직렬화한다.
- **설계 원칙 — 같은 계정 전제:** PM Agent는 각 사용자의 기존 툴 계정에 붙어서 동작한다. 그래서 PM 댓글과 사람의 답글이 같은 Figma 계정에서 나오는 것이 정상이며, PM 전용 계정을 요구하지 않는다. 작성 주체는 계정(Figma user id)이 아니라 (a) 원장에 `figma_comment_posted`로 기록된 PM 게시 comment id, (b) PM 댓글 본문의 `[ensemble-req:<requestId>]` 태그로 구분한다(아래 '작성 주체 구분').
- **자기 댓글:** PM이 자동으로 답하는 댓글은 아래 '멘션 질의'뿐이다. `pollReplies`는 (a) 원장의 PM 게시 comment id(요청 댓글과 멘션 답변 모두)만 자기 댓글로 건너뛴다. user id로 거르면 같은 계정인 사람의 답이 모두 버려지고, 태그로 거르면 사람이 태그를 인용한 답이 버려지기 때문이다. 예외로, 이 Space의 PM 서명 줄(`— Ensemble PM Agent · Space <projectId> [ensemble-req:`)이 붙은 댓글은 id가 원장에 없어도(결과 불명 쓰기, 중복으로 들어간 답변) 사람 답으로 받지 않는다. PM 자기 글이 후속 항목·미해결 항목으로 되돌아오는 것을 막기 위해서다. 태그만 인용한 답은 여전히 사람 답이다.
- **멘션 질의(텍스트 트리거):** Figma의 @멘션은 실제 Figma 사용자만 가리키므로 `@ensemble`/`@pm_agent`는 댓글 `message`에 평문으로 온다. 사람이 쓴 댓글(최상위든, 파일 안 어느 스레드의 답글이든)에 `@ensemble` 또는 `@pm_agent`(대소문자 무시, 단어 경계. `team@ensemble.com`, `@ensembles`는 아님)가 있으면 Space 맥락 질의로 본다. PM은 같은 스레드에 답한다. 질의가 최상위면 그 댓글에, 답글이면 그 루트(`parent_id`)에 답글을 단다(Figma는 루트에만 답글을 허용). 같은 계정이 쓴 질의도 사람 질의다(작성자 id로 판단하지 않는다).
- **멘션 답변 본문:** Space의 목표, 결정(`decision_recorded`, 회의 결정 기록, Slack에서 관찰된 결정), 미해결 항목(답 대기 결정 요청, PM 미해결 주제, 회의 미해결 기록, Slack 남은 일·응답 대기 요청, 반영 보고가 없는 Figma 후속 항목)을 출처(id와 어디서 왔는지)와 함께 적는다. 고르는 방법은 질의 단어와 항목 본문의 단어 겹침(한글은 2자 이상 접두 일치로 조사를 흡수)이다. 겹치는 항목이 없으면 현재 목표·최근 결정·미해결 항목을 6개까지 나열한다. 모델 호출은 없다. `answerMention(…, { text })`나 `pollMentions(…, { compose })`로 모델이 쓴 본문을 넣을 수 있고, 끝의 서명 줄과 `[ensemble-req:<mentionId>]` 태그는 항상 코드가 붙인다. 답은 Space 기록을 읽은 것이지 디자인 반영을 확인한 것이 아니라고 적는다.
- **멘션 중복 방지·전달 판정:** 멘션 id는 파일 키+댓글 id에서 정해지므로 같은 댓글은 한 번만 기록된다. 답은 Figma가 돌려준 comment id가 기록된 때만 `answered`다. 거절(4xx)은 `answer_failed`로 남고 다음 poll에서 다시 쓴다. 결과 불명(네트워크 오류·5xx)은 `answer_unknown`이며, 다시 쓰기 전에 루트 스레드에서 같은 태그+서명 줄의 답글을 찾아 있으면 그 id로 확정(`reconciled`)한다. 댓글 목록을 읽지 못하면 새로 쓰지 않는다. 한 번이라도 결과 불명이었던 멘션은 답이 기록될 때까지 매 시도 전에 이 재확인을 한다(뒤이은 시도가 깨끗하게 거절돼도 유지). 재확인용 댓글 목록은 멘션별 잠금 안에서 새로 읽는다(poll이 앞서 읽은 목록은 동시 시도보다 오래됐을 수 있다).
- **멘션에서 PM 자기 댓글 판별은 보수적으로:** (a) 원장의 PM 게시 comment id, 그리고 (b) 이 Space의 PM 서명 줄(`— Ensemble PM Agent · Space <projectId> [ensemble-req:`)이 들어 있는 댓글은 `@ensemble`이 있어도 질의로 보지 않는다. 답 댓글과 답을 구분하는 `pollReplies`와 달리, 여기서 잘못 판정하면 PM이 자기 글에 답하는 고리가 생기므로 아직 id가 기록되지 않은 PM 쓰기(결과 불명)까지 막는다. 사람이 PM 서명 줄을 통째로 붙여 넣은 질의는 답을 받지 못한다.
- **새 최상위 댓글 중 멘션이 없는 것은 여전히 처리하지 않는다:** `pollReplies`는 PM 댓글 스레드의 답만 읽고, `pollMentions`는 트리거가 있는 댓글만 읽는다. 사람이 `@ensemble` 없이 프레임에 새 최상위 댓글을 쓰면 PM은 그 댓글을 기록하지도, 후속 항목으로 만들지도, 답하지도 않는다(테스트로 고정). PM 요청 스레드 안의 `@ensemble` 답글은 두 경로 모두에 해당한다. 답글로서 후속 항목이 되고, 질의로서 맥락 답변을 받는다.
- **캔버스 변경 보고:** 디자이너 Agent(Space 참여자)가 캔버스를 바꿨다고 `reportChange`로 알리면 요청·멘션에 연결된 주장(`claimed`)으로 남는다. 기준 버전은 보고 시점에 PM이 그 파일을 마지막으로 확인한 기록이다(요청이 연결되면 그 요청의 전달 당시 확인). `recheckChange`는 파일을 다시 읽어 버전·`lastModified`가 바뀌었는지만 기록한다. 보고 자체의 검증 등급은 올라가지 않는다.
- **확인과 주장의 구분:** 답은 `claimed`다. 재확인은 파일 버전이 바뀌었는지만 본다(`file_changed_unconfirmed` / `no_change_observed`). 디자인 반영 완료를 코드가 확정하는 상태는 없다. 참여자의 반영 보고도 검증 등급을 올리지 않는다.
- **확인하지 못한 프레임에는 쓰지 않는다:** 접근 실패(`access_failed`), 프레임 없음(`frame_not_found`)이면 전달을 거절한다.

### 상태

`opened` → `inspected` | `access_failed` | `frame_not_found` → `delivering` → `awaiting_reply` | `delivery_failed` | `delivery_unknown` → `reply_received`. 마지막 실패는 `problem`(단계·종류·HTTP 상태·설명)으로 남고, 같은 단계가 성공하면 지워진다. 전달 후의 조회 실패(예: 429)도 `problem`으로 드러난다.

멘션 질의: `received` → `answering` → `answered` | `answer_failed` | `answer_unknown`. 답변 실패는 `problem`으로 남고 답이 기록되면 지워진다. 파일 댓글 목록을 읽지 못한 poll은 아무것도 기록하지 않고 `PollMentionsResult.problem`으로만 돌려준다.

## 완료 기준별 현황

| 완료 기준 | 판정 | 근거 |
|---|---|---|
| 개인 Agent가 Space에서 맥락을 읽고 질문/링크를 직접 공유 | **Figma 댓글 경로로 실제 검증, #81 HTTP 경로는 미검증** | 디자이너 Agent(Claude Code CLI)가 `@ensemble` 답글로 묻고 PM 답을 받아 캔버스를 바꾼 뒤 변경 보고를 원장에 남겼다(D1~D4). Space 공유는 live 스크립트로 했고 #81 HTTP 연결은 쓰지 않았다. |
| PM이 허용된 Figma 원본에 접근해 확인 범위와 출처를 남김 | **실제 검증** (테스트 파일 1개) | `figma_inspected`: 실제 파일 version·lastModified·프레임 `1:2`·관찰 시각을 기록. |
| PM 질문과 상대 응답이 실제 Figma 댓글에서 한 번 왕복 | **실제 검증** | 댓글 `1955923874` 게시 → 답글 `1958022831` 수신 → 후속 항목 연결. PM 댓글과 답글은 같은 계정(제품 전제)이며 comment id로 구분됐다. |
| Space에서 시작한 조율도 Figma에 도달, 응답이 다음 행동으로 연결 | 응답→후속 항목은 실제 검증, 나머지는 fake (일부) | 실제 답글이 `figma_followup_linked`(Space 미해결 항목)로 기록됨. `relayDecision` → 실제 Figma 최상위 댓글 `1958184724`(관찰 E, 이후 응답은 아직 없음). 기존 작업·결정 요청으로의 변환은 미구현. |
| 파일/프레임·댓글·버전·관찰 시각·참여자 식별 보존, 재수신 중복 없음, 자기 댓글에 답하지 않음 | **실제 검증** (스레드 안 PM 댓글 건너뛰기는 fake) | 실제: 댓글 id·parent·작성자 id/handle·작성 시각·관찰 시각 기록, Space 쪽 공유자(Agent)·대신하는 사람 기록, 원장 comment id로 PM 댓글과 답글 구분, 재poll 시 이벤트 증가 0, poll이 댓글을 쓰지 않음. 스레드 안에 PM 댓글이 섞인 경우의 건너뛰기는 fake 테스트(실제 스레드에 PM 답글이 없었음). |
| 사람이 본문 `@ensemble`/`@pm_agent`로 물으면 같은 스레드에 Space 결정·미해결 항목과 출처로 답함 | **실제 검증** (`@ensemble`; `@pm_agent`는 fake) | 최상위 질의 `1958164061` → 답 `1958187078`, 답글 질의 `1958190096` → 루트에 답 `1958191206`. 재poll 중복 0. |
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

   `post`는 `ENSEMBLE_FIGMA_LIVE=1` 없이는 거절한다. 다시 실행하면 같은 요청을 이어 쓰며 이미 전달된 댓글을 다시 쓰지 않는다. 실패는 단계·종류·HTTP 상태·Figma 메시지 한 줄로 출력한다(토큰 제외). 단계별 보고서는 같은 폴더의 `report-<phase>.json`이다(요청·멘션·변경 보고 투영과 `figma_*` 기록).

   Space→Figma 전달, 멘션 질의, 변경 보고(모두 같은 원장 `.local/figma-live/ledger.sqlite`를 쓴다):

   ```powershell
   # 4) Space 결정을 원장에 decision_recorded로 기록(id: live-decision-<해시>)하고 프레임에 최상위 댓글로 전달한다. 요청 id는 state.json의 relayRequestId.
   $env:ENSEMBLE_FIGMA_LIVE = '1'
   $env:FIGMA_TEST_DECISION = "프레임 1:2 기본 버튼 라벨은 '시작하기'로 한다; 색상 유지"
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=relay
   # 5) @ensemble/@pm_agent 댓글: ENSEMBLE_FIGMA_LIVE 없이 실행하면 감지 목록과 답변 미리보기(인용할 항목 id)만 출력하고 Figma에 쓰지 않는다.
   Remove-Item Env:ENSEMBLE_FIGMA_LIVE
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=mentions
   #    ENSEMBLE_FIGMA_LIVE=1이면 기록하고 같은 스레드에 답한다. mention id·답 댓글 id·new/skippedOwn/duplicates/answered를 출력한다. 반복 실행해도 다시 답하지 않는다.
   $env:ENSEMBLE_FIGMA_LIVE = '1'
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=mentions
   # 6) 스레드 읽기(읽기만): 디자이너 Agent가 MCP 댓글 도구 없이 PM 답변을 읽는다. pm=yes는 원장에 기록된 PM 댓글 id다.
   $env:FIGMA_THREAD_ID = '<루트 댓글 id>'
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=thread
   # 7) 디자이너 Agent의 캔버스 변경 보고(주장) + PM의 파일 버전 재확인. Figma에는 쓰지 않는다.
   $env:FIGMA_SHARE_SUMMARY = '프레임 1:2 버튼 라벨을 시작하기로 바꿈'
   $env:FIGMA_SHARE_BY = 'designer-claude'   # 기본값. 원장에 agent 참여자로 등록된다
   npx tsx packages/orchestrator/scripts/live-figma.ts --phase=share
   ```

   `relay`는 `ENSEMBLE_FIGMA_LIVE=1`과 `FIGMA_TEST_DECISION`이 없으면 거절한다. 결정은 기존 PM 스레드(답글)가 아니라 프레임의 새 최상위 댓글로 간다. 전달된 결정은 새 요청이 되어 그 스레드의 답을 `poll`이 함께 읽는다(답글로 붙이면 요청별 스레드 구분이 깨진다). `FIGMA_TEST_DECISION`이 설정돼 있으면 `mentions`·`share`도 같은 결정을 (한 번만) 기록한다. `share`는 `FIGMA_SHARE_REQUEST_ID`(기본: `relayRequestId`, 없으면 `requestId`), `FIGMA_SHARE_MENTION_ID`(기본: 답한 마지막 멘션), `FIGMA_SHARE_LINK`(선택)로 연결 대상을 정한다.
4. **응답 (사람/디자이너 Agent):** `post`가 출력한 댓글 id의 **스레드에 답글로** 답한다(같은 계정이어도 된다). 멘션 없는 새 최상위 댓글은 수신하지 않는다. 태그를 인용해도 답으로 받는다. PM에게 Space 맥락을 물으려면 어느 댓글이든 본문에 `@ensemble`(또는 `@pm_agent`)을 평문으로 적고 `--phase=mentions`를 실행한다.
5. **기록:** 보고서(원장의 `figma_*` 기록, 토큰 없음)와 Figma 화면을 대조해 아래를 이 문서에 남긴다.
   - 실제 `version`·`lastModified`, 프레임 응답 형태, 댓글 위치(프레임 고정 여부)
   - 실제 댓글 id와 답 댓글의 `parent_id`, 작성자 id/handle
   - 실패했다면 단계·HTTP 상태·메시지(스코프 부족 403 등)

### 작성 주체 구분 (같은 계정 전제)

PM Agent는 사용자의 기존 Figma 계정 토큰으로 동작하므로 PM 댓글과 사람의 답이 같은 Figma 계정에서 나온다. 이것은 한계가 아니라 제품 전제다. 구분 기준은 다음 둘이며, Figma user id는 쓰지 않는다.

- **(a) 원장의 PM 게시 comment id:** `figma_comment_posted`, `figma_mention_answer_posted`에 기록된 id만 PM이 쓴 댓글이다. poll은 이 id와 (b)의 서명 줄이 붙은 댓글만 건너뛰고, 같은 계정의 다른 답(태그만 인용한 답 포함)은 응답으로 받는다.
- **(b) 본문 태그 `[ensemble-req:<requestId|mentionId>]`:** PM 댓글이 어느 Space 요청·멘션에서 왔는지 표시한다. 원장에 comment id가 아직 없는 결과 불명 쓰기의 재확인에서 PM 댓글을 찾는 데 쓴다. `pollReplies`와 멘션 판별 모두 서명 줄과 함께 있으면 PM 댓글로 보고 답·질의로 받지 않는다(위 '멘션에서 PM 자기 댓글 판별은 보수적으로').

같은 계정으로 원장 밖에서 쓴 댓글(사람이 직접 쓴 답)은 사람의 답으로 받아들여진다. 이것이 의도된 동작이다. 작성자 id·handle은 원장에 그대로 기록한다. 테스트: "PM and user share one Figma account: own comments are judged by ledger comment ids, human replies are kept"(같은 계정의 일반 답글·태그 인용 답글 수신, 원장의 PM 댓글 id 건너뛰기, 같은 계정의 새 최상위 댓글 무시).

## 미검증·한계·열린 결정

- 실제 Figma 응답: nodes 응답 구조, `client_meta` FrameOffset 수용, 권한 부족 시 403/404 구분, 댓글 길이 제한, 댓글 목록 반영 지연은 확인하지 않았다. 반영 지연이 있으면 결과 불명 쓰기의 재확인에서 중복 댓글이 생길 수 있다.
- 개인 Agent → Space 공유(#81): `shareLink`는 함수 호출뿐이다. 웹 API·대시보드(`apps/web/lib/runtime.ts`)에 연결하지 않았다.
- PM 댓글 본문과 멘션 답변은 코드 템플릿이다. PM 모델이 본문을 쓰는 경로(`deliver(…, { text })`, `answerMention(…, { text })`, `pollMentions(…, { compose })`)는 열어 두었지만 모델 호출은 연결하지 않았다. 멘션 답변의 항목 선택은 단어 겹침이라 동의어·다른 표현은 놓치고, 흔한 단어(예: "화면")로 관련 없는 항목이 걸릴 수 있다.
- 멘션 질의는 기능을 켠 시점 이전의 `@ensemble` 댓글에도 답한다(기준 시각 필터 없음). 해결(resolved)된 스레드도 구분하지 않는다. 거절된 답변은 poll마다 다시 쓴다(재시도 간격·횟수 제한 없음).
- 후속 항목은 Figma 기록으로만 열린다. 기존 작업(`create_task`)이나 결정 요청(`decision_requested`)으로 바꾸려면 Coordinator 경로와 연결해야 한다.
- 응답 수집은 PM 댓글 스레드의 답만 본다. 멘션 없는 새 최상위 댓글로 답한 경우는 받지 않는다(설계 판단 '새 최상위 댓글 중 멘션이 없는 것은 여전히 처리하지 않는다'). 멘션 질의·선제 전달·변경 보고는 2026-10-08 실제 Figma에서 한 번씩 관찰했다(위 관찰 표).
- 동시 전달 보호는 한 프로세스 안에서만 동작한다. 여러 서버 인스턴스는 고려하지 않았다.
- 429는 기록만 하며 재시도 간격 정책은 없다. 2026-10-08 실제로 `GET /v1/files/:key`(프레임 자동 탐색)가 연속 429를 받았다 — 운영에서는 프레임 id를 저장해 이 호출을 피해야 한다.
- Figma 원격 MCP는 사람의 OAuth 동의가 필요하고(세션당 1회, 브라우저 localhost 콜백), View/Collab 좌석은 월 호출 수 제한이 있다(이번 계정에서는 막히지 않음, 좌석 종류는 미확인).
- 이번 Space 결정은 실험 스크립트가 기록했다. 실제 회의·Slack 결정이 Figma로 선제 전달되는 연결은 미검증이다. 주기 확인은 스크립트의 단순 반복이며 서버 타이머·webhook은 후속이다.
