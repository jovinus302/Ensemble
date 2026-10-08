# Slack ↔ Space 양방향 조율 실험 (#79)

기준: 2026-10-07, 브랜치 `jovinus302/issue-79-slack`. 기술 선택은 **EXPERIMENT**다. 이 문서는 구현한 경로(Socket Mode 실행기와 HTTP 엔드포인트)와 수동 설치 단계, 검증 범위를 기록한다. **실제 Slack 워크스페이스와의 왕복은 아직 검증하지 않았다(미검증).** 구현 시점에는 Slack 토큰이 없어 fake Slack·fake 소켓 단위 테스트와 로컬 서명 검사까지만 실행했다. 이 문서를 "Slack 연동 완료"의 근거로 쓰지 않는다.

## 1. 선택한 경로와 이유

| 항목 | 선택 | 이유 |
|---|---|---|
| 참여 주체 | Ensemble Slack App의 bot user | 채널 초대(`/invite`)로 범위를 정하고, 작성 주체가 PM Agent임이 Slack에 드러난다 |
| 요청 수신 | Events API 이벤트 `app_mention` + `message.channels`를 **Socket Mode**(실험 실행기) 또는 HTTP 엔드포인트(웹 앱)로 받는다 | 멘션은 `app_mention`, 멘션 없는 스레드 답변은 `message.*`로만 온다. B의 담당자 답변과 A의 후속 답변을 받으려면 둘 다 필요하다. Socket Mode는 공개 URL 없이 실제 왕복을 시험할 수 있다 |
| 맥락 읽기 | `conversations.replies` | 질문이 달린 스레드만 읽는다. 채널 전체 기록을 모으지 않는다 |
| 답변·선제 연락 | `chat.postMessage` (`thread_ts`) | A는 같은 스레드, B는 지정 채널의 새 스레드(또는 설정한 스레드) |
| 답변 생성 | 기존 PM `LlmProvider`에 강제 tool(`slack_thread_reply`) | 웹 앱의 PM 런타임 선택(`ENSEMBLE_PM_RUNTIME`)을 그대로 쓴다. 모델 실패 시 Space 상태를 담은 고정 문장으로 답하고 원장에 `composedBy: template`로 표시한다 |
| 기록 | 원장의 `external_*` 이벤트 | 화면 상태가 아니라 이벤트 원장을 정본으로 둔다는 기존 규칙을 따른다 |

두 수신 경로는 같은 `routeSlackEvent` → `SlackCoordinator` 경로를 쓴다. Socket Mode는 app-level 토큰(`xapp-`, `connections:write`)으로 `apps.connections.open`을 호출해 WebSocket을 열고, 받은 envelope마다 `{envelope_id}`로 즉시 응답(ack)한 뒤 `events_api` 페이로드를 처리한다. `hello`는 연결 확인, `disconnect`는 새 연결로 교체, 그 밖의 종료는 1초부터 최대 30초까지 늘려 가며 재연결한다. 중복 제거는 HTTP와 같이 event_id와 원장 키로 한다. 추가 의존성 없이 Node 24의 전역 `WebSocket`을 쓴다. 브라우저 참여 방식과 MCP는 시도하지 않았다(MCP는 필수 전제가 아니다).

## 2. 구현 위치

| 위치 | 하는 일 |
|---|---|
| [core/external.ts](../app/packages/core/src/external.ts) | 외부 대화 이벤트 4종과 투영(`externalConversation`), 응답 기한 지난 요청(`overdueExternalRequests`), 작업별 후속(`externalFollowUps`) |
| [channel/slack/](../app/packages/channel/src/slack/) | 서명 검증(v0 HMAC-SHA256, ±5분), 이벤트 요청 처리(`url_verification`, 재전송 헤더), 이벤트 분류(`routeSlackEvent`), event_id 중복 제거, Web API 실제 구현(`SlackWebApi`, fetch)과 테스트용 `FakeSlackApi`, 환경변수 읽기 |
| [orchestrator/slack-coordination.ts](../app/packages/orchestrator/src/slack-coordination.ts) | `SlackCoordinator`: Space 연결, 흐름 A·B, 실패·응답 부재 기록 |
| [channel/slack/socket-mode.ts](../app/packages/channel/src/slack/socket-mode.ts) | Socket Mode 클라이언트(`SlackSocketModeClient`, `openSocketModeUrl`). 소켓은 인터페이스로 추상화해 테스트에서 fake 소켓을 쓴다 |
| [orchestrator/scripts/slack-live.ts](../app/packages/orchestrator/scripts/slack-live.ts) | 실험 실행기 `npm run live:slack`: `.env.local` 읽기(값 출력 없음), `--check`, Socket Mode 연결, 흐름 B 트리거, 단계별 구조화 로그 |
| [web/app/api/slack/events/route.ts](../app/apps/web/app/api/slack/events/route.ts) | Events API 엔드포인트. 서명 확인 후 즉시 200으로 응답하고 처리는 `after()`로 응답 뒤에 한다(Slack 3초 제한) |
| [web/lib/runtime.ts](../app/apps/web/lib/runtime.ts) | `SLACK_*`가 있을 때만 `slack()` 구성. 원장 변경마다 흐름 B 확인, 5분 틱에서 응답 기한 확인 |
| [test/slack-coordination.test.ts](../app/test/slack-coordination.test.ts), [test/slack-socket-mode.test.ts](../app/test/slack-socket-mode.test.ts) | fake Slack·fake 소켓 기반 테스트 |

Space 대응: 한 Slack 워크스페이스의 한 채널(`SLACK_CHANNEL_ID`, 별칭 `SLACK_TEST_CHANNEL_ID`)을 하나의 Space에 연결한다. 실험 실행기는 자체 SQLite 원장(`app/data/slack-live.db`, 프로젝트 `slack-live`)에 작은 Space(목표·결정 1건·조사 Agent 작업)를 만들어 쓰고, 웹 앱(HTTP 경로)은 **현재 프로젝트**에 연결한다. 팀 id와 bot user id는 설정에 없으면 `auth.test`로 채운다. 다른 팀·채널 이벤트는 기록하지 않고 무시한다.

사람 연결: `SLACK_USER_MAP`(`U…=member`)이 있으면 그대로 쓴다. **없으면 테스트용 대체 규칙**으로 연결된 채널의 사람(bot이 아닌 작성자)을 모두 목표 결정권자로 본다. 그 사람의 `decision`은 결정으로 남고, 결정권자에게 보낸 요청에는 채널의 누구나 답할 수 있다. 흐름 B는 `SLACK_OWNER_USER_ID`가 있으면 그 사람을 `<@…>`로 부르고, 없으면 "담당자님,"처럼 이름으로만 부른다(Slack 알림은 가지 않음). 실제 팀에서는 `SLACK_USER_MAP`을 써야 한다.

## 3. 흐름

### A. 팀이 PM Agent를 부르는 경우

1. `app_mention` 수신 → 멘션 메시지를 원장에 먼저 기록(`external_message_observed`, kind `request`).
2. `conversations.replies`로 스레드를 읽고, Space의 목표·확정 결정(`decision_recorded`)·작업 상태·열린 결정 요청·Slack에서 기다리는 요청을 함께 모델에 전달한다.
3. 같은 스레드(`thread_ts` = 스레드 루트, 루트 멘션이면 그 메시지)에 답한다. 확인이 필요한 답(kind `ask`)이면 질문한 사람을 대상으로 `external_request_sent`(응답 대기)를 남긴다.
4. 이후 그 스레드의 사람 답변(멘션 없이도)을 기록하고 모델이 분류한 결정/제안/요청/답변과 확정 내용·남은 일을 함께 남긴다. 요청 대상자의 답이면 요청을 `answered`로 닫는다. PM은 멘션 없이는 다시 답하지 않는다.

### B. PM Agent가 필요한 사람을 찾아가는 경우

1. 원장에 개인 Agent의 결과(`result_submitted`, actor `agent`) 또는 막힘(`task_blocked`, Agent 담당 작업)이 기록된다. `decision_recorded`는 설정으로 켤 수 있다(기본 꺼짐).
2. 원장 변경마다 `syncSpaceChanges()`가 아직 보내지 않은 변화를 찾아, 담당자(막힘의 `unblockBy`가 사람이면 그 사람, 아니면 목표 결정권자)를 `<@U…>`로 부르며 지정 채널에 먼저 보낸다. 멘션을 기다리지 않는다. 같은 변화는 한 번만 보낸다(요청 id = `slack-request:<원장 이벤트 id>`).
3. 그 스레드의 담당자 답변을 기록하고 요청을 닫는다. 답변은 요청의 `taskIds`로 원래 작업에 연결되어 `externalFollowUps(state, taskId)`로 읽을 수 있다.

## 4. 원장 기록과 구분

| 이벤트 | 보존하는 것 |
|---|---|
| `external_message_observed` | 원본 위치(`workspaceId`·`channelId`·`messageTs`·`threadTs`), 작성자(`human`/`agent`/`pm`, Slack id, 연결된 멤버), Slack 시각(`postedAt`)과 관찰 시각(이벤트 `at`), 분류(`decision`/`proposal`/`request`/`answer`/`other`/`unclassified`), 확정 내용·남은 일, 답한 요청, 관련 작업 |
| `external_request_sent` | PM이 기다리는 요청: 대상, 사유(`thread_question`/`agent_result`/`agent_blocker`/`decision_followup`), 계기 이벤트, 작업, 응답 기한(`dueAt`, 기본 24시간) |
| `external_request_resolved` | `answered`(답변 메시지 연결) 또는 `no_response`(기한 경과). 먼저 기록된 결과가 유지되고 늦은 답은 요청에 연결만 된다 |
| `external_delivery_failed` | 단계(`read`/`compose`/`send`), 작업 이름, Slack 오류 코드, 시도 횟수. 토큰·요청 본문은 남기지 않는다 |

- **결정/제안/미응답 요청**: 아직 답하지 않은 요청은 `awaiting_response` 상태로 구분된다. Slack 메시지의 `decision`은 Space 멤버에 연결된 사람이 쓴 경우에만 유지되고, 연결되지 않은 사람이나 Agent의 "결정"은 `proposal`로 낮춘다.
- Slack의 `decision` 분류는 대화 기록일 뿐 `decision_recorded`(Space 권한이 있는 확정 결정)를 만들지 않는다. 승격 경로는 후속 결정이다.
- 작성 주체: PM Agent 자신은 `pm`, `SLACK_USER_MAP`에서 Agent 멤버로 연결된 bot은 `agent`, 그 외 사람은 `human`(멤버 연결 없음 가능).

## 5. 중복·자기 메시지 방지

- 같은 `event_id`는 프로세스 안에서 한 번만 처리한다(`X-Slack-Retry-Num`이 붙은 재전송 포함).
- 재시작 뒤 재전송은 메시지 원장 키(`slack:<team>:<channel>:<ts>`)로 막는다. 멘션을 먼저 기록한 뒤 답하므로 답은 **최대 한 번**이다. 기록 후 게시 전에 프로세스가 죽으면 그 멘션에는 답하지 않는다(중복보다 누락을 택함).
- 멘션은 `app_mention`과 `message` 두 이벤트로 오므로 `message` 쪽은 무시한다.
- 자기 메시지(`user` = bot user id, `bot_id` = 자기 bot id, 자기 `bot_message`), 연결되지 않은 bot, 수정·삭제·입장 같은 subtype, PM이 참여하지 않은 스레드와 멘션 없는 루트 메시지는 처리하지 않는다.
- **보정 조회(catch-up)**: 실험 실행기는 시작할 때와 1분마다 `SlackCoordinator.catchUp()`을 부른다. PM이 참여한 스레드(PM 메시지나 요청이 있는 스레드)를 `conversations.replies`로 다시 읽고, PM의 첫 메시지 이후 메시지를 실시간 이벤트와 같은 경로(`routeSlackEvent` → 원장 키 확인)로 넘긴다. 이미 기록된 메시지는 원장 키로 `duplicate`가 되고, 자기 메시지는 `self`로 걸러지므로 몇 번 돌아도 한 번만 기록된다. 이벤트 구독 누락, 연결 끊김, 실행기 재시작 동안 놓친 스레드 답을 회수하는 용도다. 놓친 멘션은 늦게 한 번 답한다. 결과는 `slack.catch_up`(`threads`, `recovered`)으로 남는다.

## 6. 실패와 응답 부재

- 스레드 읽기 실패: 실패를 기록하고 같은 스레드에 "스레드 맥락을 읽지 못해 아직 답하지 못했어요 (오류 코드)"라고 알린다. 알림 게시도 실패하면 두 실패가 모두 원장에 남는다.
- 답변 생성 실패: 고정 문장으로 답하고 `compose` 실패와 `composedBy: template`를 기록한다.
- 게시 실패: `send` 실패만 기록하고 PM 메시지는 기록하지 않는다. 흐름 B는 다음 확인 때 최대 3회까지 다시 보낸다. 담당자의 Slack 계정이 연결되지 않았으면 `recipient_not_mapped`를 한 번 기록하고 다시 시도하지 않는다.
- 응답 부재: `expireOverdue()`가 기한 지난 요청을 `no_response`로 기록한다(웹은 5분 틱).
- 표시 범위: Slack 스레드 알림(읽기 실패)과 원장 기록, `SlackCoordinator.status()`까지다. 웹 화면에 Slack 상태를 그리는 것은 이번 범위에 없다.

## 7. 실제 왕복을 위한 수동 단계

### 7.1 Slack 앱 설정 (Socket Mode)

1. https://api.slack.com/apps 에서 테스트 워크스페이스에 앱을 만든다(이름 예: Ensemble).
2. **Socket Mode** 켜기 → app-level 토큰 생성(scope `connections:write`) → `SLACK_APP_TOKEN`(`xapp-`).
3. **OAuth & Permissions → Bot Token Scopes**: `app_mentions:read`, `channels:history`(비공개 채널이면 `groups:history`), `chat:write`. `--check`의 채널 확인(`conversations.info`)에는 `channels:read`(비공개면 `groups:read`)가 필요하며, 없으면 그 항목만 `missing_scope`로 표시된다.
4. **Event Subscriptions** 켜기 → Subscribe to bot events: `app_mention`, `message.channels`(비공개면 `message.groups`). Socket Mode에서는 Request URL이 필요 없다. `message.channels`가 빠지면 멘션(`app_mention`)만 오고 스레드 답·자기 메시지 이벤트는 오지 않는다(2026-10-08 실측). `--check`는 구독 목록을 확인할 수 없으므로, 첫 실행에서 PM 답 직후 `slack.event_skipped`(`self`)가 보이는지로 확인한다. 이 경우에도 1분 주기 catch-up이 스레드 답을 회수하지만 최대 1분 늦다.
5. 워크스페이스에 설치 → Bot User OAuth Token(`xoxb-`) → `SLACK_BOT_TOKEN`. 테스트 채널에서 `/invite @Ensemble`, 채널 id → `SLACK_TEST_CHANNEL_ID`.
6. 값은 git 제외 대상인 `.env.local`(저장소 루트 또는 `app/`)에 둔다. 선택: `SLACK_USER_MAP`, `SLACK_OWNER_USER_ID`, 모델 사용 시 기존 PM 설정(`ENSEMBLE_PM_RUNTIME`, `ANTHROPIC_API_KEY` 등, `.env`). 모델 설정이 없으면 답은 고정 문장(`composedBy: template`)이다.

### 7.2 실행과 확인 (`app/`에서)

| 단계 | 명령 | 확인할 로그 |
|---|---|---|
| 점검 | `npm run live:slack -- --check` | `check_auth`(부여된 scope, 빠진 scope), `check_channel`(bot이 채널 멤버인지), `check_history`, `check_socket_mode`, `check_done ok` |
| A | `npm run live:slack` 실행 후 테스트 채널의 스레드에서 `@Ensemble 다음에 뭘 확인해야 해?` → 같은 스레드에 답이 오면 그 스레드에 사람이 답한다 | `slack.event_received` → `slack.thread_read` → `slack.reply_posted`(ts) → (`ask`이면) `slack.request_sent` → 답변 후 `slack.reply_recorded`(`resolved: true`) |
| B | `npm run live:slack -- --trigger-blocker "인터뷰 대상자가 5명뿐이에요"` (또는 `--trigger-result "<요약>"`) → 채널에 PM이 먼저 올린 메시지의 스레드에 답한다 | `space_change_recorded` → `slack.request_sent`(ts) → 답변 후 `slack.reply_recorded`(`resolved: true`) |
| 종료 | Ctrl+C (또는 `--minutes <n>`) | `stopped`: 요청별 상태(`awaiting_response`/`answered`/`no_response`), 실패 목록 |

- 중복·자기 메시지: 실행 중 `socket.acked`와 `slack.event_skipped`(`duplicate`, `self`, `mention_via_app_mention`)를 확인한다. PM 자신의 답에는 다시 답하지 않아야 한다.
- 응답 부재: `--response-timeout-minutes 2`로 실행하고 답하지 않으면 1분 주기 점검에서 `slack.request_expired`가 나온다.
- 로그에는 id·ts·오류 코드·scope 이름만 나오고 토큰과 WebSocket URL은 나오지 않는다(토큰 패턴은 한 번 더 가린다).
- 웹 앱의 HTTP 경로와 실험 실행기를 같은 앱으로 동시에 켜지 않는다. 웹 앱은 `SLACK_SIGNING_SECRET`이 있을 때만 Slack 연결을 만들며, 저장소 루트·`app/`의 `.env.local`은 읽지 않는다.

### 7.3 HTTP 경로 (웹 앱, 공개 URL 필요)

Socket Mode를 끄고 Event Subscriptions의 Request URL을 `https://<공개 주소>/api/slack/events`로 지정한다(서명된 `url_verification`에 challenge로 응답). 웹 앱에 `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID`를 준다. 로컬이면 cloudflared/ngrok 등 터널이 필요하다.

## 8. 완료 기준별 상태

| 완료 기준 | 상태 | 근거 |
|---|---|---|
| 실제 Slack 초대/연결과 Space 대응 | **실제 검증** | 8.1: 실제 워크스페이스 테스트 채널에 bot 초대, `--check` 전 항목 통과, Socket Mode 연결, 채널 → Space(`slack-live`) 대응 |
| A 호출 → 맥락 확인 → 같은 스레드 답변 실제 왕복 | **실제 검증(답 회수는 catch-up 경유)** | 사람 멘션 → 스레드 읽기 → Space 목표·결정·작업을 근거로 한 LLM 답이 같은 `thread_ts`에 게시 → 사람 답이 `decision`으로 원장에 기록. 사람 답은 `message.channels` 미구독으로 실시간 이벤트가 오지 않아 catch-up으로 회수했다 |
| B Space 변화 → 선제 요청 → 담당자 응답 실제 왕복 | **부분 검증** | 개인 Agent 막힘(`task_blocked`) → PM이 채널에 선제 메시지 게시(`agent_blocker`, 작업 `research` 연결)까지 실제 확인. 담당자 답은 기록 시점까지 오지 않아 요청이 60분 뒤 `no_response`로 만료됨. 답 → 작업 연결은 fake 테스트로만 확인 |
| 원본 메시지/스레드·작성자·시각 보존, 결정/제안/미응답 구분 | **실제 일부 검증** | 실제 페이로드로 원문·`thread_ts`·작성자·시각이 원장에 남고, 사람 답이 `decision`, 미응답이 `no_response`로 구분됨. `proposal` 분류는 fake로만 확인 |
| 재수신·자기 메시지로 인한 중복 방지 | **실제 일부 검증** | catch-up 반복(1분 주기 수십 회)·실행기 재시작 3회 동안 같은 메시지 재기록·재답변 0건(`recovered: 0`). 실시간 `self`·`mention_via_app_mention` 무시와 Slack 재전송(`retry_num`)은 이벤트 미구독·재전송 미발생으로 실제 미관찰, fake로 확인 |
| 읽기/발송 실패·응답 부재 표시, 경로·수동 단계·한계 기록 | **응답 부재 실제 검증 + 이 문서** | `slack.request_expired` → `stopped`에 `no_response`. 실제 Slack 오류 코드(읽기·발송 실패)는 발생하지 않아 미검증. 웹 화면 표시는 없음 |

Socket Mode: fake 소켓 테스트로 envelope ack, `events_api` 전달, `disconnect` 교체, 종료 후 재연결, 잘못된 app 토큰 중단, 같은 event_id 재전송 시 답 한 번, 매핑 없는 사람의 대체 규칙을 확인했다. 실제 연결에서는 `hello` → `events_api` 수신 → ack까지 확인했고, Slack 쪽 `disconnect`·재연결은 관찰하지 못했다.

### 8.1 실제 실행 기록 (2026-10-08, 실제 워크스페이스의 테스트 채널 하나)

설정: Socket Mode 앱, bot scopes `app_mentions:read`, `chat:write`, `channels:history`, `channels:read`, `groups:history`, `groups:read`, `users:read`. Bot event는 `app_mention`만 구독되어 있었다(`message.channels` 없음). PM 런타임 `ENSEMBLE_PM_RUNTIME=claude`. `SLACK_USER_MAP`·`SLACK_OWNER_USER_ID` 없음(대체 규칙: 채널의 사람 = 결정권자). 사람 역할은 사용자의 Slack 세션으로 작성했다.

| 단계 | 결과 (실행기 로그) |
|---|---|
| `--check` | `check_auth`(빠진 scope 없음), `check_channel`(bot 멤버), `check_history`, `check_socket_mode` 모두 ok |
| A: 사람이 스레드에서 멘션 | `socket.acked` → `slack.event_received`(`app_mention`) → `slack.thread_read`(2) → 11초 뒤 `slack.reply_posted`(`kind: answer`, `composedBy: llm`, 같은 `thread_ts`). 답은 확정 결정("첫 버전은 이메일 가입만 지원한다"), 작업 상태(인터뷰 정리 시작 가능, 화면 시안 대기), 대기 중인 결정 요청 없음을 Space에서 인용했다 |
| A: 사람이 같은 스레드에 답 (멘션 없음) | 실시간 이벤트 없음(`message.channels` 미구독). 실행기 재시작 시 catch-up이 회수: `slack.reply_recorded`(`kind: decision`, `resolved: false` — PM 답이 질문이 아니라 걸린 요청이 없음) → `slack.catch_up`(`threads: 1`, `recovered: 1`), 다음 회차부터 `recovered: 0` |
| B: 개인 Agent 막힘 기록 | `--trigger-blocker` → `space_change_recorded`(`task_blocked`, `research`) → `slack.request_sent`(`agent_blocker`, `target: *`, `taskIds: [research]`) — 채널 루트에 PM이 먼저 게시 |
| B: 담당자 답 | 60분 안에 답 없음 → `slack.request_expired` → 종료 요약 `status: no_response`, `failures: []`, 원장 메시지 4건 |

이번 실행에서 확인한 문제와 처리:

- `message.channels` 미구독으로 스레드 답이 유실됨 → catch-up 추가(위 5절). 구독은 앱 관리 권한이 필요해 이번에 바꾸지 못했다.
- 선제 메시지에 막힘 사유가 이미 마침표로 끝나면 `..`가 됨 → 문장부호가 있으면 더 붙이지 않도록 수정.
- `SLACK_OWNER_USER_ID`가 없으면 선제 메시지가 "담당자님"으로만 시작하고 Slack 멘션이 없어 알림이 가지 않는다. 실제 운영 전 매핑이 필요하다.

남은 실측: `message.channels` 구독 후 실시간 스레드 답 수신과 `self` 무시, 흐름 B의 담당자 답 → `resolved: true`·작업 연결, 실제 Slack 오류 코드 처리.

로컬 확인: `next dev`에서 서명된 `url_verification` → 200(challenge), 잘못된 비밀·오래된 시각 → 401, 다른 채널 이벤트 → 200 후 `ignored: unbound_channel` 로그를 확인했다. 이때 실제 Slack API는 호출하지 않았다.

## 9. #81과의 관계

개인 Agent가 Space에 들어오는 공통 경로는 #81의 범위다. 이번에는 최소한만 두었다.

- 개인 Agent의 Slack bot을 `SLACK_USER_MAP`으로 Space의 Agent 멤버에 연결해 작성 주체를 `agent`로 구분한다.
- 흐름 B의 답은 원장(`externalFollowUps`)에 작업과 연결되어 남지만, 실행 중인 Agent 세션에 전달하는 경로(기존 답변 전달 등)는 연결하지 않았다. 개인 Agent가 이 후속 결정을 읽는 방법은 #81에서 정한다.

## 10. 한계

- 한 워크스페이스·한 채널·Space 하나. 웹 앱에서는 프로젝트를 새로 시작하면 같은 채널이 새 프로젝트를 가리키고, 실험 실행기는 웹 앱과 별도 원장을 쓴다.
- `SLACK_USER_MAP`이 없을 때의 대체 규칙(채널의 모든 사람 = 결정권자)은 테스트 전용이다. 권한 판단이나 실제 팀 운영에 쓰지 않는다.
- Socket Mode 연결은 실행기 프로세스가 켜져 있는 동안만 유지된다. 꺼진 동안의 이벤트 중 PM이 참여한 스레드의 답은 다음 시작 때 catch-up이 회수하지만, PM이 없는 스레드의 새 멘션은 받지 못한다.
- catch-up은 PM이 참여한 스레드 수만큼 1분마다 `conversations.replies`를 부른다. 스레드가 많아지면 rate limit에 걸릴 수 있으며, 오래된 스레드를 빼는 기준은 아직 없다.
- `message.channels` 구독으로 채널의 모든 메시지 이벤트가 서버에 도착한다. PM이 참여한 스레드 외에는 기록하지 않지만, 전송 자체는 Slack 설정의 범위다.
- 흐름 B는 Coordinator 생성(서버 시작) 이후의 변화만 보낸다. 서버가 꺼진 동안의 변화는 보내지 않는다.
- event_id 기억은 메모리 안에서만 유지된다(재시작 후에는 원장 키가 막는다).
- 분류와 확정 내용은 모델 판단이며, 모델이 실패하면 `unclassified`(요청에 대한 답이면 `answer`)로 남는다. fake PM 런타임에서는 답이 항상 고정 문장이다.
- 스레드는 최근 30개 메시지(루트 포함)만 읽는다. permalink는 가져오지 않는다. rate limit은 실패로 기록할 뿐 대기 후 재시도하지 않는다.
- 대량 자동 알림, 과거 기록 수집, DM, 운영 수준 설치·토큰 회전은 범위 밖이다.
