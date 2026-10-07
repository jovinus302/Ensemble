# 작업 항목·결정 요청 모델 — 현재 구현

<a id="현행-동작-보충--2026-10-02"></a>

## 현행 동작 보충 — 2026-10-05

이 절은 `main@605521b` 코드로 확인한 현재 안내다. 적용 대상은 서버·원장을 사용하는 앱 `/`다. `/demo`는 [별도 클라이언트 시연](../app/demo/README.md)이므로 화면의 상태를 이 원장 모델의 실행 결과로 읽지 않는다. 아래의 이슈 #26 중심 설명은 당시 작업 모델 기록으로 보존하며, 이후 변경과 충돌하면 이 절을 우선한다. 실행 설정은 [아키텍처 현행 안내](mvp-architecture.md#현행-구현--2026-10-02), 시작 방법은 [README](../README.md)를 참고한다.

이 문서는 앱이 관리하는 프로젝트·worker의 구현 계약이다. 최신 [제품 의도](../intent.md)의 개인 Agent 자율 작업·명시적 공유·채널 간 연속성 전체를 구현한 모델은 아니다. 아래 Agent 배정·자동 시작 규칙을 개인 Agent에 대한 PM Agent의 소유권으로 해석하지 않는다. 기존 작업 환경에 붙는 PM Agent와 프로젝트 맥락 보조 뷰가 최신 제품 방향이다. 이 내부 모델이 실제 도구 연동을 구현한 것은 아니며 차이는 [MVP 범위](mvp-scope.md)에 정리한다.

### 제출, 검증, 최종 판정

작업의 `checked`는 인계 판정 상태다. 모든 `checked`가 빌드·브라우저 테스트를 실행했다는 뜻은 아니다. PR #52의 호스트 주입형 `TrustedValidator`는 작업자가 제출한 파일의 전체 내용, 원래 상대 경로와 자기보고 한계를 받는다. 작업자에게 검증기 실행 권한을 주거나 작업자 보고를 측정 증거로 승격하지 않는다.

- 호스트 검증을 설정하면 제출 → `validation_started` → `validation_finished` → 최종 judge 순서로 진행한다. `failed`는 측정된 구현 실패로서 수정 요청을 만들고, `environment_blocked`·`not_run`은 구현 결함으로 취급하지 않는다.
- `requireValidation: true`에서는 현재 제출에 연결된 `passed` 증거가 있어야 judge 및 수동 수락 경로를 통과할 수 있다. 환경 문제나 미실행은 제출 상태에서 대기한다. 검증 통과만으로 `checked`가 되지는 않는다.
- 일반 웹 앱은 현재 검증기를 주입하지 않으며 UI·환경변수 opt-in도 제공하지 않는다. `trustedValidator`와 `requireValidation`은 `ProjectManager`를 구성하는 호스트 코드의 옵션이다. 기본 소스 검토는 유지하고 검증은 `not_run`으로 표시한다. 실행 검증이 필요한 호스트는 별도로 검증기를 제공해야 한다.
- 증거는 프로젝트·작업·결과 ID, 계획/작업 버전, 제출물 digest, 문맥 digest와 정책 fingerprint에 연결된다. 비동기 검증과 judge 뒤에도 현재성을 확인한다. 취소·만료·중복 재시도와 늦은 결과를 구분하며, `cancelValidation`·`retryValidation`은 호스트 API다.
- 작업자의 `limitations`는 원장과 judge 입력에 자기보고로 전달된다. 제출 뒤 같은 첨부 ID로 추가한 파일은 이미 제출된 내용의 대체본이 되지 않는다.

근거: [이벤트](../app/packages/core/src/events.ts), [검증기](../app/packages/orchestrator/src/validation.ts), [dispatch](../app/packages/orchestrator/src/dispatch.ts), [파일 수집](../app/packages/orchestrator/src/session-runner.ts), [PM](../app/packages/orchestrator/src/pm.ts).

### 같은 계획 버전의 변경과 감사 범위

확인된 결과를 사람이 다시 열면 `revision_requested`와 `update_sent`로 요구사항을 전달할 수 있다. 이 경로는 반드시 계획 버전을 올리는 것은 아니다. `reopenRequests()`가 요청을 최종 인계 조건에 더한다. 따라서 “모든 요구사항 변경은 계획 vN+1”이라는 설명은 이 경로에 적용되지 않는다.

현재 `contextDigest`는 목표·계획·결정과 관련 이벤트 순서를 해시하며, 재개 요청이나 모든 메시지·업데이트를 포괄하는 최신 요구사항 해시는 아니다. 같은 digest만으로 증거 재사용을 판단하면 안 된다. 결과 ID, 제출물 digest, 검증 시도와 실제 조건도 확인해야 한다. 이 한계는 현재 구현의 감사 범위이며, 현재성 판단에는 인계 조건과 새 제출의 검증 증거를 함께 확인한다.

### 대화 선점과 하루 요약

PR #49의 선점은 같은 작성자가 채널에 연속으로 보낸, 첨부와 작업 스레드가 없는 메시지의 PM 조정 판단에 한정된다. 새 입력을 원장에 먼저 기록한 뒤 이전 판단을 중단하고, 원래 메시지는 보존한다. 카드 응답·첨부·작업 댓글을 취소하거나 실행 중인 모든 worker를 중단하는 기능은 아니다. 근거: [Coordinator](../app/packages/orchestrator/src/coordination.ts).

하루 요약은 이미 구현되어 있다. 자유 진행 프로젝트의 서버가 실행 중일 때 5분 주기로 점검하고, 서울 시간 09:00 이후 하루 한 번을 기준으로 변경이 있는 사람의 완료·새 작업·결정 요청을 코드 템플릿으로 요약한다. `ENSEMBLE_DIGEST=off`로 끌 수 있다. 외부 예약 서비스나 추가 LLM 호출은 사용하지 않는다. 근거: [digest](../app/packages/orchestrator/src/digest.ts), [실행 타이머](../app/apps/web/lib/runtime.ts).

---

> 이슈 #26 설계안을 main에 병합된 코드 기준으로 다시 쓴 확정본이다(2026-10-02). 설계안과 코드가 다른 곳은 **코드를 적고** "설계와 다름"으로 표시했다.
> 결정의 이유는 `docs/pm-agent-decisions.md` §5, 모듈 위치는 `docs/mvp-architecture.md` §3.1에 있다. 경로는 모두 `app/` 기준이다.

## 0. 요약

PM Agent가 작업 만들기·쪼개기·배정·상태 갱신·후속 확인을 통해 사람과 Agent 사이의 일을 잇는다. JIRA 연동이 아니고, 사용자에게 `ENS-12` 같은 키를 보이지 않으며, 칸반을 주 화면으로 두지 않는다.

- 작업 항목은 새 엔티티가 아니라 기존 `Task`(`TaskSpec`)다. 계층은 `TaskSpec.parentId`, 실행 명세가 아닌 정보(우선순위·라우팅 사유·출처·맥락)는 `task_meta_set` 이벤트에 둔다.
- 사람을 부르는 새 경로는 모두 결정 요청(`decision_requested` → `decision_resolved`) 하나다. 요청에는 항상 추천안·선택지·근거가 있다.
- 현재 라우팅은 가능한 Agent에게 우선 배정한다. 사람에게는 판단·접근 권한·Agent 역량 부족 등의 사유로 실제 작업을 맡길 수 있고 필요한 확인·정보를 요청한다. 이는 구현 규칙이며 사람의 역할을 승인에 한정하는 제품 결정은 아니다.
- PM Agent가 대화에서 맥락(이유·원 대화·확정 결정·자료·제약)을 수확해 작업에 붙이고, Agent 시작 입력에 실어 보낸다. 사람은 작업 양식을 쓰지 않는다.

## 1. 데이터 모델

### 1.1 계층

```
Goal (goal_set, 프로젝트당 1개)
 └─ Task (parentId 없음)            ← 작업
     └─ Task (parentId = 위 작업)   ← 하위 작업 (깊이 최대 MAX_TASK_DEPTH = 2)
```

- `TaskSpec.parentId?`(`core/src/events.ts`)는 선택 필드라 기존 원장과 호환된다. 계층은 구조이므로 계획(`plan_committed`)에 속한다.
- **부모 작업** = 취소되지 않은 자식이 1개 이상인 작업(`isParentTask`, `core/src/work.ts`).
  - 실행하지 않는다. `startOrder`/`planStarts`(`core/src/transitions.ts`)가 건너뛰고, 예측에서도 빠진다.
  - 상태는 `rollupParents`가 매 이벤트 끝에 자식에서 계산한다. 살아 있는 자식이 모두 `checked`면 `checked`, 아니면 `waiting`(`blocked`는 지운다). 그래서 부모는 `reserved/running/submitted`가 되지 않고, 부모에 `dependsOn`한 작업은 "자식 전부 완료" 뒤에 ready가 된다.
  - 자식이 모두 취소되면 부모는 일반 작업으로 돌아간다. 이때 결과가 없으면 롤업으로 얻은 `checked`를 `waiting`으로 되돌린다.
- 분할 전제: 대상 작업이 `waiting`/`ready`이고 결과가 없을 때만 쪼갤 수 있다. 진행 중인 작업은 쪼개지 않고 후속 작업(`dependsOn`)을 만든다.

### 1.2 투영 필드 (`ProjectState`)

| 필드 | 의미 |
|---|---|
| `TaskState.ordinal` | 생성 순서(`tasks.size + 1`). 정렬·로그용 내부 값이고 화면에 나오지 않는다 |
| `TaskState.meta` | `TaskMeta = { priority; routing?; brief?; origin? }`. 새 작업은 `{ priority: 'normal' }` |
| `TaskState.children` | `plan_committed`마다 `spec.parentId`에서 다시 만든다 |
| `TaskState.reassignCount` | 기존 작업의 담당이 커밋에서 바뀔 때마다 +1. 재배정 루프 거부용 |
| `ProjectState.decisionRequests` | `Map<Id, DecisionRequestState>`. 상태는 `open` 또는 `DecisionOutcome` 중 하나 |

- 자동 행동 카운터: 대상 사람이 직접 `decision_resolved`(rejected/withdrawn/expired 제외)하면 기존 `cardApproved`·`authorityApproved`처럼 0으로 리셋한다(`decisionApproved`). `decision_requested`·`task_meta_set`·`pm_spoke`는 `isAutomationAction`이 세지 않는다. 작업 생성은 `plan_committed`로 이미 센다.

### 1.3 이벤트 (`core/src/events.ts`, 모두 추가형)

**`task_meta_set`** `{ taskId, priority?, routing?, brief?, origin? }`

- `Priority` = `high | normal | low`.
- `TaskRouting` = `{ executor: 'agent' | 'human'; reason: RoutingReason; note }`. `RoutingReason` = `agent_capable | needs_decision | needs_human_access | needs_human_judgement | no_capable_agent`.
- `TaskBrief` = `{ why, sourceMessageIds, decisionIds, attachmentIds, constraints }`. PM Agent가 대화에서 모은 맥락이고 사람이 쓰지 않는다.
- `TaskOrigin` = `{ createdBy: 'pm' | Id, planVersion, sourceMessageIds, decisionRequestId?, splitFrom? }`.
- 리듀서(`applyWorkEvent`): `origin`은 **처음 기록된 것만** 유지한다. `priority`는 유효한 값일 때만 덮어쓰고, `routing`·`brief`는 통째로 바꾼다. 없는 작업에 대한 메타는 무시한다.
- `TaskSpec`에 넣지 않은 이유: 넣으면 `plan_committed` 투영이 spec 차이로 `specVersion`을 올려 결과를 stale로 만들고 `checked`를 `waiting`으로 되돌린다. `task_meta_set`은 `specVersion`·결과·`checked`를 바꾸지 않는다.

**`decision_requested`**

```ts
{ requestId; kind: 'plan_change' | 'assignment' | 'choice' | 'missing_info' | 'stuck_work';
  targetMemberId;                       // 사람만
  question;                             // 한국어 1~2문장
  options: { optionId; label; effects: DecisionEffect[]; tradeoff }[];
  recommendation: { optionId; rationale; evidence: Id[] };   // 필수
  impact: { taskIds; blockedTaskIds; deadlineDeltaDays? };
  editable?: ('assignee' | 'title' | 'priority' | 'include')[];
  sourceMessageIds; remindAt? }

type DecisionEffect =
  | { type: 'plan_ops'; ops: PlanOp[] }
  | { type: 'resolve_task'; taskId; action: 'accept' | 'retry' | 'recheck'; note? }
  | { type: 'answer'; taskId; questionId? }
  | { type: 'none' };
```

**`decision_resolved`** `{ requestId, by, outcome, optionId?, edits?, answerText?, note? }`. `outcome` = `approved | chose_other | edited | rejected | answered | withdrawn | expired`.

**`pm_spoke`**에 선택 필드 `threadId`·`taskIds`·`requestId`를 더했다. 결정 요청 발언은 `requestId`·`taskIds`를 단다.

- 이름 충돌 주의: 기존 `decision_recorded`(대화에서 확정된 결정)와 결정 요청(`DecisionRequest`)은 별개다.
- 작업 댓글은 새 이벤트가 아니다. 사람 댓글 = `message_recorded`의 `threadId: "task:<taskId>"`(`taskThreadId`), Agent 발언 = 기존 `reply_recorded`/`agent_report_recorded`(taskId 있음).
- **설계와 다름**: PM 메모를 작업 스레드에 남기는 `pm_spoke.threadId`는 읽는 쪽(`taskActivity`, 웹 보기 모델)만 있고, 오케스트레이터는 아직 이 필드를 쓰지 않는다. PM 발언은 모두 채널에 나간다.

### 1.4 보기 상태와 활동 기록

보기 상태는 새 상태 기계가 아니라 순수 함수 `workStatus(task, state)`(`core/src/work.ts`)다. 위에서부터 먼저 맞는 것을 쓴다.

| 보기 상태 | 조건 |
|---|---|
| `done` 완료 | `checked` |
| `cancelled` 취소 | `cancelled` |
| `waiting_human` 사람 대기 | 이 작업을 `impact.blockedTaskIds`에 담은 **열린** 결정 요청이 있음(`waitingOn`). TaskStatus는 바꾸지 않는다 |
| `todo` 할 일 | `waiting`, `ready` |
| `in_progress` 진행 중 | `reserved`, `running`, `revising` |
| `in_review` 검토 중 | `submitted` (PM 인계 판단 중) |
| `blocked` 막힘 | `blocked` |

- "제안됨"(승인 전 작업)은 상태가 아니다. 승인 전에는 Task가 아니라 열린 결정 요청 안의 op다.
- "사람 대기"는 `taskIds`가 아니라 `blockedTaskIds`로만 판정한다.
- 부모 작업의 보기 상태는 웹 보기 계층(`build-view-model.ts` `statusOf`)이 계산한다: `checked`면 완료, 부모에 열린 요청이 걸려 있으면 사람 대기, 할 일이 아닌 자식이 있으면 진행 중, 아니면 할 일.
- 활동 기록은 새 이벤트 없이 원장에서 파생한다(`taskActivity(events, taskId)`). 종류: `created`(출처 포함) · `assigned` · `started` · `submitted` · `reviewed` · `revision` · `blocked` · `resumed` · `changed` · `decision_requested` · `decision_resolved` · `comment`.

## 2. PlanOp와 권한 (`core/src/plan-ops.ts`)

### 2.1 작업 op

| op | 권한 판정 ChangeKind | 비고 |
|---|---|---|
| `create_task` (최상위) | `scope_add` | 담당이 사람이면 `human_commitment`(그 사람)도 필요 |
| `create_task` (`parentId` 있음) | `split_task` | `origin.splitFrom` = `parentId` |
| `split_task { taskId, children }` | `split_task` | 대상이 waiting/ready이고 결과 없을 때만. 자식은 부모의 `dependsOn`을 물려받는다 |
| `cancel_task { taskId, reason }` | `scope_reduce` | 하위 작업까지 계획에서 뺀다. 투영이 빠진 작업을 `cancelled`로 만든다 |
| `set_priority { taskId, priority }` | `reorder` | spec을 바꾸지 않는다. `task_meta_set { taskId, priority }`만 쓴다 |
| 기존 `reassign` | 사람이 끼면 `human_commitment`, Agent끼리면 `reassign_agent` | 기존 그대로 |

- `applyOps`는 새 `TaskSpec[]`만 돌려준다. 메타는 `taskMetaFromOps(ops, { planVersion, createdBy, decisionRequestId? })`가 따로 만들고, 코디네이터가 같은 트랜잭션에서 `plan_committed` + 새 작업마다 `task_meta_set`(priority·routing·brief·origin)을 쓴다. 구조와 메타가 따로 기록돼도 원자적이다.
- 새 작업 생성은 기존 작업의 spec을 바꾸지 않으므로 기존 담당에게 변경 알림이 가지 않는다.

### 2.2 검증 (`planOpProblems`, `planOpsProblems`)

- 없는 작업, 빈 제목, 멤버가 아닌 담당, 이미 쓰인 id, 잘못된 우선순위.
- 라우팅이 없거나 `routingProblems`에 걸리는 초안(§3).
- 브리프 검증: 존재하지 않는 메시지, `state.decisions`(확정된 결정)에 없는 `decisionIds`는 거부. 첨부 id는 코디네이터 단계(`finishDraft`)에서 `attachment_recorded` 기준으로 검사한다.
- 구조: 알 수 없는 부모·의존, `parentId` 순환, `dependsOn` 순환(부모가 자기 자식을 기다리는 경우 포함), 깊이 `MAX_TASK_DEPTH`(2) 초과.
- 재배정: 같은 작업을 이미 `MAX_REASSIGNS`(2)번 재배정했으면 세 번째는 거부.
- 분할: 자식 0개, 자식 id 중복, 대상이 waiting/ready가 아니거나 결과가 있으면 거부. `cancel_task`는 사유가 필수다.

### 2.3 권한 판정과 Q1 기본값

- `opAuthority`는 기존 `whoApproves`(`core/src/authority.ts`)를 쓴다. `scope_reduce`·`scope_add`·`deadline_change`·`goal_change`는 결정권자(`goal.decider`)가 직접 말한 경우에만 허용한다. 나머지는 프로젝트의 `delegation.pmMayApply`에 든 종류면 PM Agent가 바로 적용한다. 요구 조건이 여럿이면 처음으로 막히는 것을 돌려준다.
- **Q1 기본값**: `DEFAULT_PM_MAY_APPLY = ['reorder', 'split_task', 'reassign_agent']`. 이미 승인된 작업을 하위 작업으로 나누기, Agent끼리 재배정, 우선순위 변경은 PM Agent가 묻지 않고 한다. 새 범위 추가(최상위 `create_task`)는 결정권자 발언이 아니면 카드로 묻는다.
  - **바꾸는 설정**: `DEFAULT_PM_MAY_APPLY`(`core/src/plan-ops.ts`). 웹 런타임이 새 프로젝트의 `goal_set.delegation.pmMayApply`에 이 값을 넣는다(`apps/web/lib/runtime.ts`). 이미 만들어진 프로젝트는 원장의 `goal_set`에 기록된 값을 따른다.
- 허용되면 즉시 적용, 아니면 권한자에게 결정 요청을 연다(§5.2).

## 3. 라우팅 (`core/src/routing.ts`)

LLM은 초안에 `executor`·`reason`(그리고 역할)을 제안하고, 코드가 확정한다.

- `routeTask(state, proposal, { needsAcceptance? })`
  1. `executor: agent` → 제안한 역할(`proposal.role`, 없으면 제안된 Agent의 역할)을 가진 Agent를 찾는다. 역량 표는 `agentCapabilities(state)`가 만든다(Agent 멤버마다 `{ member.role, memberId }`). 여럿이면 `activeTurn`이 없는 첫 Agent, 모두 바쁘면 합류 순서의 첫 Agent.
  2. 맞는 Agent가 없으면 `no_capable_agent`로 사람에게 내린다.
  3. `executor: human` → 사유가 `HUMAN_ROUTING_REASONS`(`agent_capable` 외 네 가지) 안일 때만 허용한다. 후보는 제안된 사람, 없으면 결정권자다.
- `routingProblems`: Agent 실행인데 담당이 Agent가 아니거나 사유가 `agent_capable`이 아님, 사람 실행인데 담당이 사람이 아니거나 사유가 사람용이 아님 → 거부.
- 라우팅 사유는 항상 `task_meta_set.routing`에 남고, 작업 상세에 문장으로 보인다(`ROUTING_LABEL`, 예: "Agent가 할 수 있는 일이라 바로 맡겼어요"). 라우팅 메타가 없는 기존 Agent 작업도 같은 문장을 보인다.
- #23과의 관계: 역량 판정은 지금 `agents/src/roles.ts`의 역할 키로 한다. #23에서 역할별 skill·tool 세트가 정해지면 `agentCapabilities`만 그 정의를 읽도록 바꾼다.

### Q2 기본값: 사람에게 일을 맡길 때는 본인 수락 카드

- 사람 담당 작업은 `human_commitment`라서, 그 사람이 직접 말한 것이 아니면 코디네이터가 그 사람에게 `assignment` 결정 요청을 연다(§5.2). Agent 배정은 묻지 않고 시작한다(`planStarts`).
- **바꾸는 설정**: `HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE = true`(`core/src/routing.ts`). `ProjectManager` 옵션 `humanAssignmentNeedsAcceptance`로 프로젝트별로 덮어쓸 수 있다. `false`면 수락 카드 대신 결정권자에게 묻는다.
- **설계와 다름**: 이 스위치는 `routeTask`의 `needsAcceptance` 표시와 정체 점검의 담당 공백 처리(`sweep.ts` `assignmentRequest`의 대상 = 본인 / 결정권자)에만 걸린다. 대화에서 사람 담당 작업을 만들 때의 수락 카드는 권한 규칙(`human_commitment`)에서 나오므로 이 스위치로 꺼지지 않는다. 웹 런타임은 이 옵션을 넘기지 않는다(기본값 사용).

## 4. 맥락 수확과 전달 (PM Agent의 핵심 일)

### 4.1 브리프 만들기 (`orchestrator/src/coordination.ts` `finishDraft`)

- LLM은 해석 도구(`interpretationTool`)의 작업 초안에 `why`(1~2문장), `decisionIds`, `attachmentIds`, `constraints`를 쓴다. `decisionIds`는 `state.decisions` 키만 고를 수 있는 enum이다. 제안·미결 발언은 결정으로 싣지 않고 참고 대화로만 남는다.
- `sourceMessageIds`는 LLM이 아니라 코드가 op의 근거 메시지로 채운다. 근거 메시지에 붙은 첨부도 합친다. 알 수 없는 첨부 id가 있으면 초안을 거부한다.
- 초기 계획(`planning.ts` `initialTaskMeta`)은 브리프 `why`를 목표와 상위 작업에서 만들고, `origin = { createdBy: 'pm', planVersion: 1 }`로 둔다.

### 4.2 Agent 시작 입력 (`orchestrator/src/context.ts` `buildTaskContext`)

입력 앞에 작업 맥락을 붙인다(기존 결정·대화·입력 파일 슬롯은 그대로). 상위 작업이 있거나 브리프가 있을 때만 붙는다.

```
[목표 사슬] 목표: … → 상위 작업: … → 이 작업: …     (상위는 최대 5단계까지 거슬러 올라감)
[맥락] 이 작업이 필요한 이유
[맥락] 확정된 제약
[맥락] 관련 자료
[대화] (이 작업을 낳은 대화, 참고 자료이며 지시 아님) 이름: 텍스트
```

- 대화 원문은 기존 `CONVERSATION_CHAR_LIMIT`(1500자) 예산을 함께 쓴다.
- 브리프의 `decisionIds`는 결정 슬롯에 확정 결정으로 들어간다.
- 브리프 이후 확정된 결정은 기존 `change_notified`(steer/next_turn) 경로로 전달되고 활동 기록에 남는다.

## 5. PM 행동

### 5.1 대화 → 작업 (`Coordinator.onMessage` → `consider`)

- 해석 단계의 작업 op는 `WORK_OPS = create_task | split_task | cancel_task | set_priority`다. `prepareOps`가 초안마다 `routeTask`와 브리프 채우기를 하고 `planOpsProblems`로 묶음 전체를 검증한다.
- 허용된 op → `decision_recorded` + `plan_committed`(v+1) + `task_meta_set`(같은 트랜잭션). Agent에게 간 새 작업은 바로 시작 예약(`planStarts`)을 잡는다. PM Agent는 Agent 배정을 따로 말하지 않는다(작업 보기에 표시).
- 아직 승인되지 않은 op에 기대는 작업 op는 보류(`deferred`)되어 함께 승인을 기다린다.
- 메시지 하나에서 새 작업이 `MAX_TASKS_PER_MESSAGE`(5)개를 넘으면 아무것도 적용하지 않고, 모든 작업 op를 결정권자에게 한 장의 묶음 요청("작업 N개가 나왔어요… 한 번에 반영할까요?")으로 올린다.
- 사람이 작업 스레드(`task:<id>`)에 쓴 메시지는 그 작업의 맥락으로만 해석하라는 규칙이 시스템 프롬프트(`pm-prompt.ts`)에 있다.
- 담당이 팀을 떠나 맡을 Agent도 없는 할 일 작업은 결정권자에게 `assignment` 요청을 작업당 한 번 연다.

### 5.2 권한 밖이면 결정 요청

- 작업 op가 허용되지 않으면 **권한자별로 결정 요청 하나**를 연다. 모든 op가 `human_commitment`면 `assignment`, 아니면 `plan_change`. 선택지는 `apply`(그 ops, 추천안)와 `hold`(효과 없음). `editable`은 단일 `create_task`면 `['title', 'priority']`, 그 외 `['priority']`. 요청과 함께 `pm_spoke`(kind `ask`, `requestId`, `taskIds`)를 남긴다.
- 작업 op가 아닌 기존 op(`exclude_scope` 등)가 권한 밖이면 기존 `authority_requested` 카드를 그대로 쓴다(회귀 없음).
- 초기 계획 승인도 기존 `plan_proposed` 카드 그대로다(기획 = 사람 결정). 계획 템플릿 작업마다 하위 작업을 최대 `MAX_SUBTASKS`(3)개 둘 수 있고, `decidePlan`이 커밋할 때 작업마다 `task_meta_set`을 함께 쓴다.

### 5.3 결정 요청 규칙 (`core/src/decision-requests.ts`)

- 생성 헬퍼 `createDecisionRequest`가 `decisionRequestProblems`를 통과해야 만든다. 리듀서도 규칙에 어긋난 `decision_requested`는 무시한다.
  - 대상은 사람 멤버만. 질문이 비면 안 된다.
  - 선택지 `MIN_DECISION_OPTIONS`~`MAX_DECISION_OPTIONS`(2~4)개, id 중복 없음, **효과가 모두 `none`인 "보류" 선택지 1개 이상 필수**.
  - **추천안 필수**: 선택지 중 하나를 가리키고 근거 문장(`rationale`)이 있어야 한다. `evidence`는 원장 ID 목록이며 빈 목록은 허용된다.
  - 작업 하나에 열린 요청은 최대 1개(`taskIds`·`blockedTaskIds` 모두 검사).
  - `remindAt` 기본값 = 생성 시각 + `DECISION_REMIND_HOURS`(24시간).
- `openDecisions(state)` 어댑터가 새 요청과 기존 `plan_proposed`/`authority_requested`를 같은 모양(`OpenDecision`, `source` 필드로 구분)으로 돌려준다. 기존 원장 이벤트는 이관하지 않는다.
- 응답은 순수 함수 `resolveDecision(state, requestId, answer, ctx, settings?) → { effects, events }`가 계산한다.

| 답 | outcome | 적용되는 효과 |
|---|---|---|
| `approve` | `approved` | 추천 선택지의 effects |
| `choose` | 추천안이면 `approved`, 아니면 `chose_other` | 고른 선택지의 effects |
| `edit` | `edited` | `editable` 필드만 바꾼 effects. 우선순위를 고치면 관련 작업마다 `task_meta_set`도 쓴다 |
| `answer` | `answered` | `answer` 효과만(답변 원문 필수) |
| `reject` | `rejected` | 없음 |
| `withdraw` / `expire` | `withdrawn` / `expired` | PM·system만. Q3 설정에 따라 다름 |

- 답할 수 있는 사람은 `targetMemberId`뿐이다. 닫힌 요청에는 다시 답할 수 없다.
- 실행은 `decideRequest`(`orchestrator/src/decision-flow.ts`)가 한다. 새 적용 경로는 없다: `plan_ops`는 `planOpsProblems`·`validOp`·`opAuthority`로 다시 검증한 뒤 `Coordinator.onConfirmedOperations`로 적용하고, `resolve_task`는 기존 `resolveTask`(작업이 blocked/submitted/revising일 때), `answer`는 `Dispatcher.onAnswer`(기존 답변 전달 경로)로 보낸다. 오류는 `DecisionRequestError`(`not_found` 404, `forbidden` 403, `invalid_input` 400, `invalid_state` 409).
- 기존 카드 API로 들어온 id도 `ProjectManager.decideCard`가 `decisionRequests`에 있으면 `decideRequest`로 보낸다.
- 상태가 바뀌어 요청이 무의미해지면(대상 작업 취소 등) 정체 점검이 먼저 `withdrawn`으로 닫는다.
- **묶기**: 웹 보기 모델(`build-view-model.ts` `decisionCards`)이 core `bundleDecisions`로 사람당 결정 요청 카드를 `DECISION_BUNDLE_LIMIT`(3)장까지 따로 보이고, 넷째부터는 셋째 카드의 `bundled`에 요청 순서대로 합친다. 묶인 요청도 카드 안 접힘 목록에서 각자 답한다. 계획 승인·권한 카드(`vm.cards`)는 묶지 않는다. 생성 시점에 사람당 개수를 막지는 않는다.

### 5.4 Agent 질문 → `missing_info` (`Dispatcher.onQuestion`)

- 질문 대상(지정된 사람 → 해당 파일 주인 → 결정권자)에게 `missing_info` 요청을 연다. 선택지는 `answer`(효과 `answer`)와 `hold`, `impact.blockedTaskIds = [그 작업]`. 그래서 작업이 "사람 대기"로 보이되 TaskStatus는 그대로라 진행 중인 Agent 턴을 끊지 않는다.
- 대상이 사람이 아니거나 그 작업에 이미 열린 요청이 있으면 요청은 만들지 않고 채널 질문만 나간다.
- 채널에서 따로 답이 오면 요청을 닫는다(대상이 답했으면 `answered`, 아니면 PM Agent가 `withdrawn`).

### 5.5 작업 댓글 전달 (`ProjectManager.processRecordedMessage`)

- 작업 스레드 메시지가 들어오면, 작업이 끝나지 않았고 담당이 Agent일 때 댓글 원문을 `sessions.deliver`(steer 또는 next_turn)로 보내고 `change_notified`(changeId `comment:<messageId>`)를 기록한다. 그다음 평소처럼 코디네이터가 판단한다.
- 사람 담당 작업의 댓글은 전달하지 않는다.

### 5.6 정체 점검 (`ProjectManager.sweep(now)` → `runSweep`, 규칙은 `core/src/stuck.ts` `stuckFindings`)

"고치지 말고 보고": 점검은 아무것도 자동 재시작·재배정하지 않는다. 부모 작업과 이미 열린 요청이 있는 작업은 건너뛴다. 먼저 무의미해진 요청을 `withdrawn`으로 닫는다.

| 규칙 | 조건 | 처리 | 멱등 키 |
|---|---|---|---|
| `blocked` | 마지막 재개 이후 첫 `task_blocked`가 `STUCK_BLOCKED_HOURS`(4시간) 이상 지남 | 결정권자에게 `stuck_work` 요청. 선택지: 다시 맡기기 / 다른 Agent에게 맡기기(같은 일을 할 Agent가 있고 결정권자가 적용할 수 있을 때) / 지금 결과로 확인(결과가 있을 때) / 작업 취소(결정권자가 적용할 수 있을 때) / 보류 | `sweep:blocked:<taskId>:<day>` |
| `unassigned` | waiting/ready인데 담당이 멤버가 아님 | `assignment` 요청(맡을 Agent가 있으면 결정권자, 없고 Q2가 켜져 있으면 후보 본인) | `sweep:unassigned:<taskId>:<day>` |
| `human_overdue` | 사람 담당 작업이 진행 중이고 시작 때 예측한 완료 시점을 넘김, **그리고** 지금 전체 예측이 늦음 | 그 사람에게 한 줄 확인(`ask`). 기한 영향이 없으면 말하지 않음 | `sweep:human_overdue:<taskId>:<day>` |
| `decision_remind` | 열린 요청이 `remindAt`을 지남 | 대상에게 한 번만 다시 알림 | `decision:<requestId>:remind` (날짜 없음 → 평생 1회) |
| `decision_expire` | 리마인드 뒤 `DECISION_EXPIRE_HOURS_AFTER_REMIND`(24시간) 지남 | `expire`로 닫음(Q3) | `sweep:decision_expire:<requestId>:<day>` |

- `<day>`는 서울 날짜(`kstDay`)다. 같은 키가 원장에 있으면 다시 하지 않으므로 같은 발견은 하루 한 번만 처리한다.
- **설계와 다름**: 설계의 "할 일인데 담당 Agent가 없음"은 코드에서 "담당이 멤버가 아님"(`unassigned`)이다. "사람 담당 작업이 예측 완료일을 넘김"은 전체 예측이 지금 늦을 때만 잡는다.

### Q3 기본값: 답 없는 요청은 만료, 작업은 멈춘 채, 자동 적용 없음

- 리마인드 1회 → 24시간 뒤에도 답이 없으면 `expired`로 닫는다. 추천안을 자동 적용하지 않는다(pm-principles "침묵은 동의가 아님").
- 만료 뒤에는 열린 요청이 아니므로 보기 상태의 "사람 대기" 표시는 풀리고 TaskStatus는 그대로다. core `pausedTaskIds`는 만료된 요청의 작업도 멈춘 작업으로 계속 세고, `Dispatcher`의 시작 경로(`unpausedStarts` → `planStarts`)가 이 집합의 작업을 자동 시작하지 않는다.
- **바꾸는 설정**: `DecisionSettings.unanswered`(`DEFAULT_DECISION_SETTINGS = { unanswered: 'expire' }`, `core/src/decision-requests.ts`). `'apply_recommendation'`이면 만료 때 추천안 효과를 적용한다. `ProjectManager` 옵션 `decisionSettings`로 넘기며, 웹 런타임은 넘기지 않는다(기본값).

### 5.7 하루 요약 (`ProjectManager.digest(now)` → `runDigest`, 재료는 `digestFacts`)

- 언제: `digestDue`가 참일 때 — 켜져 있고, 서울 시각이 `hourKst`(9시) 이후이며, 그날 키 `digest:<day>`가 원장에 없을 때. 별도 타이머가 아니라 정체 점검 틱에서 함께 확인하므로 9시 이후 첫 틱에 나간다.
- 재료(지난 요약 이후, 없으면 최근 24시간): 사람마다 완료된 작업(결정권자는 전체, 나머지는 본인 것), 새로 시작한 Agent 작업(결정권자만), 새 결정 요청, 답을 기다리는 결정 수, 예상 완료 변화(결정권자만). 사람만 대상이다.
- 바뀐 것(완료·시작·새 요청·예측 변화)이 있는 사람만 `@이름`으로 한 줄씩 적는다. 답을 기다리는 결정 수만 있는 사람은 빼진다. 작업 이름은 `TITLES_SHOWN`(3)개까지 보이고 나머지는 "외 N건".
- 전체가 비면 게시하지 않고, 같은 키로 조용한 `pm_considered`만 남겨 그날 다시 시도하지 않는다. 게시물은 `pm_spoke kind: 'summary'`. 내용은 코드 템플릿이다(LLM 없음).

### Q4 기본값: 매일 09:00(서울), 바뀐 사람만 멘션, 기본 켜짐

- **바꾸는 설정**: 환경 변수 `ENSEMBLE_DIGEST=off`(`0`/`false`/`no`도 같음)로 끈다(`digestEnabledFromEnv`, `apps/web/lib/runtime.ts`). 시각은 `DEFAULT_DIGEST_SETTINGS = { enabled: true, hourKst: 9 }`(`core/src/stuck.ts`).

### 5.8 안전장치

| 안전장치 | 코드 |
|---|---|
| 한 일에 주인은 하나 | `TaskSpec.assignee` 단일. 시작은 store 트랜잭션의 예약(`task_start_reserved`, 키 `start:<taskId>:v<specVersion>`) + Agent 점유(`activeTurn`). 부모는 실행하지 않는다 |
| 일이 빙글 돌면 거절 | 수정 요청 상한 `MAX_AGENT_REVISIONS`(2), 재배정 `MAX_REASSIGNS`(2), 깊이 `MAX_TASK_DEPTH`(2), `parentId`/`dependsOn` 순환 거부 |
| 한도에 닿으면 멈춤 | 기존 `AUTOMATION_LIMIT`(12)와 `action_limit_reached`. 작업 생성도 `plan_committed`로 센다. 메시지당 새 작업 5개 초과는 묶음 요청 |
| 위험한 결정은 승인으로 남김 | 사람 결정은 모두 `decision_requested` → `decision_resolved`로 원장에 남는다(근거·추천안·실제 선택). 범위·기한·목표 변경은 결정권자 발언 없이 적용하지 않는다 |

## 6. 사람 화면 (`apps/web`)

배치: 넓은 화면은 채널(왼쪽·가운데) + 작업 패널(오른쪽) 2단. 839px 이하에서는 탭 **채널 / 작업 / 내 결정**(내 결정에 개수 배지).

- **작업 패널 탭** (`WorkPanel.tsx`): 작업 / 팀 / 내 결정 / 일정. 기존 로드맵 카드(`RoadmapCard`)는 일정 탭으로 옮겼다. 계획 승인 전(작업 보기 모델 없음)에는 작업 탭이 자기 빈 상태(승인 대기 안내)를 보인다.
- **작업 탭**: 목표·기한·예상 완료 아래 작업 트리. 묶음은 사람 대기 / 진행 중(검토 중·막힘 포함) / 할 일 / 완료(취소 포함, 접힘). 빈 묶음은 숨긴다. 우선순위 → 계획 순서로 정렬한다. 사람 대기 행에는 "내 결정 대기" 또는 "OO님 결정 대기".
- **팀 탭**: PM → 사람 → Agent 순 한 줄 목록. 지금 하는 작업, 상태("결정 N건 대기", 작업 상태, "쉬는 중"), 열린 결정 수.
- **내 결정 탭**과 채널 인라인 카드는 같은 컴포넌트(`DecisionRequestCard.tsx`)다. 카드 = 질문, **PM 추천**(추천안·근거·증거, 추천안은 이 블록에만 한 번), 나머지 선택지, 영향(관련 작업 / 멈춘 작업 / 일정). 버튼: **추천대로 진행**, **다른 안 선택**, **고쳐서 승인**(`editable`이 있을 때만), **보류**. `missing_info`(답변형)는 답 없이 진행할 수 없으므로 필수 답변 입력란과 **답변 보내기**·**보류**만 둔다. 기존 계획·권한 카드는 기존 `ApprovalCard` 그대로다.
- **작업 상세(서랍, `WorkItemDetail.tsx`)**: 담당·라우팅 사유·상태, 확인/다시 맡기기(`TaskResolution`), 하위 작업, 완료 조건, 범위, **PM Agent가 정리한 맥락**(이유, 원 대화, 관련 결정, 확정된 제약, 자료), 출처, 활동 기록(대화 보기 링크), 댓글 입력.
- PM 발언이 작업을 언급하면(`pm_spoke.taskIds`) 메시지에 작업 이름 칩이 붙고, 누르면 상세가 열린다.
- 만들지 않은 것: 작업 생성 양식, 드래그 칸반, 사용자에게 보이는 작업 키. 보기 모델은 `ordinal`을 내보내지 않고, PM 문장 속 키 패턴도 `stripTaskKeys`로 지운다.

### 6.1 보기 계약 (`apps/web/lib/view-model.ts`, 모두 선택 필드)

- `VmWorkItem`: `id`(그리지 않음), `title`, `parentId?`, `ownerId`, `ownerKind`, `status: VmWorkStatus`, `priority`, `routingNote?`, `waitingOn?`, `childIds`, `brief?{ why, sources[{ messageId, excerpt }], decisions[{ id, summary }], attachments, constraints }`, `origin?`, `handoffConditions?`, `exclusions?`, `limits?`, `resolution?`.
- `VmDecisionCard`(`kind: 'decision'`): `id`, `forMemberId`, `requestKind`, `question`, `recommendation`, `options[{ optionId, label, tradeoff, summary }]`, `impact{ taskTitles, blockedTitles, deadlineDeltaDays? }`, `editable?`, `answerMode`(`missing_info`만 `text`), `bundled?`(넷째 이후 묶인 요청). `ViewModel.decisionCards`는 나(`me`)에게 열린 요청만 담는다.
- `ViewModel.work = { items, team[{ memberId, currentItemId?, state, openDecisions }] }`, `VmMessage.taskIds?`, `VmTaskDetail = { item, activity: VmActivityItem[], comments }`.
- 보기 모델은 `build-view-model.ts`가 만든다. 브리프의 원 대화는 80자 발췌, 없는 메시지·결정·첨부는 뺀다.

### 6.2 API (`apps/web/app/api/[...path]/route.ts`)

| 경로 | 동작 |
|---|---|
| `GET tasks/:id?me=` | `{ item, activity, comments }`. 없는 작업 404 `task_not_found` |
| `POST tasks/:id/comments { me, text }` | 작업 스레드 메시지로 기록 후 PM 처리. 202 `{ accepted, messageId }`. 빈 글 400, 사람이 아니면 403, 없는 작업 404 |
| `POST decisions/:id { me, action, optionId?, edits?, text? }` | `action` = `approve \| choose \| edit \| reject \| answer`. 응답은 `me`의 `ViewModel`. 대상자가 아니면 403, 없는 요청 404 `decision_not_found`, 답이 필요한 선택지에 글이 없으면 400 `answer_required`. `edits.include`의 작업 이름은 런타임이 작업 id로 바꾼다 |
| `POST tasks/:id/resolve { action, note? }` | 기존 확인/다시 맡기기(설계에 없던 경로) |
| `POST cards/:id { memberId, approve }` | 기존 카드 경로 유지. 새 요청 id도 받는다 |

오류 모양은 `{ error: { code, message } }`.

개인 Agent의 Space 참여 경로(`space/participants/…`, `space/requests/sweep`)와 그 이벤트는 #81 실험이다. 계약은 [실험 기록](experiments/issue-81-personal-agent-space.md) 2절에 둔다.

### 6.3 런타임과 설정 (`apps/web/lib/runtime.ts`)

- 정체 점검 틱 `SWEEP_INTERVAL_MS` = 5분. 틱마다 `pm.sweep(now)`, 요약이 켜져 있으면 `pm.digest(now)`. 자유 시작 모드에서만 돌고, 틱은 겹치지 않는다. 시나리오 모드에서는 아무것도 하지 않는다.

| 설정 | 기본값 | 의미 |
|---|---|---|
| `ENSEMBLE_PM_RUNTIME` | `api` | PM 백엔드: `api` / `codex` / `claude` / `fake`(규칙 기반 데모 PM `FakePmLlm`, `lib/fake-connector.ts`) |
| `ENSEMBLE_DIGEST` | 켜짐 | `off`면 하루 요약 끔 (Q4) |
| `DEFAULT_PM_MAY_APPLY` | `['reorder','split_task','reassign_agent']` | PM 자율 범위 (Q1, 코드 상수) |
| `HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE` / `humanAssignmentNeedsAcceptance` | `true` | 사람 배정 수락 카드 (Q2) |
| `DecisionSettings.unanswered` / `decisionSettings` | `'expire'` | 답 없는 요청 처리 (Q3) |
| `DEFAULT_DIGEST_SETTINGS` / `digestSettings` | `{ enabled: true, hourKst: 9 }` | 하루 요약 시각 (Q4) |
| `DECISION_REMIND_HOURS`, `DECISION_EXPIRE_HOURS_AFTER_REMIND` | 24, 24 | 리마인드·만료 시간 |
| `STUCK_BLOCKED_HOURS` | 4 | 막힘 보고 기준 |

## 7. 설계안과 다른 점 모음

| 설계안 (#26) | 코드 |
|---|---|
| PM 메모는 `pm_spoke.threadId`로 작업 스레드에 | 필드와 읽는 쪽만 있고 오케스트레이터는 쓰지 않는다 |
| "할 일인데 담당 Agent 없음" → `assignment` | "담당이 멤버가 아님"(`unassigned`) |
| 사람 작업이 예측 완료일을 넘기면 확인 | 전체 예측이 지금 늦을 때만 |
| `stuck_work` 추천: 다시 맡기기 / 다른 Agent에 재배정 / 취소 | 다시 맡기기 / 다른 Agent에게 맡기기 / 지금 결과로 확인 / 작업 취소 / 보류. 재배정은 같은 일을 할 Agent가 있고 결정권자가 적용할 수 있을 때만 보인다 |
| Q2 스위치 하나로 수락 카드 전환 | 스위치는 라우팅 표시와 정체 점검 담당 공백 처리에만 걸리고, 대화에서의 수락 카드는 권한 규칙(`human_commitment`)에서 나온다 |
| 하루 요약 09:00 타이머 | 별도 타이머 없이 5분 틱에서 09:00 이후 첫 확인 때 게시 |
| 카드 4버튼 고정 | `고쳐서 승인`은 `editable`이 있을 때만. `missing_info`는 답변 입력란 + `답변 보내기`·`보류`만 |
| API 3경로 | `tasks/:id/resolve` 추가. 댓글 응답은 202 `{ accepted, messageId }`, 결정 응답은 `ViewModel` |

## 8. 범위 밖

- 금액 예산: 비용 계측이 없다. 생기면 `action_limit_reached` 같은 예산 정지 이벤트를 더한다.
- Agent도 같은 동사(MF): Agent가 보고 규약으로 하위 작업 제안·댓글을 올리는 것은 아직 없다.
