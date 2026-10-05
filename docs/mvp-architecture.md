# Ensemble 아키텍처

<a id="현행-구현--2026-10-02"></a>

## 현행 구현 — 2026-10-05

확인 기준은 `main@605521b`다. 전체 문서 지도는 [docs 안내](README.md)를 따른다. 제품 방향은 `intent.md`를 따르고 여기에는 현재 실행 구조만 설명한다. 시작 명령은 [README](../README.md), 제품 범위는 [MVP 범위](mvp-scope.md)를 참고한다.

### 실행 앱과 독립 시연

| 경로 | 진입점 | 상태·실행 경로 |
|---|---|---|
| `/` | [App](../app/apps/web/components/App.tsx) | [웹 runtime](../app/apps/web/lib/runtime.ts) → ProjectManager → 이벤트 원장·SQLite |
| `/demo/pm-coordination` | [PmCoordinationDemo](../app/demo/scripted/pm-coordination/PmCoordinationDemo.tsx) | pm-coordination reducer와 고정 대화·결과 |
| `/demo/marketing-campaign` | [MarketingCampaignDemo](../app/demo/scripted/marketing-campaign/MarketingCampaignDemo.tsx) | S27 시나리오·노드/엣지·장면 상태 |
| `/demo/design-to-code` | [DesignToCodeDemo](../app/demo/scripted/design-to-code/DesignToCodeDemo.tsx) | design-to-code reducer와 합의·초안·공유·검토 상태 |

뒤의 세 경로는 앱 서버 API·PM provider·worker connector·SQLite에 연결되지 않은 클라이언트 시연이다. 실제 앱의 fake 모드는 동일한 서버·원장을 쓰므로 이들과 구분한다. [데모 안내](../app/demo/README.md)에 조작과 한계를 정리했다.

현행 패키지는 `core`(이벤트·투영·권한·예측), `store`(메모리·SQLite), `llm`(provider), `agents`(세션 connector), `orchestrator`(계획·조율·검토·인계), `channel`(채널 계약), `scenarios`(앱 입력 재생)다. 스크립트 데모는 `app/demo/scripted`, 실제 앱을 이용하는 관찰 실행기는 `app/demo/runtime`에 둔다. 별도 패키지나 런타임 복제는 만들지 않는다.

현재 검증 명령은 `app/`에서 `npm test`, `npm run typecheck`, `npm run build`다. 테스트 구성과 역사적 실행기 구분은 [QA 안내](qa/README.md)를 따른다.

### 웹 앱의 PM과 worker는 별도 선택

| 설정 | 웹 앱의 현재 경로/기본값 |
|---|---|
| `ENSEMBLE_PM_RUNTIME=api` | 기본값. Anthropic Messages API 호환 provider. 모델 환경변수는 `ENSEMBLE_MODEL_PM` → `ENSEMBLE_MODEL` → 코드 기본 `claude-sonnet-5` |
| `ENSEMBLE_PM_RUNTIME=codex` | 웹 앱은 `CodexLlmProvider`의 app-server 경로. 기본 effort `low`, 호출 제한 1.5분. `ENSEMBLE_PM_TIMEOUT_MS`가 있으면 우선, 없으면 `ENSEMBLE_PM_TIMEOUT_MINUTES` 사용 |
| `ENSEMBLE_PM_RUNTIME=claude` | `pmRuntimeFromEnv()`의 `ClaudeCliProvider` (`claude -p` 구조화 JSON). 기본 effort `medium`, 호출 제한 5분 |
| `ENSEMBLE_PM_RUNTIME=fake` | 웹 앱의 규칙 기반 `FakePmLlm`; 실제 모델 평가 결과가 아님 |
| `ENSEMBLE_AGENT_RUNTIME` | `fake`가 기본. 실제 실행은 `codex` app-server 또는 `claude` CLI connector. `ENSEMBLE_MODEL_AGENT`가 없으면 connector/사용자 런타임 기본 모델을 유지 |

웹 앱의 Codex PM 경로와 독립 CLI 도구가 사용하는 `pmRuntimeFromEnv()`를 혼동하지 않는다. 후자는 `api/codex/claude`만 다루고, Codex는 `codex exec` 기반 `CodexCliProvider`, CLI 공통 기본 effort `medium`·제한 5분이다. `fake` 선택은 웹 런타임이 처리한다. 특히 아래의 CLI 설명은 모든 웹 PM 호출이 `codex exec`라는 뜻이 아니다.

웹 앱은 Claude PM에도 `modelFor('pm', 'anthropic')`의 모델 값을 요청에 전달하므로, 별도 설정이 없으면 코드 기본 `claude-sonnet-5`가 적용된다. 독립 Claude CLI factory의 자체 기본 모델 유지와 다르다. `ENSEMBLE_MODEL_PM`을 명시하면 런타임 간 모델 이름 혼동을 줄일 수 있다. 현재 모델 가용성·요금·로그인 상태를 이 문서가 검사하거나 보장하지는 않는다. 실제 worker 작업 공간은 `ENSEMBLE_AGENT_WORKSPACE_ROOT`로 지정하며 웹 앱은 저장소 내부 경로를 거절한다. 근거: [웹 런타임](../app/apps/web/lib/runtime.ts), [공통 PM 선택](../app/packages/llm/src/runtime.ts), [모델 선택](../app/packages/llm/src/env.ts), [Codex PM app-server](../app/packages/agents/src/codex/llm.ts).

### 조정 판단의 선점과 백그라운드 점검

[Coordinator](../app/packages/orchestrator/src/coordination.ts)는 PR #49 이후 같은 작성자의 새로운 일반 채널 메시지를 내구적으로 기록한 뒤 진행 중인 이전 판단에 abort를 전달한다. 첨부가 있거나 작업 스레드에 속한 입력, 카드 처리는 이 선점 대상이 아니다. 원장 재확인과 커밋 시점의 supersession 검사로 늦은 판단 적용을 막고, 앞선 메시지는 맥락으로 보존한다. 이를 전역 worker 취소나 모든 종류의 입력을 버리는 정책으로 확대 해석하지 않는다.

웹의 자유 진행 모드에는 5분 주기 정체 점검과 하루 요약이 연결되어 있다. 요약 기본값은 서울 09:00, 활성 상태이며 `ENSEMBLE_DIGEST=off`로 비활성화한다. 하루 키로 중복을 막고 변경이 없으면 발언하지 않는다. 서버 실행 중의 타이머이며 외부 cron·예약 서비스가 아니다. [core 규칙](../app/packages/core/src/stuck.ts), [요약 생성](../app/packages/orchestrator/src/digest.ts).

### 호스트 검증 경계와 현재 기본 연결

PR #52는 [validation.ts](../app/packages/orchestrator/src/validation.ts)의 `TrustedValidator`를 호스트 옵션으로 추가했다. worker 제출은 [SessionRunner](../app/packages/orchestrator/src/session-runner.ts)가 경로를 검사하고 파일 내용을 원장 첨부로 고정한다. 원래 상대 경로와 `limitations`도 보존한다. 검증기는 불변 제출 snapshot을 받고, worker 자기보고와 구분되는 측정 증거를 [Dispatcher](../app/packages/orchestrator/src/dispatch.ts)의 최종 judge 앞에 제공한다.

`requireValidation: true`에서는 현재 제출에 연결된 통과 증거가 필요하다. `failed`는 구현 수정, `not_run`·`environment_blocked`는 검증 대기다. 취소·시간 제한·만료·중복 재시도 및 judge 이후 재확인을 처리한다. 현재 웹 런타임은 검증기를 주입하지 않으므로 기본 소스 검토를 유지하고 측정 상태는 `not_run`이다. 일반 웹 UI나 환경변수로 검증기를 켜는 설정은 없으며, opt-in은 `ProjectManager`를 구성하는 호스트 코드의 옵션이다.

바인딩은 결과·제출물·계획/작업 버전·정책·문맥을 포함하지만, 현재 문맥 digest는 모든 채널 메시지나 같은 계획 버전의 사람 재개 요청을 해시하지 않는다. 인계 판정의 재개 조건과 새 제출의 검증 증거를 함께 확인해야 한다. 현재 감사 범위는 [작업 모델](work-model.md#같은-계획-버전의-변경과-감사-범위)에 설명한다.


## 3. 코드 위치

### 3.1 작업 항목·결정 요청 모듈 (이슈 #26)

작업 항목·결정 요청 모델의 정본은 `docs/work-model.md`다. 판정은 core의 순수 함수가, 실행은 orchestrator가 한다.

| 패키지 | 모듈 | 하는 일 |
|---|---|---|
| core | `work.ts` | 작업 메타(`task_meta_set`) 리듀서, 부모 판정·롤업(`isParentTask`, `rollupParents`), 보기 상태(`workStatus`, `waitingOn`), 활동 기록(`taskActivity`), 작업 스레드 id(`taskThreadId`) |
| core | `plan-ops.ts` | 작업 op(`create_task`, `split_task`, `cancel_task`, `set_priority`) 검증·적용(`planOpsProblems`, `applyOps`, `taskMetaFromOps`), 권한 판정(`opAuthority`), Q1 기본값 `DEFAULT_PM_MAY_APPLY` |
| core | `routing.ts` | 라우팅 확정(`routeTask`, `routingProblems`), 역량 표(`agentCapabilities`), Q2 기본값 `HUMAN_ASSIGNMENT_NEEDS_ACCEPTANCE` |
| core | `decision-requests.ts` | 결정 요청 리듀서·생성 검증(`createDecisionRequest`), 기존 카드 어댑터(`openDecisions`), 응답 계산(`resolveDecision`), 리마인드·만료(`decisionsDue`), 묶기(`bundleDecisions`), Q3 설정 `DecisionSettings` |
| core | `stuck.ts` | 정체 판정(`stuckFindings`), 하루 요약 재료·시점(`digestFacts`, `digestDue`), Q4 기본값 `DEFAULT_DIGEST_SETTINGS` |
| core | `transitions.ts` | 시작 순서(`startOrder`: 우선순위 → 생성 순서, 부모 제외)와 시작 예약(`planStarts`) |
| orchestrator | `coordination.ts` | 대화 → 작업 op 해석, 브리프 채우기, 권한 밖이면 결정 요청, 메시지당 새 작업 5개 초과 묶음(`MAX_TASKS_PER_MESSAGE`) |
| orchestrator | `planning.ts` | 계층 초기 계획(하위 작업 `MAX_SUBTASKS`), 커밋 때 작업 메타 기록 |
| orchestrator | `context.ts` | Agent 시작 입력에 목표 사슬·브리프 주입(`buildTaskContext`) |
| orchestrator | `decision-flow.ts` | 결정 응답 실행(`decideRequest`): 기존 `onConfirmedOperations`·`resolveTask`·답변 전달로 |
| orchestrator | `dispatch.ts` | Agent 질문 → `missing_info` 결정 요청(`onQuestion`) |
| orchestrator | `sweep.ts` | 정체 점검 실행(`runSweep`): 막힘·담당 공백 요청, 사람 작업 확인, 리마인드·만료 |
| orchestrator | `digest.ts` | 하루 요약 게시(`runDigest`, 코드 템플릿) |
| orchestrator | `pm.ts` | 진입점(`ProjectManager`): 작업 댓글 전달, `sweep(now)`·`digest(now)`, 카드 id를 결정 요청으로 연결(`decideCard`) |
| web | `lib/build-view-model.ts`, `lib/view-model.ts` | 작업 패널·결정 카드 보기 모델(`ViewModel.work`, `decisionCards`), 작업 키 숨김 |
| web | `lib/runtime.ts` | 5분 정체 점검 틱 + 하루 요약(`ENSEMBLE_DIGEST`), `task`·`comment`·`decide` |
| web | `app/api/[...path]/route.ts` | `GET tasks/:id`, `POST tasks/:id/comments`, `POST decisions/:id` (기존 `cards/:id` 유지) |
| web | `components/WorkPanel.tsx`, `WorkItemDetail.tsx`, `DecisionRequestCard.tsx` | 작업 패널(작업/팀/내 결정/일정), 작업 상세 서랍, 결정 카드 |


## 5. 유지할 실행 규칙

- 이벤트 원장을 정본으로 두고 화면은 투영에서 계산한다.
- 같은 작업 시작은 예약·멱등 키·Agent 점유를 함께 확인한다.
- 실행 Agent는 결과·첨부·질문·변경 확인을 제출하며 원장 쓰기·배정 권한은 갖지 않는다.
- 사람의 새 약속과 위임 밖 변경은 해당 권한자의 확인을 받는다.
- SQLite·첨부·프로젝트 메타데이터의 기본 위치는 `app/data/`이며 `ENSEMBLE_DATA_DIR`로 분리한다.
- 현재 웹앱은 로컬 사용자 전환 방식이다. 승인 규칙을 사용자 인증·조직 접근 제어로 해석하지 않는다.

제품 성공 기준과 미확정 사항은 [MVP 범위](mvp-scope.md), 결정 이유는 [결정 기록](pm-agent-decisions.md)를 따른다.
