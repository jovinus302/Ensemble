# 기능 모판 G1~G16

> 도그푸딩의 기준이 되는 기능 갭 목록이다. 원 계획(2026-10-19)의 G1~G12를 jovinus302/Ensemble origin/main `f71e33e` 기준으로 다시 대조했고, 신규 G13~G16을 더했다. 근거는 모두 저장소 경로다.

## 0. 읽는 법

- 원 ID(G1~G12)는 그대로 둔다. 신규는 G13~G16이다.
- 도그푸딩에서 생기는 새 갭은 G17부터 쓴다. 번호는 재사용하지 않는다.
- 상태 라벨은 `있음`, `부분`, `없음`, `해소` 넷이다.
- 우선순위는 초안이다. Iter 1 리포트를 보고 사용자가 확정한다.
- 근거 경로는 워크트리 루트 기준이다. 줄 번호는 `f71e33e` 시점이다.

## 1. 모판 표

| ID | 영역 | 구현 항목 | 상태 | 지금 있는 것 | 근거 | 원 문서 기준 | 우선순위(원안→초안) | 바꾼 이유 |
|---|---|---|---|---|---|---|---|---|
| G1 | 정보 공유 | 외부 세션 작업 보고: 로컬 Claude Code·Codex 세션에서 한 작업의 요약·브랜치·파일을 보드(작업 진행·결과)에 연결한다 | 부분 | #81 Space 참여가 있다. 확인 코드로 연결한 개인 Agent가 토큰으로 맥락을 읽고, result·question·blocked·note 글을 taskId와 함께 올린다. PM은 폴더를 관찰하고 .ensemble/inbox로 후속 요청을 보낸다. 하지만 글은 space_post_recorded로만 남아 작업 상태나 result_submitted에 이어지지 않는다. 브랜치와 파일도 자유 텍스트다. | `app/packages/core/src/participation.ts:36-60`<br>`app/packages/orchestrator/src/space-participation.ts:244-271`<br>`app/packages/orchestrator/src/space-participation.ts:360-401`<br>`app/apps/web/app/api/[...path]/route.ts:36-72` | Ensemble이 직접 실행한 작업만 Artifact에 보임 | P0 → P0 | 상태를 '없음'에서 '부분'으로 바꾼다. 범위는 'Space result 글을 담당 작업의 진행·결과로 연결하고 브랜치·파일 필드를 구조화하는 것과 보고 스킬'로 좁힌다. G4에 남아 있던 'HTTP 첨부의 taskId 보존'도 여기로 흡수한다. |
| G2 | 정보 공유 | 구현 이력 검색: '이거 누가 만들었나'를 산출물·기록에서 찾는다 | 없음 | 원장에 result_submitted 요약, 첨부, 작업 활동 기록이 남는다. 검색 API는 없다. Hindsight 기억(memory 패키지)은 origin/main에 없다. | `app/packages/core/src/work.ts:125`<br>`app/apps/web/lib/runtime.ts:649-659` | Artifact 목록, Hindsight 기억 | P1 → P1 | 원 문서는 Hindsight 기억이 있다고 봤지만 jovinus302 main에는 없다. G3에 남아 있던 '판단 근거 검색'을 흡수한다. |
| G3 | 정보 공유 | 대화 이력·PM 판단 근거를 DB에 저장한다 | 해소 | 해소됐다. message_recorded, pm_considered, pm_spoke, decision_recorded, handoff_reviewed가 SQLite 원장에 추가형으로 저장되고, 재시작 뒤 project()로 복원된다. | `app/packages/store/src/sqlite.ts:1-22`<br>`app/packages/core/src/events.ts:94-104`<br>`app/apps/web/lib/runtime.ts:143` | 서버 메모리에만 있어 재시작하면 사라짐 | P1 → P2(해소) | P1에서 '해소'로 바꾼다. 우선순위 칸에는 P2(해소)로 적는다. 검색은 G2로 옮긴다. |
| G4 | Task 분할·배정 | 사람 담당자 배정: 사람 몫 작업을 실행 대기열에서 빼고, 결과 제출을 작업에 정확히 연결한다 | 부분 | 사람 멤버를 담당자로 배정할 수 있고 사람 작업은 대기열에서 빠진다. 하지만 HTTP 메시지 경로는 첨부의 taskId를 버린다. 그래서 첫 결과 제출이 어디로 가는지는 둘 중 하나로 정해진다. (a) 재제출할 수 있는 작업(보완·멈춤 상태)이 정확히 1개이고 미해결 질문이 없으면, 모델을 거치지 않고 그 작업으로 고정 라우팅된다. 결정권자에게는 보완 중인 Agent 작업의 recheck도 이 대상에 들어가므로, 다른 작업의 첫 결과가 엉뚱한 작업의 재검토로 갈 수 있다. (b) 그 밖의 경우는 route_message 모델 분류에 달려 있고, 본인 담당이면 다른 작업으로 분류될 수도 있다. | `app/packages/core/src/routing.ts:51-68`<br>`app/packages/orchestrator/src/dispatch.ts:265-274`<br>`app/apps/web/app/api/[...path]/route.ts:10-19`<br>`app/packages/orchestrator/src/pm.ts:351-371`<br>`app/packages/orchestrator/src/pm.ts:383` | assignee가 deva·uxa뿐 | P0 → P1 | 핵심(배정, 대기열 제외)이 이미 있어 P0에서 P1로 내린다. 남은 범위는 '결과를 작업에 명시적으로 연결하는 것'이고, 구현은 G1이 흡수한다. 도그푸딩에서는 R3(대체 제출)과 R15(오라우팅) 건수로 다시 판정한다. |
| G5 | Task 분할·배정 | 착수 때 목표를 받아 에픽 전체를 한 번에 분해한다 | 부분 | 첫 계획은 4역할 템플릿만 채운다(작업당 하위 작업 3개, 깊이 2). 그 뒤로는 사람 메시지 단위로 create_task를 받는다. | `app/packages/orchestrator/src/planning.ts:24`<br>`app/packages/orchestrator/src/planning.ts:37-47`<br>`app/packages/core/src/plan-ops.ts:35` | 요청 단위 PM 턴, Slack 회의 정리 | P1 → P1 | 우선순위는 그대로 두고 'Iter 1 결과에 따라 P0로 올릴 1순위 후보'로 표시한다. |
| G6 | Task 분할·배정 | Agent 역할 확장(BE·FE·QA·Reviewer) | 부분 | research-agent와 prototype-agent 두 역할뿐이다. | `app/packages/agents/src/roles.ts:19-52`<br>`app/packages/core/src/routing.ts:24-27` | PROFILES에 pm·deva·uxa 고정 | P2 → P2 | 원 문서의 pm·deva·uxa를 research·prototype으로 바꿔 적는다. |
| G7 | 일정·진행 관리 | 실행 완료·승인 때 PM 후속 판단이 계획 밖 다음 작업을 제안한다(07→02) | 부분 | ready 작업은 결과가 나올 때 자동으로 예약된다. 정체 점검, liaison 후속 요청도 있다. 하지만 계획 밖 새 작업은 사람 메시지가 근거여야만 생긴다. | `app/packages/orchestrator/src/dispatch.ts:175-189`<br>`app/packages/orchestrator/src/coordination.ts:64-68`<br>`app/packages/orchestrator/src/sweep.ts:115-150` | 사람이 요청해야 PM 턴이 돎 | P0 → P0 | 상태를 '부분'으로 바꾸고 P0는 유지한다. 범위는 'checked되거나 계획이 소진될 때 plan_change 결정 요청(추천안 포함)으로 다음 작업을 제안하는 것'이다. 판정 지표는 결정 요청의 근거(sourceMessageIds)까지 따라가 센 beyondPlanByPm이다. |
| G8 | 일정·진행 관리 | 머지 상태 추적: 확정된 결과가 대상 레포 main에 들어갔는지 추적한다 | 없음 | 레포·브랜치 개념이 없다. Agent 결과는 격리 폴더의 파일을 첨부로 고정한 것뿐이다. | `app/packages/orchestrator/src/session-runner.ts:318-360`<br>`app/packages/agents/src/claude/connector.ts:93-104` | 승인(done)까지만 | P1 → P1 | 범위를 '결과물과 개인 Agent 브랜치가 대상 레포에 반영됐는지 추적'으로 넓힌다. 도그푸딩에서는 board_only(R9)로 잰다. |
| G9 | 일정·진행 관리 | 기한·마일스톤 | 부분 | 목표 기한, 주간 가용 시간, 작업 추정치, 예상 완료(forecast), 하루 요약이 있다. 마일스톤은 없다. | `app/packages/core/src/events.ts:67`<br>`app/packages/core/src/forecast.ts`<br>`app/packages/core/src/authority.ts:9` | 4열 상태, 트리 진행률 | P2 → P2 | 원 문서의 '4열 상태'보다 많이 갖췄다(부분). |
| G10 | 공동개발 조율 | 중복 감지: 새 작업이나 외부 작업이 기존 작업·산출물과 겹치면 경고한다 | 없음 | 없다. 같은 작업 id, clientPostId, 멱등 키의 기계적 중복만 막는다. | `app/packages/store/src/sqlite.ts:128-131`<br>`app/packages/orchestrator/src/space-participation.ts:249-255` | 없음 | P0 → P0 | 상태와 우선순위는 그대로다. 비교할 재료(Space 글, 폴더 관찰, 결과 요약, 작업 브리프)가 원장에 있다는 점을 적는다. |
| G11 | 공동개발 조율 | 같은 파일을 건드리는 진행 중 작업 사이의 충돌을 미리 경고한다 | 없음 | 없다. Agent 폴더는 격리돼 있고, 개인 폴더 관찰은 경로와 해시만 남긴다. | `app/packages/core/src/participation.ts:59-68`<br>`app/packages/agents/src/claude/connector.ts:93-104` | 선행 브랜치 병합, 실행별 worktree 격리 | P1 → P1 | 재료가 워크트리 병합이 아니라 폴더 격리와 관찰 메타데이터다. 도그푸딩에서는 하네스 머지 충돌로 관찰한다. |
| G12 | 채널 연계 | Slack에서 요청·진행 보고·승인 알림 | 부분 | #79 실험이 있다. Flow A는 검증됐고, Flow B는 선제 메시지까지만 확인됐다. | `app/packages/orchestrator/src/slack-coordination.ts`<br>`app/apps/web/lib/runtime.ts:157-185`<br>`docs/slack-coordination-experiment.md` | Slack 회의 정리만 | P1 → P1 | 상태를 '부분(실험)'으로 바꾼다. Iter 1·2에서는 SLACK_* 환경 변수를 지워 제외하고, Iter 3에서 다룬다. |
| G13 | Task 분할·배정 | (신규) 팀 구성 변경과 재배정: 사람·Agent 멤버를 추가하고, 역할을 지정하고, 결정 요청에서 담당자를 바꾼다 | 없음 | 없다. seed가 멤버를 고정하고, 멤버를 추가하는 라우트가 없다. 결정 요청의 editable은 title·priority뿐이라 assignee를 바꿀 수 없다. routeTask는 맞는 사람이 없으면 결정권자에게 넘긴다. | `app/apps/web/lib/runtime.ts:272-277`<br>`app/packages/orchestrator/src/coordination.ts:685`<br>`app/packages/core/src/decision-requests.ts:215-223`<br>`app/packages/core/src/routing.ts:54` | (원 문서에 없음) | — → P1 | 신규. 가상 팀원을 designer 멤버로 재사용해야 하는 제약과, owner에게 코드 작업이 배정되는 문제(R14)에서 나왔다. |
| G14 | 공동개발 조율 | (신규) 실행 기반: 실행 Agent가 대상 레포에서 작업하고 checked에 테스트 근거를 연결한다. Windows CLI 실행 기반(spawn·argv 한도)을 갖춘다 | 없음 | 없다. Agent는 저장소 밖 빈 폴더에서 WebSearch/WebFetch와 편집만 한다. TrustedValidator가 주입되지 않아 검증 상태는 not_run이다. Windows에서 셸 없는 spawn('claude')는 ENOENT가 난다(이 PC에서 확인). PM CLI는 시스템 프롬프트(7,008자)와 해석 스키마를 argv로 넘기는데, 스키마는 사람 메시지 1건당 약 546자씩 커져 약 25건부터 32,767자를 넘는다(ENAMETOOLONG). | `app/packages/agents/src/claude/connector.ts:42-43`<br>`app/packages/agents/src/claude/connector.ts:141-159`<br>`app/packages/llm/src/claude-cli.ts:46-54`<br>`app/packages/llm/src/cli.ts:42`<br>`app/packages/orchestrator/src/coordination.ts:64-91`<br>`app/packages/orchestrator/src/validation.ts:17-25` | (원 문서에 없음) | — → P1 | 신규. Iter 2 제품 수정 후보로 둔다: ClaudeCliProvider가 --system-prompt-file이나 stdin으로 넘기고 스키마를 $ref로 쓰게 하는 것, 그리고 Windows spawn을 해석하는 것. 도그푸딩에서는 R5·R10·R13 건수로 우선순위를 확정한다. |
| G15 | 일정·진행 관리 | (신규) 실행 사용량(토큰) 기록 | 없음 | 없다. Claude 커넥터는 usage를 버린다. ClaudeCliProvider는 캐시를 입력 토큰에 합산해 돌려주지만 원장에 남기지 않는다. | `app/packages/agents/src/claude/connector.ts:186-189`<br>`app/packages/llm/src/claude-cli.ts:72-79` | (원 문서에 없음) | — → P2 | 신규. Iter 1에서는 하네스가 대신 측정한다. |
| G16 | 일정·진행 관리 | (신규) 자동 행동 상한 뒤 재개 경로 | 부분 | 상한 12에 닿으면 다음 시작이 보류되고 작업은 ready로 남는다. automation_resumed를 쓰는 코드가 없다. 상한은 사람의 승인 이벤트, 결정 응답, 결정권자 메시지가 반영한 decision_recorded로만 풀린다. | `app/packages/core/src/action-limit.ts:4-17`<br>`app/packages/core/src/projection.ts:84-97`<br>`app/packages/orchestrator/src/coordination.ts:838-848` | (원 문서에 없음) | — → P1 | 신규. 도그푸딩에서는 R6, withheldReadyAtLimit, 정체 종료로 측정한다. |

## 2. 원안 P0 (원문 보존)

아래 표는 계획 문서의 'P0 구현 항목' 표 4행이다. 원문 그대로 옮겼고 고치지 않았다.

| ID | 왜 먼저인가 | 구현 방향 |
|---|---|---|
| G1 외부 세션 작업 보고 | 지금은 Ensemble이 직접 실행한 작업만 보인다. 회의에서 말한 "로컬·개별 세션 작업을 모른다"를 그대로 남긴다 | ensemble-task 스킬에 작업 보고를 더해 요약·브랜치·바뀐 파일을 보드와 Artifact에 남긴다 |
| G4 사람 담당자 배정 | 공동개발에는 사람 몫이 있다. 지금은 사람 몫을 보드에 표현할 방법이 없다 | assignee에 사람을 허용하고, 사람 담당은 실행 대기열에서 뺀다. G1 보고로 진행을 갱신한다 |
| G7 실행 완료 후 PM 후속 턴 | Workflow의 마지막 단계(다음 결정)가 비어 있다. PM Agent가 조율한다고 말하려면 이 고리가 닫혀야 한다 | 실행 완료나 승인 때 PM 턴을 돌려 후속 태스크를 제안하고, 사람이 수락하면 등록한다 |
| G10 중복 감지 | 회의에서 말한 중복 개발과 토큰 낭비를 직접 줄인다 | 새 태스크나 G1 보고가 들어오면 기존 태스크·산출물·기억과 비교해 경고한다 |

## 3. P0 초안

jovinus302 기준 P0 초안은 G1·G10·G7이다. G4는 핵심이 이미 있어 P1로 내렸고 남은 부분은 G1이 흡수한다. 구현 순서는 G1 → G10 → G7이다.

## 4. P0 구현 방향 (Iter 2 계획, 지금 구현하지 않음)

이 절은 Iter 2 계획이며 지금 구현하지 않는다. Iter 1에서는 기능을 더하지 않는다. 그래야 Iter 2에서 P0를 넣은 효과를 Iter 1 기준선과 비교할 수 있다.

| ID | 왜 먼저인가 | 구현 방향 | 건드릴 파일(예상) | 완료 판정 |
|---|---|---|---|---|
| G1 | 로컬 세션의 작업이 보드의 진행·결과에 이어지지 않는다. 글은 `space_post_recorded`로만 남는다 | Space 글에 branch·commit·changedFiles 필드를 둔다. taskId가 붙은 result 글을 결과 후보로 잇는다. HTTP 첨부의 taskId를 보존한다. 보고 스킬을 둔다 | `app/packages/core/src/participation.ts`, `app/packages/orchestrator/src/space-participation.ts`, `app/apps/web/app/api/[...path]/route.ts` | R2·R3·R15 감소, 프로브 정답률 상승 |
| G10 | 중복 개발과 토큰 낭비를 직접 줄인다. 지금은 기계적 중복(같은 id·키)만 막는다 | create_task 초안과 Space result 글을 기존 작업·결과·글과 비교해 겹치면 경고한다 | `app/packages/orchestrator/src/coordination.ts`, `app/packages/orchestrator/src/space-participation.ts`, 새 `app/packages/core/src/dedupe.ts` | planted realized와 confirmed 감소 |
| G7 | 계획 밖 다음 작업은 사람 메시지가 있어야만 생긴다. PM의 마지막 단계(다음 결정)가 비어 있다 | checked되거나 계획이 소진되면 plan_change 결정 요청(근거 메시지 없음)으로 제안한다 | `app/packages/orchestrator/src/dispatch.ts`, `app/packages/orchestrator/src/decision-flow.ts`, 새 `app/packages/orchestrator/src/follow-up.ts` | beyondPlanByPm > 0, initiate 감소 |

부가 후보는 G14다. ClaudeCliProvider가 `--system-prompt`와 `--json-schema`를 argv로 넘기지 않게 하는 것, 그리고 Windows spawn 해석이다.

## 5. 우선순위 변경 근거

- **G3 해소.** 대화와 PM 판단 근거가 SQLite 원장에 추가형으로 저장되고 재시작 뒤 `project()`로 복원된다. 원 문서의 '서버 메모리에만 있음'은 더 이상 맞지 않는다. 남은 검색 요구는 G2로 옮겼다.
- **G4 P0→P1.** 사람 담당자 배정과 대기열 제외가 이미 있다. 남은 부분은 결과 제출을 작업에 명시적으로 연결하는 것이고, G1이 흡수한다. 도그푸딩에서는 R3(대체 제출)과 R15(오라우팅) 건수로 다시 판정한다.
- **G5 승격 후보.** 첫 계획이 4역할 템플릿뿐이라 소프트웨어 프로젝트의 에픽 분해가 약하다. Iter 1에서 R5·R11·R17이 많이 나오면 P0로 올릴 1순위 후보다.
- **G13 신규.** 멤버 추가 라우트가 없고 결정 요청에서 담당자를 바꿀 수 없다. 가상 팀원을 designer 멤버로 재사용해야 하고, owner에게 코드 작업이 배정되는 문제(R14)가 나왔다.
- **G14 신규.** Agent는 저장소 밖 빈 폴더에서만 일하고 TrustedValidator가 주입되지 않아 검증 상태가 `not_run`이다. Windows에서 셸 없는 `spawn('claude')`는 ENOENT가 난다(이 PC에서 재현). PM CLI는 시스템 프롬프트와 해석 스키마를 argv로 넘기는데, 스키마가 사람 메시지에 비례해 커진다. 실측은 사람 메시지 10건 15,228자, 30건 26,148자, 50건 37,068자다. 시스템 프롬프트 7,008자를 더하면 약 25건부터 Windows 한도(32,767자)를 넘는다(ENAMETOOLONG).
- **G15 신규.** Claude 커넥터가 usage를 버리고, ClaudeCliProvider는 캐시를 입력 토큰에 합산해 돌려줄 뿐 원장에 남기지 않는다. 토큰 낭비를 줄인다는 목표를 재려면 기록이 필요하다. Iter 1에서는 하네스가 대신 측정한다.
- **G16 신규.** 자동 행동 상한 12에 닿으면 시작이 보류되고, 풀리는 경로는 사람의 승인·결정 응답·결정권자 메시지뿐이다. `automation_resumed`를 쓰는 코드는 없다. R6와 withheldReadyAtLimit, 정체 종료 건수로 측정한다.

## 6. 마찰→모판 규칙 표

하네스가 마찰을 기록할 때 쓰는 규칙이다. 심각도 high는 3점, medium은 2점, low는 1점이다. 잡음은 점수에서 뺀다.

| 규칙 | 조건 | 카테고리 | 기본 갭 | 심각도 | 잡음 |
|---|---|---|---|---|---|
| R1 | 결정 대리 next_step_request(ok) | intervention | G7 | medium | |
| R2 | teammate-b의 result 글에, 보드 작업 제목에 없는 B-id가 있음 | status_lookup | G1 | high | |
| R3 | 사람 결과 대체 제출(via fallback) | tooling | G4 | high | |
| R4 | 하네스의 팀원 브랜치 main 머지 | integration | G8 | low | |
| R5 | task_blocked: 사유가 `/제한 시간\|세션 오류\|시작하지 못\|ENOENT\|결과를 받지 못\|작업이 중단/`이면 G14, `/보완/`이면 G5, 그 밖에는 UNMAPPED. infra로 분류된 사유는 R16으로 보낸다 | blocked | G14 / G5 / UNMAPPED | medium | |
| R6 | action_limit_reached | intervention | G16 | high | |
| R7 | 대리 행동 실패 또는 폴백 | tooling | UNMAPPED | low | 잡음 |
| R8 | 팀원이 게시했다고 보고했지만 기록이 없음 | tooling | G1 | medium | |
| R9 | Agent 담당의 B-id 작업이 checked인데 사이클 끝까지 verified가 아님(board_only) | integration | G8 | medium | |
| R10 | 통합 테스트 실패 | integration | G14 | high | |
| R11 | 대상이 software인데 v1이 4역할 템플릿(1회) | handoff | G5 | medium | |
| R12 | 프로브 오답: perQuestion의 id별 correct=false를 questions의 id별 kind와 join해 mate 질문이면 G1, task 질문이면 G2. failed 프로브는 건너뛴다 | status_lookup | G1 / G2 | medium | |
| R13 | PM argv 초과(어댑터 overflow) 또는 판단 실패: judgement_failed 이벤트, 사유가 pm.ts의 JUDGE_FAILURE_REASON 문구인 pm_considered. 같은 triggerId는 1건으로 센다. 코드의 판단 실패 사유 목록을 바꾸면 이 조건도 함께 고친다 | tooling | G14 | high | |
| R14 | owner에게 배정된 B-id 작업 | handoff | G13 | medium | |
| R15 | 사람 결과 오라우팅(via misrouted) | tooling | G4 | high | |
| R16 | 인프라 실패(dogfood_infra_pause) 또는 인프라 사유의 task_blocked | tooling | UNMAPPED | low | 잡음 |
| R17 | 계획 초안 실패: 사유가 `/CLI\|ENOENT\|ENAMETOOLONG\|시간/i`이면 G14, 아니면 G5 | tooling | G14 / G5 | high | |

카테고리는 duplicate, status_lookup, intervention, blocked, handoff, integration, tooling, other 여덟 가지다. 맞는 갭이 없으면 NEW로 올리고 G17부터 번호를 붙인다.

## 7. 확정 절차

- 점수는 Σ 가중치다. high 3, medium 2, low 1이고 잡음은 뺀다.
- 리포트가 점수 상위 4개를 원 P0(G1·G4·G7·G10)와 비교한다.
- 사용자가 확정한 뒤 §1을 날짜와 함께 갱신한다.
