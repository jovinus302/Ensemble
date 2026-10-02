# Ensemble MVP 아키텍처 (M0 결정)

## 현행 구현 — 2026-10-02

확인 기준은 `main@c91234a`다. 아래 2026-09-28 환경 확인·M0 배치는 당시의 기록이며, 공급자 모델 목록·인증·네트워크 가능 여부를 현재 환경에 대한 보장으로 읽지 않는다. 이 절이 실행 경로와 기본값을 보충·대체한다. 시작 명령은 [README](../README.md), 제품 범위는 [MVP 범위](mvp-scope.md)를 참고한다.

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

`requireValidation: true`에서는 현재 제출에 연결된 통과 증거가 필요하다. `failed`는 구현 수정, `not_run`·`environment_blocked`는 검증 대기다. 취소·시간 제한·만료·중복 재시도 및 judge 이후 재확인을 처리한다. 현재 웹 런타임은 검증기를 주입하지 않으므로 기본 소스 검토를 유지하고 측정 상태는 `not_run`이다. 일반 웹 UI나 환경변수로 검증기를 켜는 설정은 없으며, opt-in은 `ProjectManager`를 구성하는 호스트 코드의 옵션이다. benchmark 패키지의 실제 빌드·브라우저 runner를 일반 앱의 기본 validator로 간주하지 않는다.

바인딩은 결과·제출물·계획/작업 버전·정책·문맥을 포함하지만, 현재 문맥 digest는 모든 채널 메시지나 같은 계획 버전의 사람 재개 요청을 해시하지 않는다. 인계 판정의 재개 조건과 새 제출의 검증 증거를 함께 확인해야 한다. 이 한계와 실제 v4 경로는 [작업 모델](work-model.md#같은-계획-버전의-변경과-감사-범위)에 설명한다.

---

## M0 및 2026-09-28 아키텍처 기록

> 제품 의도는 `intent.md`, 데이터 모델·enum·규칙은 `docs/product-state-model.md`가 정본이다. 이 문서는 그 둘을 **어떤 코드 구조로 구현하는지**만 정한다.

## 1. 확정된 결정 (2026-09-28, 사용자)

| 항목 | 결정 |
|---|---|
| 채널 | 자체 Slack형 웹앱. 실제 Slack 연동은 하지 않는다. 연동은 나중에 `ChannelAdapter`로 붙인다 |
| 스택 | TypeScript 단일 스택. Next.js(App Router) + SQLite(Node 내장 `node:sqlite`) |
| LLM | 루트 `.env`의 `ANTHROPIC_BASE_URL`(사내 LiteLLM proxy)과 `ANTHROPIC_API_KEY`. Anthropic Messages API 호환 |
| 시연 | 실제 LLM 호출. **시나리오 모드**(§8 시나리오 B 대본 재생)와 **자유형식 모드**(사람이 직접 목표·발언 입력)를 둘 다 제공 |
| 코드 위치 | repo 안 `app/`. 확장 가능한 모노레포 구조 |

## 2. 환경 확인 결과 (2026-09-28)

- proxy에서 쓸 수 있는 Claude 모델: `claude-sonnet-5`, `claude-fable-5`, `claude-sonnet-4-6`. GPT·Gemini 계열도 목록에 있다.
- tool use: 동작한다(`tool_choice` 강제 포함).
- **웹 검색 서버 도구: 쓸 수 없다.** Vertex AI 조직 정책 `allowedPartnerModelFeatures`가 막는다. 경쟁사 조사 Agent는 모델 지식으로 작성하고, 산출물에 "웹 검색 없음"을 표시한다.
- Windows curl은 인증서 폐기 확인에 실패한다(`--ssl-no-revoke` 필요). Node 클라이언트에서의 동작은 `npm run smoke:llm`으로 확인한다.
- Node SDK(`@anthropic-ai/sdk`)는 추가 TLS 설정 없이 proxy에 연결된다. `npm run smoke:llm`이 한국어 텍스트와 강제 tool 호출을 확인한다.
- **proxy가 응답을 캐시한다.** 같은 요청을 다시 보내면 같은 응답 ID가 돌아온다. 요청은 Vertex(`msg_vrtx_…`)와 Bedrock(`msg_bdrk_…`)으로 나뉘어 간다. 첫 스모크에서 텍스트가 한 번 빈 문자열로 왔고 재현되지 않았다. 재시도는 같은 요청을 다시 보내는 방식으로는 의미가 없을 수 있으므로, 빈 응답·재시도 처리는 M2에서 정한다.
- 기본 모델은 `claude-sonnet-5`. 역할별로 `ENSEMBLE_MODEL_PM`, `ENSEMBLE_MODEL_AGENT`로 바꾼다.
- PM 백엔드는 `ENSEMBLE_PM_RUNTIME`으로 고른다: `api`(기본, 위 proxy의 Messages API), `codex`(`codex exec` 읽기 전용·`--output-schema`), `claude`(`claude -p --output-format json`·도구/설정 없음·`--json-schema`). CLI 런타임은 `ENSEMBLE_MODEL_PM`이 있을 때만 모델을 지정하고, `ENSEMBLE_PM_EFFORT`(기본 medium)와 `ENSEMBLE_PM_TIMEOUT_MINUTES`(기본 5)를 따른다. 실제 호출 확인은 `npm run smoke:pm`.

## 3. 디렉토리 구조

```
app/
  package.json              npm workspaces 루트, 공통 스크립트
  tsconfig.base.json
  apps/
    web/                    Next.js — 채널 화면, Product State 패널, 카드, API 라우트
  packages/
    core/                   도메인. 이벤트 원장 타입, 투영(현재 상태), computeGap, 태스크 상태 머신. 외부 의존성 없음
    store/                  LedgerStore 인터페이스 + SQLite 구현 + 메모리 구현(테스트용)
    llm/                    LlmProvider 인터페이스 + Anthropic 구현(proxy) + 모델 설정
    channel/                채널·멤버·메시지·카드 모델, ChannelAdapter 인터페이스(웹 → 나중에 Slack)
    agents/                 Agent 역할 레지스트리, 실행 런타임, 도구(report_result, attach_evidence)
    orchestrator/           AI PM. 입력 분류(intake), 인계 판정, 자동 시작(dispatch), 맥락 조각(prompt-slice), 역할 템플릿
    scenarios/              시나리오 정의와 재생기. 자유형식 모드와 같은 엔진을 쓴다
```

의존 방향은 한쪽이다. 거꾸로 import하지 않는다.

```
core  ←  store, channel
core, llm  ←  agents
core, store, channel, llm, agents  ←  orchestrator
orchestrator  ←  scenarios  ←  apps/web
```

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

## 4. 확장 지점

| 바꾸고 싶은 것 | 손대는 곳 | 나머지 영향 |
|---|---|---|
| 실제 Slack 연동 | `channel`에 `ChannelAdapter` 구현 추가 | 없음. PM은 어댑터만 본다 |
| 다른 모델·공급자(GPT, Gemini) | `llm`에 `LlmProvider` 구현 추가 | 없음 |
| Postgres 등 다른 저장소 | `store`에 `LedgerStore` 구현 추가 | 없음. 정본은 이벤트 원장이다 |
| 새 Agent 역할 | `agents`의 역할 레지스트리에 정의 추가 | 역할 템플릿에서 참조 |
| 새 시나리오 | `scenarios`에 파일 추가 | 없음 |
| 여러 채널·프로젝트 | 모든 이벤트가 `project_id`·`target_product_id`를 가진다 | 원장 스키마 변경 없음 |

## 5. 지키는 규칙 (product-state-model, argo-takeaways에서)

1. 정본은 이벤트 원장이다. 화면·패널·카드는 모두 원장의 투영이다.
2. 상태 판정(`computeGap`, criterion `passed`)은 결정적 코드가 한다. LLM은 판정하지 않는다.
3. 인계 트리거는 `checked`(PM 판정)이고, `passed`는 증거로만 정해진다.
4. 확인 한 번에 다음 작업 시작은 한 번이다. 같은 `checked`로 두 번 시작하지 않는다(멱등 키).
5. AI PM이 스스로 잇는 행동에는 횟수 상한이 있다. 상한에 닿으면 결정권자에게 알린다.
6. 실행 Agent의 도구는 산출까지다. 원장 쓰기·배정·검증 판정 권한은 없다.
7. Argo와 ensemble-studio v1.0은 참고용이다. 코드·SQL·프롬프트 문장은 옮기지 않는다.

## 6. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| M0 | 이 문서 + 스캐폴드 + LLM 연결 스모크 | `npm test` 통과, `npm run smoke:llm` 통과 |
| M1 | core: 원장·투영·computeGap·상태 머신 | product-state-model §7.1 1–9단계를 재현하는 단위 테스트 |
| M2 | orchestrator: dispatch·멱등·상한·prompt-slice·역할 템플릿·인계 판정 | 중복 시작 없음, 상한 알림, 판정 사유 기록 테스트 |
| M3 | 채널 웹앱 + intake + Agent 도구 | 브라우저에서 카드·패널이 원장과 일치 |
| M4 | 시나리오 모드·자유형식 모드 시연 | 시나리오 B 전 구간(6′ 포함) 실행, 지시 없이 이어진 인계 수 기록 |

## 7. 미결

- 인계 판정(예: "초안이 D1의 문제를 다루는가")은 LLM이 한다. 판정 사유 형식과 오판을 되돌리는 절차는 M2에서 정한다.
- 인증은 MVP에서 하지 않는다. 로컬 단일 서버에서 사람 2명을 화면의 사용자 전환으로 흉내 낸다.
