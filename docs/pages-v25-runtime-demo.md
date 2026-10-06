# Pages v2.5 런타임 데모 — WORK CONTEXT 설계

> 2026-10-06 작성, `main@7095f0b`(PR #74) 기준으로 다시 확인. 입력: 애니메이션 시나리오 덱 `Ensemble-v2.5-Pages-scenario.html`(장면 03·04·05, 덱 끝에 v1.0→v1.1 변경 장면 06이 더 있다). 이 문서는 그 덱을 **실제 앱 `/`의 시나리오**로 재현하기 위한 갭 분석·원장 계약·PM 동작·화면·대본·검사·작업 분할을 정한다. 구현 전 설계이며, 현재 동작의 설명은 [작업 모델](work-model.md)이 정본이다.
> 함께 읽을 것: [제품 의도](../intent.md), [작업 모델](work-model.md)(이벤트·권한·화면), [아키텍처](mvp-architecture.md), [PM 원칙](pm-principles.md), [핵심 회귀 검사](qa/essential-regressions.md), [런타임 시연](../app/demo/runtime/README.md), [DESIGN.md](../DESIGN.md)(토큰).
> 기반 커밋(브랜치 `jovinus302/pages-v25`)에 계약 타입·projection·golden ledger·화면 슬롯·핵심 회귀 검사가 들어 있다. 아래 경로는 별도 표기가 없으면 `app/` 기준이다.

## 0. 고정된 결정

사용자 결정:
1. 새 데모 라우트가 아니라 **실제 앱 `/`**(apps/web + packages)에 구현한다. `@ensemble/scenarios`에 Pages v2.5 대본을 추가하고(사람 발언만 대본), 앱의 **시나리오** 버튼으로 재생한다. 빠진 제품 기능은 실제 앱 UI + 원장 이벤트로 만든다.
2. `ENSEMBLE_PM_RUNTIME=fake`이면 PM은 **결정적**이어서 시나리오가 항상 같은 기록을 남긴다. api/codex/claude 런타임에서는 **같은 이벤트 계약**을 모델이 PM 프롬프트·도구 확장으로 채운다.
3. 제작 도구(Figma·프롬프트 스튜디오·개발 도구)와 인력 pool은 **시뮬레이션**이고 원장 이벤트로 남는다. 실제 외부 서비스는 없다.

coordinator 결정(2026-10-06):
- **Q1 대본 예외 수락**: 장면 03의 Story Agent·UI Agent 발언은 시나리오 실행기가 `message_recorded`(actor `system:scenario`, `authorId` = 그 Agent)로 쓴다. **시연 대본의 한계**로 명시한다 — 실제 Agent가 킥오프에서 스스로 제안하는 기능은 범위 밖이다. PM 출력은 어떤 경우에도 대본에 넣지 않는다.
- **Q2 수락**: 덱에 없는 사람 발언 1줄(장면 04 직전 김서연 "네, 채워 넣고 순서대로 정리해 주세요.")을 넣는다.
- **Q3 수락**: 분기는 `decision_requested`를 쓰지 않고 `context_branch_*`로 둔다(§2).
- **Q5**: D는 미리보기를 `basePreview` 대비 patch로 쓸 수 있다. 그것이 §3 계약(`PreviewDraft`·`AppPreviewSpec`)을 바꾸면 D는 멈추고 coordinator에 먼저 묻는다.

지키는 기존 규칙: 원장이 유일한 정본이고 화면은 원장에서 계산한다. PM은 제안만 하고 권한·검증은 코드가 한다. PM 발언은 `pm_considered`와 함께 남는다. 실행 Agent는 원장에 직접 쓰지 않는다. 스크립트 데모(`app/demo/scripted/*`, `/demo/pm-coordination` 등)는 제품 런타임을 import하지 않는 별도 시연이므로 건드리지 않고 재사용하지도 않는다 — `/demo/pm-coordination`의 Story·UI Agent는 이름만 같다.

## 1. 장면 요약 (덱 → 런타임)

| 장면 | 덱에서 일어나는 일 | 런타임에서 누가 하는가 |
|---|---|---|
| 03 감지 | 김서연·박도윤·이하준·Story Agent·UI Agent가 말한다. PM이 WORK CONTEXT에 충돌(D1 9시 자동 ↔ D2 버튼 수동)·위반(4종 매일 동시 생성 → 비용 한도)·미정(생성 버튼 위치)·누락 4(fiction 수위, feed 공유 개인정보, 9시 설정 화면, 지표)을 올리고 "채워 넣고 정리할까요?"라고 묻는다. LOG에 감지가 쌓인다. | 사람 발언 = 대본, Agent 전제 = 대본 예외(Q1). 항목·상태·질문 = PM |
| 04 정렬 | (사람 "네", Q2) PM이 D1을 통합하고 D2를 A/B 분기로 남긴다. 사람들이 정하지 못한다 → PM이 "근거 부족" 판단 → pool 검색 → 한지우(정책)·정유나(내러티브) 초대·합류 → 둘 다 B → 김서연 "B로 확정" → PM이 Proposal v1 생성(결정·3 화면·누락 보완) + 모바일 미리보기. "A로 가면?" → PM이 A 예상 경로를 캔버스와 미리보기에 올린다. | 사람·pool 전문가 발언 = 대본. 통합·분기·검색·초대·Proposal·미리보기 = PM. 합류 = pool 시뮬레이션 |
| 05 전달 | 김서연 "B 유지, v1 확정, 진행" → PM이 A 경로를 걷고 v1.0 확정, Proposal을 결정→기능→화면→지표(D1 D2 F1–F4 S1 S2 V1 V2)로 펼친다. 참여자가 연결해 둔 제작 도구로 넘기고(Figma←박도윤, 프롬프트 스튜디오←Story Agent, 개발 도구←이하준), 진행이 v1.0 빌드로 끝난다. 오른쪽이 쓸 수 있는 Pages v1.0 화면. | 확정 = 사람. 펼침·전달·빌드 안내 = PM. 진행·빌드 = 도구 시뮬레이션 |
| 06 변경(확장) | 한지우 "fiction 표시가 없다", 김서연 "라벨 추가, 노래 빼자" → PM이 F5 추가·F2 제외, 하류(S1·S2·템플릿) 낡음, D1·D2 영향 없음을 변경 카드로 보인다 → 변경 적용 → 변경분만 재전달 → v1.1 빌드. | 적용/되돌리기 = 사람(카드 버튼). 나머지 = PM·도구 시뮬레이션 |

장면 06은 "3-slide" 범위 밖이지만 덱에 있고 계약 비용이 작아 **계약과 golden에 포함**하고, 구현 우선순위는 03→05 다음으로 둔다.

## 2. 갭 분석 (덱 요소 → 현재 기능 / NEW)

현재 기능의 근거는 [작업 모델](work-model.md) §1(이벤트·투영), §5(PM 행동), §6(화면·API·런타임)이다.

| 덱 요소 | 현재 | 판단 |
|---|---|---|
| 채널 메시지·작성자·시간 | `message_recorded`·`pm_spoke`, `components/Message.tsx` | 재사용. 채널 이름만 `# pages-general` |
| 멤버 목록·역할(AGENT 배지) | `member_joined`, `components/Members.tsx` | 재사용 + **NEW** `member_joined.source: "pool"`(POOL 배지, "+2 POOL") |
| Agent 발언(Story·UI, 장면 03) | Agent는 작업 턴의 `reply_recorded`로만 말한다 | **대본 예외(Q1)**: 실행기가 `message_recorded`(actor `system:scenario`)로 쓴다. PM facts(`state.messages`)에 들어가야 해서 `reply_recorded`가 아니다 |
| 프로젝트 머리 `PRJ-0518 · v0.3 → v1.0 → v1.1` | 없음 | **NEW** `context_session_started` + 버전(확정·변경 적용 때 이동) |
| WORK CONTEXT 캔버스(레이어 열·노드·연결선) | 작업 패널(`WorkPanel.tsx`, 작업 트리) | **NEW** `context_item_upserted`·`context_edge_upserted`, 캔버스 UI |
| 감지 상태 충돌·위반·미정·누락 | 없음(`decision_recorded`·`conflicts`는 계획용) | **NEW** `ContextItemStatus` |
| 통합·누락 보완·분기·확정·유지·추가·갱신·낡음·제외·검증 예정 | 없음 | **NEW** 같은 상태 열거 + `supersededBy`(흡수된 항목은 캔버스에서 숨김) |
| LOG(시간·종류·문장, 최신 위) | `PmLog.tsx`(말하기/침묵 판단) | **NEW** 원장 이벤트에서 계산하는 별도 LOG. 기존 PM 판단 기록은 그대로 |
| A/B 분기 카드 | `decision_requested`(추천·보류 선택지 필수, 대상 1명; work-model §5.3) | **NEW** `context_branch_*`(Q3). 덱은 사람들이 채팅으로 정하고 PM은 추천 없이 근거를 모은다. 사람만 확정하는 규칙은 projection에서 같게 지킨다 |
| PM 단계 칩("판단 중: 결정 근거 확인 → 멤버 역량 확인 → 가능 인력 검색") | 없음 | **NEW** 채팅 카드 `pm_steps` |
| 인력 pool 검색·초대·합류 | 없음 | **NEW** `member_pool_listed`(seed), `pool_search_recorded`, `pool_member_invited`, 합류는 `member_joined` |
| Proposal v1(결정·화면 3·누락 보완·입력 5) | `plan_proposed`(작업·추정) | **NEW** `proposal_generated`·`proposal_confirmed`·`proposal_expanded`. 작업 계획을 쓰면 일정 예측·자동 시작·검증 대기(`validation_*`)가 같이 돌므로 분리한다 |
| "A로 가면?" 예상 경로 + 미리보기 비교 | 없음 | **NEW** `context_branch_previewed`/`_preview_cleared` + `preview_rendered(source: branch)` |
| 결정→기능→화면→지표 펼침(D/F/S/V 칩) | 없음 | **NEW** 항목 upsert + `proposal_expanded` |
| 제작 도구 전달·진행(전달됨→제작 중→제작 완료→빌드 완료) | 작업 인계(`handoff_reviewed`, Agent 세션), 호스트 검증(`orchestrator/src/validation.ts`) | **NEW** `production_tool_linked`(seed), `tool_handoff_sent`, `tool_progress_reported`(시뮬레이션), `build_produced`. 작업·검증 경로와 섞지 않는다 |
| 오른쪽 모바일 앱 화면(Proposal·A 예상·예상 화면·v1.0·v1.1) | 없음 | **NEW** `preview_rendered.spec: AppPreviewSpec` → React로 다시 그림(이미지·base64 글꼴 없음) |
| 변경 카드 "변경 적용 · v1.1 / 되돌리기" | 계획 변경 결정 카드(작업용) | **NEW** `context_change_proposed`·`context_change_resolved`, `POST /api/context/changes/:id` |
| 시나리오 버튼·다음 발언·재시도/건너뛰기 | `scenario/start·next·retry·skip`, `runtime.ts`가 `continuousScenario`만 받음 | 재사용 + 시나리오 선택 UI(기반 커밋) + **NEW** 런타임의 대본 등록부(A) |
| 상단 Connect/Align/Deliver/Tuning, 채널 design·dev, CONTEXT/ARTIFACT REPOSITORY, "Figma 열기" | 없음 | **범위 밖**(장식). 필요하면 C가 비활성 표시만 |

## 3. 원장 계약 (기반 커밋: `packages/core/src/work-context.ts`)

### 3.1 데이터

- `ContextItem { itemId, key?, layer, title, status, note?, sourceMemberId, sourceMessageIds, derivedFrom?, supersededBy? }` — `layer`: intent·decision·feature·screen·metric·contribution. `sourceMemberId: "pm"`이면 PM이 채운 항목(덱의 E).
- `ContextEdge { edgeId, from, to, kind: supports|conflicts|derives|feeds, stale? }` — 끝점은 항목 id 또는 `tool:<toolId>`.
- `BranchOption { optionId("A"/"B"), title, gains[], risks[] }`, `PoolCandidate`, `ProductionToolId = figma|prompt-studio|dev-tools`, `AppPreviewSpec`(앱 이름·날짜·버전 칩·hero 카드·notice·포맷·지난 생성물·탭·annotations), `ContextCard`(채팅 카드, id만 담는다).

### 3.2 이벤트 22종 (`WorkContextEventPayloads`, `EventPayloads`가 확장)

| 이벤트 | 쓰는 쪽 | 뜻 |
|---|---|---|
| `context_session_started` | seed | WORK CONTEXT 켜짐(코드·제목·채널·버전 0.3) |
| `member_pool_listed` | seed | 시뮬레이션 pool 4명(적합 2 + 비적합 2: 바쁨·무관) |
| `production_tool_linked` | seed | 참여자가 연결해 둔 도구 3개 |
| `context_item_upserted` / `context_edge_upserted` | PM | id 기준 전체 교체 |
| `context_branch_opened` / `_previewed` / `_preview_cleared` / `_resolved` | PM | 분기 열기·예상 경로·걷기·확정(사람만) |
| `pool_search_recorded` / `pool_member_invited` | PM | 근거 부족 판단과 검색 결과·초대 |
| `member_joined`(source pool) | pool 시뮬레이션 | 합류 |
| `proposal_generated` / `_confirmed` / `_expanded` | PM | Proposal v1, 확정(사람만, 버전 이동), D/F/S/V 펼침 |
| `tool_handoff_sent` | PM | 연결된 도구에만, round 1/2 |
| `tool_progress_reported` / `build_produced` | 도구 시뮬레이션 | 진행·빌드(PM이 쓰지 않는다) |
| `preview_rendered` / `preview_withdrawn` | PM(proposal·branch·design), 도구(build) | 모바일 화면 데이터 |
| `context_change_proposed` / `_resolved` | PM / 사람 | v1.0→v1.1 변경 묶음, 적용·되돌리기 |
| `context_card_posted` | PM | `pm_spoke.messageId`에 카드 붙이기 |

리베이스로 바뀐 계약은 없다. `main`이 추가한 `validation_*` 이벤트·`DecisionOption.answerText`와 이름이 겹치지 않고, `EventPayloads extends WorkContextEventPayloads` 연결만 새 `events.ts`에 다시 얹었다.

### 3.3 projection 규칙 (`work-context-projection.ts`, `ProjectState.workContext`)

- `context_session_started` 전의 WORK CONTEXT 이벤트는 무시한다. 없는 id를 가리키는 참조는 버린다(분기 없는 미리보기, 연결 안 된 도구로의 전달 등).
- 분기 확정·Proposal 확정·변경 적용은 **사람 멤버**일 때만 반영한다(`decidedBy`·`confirmedBy`·`by`). 변경 묶음은 한 번만 닫힌다.
- 버전: 세션 버전 → `proposal_confirmed.contextVersion` → 적용된 `context_change.toVersion`.
- `currentPreview(wc, source?)`: 걷히지 않은 가장 최근 미리보기. 화면은 branch 미리보기를 비교 칸으로, 나머지 최신을 주 화면으로 쓴다.
- 새 이벤트는 `isAutomationAction`(자동 행동 12회 상한)에 넣지 않았다. 재전달 반복 위험은 A의 검증(같은 round 중복 거절)으로 막는다(§10).

### 3.4 PM 도구 계약 (`work-context-ops.ts`)

- 도구 이름 `update_work_context`, 입력 `WorkContextToolOutput { ops: WorkContextOp[]; speech: WorkContextSpeech[≤2]; reason }`. 비우면 침묵.
- op 13종: `upsert_item`, `upsert_edge`, `open_branch`, `preview_branch`, `clear_branch_preview`, `resolve_branch`, `search_pool`, `generate_proposal`, `confirm_proposal`, `expand_proposal`, `handoff_tools`, `withdraw_preview`, `propose_change`.
- facts `WorkContextFacts`(`work-context-facts.ts`의 `workContextFacts(state, trigger)`): 결정권자, 멤버, 최근 메시지 40개(PM 포함), 항목·연결·분기·pool·도구·전달·Proposal·빌드·변경 묶음, `basePreview`(모델이 화면을 지어내지 않고 고쳐 쓰게).
- trigger: 채널 메시지 또는 `member_joined`·`build_produced`·`tool_progress_reported`·`context_change_resolved`.
- 코드 검증(A 구현, `packages/core/src/work-context-apply.ts`): id 충돌·없는 항목 참조 거절, `resolve_branch.decidedBy`·`confirm_proposal.confirmedBy`는 sourceMessageIds 안에서 그 사람이 직접 말했어야 함(결정권자 규칙은 confirm만), `search_pool.candidateIds`는 listed·available·미초대만, `handoff_tools.toolId`는 linked만, 같은 round 재전달 거절. 형태 검사는 `orchestrator/src/op-validation.ts`의 `validCoordinationOp`처럼 순수 함수로 두고, 거절된 op만 버리고 이유를 `pm_considered.reason`에 남긴다(`coordination.ts` `prepareOps` 관례).

## 4. fake PM — 장면별 결정적 동작 (`ENSEMBLE_PM_RUNTIME=fake`)

`FakePmLlm`(`apps/web/lib/fake-connector.ts`)의 `update_work_context` case가 `apps/web/lib/fake-work-context-pm.ts`에 위임해 facts만 보고 규칙으로 답한다(모델 없음). 규칙은 **상태 + 짧은 정규식**이고, 출력은 golden ledger(`packages/scenarios/src/pages-v25/golden.ts`)와 같아야 한다. id는 `ids.ts`의 고정 id를 쓴다.

| # | 트리거(facts) | ops | speech·card |
|---|---|---|---|
| F03-1 | 결정권자 메시지 `/9시\|자동/`, 항목 없음 | I1(intent), D1(decision) + I1→D1 | 침묵 |
| F03-2 | `/버튼\|원할 때/`, D1 있음 | I2, D2(수동, conflict "D1과 충돌") + I2→D2, D1–D2 conflicts | 침묵 |
| F03-3 | `/4종\|매일\|비용/` | [기능] 4종 매일 동시 생성(violation "비용 한도") | 침묵 |
| F03-4 | Story Agent 메시지 | [기능] data + fiction 섞어 생성 | 침묵 |
| F03-5 | UI Agent 메시지 `/미정/` | [화면] 3탭(undecided "생성 버튼 위치") + 누락 4 | 10:45 ask(카드 없음) |
| F04-1 | PM ask 뒤 결정권자 `/네\|정리/`, 감지 항목 남음 | I2 갱신·I3(filled)·D1 merged(+흡수 supersededBy)·D2 branch·참여 항목 3·연결, `open_branch(A,B)` | summary + `branch_options` |
| F04-2 | 분기 열림, 분기 뒤 pool 아닌 사람 3명이 모두 말했고 아무도 A/B를 고르지 않음 | `search_pool`(분기 주제어 개인정보·fiction과 expertise가 겹치고 available인 후보 = 한지우·정유나) | fact 2개: `pm_steps(판단 중)` → `pool_candidates(searchId)` |
| F04-3 | pool 멤버 메시지 `/\b[AB]\b/` | 참여 항목(c-jiwoo/c-yuna) + →D2 | 침묵 |
| F04-4 | 결정권자 `/([AB])로? 확정/` | `resolve_branch`(evidence = 분기에 의견 낸 pool 멤버), `generate_proposal` + 미리보기 B | summary 2개: `pm_steps(생성 중)` → `proposal` |
| F04-5 | 결정권자 `/([AB])로 가면/`, 고른 것과 다른 선택지 | `preview_branch(A)` + 미리보기 A | answer + `branch_preview` |
| F05-1 | 결정권자 `/유지\|확정\|진행/`, Proposal generated | `clear_branch_preview`, `withdraw_preview(A)`, `confirm_proposal(1.0)`, `expand_proposal(D1 D2 F1–F4 S1 S2 V1 V2)` / `handoff_tools`(3) + 예상 화면 | 2개: summary + `expansion`, fact + `tool_handoffs` |
| F05-2 | trigger `build_produced` 1.0 | — | fact + `build` |
| F06-1 | pool 멤버 피드백 | — | 침묵 |
| F06-2 | 빌드 뒤 결정권자 `/라벨\|빼\|제외/` | F5 added·F2 excluded·S1 S2 stale·D1 D2 kept, `propose_change` | summary + `change_set` |
| F06-3 | trigger `context_change_resolved` applied | `handoff_tools` round 2(3) + 예상 화면 v1.1 | fact + `tool_handoffs` |
| F06-4 | trigger `build_produced` 1.1 | S1·S2 updated | fact + `build` |

시뮬레이션 통합(A, `apps/web/lib/fake-integrations.ts`): `pool_member_invited` → 짧은 지연 후 `member_joined(source pool)`(`PAGES_POOL_MEMBERS`). `tool_handoff_sent` → in_progress → done(개발 도구는 같은 round의 다른 도구가 끝난 뒤 시작) → 마지막에 같은 round의 최신 design 미리보기 spec으로 `preview_rendered(build)` + `build_produced`. 지연은 시나리오 모드 `SCENARIO_FAKE_AGENT_DELAY_MS`(2초, `runtime.ts`) 관례를 따른다. 쓰는 actor는 `system:pool`·`system:tools`.

## 5. 실제 모델 PM 확장 (api / codex / claude)

- 같은 도구·같은 검증: `workContextTool()`·`WORK_CONTEXT_SYSTEM_PROMPT`·`workContextUserMessage(facts)`(`packages/orchestrator/src/work-context-prompt.ts`, 기반 커밋은 느슨한 스키마). D가 op별 JSON Schema(`oneOf` + required)와 프롬프트를 완성한다. 미리보기 patch는 Q5를 따른다.
- 프롬프트 요점: 감지 4종의 정의와 예, "아무도 말하지 않았지만 필요한 것"을 missing으로, 사람이 분기를 못 정하고 팀 역량이 없으면 pool 검색, 확정은 사람 문장 인용(sourceMessageIds), 미리보기는 `basePreview`를 고친다, 말하기는 [PM 원칙](pm-principles.md)(행동을 바꾸는 말, 한두 문장, 질문은 1개).
- 실행 흐름(A): `ProjectManager.processRecordedMessage`(`orchestrator/src/pm.ts`)가 WORK CONTEXT 프로젝트의 메시지·트리거를 계획 조율(`Coordinator`, 계획 없음) 대신 `WorkContextPm.consider(trigger)`(신규 `orchestrator/src/work-context.ts`)로 보낸다 → `llm.complete({ forceTool: WORK_CONTEXT_TOOL })` → 검증 → 한 `store.transaction`에 `pm_considered`·WORK CONTEXT 이벤트·`pm_spoke`·`context_card_posted`. 판단 실패는 기존 `judgement_failed` 관례.
- 결정성은 fake만 보장한다. 실제 모델 회차는 **계약 적합성**(검증 통과, 권한 규칙, 카드 참조 무결성)과 장면 체크포인트의 **형태**(예: 03 끝에 충돌≥1·누락≥1, 04에 분기 1·pool 초대≥1)로만 평가한다.

## 6. 화면 계약과 배치 (기반 커밋: `apps/web/lib/work-context-view-model.ts`)

- `ViewModel.workContext?: VmWorkContext` — 있으면 화면이 **채팅 | WORK CONTEXT 캔버스 + LOG | 모바일 미리보기** 3열(`.workspace-context`, `app/globals.css`). 없으면 기존 2단(채널 + 작업 패널, work-model §6) 그대로.
- `VmWorkContext`: `code·title·channelName·versionLabel("v1.0 → v1.1")·stageLabel·summary(연결·충돌·위반·미정·누락 …)·items(supersededBy 제외)·edges·branches·log·preview·comparePreview(분기 A)·handoffs·proposal·changeSet·pool`.
- `VmMessage.contextCard?: VmContextCard` — 서버가 현재 상태로 풀어 준다(도구 진행이 같은 카드에서 바뀐다). `VmMember.pool?: true`.
- 조립: `buildViewModel`(`lib/build-view-model.ts`) → `buildWorkContext`(`lib/build-work-context.ts`, 접합부) → `buildContextCanvas`(B) + `buildContextCards`(C).
- 동작: 변경 카드 버튼 → `actions.resolveContextChange(id, outcome)`(`components/use-view-model.ts`) → `POST /api/context/changes/:id { me, outcome }`(라우트는 A).
- 좁은 화면(839px 이하): 탭 "채널 / 맥락 / 내 결정". 맥락 탭에서 캔버스 아래에 미리보기.
- 시각 규칙: `--ens-*` 토큰만, 상태 색은 `data-tone`(conflict/violation/undecided/missing/ok/branch/changed/stale/excluded/info)으로. 덱의 애니메이션은 [MOTION.md](../MOTION.md) 범위의 짧은 전환만, `prefers-reduced-motion` 존중.
- 모바일 미리보기는 `AppPreviewSpec`을 React로 그린다. 덱 HTML·이미지·base64 글꼴은 저장소에 넣지 않는다.

## 7. 대본 (`packages/scenarios/src/pages-v25/lines.ts`)

- 시나리오 키 `pages-v25`. seed: 팀 5명(김서연 결정권자, 박도윤, 이하준, Story Agent, UI Agent), goal(시연용), 세션, pool 4명, 도구 3개(`pagesSeedEvents`). 시계는 2026-10-02(금) KST(`PAGES_NOW`, `pagesAt`).
- `PAGES_LINES` 17줄 — 덱 원문 16줄 + Q2의 1줄(장면 04 시작 전 김서연 "네, 채워 넣고 순서대로 정리해 주세요.", PM의 10:45 질문에 대한 답).
- `PAGES_STEPS` 18단계: `say`와 `applyChange`(장면 06에서 결정권자가 변경 카드의 "변경 적용"을 누름). 대기 조건 `WorkContextCondition`: `pmSpokeAfter`·`memberJoined`·`branchOpen`·`branchPreviewed`·`proposalStatus`·`buildProduced`·`changeSetProposed`·`all`. 완료 = `buildProduced 1.1`.
- **대본 한계(Q1)**: Agent 두 줄(장면 03)은 실행기가 `message_recorded`(actor `system:scenario`, authorId = Agent)로 쓴다. 현재 `advanceScript`(`script.ts`)는 사람만 허용하므로 A가 Pages용 분기를 넣는다. 대본에 PM 출력은 없다.
- 현재 `script.ts`의 조건부 줄(`isConditionalStep`·`conditionalLineDue`)은 기존 대본용이다. Pages 대본은 조건부 줄 없이 대기 조건으로만 진행한다.
- 덱 시각(10:02…16:14)은 golden에만 쓴다. 라이브 회차는 실제 시계를 쓴다(기존 관례). 시나리오 바의 "다음 발언"은 `PagesStep.text`.

## 8. 검사 계획

현재 정책은 [핵심 회귀 검사](qa/essential-regressions.md): `app/test/essential-*.test.ts`만 `npm test`(Node 내장 test runner, 10초 제한)로 돈다. 위험 기준 목록이며 helper별·시각 스냅샷 검사로 늘리지 않는다. 타입 검사와 웹 빌드는 따로 돈다. 자동 검사는 실제 모델 판단 품질이나 브라우저 배치를 증명하지 않는다.

| 층 | 사례 | 위치 |
|---|---|---|
| 기반(통과) | 사람만 분기·Proposal·변경 묶음을 닫는다(Agent·없는 선택지 거절, 세션 전 이벤트 무시, 한 번만 닫힘) | `test/essential-pages-v25.test.ts` |
| 기반(통과) | golden이 장면 03–06을 재현, 대본 = 사람 + Q1 예외 2줄(actor `system:scenario`), 카드·참조 무결성 | 같은 파일 |
| 기반(통과) | 화면 모델: WORK CONTEXT가 있을 때만 노출, 카드 해석, pool 배지, A/B 비교, 변경 버튼은 결정권자만, v1.1 노래 없음 | 같은 파일 (`test/pages-v25-fixture.ts` 사용) |
| A | fake 런타임(`WebRuntime` + `FakePmLlm` + fake 통합)으로 `pages-v25`를 끝까지 재생 → 정규화한 WorkContext = golden `s06_built`; op 검증이 권한·pool·도구·같은 round 중복을 거절; 기존 `scene-1-3` 시작 경로 유지 | `test/essential-pages-v25-runtime.test.ts`(신규, 2~3 사례) |
| B·C | 새 자동 검사 파일 없음. `npm run typecheck`·`npm run build` + [QA 안내](qa/README.md)의 실제 앱 브라우저 확인(PM·Agent fake, 별도 `ENSEMBLE_DATA_DIR`)으로 체크포인트 화면 확인. 위험 사례가 필요하면 coordinator 승인 후 추가 | — |
| D | 녹화한 모델 출력 fixture가 A의 검증을 통과(1 사례). live 실행은 수동, 기본 검사 아님 | `test/essential-pages-v25-model.test.ts`(신규), `packages/orchestrator/scripts/live-pages-v25.ts`(신규) |

기준선(2026-10-06): 리베이스 후 이 브랜치에서 `npm test` 21/21(기존 18 + 신규 3), `npm run typecheck`·`npm run build` 통과. 리베이스 전 vitest 시절의 무작위 5초 타임아웃은 `main`이 그 테스트들을 제거하면서 사라졌다.

## 9. 작업 분할 — 병렬 4개, 파일 소유 겹치지 않음

**고정 계약(기반 커밋, 바꿀 때는 coordinator 경유)**: `packages/core/src/work-context.ts`, `packages/core/src/work-context-ops.ts`, `packages/core/src/events.ts`·`projection.ts`·`index.ts`의 WORK CONTEXT 연결부, `packages/scenarios/src/pages-v25/ids.ts`, `packages/scenarios/src/index.ts`의 export 한 줄, `apps/web/lib/work-context-view-model.ts`, `apps/web/lib/build-work-context.ts`, `apps/web/lib/view-model.ts`·`build-view-model.ts`의 연결부, `apps/web/components/App.tsx`, `apps/web/components/Message.tsx`, `apps/web/components/use-view-model.ts`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `test/essential-pages-v25.test.ts`, `test/pages-v25-fixture.ts`. golden(`pages-v25/golden.ts`·`fixtures.ts`·`lines.ts`)은 A 소유지만 체크포인트 결과를 바꾸면 기반 검사와 B·C 화면이 바뀌므로 coordinator에 먼저 알린다.

**병합 주의**: 기반 커밋만 `main`에 넣으면 시나리오 선택에 "Pages v2.5"가 보이지만 런타임이 아직 거절한다. 기반은 A와 함께 병합한다.

### A — 런타임·PM 루프·fake 결정성·대본·시뮬레이션
- 소유: `packages/core/src/work-context-projection.ts`, `packages/core/src/work-context-apply.ts`(신규); `packages/orchestrator/src/work-context.ts`(신규, `WorkContextPm`), `packages/orchestrator/src/pm.ts`(연결만), `packages/orchestrator/src/index.ts`의 A export 줄; `packages/scenarios/src/pages-v25/{golden,fixtures,lines,index}.ts`, `packages/scenarios/src/script.ts`; `apps/web/lib/runtime.ts`, `apps/web/app/api/[...path]/route.ts`, `apps/web/lib/fake-connector.ts`(위임 한 줄), `apps/web/lib/fake-work-context-pm.ts`(신규), `apps/web/lib/fake-integrations.ts`(신규); `test/essential-pages-v25-runtime.test.ts`(신규); 문서 `app/demo/runtime/README.md`(Pages 시나리오 안내), `docs/qa/essential-regressions.md`(A·D 행과 개수), `docs/work-model.md`(구현 후 현행 설명).
- 소비 계약: §3 이벤트·op·facts, `workContextTool()`·`WORK_CONTEXT_SYSTEM_PROMPT`(D 파일 import만), `PAGES_STEPS`·`PAGES_COMPLETION`.
- 수용 기준: `startScenario('pages-v25')` → 다음 발언 반복으로 끝까지 진행, fake 회차의 정규화 WorkContext = golden `s06_built`; `scene-1-3` 시작 경로 그대로; `POST /api/context/changes/:id`(결정권자만, 1회); 시나리오 바 장면 표기 03–06; `npm test`·`typecheck`·`build` 통과.

### B — WORK CONTEXT 캔버스·LOG
- 소유: `apps/web/components/context/ContextPane.tsx`, `apps/web/components/context/canvas/**`(신규), `apps/web/lib/build-context-canvas.ts`, `apps/web/lib/context-log.ts`(신규), `apps/web/app/work-context.css`.
- 소비 계약: `VmWorkContext`의 summary·items·edges·branches·log·versionLabel·stageLabel, golden 체크포인트(`test/pages-v25-fixture.ts`의 `pagesViewModel`).
- 수용 기준: 체크포인트별로 덱과 같은 열·노드·상태 칩·연결 수, 흡수 항목 숨김, 분기 노드 A/B와 선택·예상 표시, LOG가 덱 문장 형식("10:45 누락 · …")·최신 위, 좁은 화면에서 가로 스크롤 없음, 내부 id 비노출, 기반 검사 유지.

### C — 채팅 카드·pool·Proposal·제작 도구·모바일 미리보기
- 소유: `apps/web/components/context/{ContextMessageCard,PreviewPane,MobilePreview}.tsx`, `apps/web/components/context/cards/**`(신규), `apps/web/components/Members.tsx`(POOL 배지·"+N POOL"), `apps/web/lib/build-context-cards.ts`, `apps/web/lib/mock-view-model.ts`(선택: `?mock` Pages 변형), `apps/web/app/pages-preview.css`.
- 소비 계약: `VmContextCard` 9종, `VmWorkContext`의 preview·comparePreview·handoffs·proposal·changeSet·pool, `actions.resolveContextChange`(연결됨), `AppPreviewSpec`.
- 수용 기준: 카드 9종이 덱 모양으로 그려짐, 도구 진행 라벨이 제자리에서 바뀜, A/B 미리보기 나란히(실명·검수 대기 표시), v1.0/v1.1 차이(라벨·노래 없음), 변경 카드 버튼은 결정권자에게만, 미리보기는 데이터만으로 그림(이미지·내장 글꼴 없음), 기반 검사 유지.

### D — 실제 모델 PM 프롬프트·도구
- 소유: `packages/orchestrator/src/work-context-prompt.ts`, `packages/core/src/work-context-facts.ts`(facts 보강, `WorkContextFacts` 모양 유지), `packages/orchestrator/scripts/live-pages-v25.ts`(신규), `test/essential-pages-v25-model.test.ts`(신규), `test/fixtures/pages-v25-model-*.json`(신규).
- 소비 계약: `WorkContextToolOutput`·`WorkContextOp`·`WorkContextFacts`, A의 검증 함수(합류 후 fixture 검증), Q5.
- 수용 기준: op 13종을 덮는 스키마, 프롬프트가 감지 4종·권한·pool·도구·미리보기 규칙을 담음, 녹화 출력 fixture가 A 검증을 통과, `ENSEMBLE_PM_RUNTIME=codex`(또는 api)로 live 스크립트가 장면 03 형태 기준을 만족(수동 실행, 결과는 QA 안내의 결과 관리 규칙대로 저장소 밖에).

의존 순서: B·C·D는 기반 커밋만으로 바로 시작한다(golden 체크포인트로 화면·프롬프트 개발). A가 끝나면 실제 앱 브라우저 확인으로 B·C 화면을 보고, D의 fixture 검증을 켠다.

## 10. 열린 위험

1. **자동 행동 상한**: WORK CONTEXT 이벤트는 상한에 세지 않는다. 실제 모델이 재전달을 반복하는 위험은 A의 검증(같은 round 중복 거절)으로 막는다.
2. **실제 모델의 미리보기 spec**: 전체 `AppPreviewSpec`은 토큰이 크다. Q5대로 D가 patch를 검토하되 계약이 바뀌면 먼저 묻는다.
3. **분기와 결정 카드의 이원화**(Q3): "내 결정" 탭과 분리된다. 나중에 합치려면 `DecisionRequestKind`에 `context_branch`를 넣는 길이 있다.
4. 상단 단계 탭·채널 design/dev·REPOSITORY·"Figma 열기"는 장식으로 범위 밖.
