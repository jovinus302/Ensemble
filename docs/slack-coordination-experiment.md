# Slack ↔ Space 양방향 조율 실험 (#79)

기준: 2026-10-07, 브랜치 `jovinus302/issue-79-slack`. 기술 선택은 **EXPERIMENT**다. 이 문서는 구현한 경로와 수동 설치 단계, 검증 범위를 기록한다. **실제 Slack 워크스페이스와의 왕복은 아직 검증하지 않았다(미검증).** 작업 환경에 Slack 토큰·서명 비밀이 없어 fake Slack과 단위 테스트, 로컬 서명 검사까지만 실행했다. 이 문서를 "Slack 연동 완료"의 근거로 쓰지 않는다.

## 1. 선택한 경로와 이유

| 항목 | 선택 | 이유 |
|---|---|---|
| 참여 주체 | Ensemble Slack App의 bot user | 채널 초대(`/invite`)로 범위를 정하고, 작성 주체가 PM Agent임이 Slack에 드러난다 |
| 요청 수신 | Events API(HTTP) `app_mention` + `message.channels` | 멘션은 `app_mention`, 멘션 없는 스레드 답변은 `message.*`로만 온다. B의 담당자 답변과 A의 후속 답변을 받으려면 둘 다 필요하다 |
| 맥락 읽기 | `conversations.replies` | 질문이 달린 스레드만 읽는다. 채널 전체 기록을 모으지 않는다 |
| 답변·선제 연락 | `chat.postMessage` (`thread_ts`) | A는 같은 스레드, B는 지정 채널의 새 스레드(또는 설정한 스레드) |
| 답변 생성 | 기존 PM `LlmProvider`에 강제 tool(`slack_thread_reply`) | 웹 앱의 PM 런타임 선택(`ENSEMBLE_PM_RUNTIME`)을 그대로 쓴다. 모델 실패 시 Space 상태를 담은 고정 문장으로 답하고 원장에 `composedBy: template`로 표시한다 |
| 기록 | 원장의 `external_*` 이벤트 | 화면 상태가 아니라 이벤트 원장을 정본으로 둔다는 기존 규칙을 따른다 |

비교 후보: Socket Mode는 공개 URL 없이 로컬에서 받을 수 있어 수동 검증에 편하지만 app-level 토큰과 WebSocket 클라이언트가 필요해 이번에는 구현하지 않았다. 브라우저 참여 방식과 MCP는 시도하지 않았다(MCP는 필수 전제가 아니다).

## 2. 구현 위치

| 위치 | 하는 일 |
|---|---|
| [core/external.ts](../app/packages/core/src/external.ts) | 외부 대화 이벤트 4종과 투영(`externalConversation`), 응답 기한 지난 요청(`overdueExternalRequests`), 작업별 후속(`externalFollowUps`) |
| [channel/slack/](../app/packages/channel/src/slack/) | 서명 검증(v0 HMAC-SHA256, ±5분), 이벤트 요청 처리(`url_verification`, 재전송 헤더), 이벤트 분류(`routeSlackEvent`), event_id 중복 제거, Web API 실제 구현(`SlackWebApi`, fetch)과 테스트용 `FakeSlackApi`, 환경변수 읽기 |
| [orchestrator/slack-coordination.ts](../app/packages/orchestrator/src/slack-coordination.ts) | `SlackCoordinator`: Space 연결, 흐름 A·B, 실패·응답 부재 기록 |
| [web/app/api/slack/events/route.ts](../app/apps/web/app/api/slack/events/route.ts) | Events API 엔드포인트. 서명 확인 후 즉시 200으로 응답하고 처리는 `after()`로 응답 뒤에 한다(Slack 3초 제한) |
| [web/lib/runtime.ts](../app/apps/web/lib/runtime.ts) | `SLACK_*`가 있을 때만 `slack()` 구성. 원장 변경마다 흐름 B 확인, 5분 틱에서 응답 기한 확인 |
| [test/slack-coordination.test.ts](../app/test/slack-coordination.test.ts) | fake Slack 기반 테스트 |

Space 대응: 한 Slack 워크스페이스(`SLACK_TEAM_ID`)의 한 채널(`SLACK_CHANNEL_ID`)을 웹 앱의 **현재 프로젝트**에 연결한다. 다른 팀·채널 이벤트는 기록하지 않고 무시한다.

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

## 6. 실패와 응답 부재

- 스레드 읽기 실패: 실패를 기록하고 같은 스레드에 "스레드 맥락을 읽지 못해 아직 답하지 못했어요 (오류 코드)"라고 알린다. 알림 게시도 실패하면 두 실패가 모두 원장에 남는다.
- 답변 생성 실패: 고정 문장으로 답하고 `compose` 실패와 `composedBy: template`를 기록한다.
- 게시 실패: `send` 실패만 기록하고 PM 메시지는 기록하지 않는다. 흐름 B는 다음 확인 때 최대 3회까지 다시 보낸다. 담당자의 Slack 계정이 연결되지 않았으면 `recipient_not_mapped`를 한 번 기록하고 다시 시도하지 않는다.
- 응답 부재: `expireOverdue()`가 기한 지난 요청을 `no_response`로 기록한다(웹은 5분 틱).
- 표시 범위: Slack 스레드 알림(읽기 실패)과 원장 기록, `SlackCoordinator.status()`까지다. 웹 화면에 Slack 상태를 그리는 것은 이번 범위에 없다.

## 7. 실제 왕복을 위한 수동 단계 (미실행)

1. https://api.slack.com/apps 에서 테스트 워크스페이스에 앱을 만든다(이름 예: Ensemble).
2. **OAuth & Permissions → Bot Token Scopes**: `app_mentions:read`, `channels:history`(비공개 채널이면 `groups:history`), `chat:write`.
3. 공개 HTTPS 주소를 준비한다(로컬이면 cloudflared/ngrok 등 터널 → `http://localhost:3000`).
4. 웹 앱을 아래 환경변수로 실행한다(`app/.env` 또는 셸, `.env`는 git 제외 대상):
   - `SLACK_BOT_TOKEN`(Bot User OAuth Token, `xoxb-`), `SLACK_SIGNING_SECRET`(Basic Information), `SLACK_TEAM_ID`, `SLACK_CHANNEL_ID`
   - 선택: `SLACK_BOT_USER_ID`(없으면 `auth.test`로 조회), `SLACK_USER_MAP=U사람=owner,U디자이너=designer,B개인Agent=research-agent`, `SLACK_PROACTIVE_TRIGGERS=agent_result,agent_blocker[,decision_followup]`
5. **Event Subscriptions** 켜기 → Request URL `https://<주소>/api/slack/events`(서명된 `url_verification`에 challenge로 응답한다) → Subscribe to bot events: `app_mention`, `message.channels`(비공개면 `message.groups`).
6. 앱을 워크스페이스에 설치하고 테스트 채널에서 `/invite @Ensemble`.
7. 검증 A: 채널의 기존 스레드에서 `@Ensemble 이 결정 다음에 뭘 해야 해?` → 같은 스레드 답 확인 → 답변 작성 → 원장의 `external_*` 기록 확인.
8. 검증 B: 자유 진행 프로젝트에서 Agent 결과나 막힘이 생기게 한 뒤 → 지정 채널에 담당자 멘션 메시지 확인 → 그 스레드에 답 → `externalFollowUps`로 작업 연결 확인.
9. 재전송 확인: Slack 관리 화면의 이벤트 재시도 또는 같은 요청 재전송 시 답이 한 번인지, 자기 답변에 다시 답하지 않는지 확인한다.

## 8. 완료 기준별 상태

| 완료 기준 | 상태 | 근거 |
|---|---|---|
| 실제 Slack 초대/연결과 Space 대응 | **미검증** | 연결 설정(팀·채널 → 현재 프로젝트)과 엔드포인트만 구현. 실제 설치·초대 안 함 |
| A 호출 → 맥락 확인 → 같은 스레드 답변 실제 왕복 | **구현만, 실제 미검증** | fake Slack 테스트로 스레드 읽기·Space 맥락 전달·같은 `thread_ts` 답변·답변 기록 확인 |
| B Space 변화 → 선제 요청 → 담당자 응답 실제 왕복 | **구현만, 실제 미검증** | fake Slack 테스트로 막힘 → 선제 게시 → 담당자 답 → 작업 연결 확인 |
| 원본 메시지/스레드·작성자·시각 보존, 결정/제안/미응답 구분 | **테스트로 확인(fake)** | 실제 Slack 페이로드 형식과의 일치는 미검증 |
| 재수신·자기 메시지로 인한 중복 방지 | **테스트로 확인(fake)** | event_id, 재시작 후 원장 키, 이중 이벤트, 자기/bot 메시지 |
| 읽기/발송 실패·응답 부재 표시, 경로·수동 단계·한계 기록 | **테스트로 확인(fake) + 이 문서** | 실제 Slack 오류 코드 발생은 미검증. 웹 화면 표시는 없음 |

로컬 확인: `next dev`에서 서명된 `url_verification` → 200(challenge), 잘못된 비밀·오래된 시각 → 401, 다른 채널 이벤트 → 200 후 `ignored: unbound_channel` 로그를 확인했다. 이때 실제 Slack API는 호출하지 않았다.

## 9. #81과의 관계

개인 Agent가 Space에 들어오는 공통 경로는 #81의 범위다. 이번에는 최소한만 두었다.

- 개인 Agent의 Slack bot을 `SLACK_USER_MAP`으로 Space의 Agent 멤버에 연결해 작성 주체를 `agent`로 구분한다.
- 흐름 B의 답은 원장(`externalFollowUps`)에 작업과 연결되어 남지만, 실행 중인 Agent 세션에 전달하는 경로(기존 답변 전달 등)는 연결하지 않았다. 개인 Agent가 이 후속 결정을 읽는 방법은 #81에서 정한다.

## 10. 한계

- 한 워크스페이스·한 채널·현재 프로젝트 하나. 프로젝트를 새로 시작하면 같은 채널이 새 프로젝트를 가리킨다.
- `message.channels` 구독으로 채널의 모든 메시지 이벤트가 서버에 도착한다. PM이 참여한 스레드 외에는 기록하지 않지만, 전송 자체는 Slack 설정의 범위다.
- 흐름 B는 Coordinator 생성(서버 시작) 이후의 변화만 보낸다. 서버가 꺼진 동안의 변화는 보내지 않는다.
- event_id 기억은 메모리 안에서만 유지된다(재시작 후에는 원장 키가 막는다).
- 분류와 확정 내용은 모델 판단이며, 모델이 실패하면 `unclassified`(요청에 대한 답이면 `answer`)로 남는다. fake PM 런타임에서는 답이 항상 고정 문장이다.
- 스레드는 최근 30개 메시지(루트 포함)만 읽는다. permalink는 가져오지 않는다. rate limit은 실패로 기록할 뿐 대기 후 재시도하지 않는다.
- 대량 자동 알림, 과거 기록 수집, DM, 운영 수준 설치·토큰 회전은 범위 밖이다.
