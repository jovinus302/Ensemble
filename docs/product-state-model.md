# Ensemble Product State 모델 (정본)

상태: Phase 0 확정 전제 및 설계안. 2026-09-28. 개념 배경은 `docs/structured-product-state.md`, Ensemble의 제품 의도는 `intent.md` 참조.

> **용어 표기 안내**: 이 문서에서 팀이 만들고 있는 대상은 **대상 제품**(Product State의 주체)이라 부른다. 모든 `product`/`product_id` 식별자는 `target_product`/`target_product_id`로 표기한다(`can_decide(target_product, user, kind)`, `computeGap(target_product)`, `project.target_product_id` 등). Ensemble 자신은 항상 "Ensemble"로 쓰고 "제품" 한 단어로 Ensemble을 가리키지 않는다. "Product State"는 "대상 제품의 상태"로 정의한다. `intent.md`의 "AI PM", "Agent/실행 Agent", "사람/사용자" 용어는 이 문서에서도 같은 의미로 쓴다. 이 문서의 "결정권자"는 intent.md의 "사용자"에 해당하는, 대상 제품에 대한 결정 권한을 가진 역할이다(MVP는 1인).

## 0. 확정 전제

1. Product State는 `target_product` 단위로 소유한다. Project State(태스크)는 `project` 단위다. MVP는 `target_product:project` = 1:1이다.
2. 정본은 DB 엔티티와 이벤트 원장이다. 채팅 추출과 구조화 패널은 같은 원장을 거쳐서만 쓴다.
3. 채팅 발언은 후보로만 기록한다. 결정 확정은 결정권자(대상 제품 소유자; intent.md의 "사용자"에 해당하는 역할. MVP에서는 1인, `can_decide(target_product, user, kind)`로 판정)의 확인 카드, 또는 PM이 선택지로 요청한 결정에 대한 결정권자의 직접 답변(solicited)으로만 이루어진다. 두 경우 모두 undo를 제공한다.
4. 에이전트의 완료 보고는 claim이다. 태스크는 `reported_done`까지만 올린다. 인수 조건이 `passed`가 되려면 system-attested 증거나 사람 승인이 필요하고, 에이전트만의 검증은 `agent_verified`(참고용)로 둔다.
5. gap과 충족 판정은 결정적 코드(`computeGap`)가 한다. 목표 달성에는 결정권자의 명시적 승인이 필요하다.
6. AI PM은 결정권자가 승인한 계획(`plan`) 안에서는 사람의 재승인 없이 후속 작업 전달·수정 요청·재개·인계를 진행한다(`dispatch: within_plan`). 계획에 없는 새 태스크, 담당자 교체, 결정 변경 후 `impacted` 처리, 범위 변경, 외부 공개·비용 발생·되돌리기 어려운 행동은 결정권자 확인을 받는다.
7. Ensemble은 코드와 테스트 실행을 호스팅하지 않는다. 외부 실행 결과를 출처(`attested_by`), 요구사항 버전, (소프트웨어 대상 제품인 경우) 코드 revision·환경과 함께 기록·판정한다.
8. `docs/structured-product-state.md`(codex 브랜치)는 개념 배경이다. enum과 규칙의 정본은 이 문서다.
9. 후속 작업의 트리거는 태스크 `checked`(PM의 인계 조건 확인)이고, 대상 제품 상태의 `passed`는 증거 규칙(전제 4)으로만 정해진다. 작업 흐름은 PM이 판단하고, 제품 상태는 증거가 판정한다.

## 1. 개념 정의

- Product State = 대상 제품의 목표·현재 상태·결정을 유지하는 구조. 사람과 AI Agent가 "무엇을 만들기로 했고, 어디까지 만들어졌고, 무엇이 미해결인지" 공유하는 기준이다.
- Product State("대상 제품이 어떤 상태인가") vs Project State("일이 어떤 상태인가"). 예: "검색 구현을 Agent A가 진행 중"은 Project State이고, "PDF 키워드 검색은 동작하지만 의미 검색은 미검증"은 Product State다. **태스크가 모두 완료돼도 대상 제품이 목표 상태에 도달한 것은 아닐 수 있다.**
- 4대 구성
  - **목표 상태**: 누구의 어떤 문제, 제공해야 할 동작, 완료 조건
  - **현재 상태**: 구현 여부와 검증 여부를 구분하며, 미확인을 사실로 취급하지 않는다
  - **결정과 제약**: 무엇을 왜 선택했는지, 지켜야 할 조건, 제외 범위, 변경 이유·영향 추적
  - **증거와 미확인 사항**: 테스트·실행 결과·산출물·관찰을 연결하고, 미검증 가정·미해결 질문을 남긴다
- 파일 검색 대상 제품 예시
  - 목표: "정확한 표현을 기억하지 못해도 자연어로 가져온 문서를 찾는다"
  - 현재: "PDF 가져오기·키워드 검색 동작, 의미 검색 미검증"
  - 결정: "이번 버전은 직접 가져온 파일만, 휴대폰 전체 색인 제외"
  - 증거: "PDF 가져오기 테스트 통과, 대표 자연어 질문 정확도 확인 필요"
- 설계 원칙
  1. gap·충족 판정은 LLM이 아닌 코드가 한다.
  2. 채팅 발언은 확정 상태가 아니라 후보로만 유입된다.
  3. 완료 보고는 `reported_done`까지만 올리고, 검증 증거가 붙어야 현재 상태가 바뀐다.

## 2. 데이터 모델

모든 `ps_*` 엔티티는 `target_product_id`로 범위를 정하고, `task`는 `project_id`로 범위를 정한다(`project.target_product_id` 참조). 쓰기는 서버 RPC와 도메인 서비스로만 허용한다(RLS + security definer 쓰기 방식).

### 2.1 목표 측

- `ps_goal`: `id`, `target_product_id`, `problem`(누구의 어떤 문제), `outcome`, `status`(`proposed | active | superseded | dropped`), `version`, `accepted_by`, `accepted_at`
- `ps_requirement`: `id`, `goal_id`, `behavior`(제공해야 할 동작), `status`(`proposed | accepted | excluded | superseded`), `version`, `origin_decision_id`
- `ps_criterion` (인수 조건, **gap 계산의 최소 단위**): `id`, `requirement_id`, `text`, `verify_method`(`automated_test | agent_check | human_review | observation`), `required_evidence_kinds[]`, `version`

### 2.2 결정·제약

- `ps_decision`: `id`, `target_product_id`, `kind`(`scope_in | scope_out | constraint | choice`), `statement`, `rationale`, `status`(`proposed | confirmed | revoked | superseded`), `proposed_by`, `confirmed_by`, `confirmed_at`, `supersedes_id`, `source_message_id`
- `ps_decision_link`: `decision_id` → `requirement_id` 또는 `criterion_id` (영향 추적의 근거)

### 2.3 현재 상태 측 (증거 기반)

- `ps_claim` (자기보고): `id`, `criterion_id`(또는 `requirement_id`), `claim`(`done | partial | not_done`, `done` = 담당자가 산출했다고 보고함), `actor`(`agent | human`), `task_id`, `source_message_id`, `evidence_refs[]`, `created_at`. 사람·Agent 담당자가 올린 산출물 참조는 `ps_claim.evidence_refs[]`에 담는다. 담당자의 제출은 `ps_evidence`를 만들지 않는다. **이것만으로는 검증 상태가 절대 바뀌지 않는다.**
- `ps_evidence`: `id`, `criterion_id`, `kind`(`test_run | browser_check | artifact | user_observation | log`), `ref`(run id / url / message id / attachment), `result`(`pass | fail | inconclusive`), `attested_by`(`ci_integration | connected_runner | human | agent_claim`), `produced_by`, `recorded_by`, `criterion_version`, `requirement_version`, `code_revision`, `environment`, `captured_at`, `task_id`, `invalidated_at`
- `ps_open_item`: `id`, `target_product_id`, `kind`(`assumption | question | risk`), `text`, `links`(criterion/decision), `status`(`open | resolved`), `resolved_by`(decision_id 또는 evidence_id)

### 2.4 원장과 분류

- `ps_event` (append-only 원장): `id`, `target_product_id`, `type`(`goal_changed, requirement_accepted, decision_proposed, decision_confirmed, decision_superseded, claim_recorded, evidence_recorded, evidence_invalidated, open_item_opened, open_item_resolved` 등), `actor`, `payload`, `source_message_id`, `created_at`. "왜 바뀌었나"와 "변경의 영향"은 이 원장에서 거슬러 올라가 찾는다. 현재 상태는 원장에서 계산한 투영(projection)이며, MVP에서는 뷰 또는 동기 갱신 테이블로 단순화한다.
- `ps_intake` (발언 분류 후보): `message_id`, `target_product_id`(채널→project→target_product로 도출해 저장), `class`(`proposal | decision | completion_report | verification_result | question | other`), `confidence`, `extracted`(jsonb), `author_authority`(bool), `status`(`pending | applied | rejected | auto_logged`), `applied_event_id`

### 2.5 Project State와의 연결

- `plan`: `id`, `project_id`, `version`, `status`(`proposed | approved | superseded`), `approved_by`, `approved_at`, `ps_snapshot`. "승인된 계획"이란 `plan`의 `approved` 버전을 뜻한다. 구성: 태스크 집합(담당자, `depends_on[]`, `task_target`), 팀 구성, 승인 시점 Product State 버전 스냅샷.
- `task` (Project State): `id`, `project_id`, `plan_id`, `depends_on[]`(선행 태스크 id 또는 결정 대기 질문(`ps_open_item`, kind=question) id. 태스크는 `checked` 이상일 때, 질문은 `resolved`일 때 충족), `handoff_conditions`(인계 조건: 필요한 산출물, 필요한 증거 kind의 존재), 상태 `queued | running | blocked | reported_done | checked | accepted | cancelled | impacted`, `assignee`, `ps_snapshot`(배정 시점의 criterion·requirement version map)
- `task_target`: `task_id` ↔ `criterion_id`. 태스크의 "완료 조건"은 자유 텍스트가 아니라 이 링크와 criterion의 `required_evidence_kinds`에서 만든다.
- 프로젝트 정책: `dispatch: manual | within_plan | within_plan_plus_low_risk_new` (MVP는 `within_plan`. 마지막 값은 Phase 3 후보)

**태스크 전이 규칙**

- `task_target`이 "열린" 것으로 계산에 포함되는 상태는 `accepted`·`cancelled`를 제외한 모든 상태다(§2.6 `computeGap` 참조).
- `reported_done → checked`: PM이 결과물을 `handoff_conditions`와 대조해 충족 여부를 판정하고 사유를 원장에 기록한다. 충족되지 않으면 `running`으로 되돌아가고, 같은 담당자에게 무엇이 빠졌는지 구체적인 수정 요청을 자동으로 전달한다(intent.md §7 "결과가 부족하면 수정 요청"에 대응).
- `checked` 판정 시, `depends_on`이 모두 충족된(§2.5 정의) 상태의 대기 태스크를 자동으로 시작한다(`dispatch: within_plan`).
- `checked → accepted`: 대상 criterion이 모두 `passed`가 될 때(§2.6). `reported_done`뿐 아니라 이미 `checked`인 태스크의 대상 criterion에 `failed` 증거가 새로 기록되면 해당 태스크는 `running`으로 되돌아간다.
- `blocked` 태스크는 막힘의 원인이 된 결정·정보가 원장(`ps_event`)에 기록되는 시점에 `running`으로 재개된다.

### 2.6 파생 규칙 (코드, 결정적)

criterion 검증 상태: 판정은 `attested_by`가 `ci_integration`/`connected_runner`/`human`인 유효 증거 중 `captured_at`이 가장 최신인 것을 기준으로 한다. `attested_by = agent_claim` 증거는 `passed`/`failed` 판정에 쓰지 않고 부속 표시 `agent_verified`에만 쓴다.

| 상태 | 조건 |
| --- | --- |
| `passed` | 유효한 증거(invalidated 아님, criterion_version·requirement_version이 현재와 같음, required kind 충족)가 있고, `attested_by`가 `ci_integration`/`connected_runner`(system-attested) 또는 `human`(사람 승인)일 때 |
| `failed` | 최신 유효(판정 대상) 증거가 `fail` |
| `stale` | 증거는 있지만 현재 버전과 맞지 않음 |
| `unverified` | 증거 없음 |

`reported`와 `agent_verified`는 위 표의 별도 상태가 아니라 `unverified`의 부속 표시다: `unverified`인데 `ps_claim`이 있으면 `reported`, `attested_by = agent_claim`인 pass 증거만 있으면 `agent_verified`로 표시한다. 둘 다 `passed`로 치지 않는다.

- `produced_by`는 증거를 실제로 실행·생산한 주체다. `ci_integration`은 CI 시스템이 생산 주체이므로 구현 에이전트의 커밋에서 트리거됐어도 system-attested로 인정한다. `connected_runner`는 구현 에이전트 자신이 실행한 경우 system-attested로 인정하지 않고 `agent_claim`으로 강등한다(구현자와 증거 생산자 분리). 테스트 내용 자체의 적절성은 criterion의 `verify_method`·`required_evidence_kinds`와 사람 검토가 담당한다.
- `attested_by = human` 증거는 §5의 검증 승인 권한자가 검증 승인 카드로 기록할 때만 생성된다(`recorded_by` = 승인자, `produced_by` = 산출물 담당자). 담당자 본인의 업로드·완료 보고는 claim이다.
- requirement 충족 = criterion이 1개 이상 있고, 그 모두가 `passed`. criterion이 하나도 없는 `accepted` requirement는 충족으로 보지 않는다.
- goal 달성 = 모든 `accepted` requirement 충족 **+ 결정권자의 goal 승인 이벤트**
- 따라서 "태스크가 전부 `accepted`여도 goal 미달성"이 자연스럽게 표현된다.
- `computeGap(target_product)`: `passed`가 아닌 criterion 집합에서 이미 "열린" `task_target`이 겨냥한 criterion을 뺀 집합. "열린" task_target은 `accepted`·`cancelled`가 아닌 상태의 태스크가 가진 링크로 정의한다(§2.5 태스크 전이 규칙 참조). gap 중 승인된 계획의 `task_target`으로 덮인 것은 계획대로 진행하고, 덮이지 않은 gap만 계획 수정안의 후보가 된다. 순수 함수이며 단위 테스트 대상.

### 2.7 설계 선택과 트레이드오프

- **별도 도메인**(작업 테이블 확장 대신): 목표·결정·증거는 태스크보다 오래 살고 여러 태스크에 걸친다. 자유 텍스트 완료 기준 확장으로는 버전 관리·증거 만료·영향 분석이 불가능하다. 대신 초기 스키마가 커지고(약 9개 테이블) 태스크 생성 시 "어느 인수 조건을 겨냥하나" 입력 부담이 생긴다 → PM이 링크 초안을 채워 완화.
- **원장+투영**(단순 CRUD 대신): 결정 변경 이력과 근거 추적이 요구사항 자체이기 때문. 구현 복잡도 증가는 MVP에서 투영 단순화로 완화.
- **대상 제품 단위 소유**(프로젝트 단위 대신): Product State는 작업보다 오래 사는 기준이라 v1 프로젝트의 목표·결정·증거가 v2의 출발점이어야 한다. 되돌리기 비용이 비대칭(대상 제품 키→프로젝트 키로 접기는 거의 무료, 반대는 모든 FK·원장·권한·증거 바인딩 이관). MVP는 1:1 강제, UI에 드러내지 않음. 여러 프로젝트가 한 대상 제품을 동시 변경할 때의 동시성·권한 충돌은 **미결**(Phase 2 이후).

## 3. 대화 → Product State 반영 파이프라인

삽입 위치: 메시지 저장 직후의 비동기 소비자. 에이전트 실행 큐와 분리해 응답 지연에 영향을 주지 않는다. "전량 일지 적재" 대신 "분류 → 후보 원장".

1. **입력 경로 두 개**
   - (a) 구조화 경로(신뢰도 높음): 에이전트는 자유 텍스트 마커 대신 도구로 보고한다. `report_result{task_id, claims[], evidence[], open_questions[]}`, `attach_evidence`, `propose_decision`, `raise_question`.
   - (b) 자유 발언 경로(신뢰도 낮음): 사람과 에이전트의 채널 메시지.
2. **자유 발언 분류**: 정규식 프리필터 → 도구를 쓸 수 없는 readOnly 원샷 LLM 분류(프롬프트 인젝션으로 상태를 쓰는 경로 차단). 결과는 `ps_intake`에만 기록.
3. **유형별 적용 정책 (MVP)**

   | 유형 | 처리 |
   | --- | --- |
   | 제안 ("전체 파일 검색도 해볼까?"; 첫 사이클 예: "인터뷰를 더 늘려 볼까?") | `auto_logged`. `ps_open_item(question)` 또는 `ps_decision(proposed)`로 조용히 기록. 확정 범위·gap에 영향 없음 |
   | 결정 ("이번에는 가져온 파일만 지원하자"; 첫 사이클 예: PM 질문에 대한 "①로 가자" — solicited) | 작성자가 결정권자면 "결정으로 기록할까요?" 인라인 카드 → 1클릭 확정. 결정권자가 아니면 `proposed`로 두고 결정권자에게 확인 요청을 모아서 보냄. PM이 결정권자에게 선택지로 요청한 결정(solicited)에 결정권자가 답하면 카드 없이 `confirmed`로 기록하고 undo를 제공하며 채널에 "기록했습니다"를 알린다. 확인 카드는 PM이 묻지 않았는데 나온 결정성 발언에만 쓴다 |
   | 완료 보고 ("검색 구현을 완료했습니다"; 첫 사이클 예: "사용 흐름 초안 올렸어요") | `ps_claim` 생성, 태스크 `reported_done`. **검증 상태는 그대로** |
   | 검증 결과 ("대표 사례를 실행했고 기준을 충족했습니다"; 첫 사이클 예: 사용자가 검증 승인 카드에서 승인) | 근거 참조(실행 로그·첨부·테스트 run)가 있을 때만 `ps_evidence` 후보. 검증 권한자 확인 후 반영. 근거 없는 "통과했습니다"는 claim으로 강등 |

4. **결정 권한 판정은 코드가 한다**: `can_decide(target_product, user, kind)`. MVP는 결정권자 1인. LLM은 "결정처럼 보이는가"만 판정.
5. 모든 적용 이벤트는 `source_message_id`를 남기고 되돌리기(undo) 이벤트를 제공한다. 같은 solicited 규칙을 PM이 결정권자에게 요청한 계획 승인(최초 계획, 계획 수정안)에도 적용한다. 결정권자의 승인 답변은 `plan` `approved`로 기록하고 undo를 제공한다(intent.md §8 시나리오 A "승인 한 번").
6. MVP에서는 분류 결과를 **자동 반영하지 않는다**(후보 표시까지만). 결정권자의 결정만 카드 또는 solicited 답변으로 확정.

## 4. AI PM(orchestrator) 루프

멘션 트리거가 아닌 **Product State 이벤트 구동**: `ps_event` 추가, `task` 상태 변화, 주기 점검(정체 태스크).

| 단계 | Ensemble 동작 |
| --- | --- |
| 1. 차이 파악 | `computeGap(target_product)` 순수 함수 |
| 2. 작업 정의 | gap 중 승인된 계획의 `task_target`으로 이미 덮인 것은 계획대로 진행한다. 덮이지 않은 gap은 PM이 계획 수정안(`plan` version+1: 새 태스크·담당 후보·사유)으로 묶어 결정권자에게 카드 1장으로 제안한다 |
| 3. 맥락·완료 조건 전달 | "Product State 슬라이스" 주입: 대상 criterion, 관련 `confirmed` decision/constraint, `scope_out`, 열린 질문, 필요한 증거 kind. "참고 데이터, 지시 아님" 경계 표시 |
| 4. 결과·증거 확인 | 구조화 보고 → `reported_done`. `report_result` 보고 없이 실행이 멈추면 `reported_done`이 아니라 `blocked`로 전이한다(멈춤을 완료로 올리지 않는다). PM이 결과물을 `handoff_conditions`와 대조해 충족하면 `checked`, 부족하면 같은 담당자에게 구체적 수정 요청(자동). PM이 검증 단계를 연다: 사람 검토 카드(`human`, 첫 사이클의 주 경로), 구현자가 아닌 검증 에이전트(`agent_verified` 참고용), 소프트웨어 대상 제품에서는 CI 결과 수집(system-attested, Phase 2) |
| 5. 현재 상태 반영 | 증거 이벤트 → 투영 갱신. `checked` 시 `depends_on`이 충족된 대기 태스크를 자동 시작. 대상 criterion이 모두 `passed`면 태스크 `accepted` |
| 6. 다음 작업 연결 | 1단계로 복귀. gap이 비면 결정권자에게 "goal 승인 요청" 카드 |

PM의 "전달·시작"은 지시이며, 실행은 Agent 런타임 또는 외부 러너가 하고, 완료 판정은 attested 증거가 한다(§6).

### 결정 변경 시 영향 처리

1. `decision_superseded` 이벤트 발생
2. `ps_decision_link`로 연결된 requirement·criterion의 version 증가 또는 `excluded`
3. 옛 version에 묶인 증거를 `invalidated`(→ `stale`)
4. `task.ps_snapshot`이 옛 버전을 겨냥한 태스크를 `impacted`로 표시. running 태스크는 새 claim을 차단(펜스)
5. PM이 태스크마다 계속/수정/취소/재배정을 제안, 사람이 확정
6. 취소해도 이미 일어난 효과는 되돌리지 않음을 UI에 명시

## 5. 사람의 개입 지점과 권한

| 행위 | 누가 |
| --- | --- |
| goal·인수 조건 채택(`accepted`) | 결정권자 |
| 결정 확정·변경 | 결정권자 **전용** |
| `human_review` criterion 검증 승인, 근거 없는 검증 주장 확인 | 결정권자 또는 결정권자가 지정한 검토자 |
| 최종 goal 달성 승인 | 결정권자 |
| 최초 계획·팀 구성 승인, 계획 수정안 승인(계획 승인 카드 또는 PM 요청에 대한 직접 답변) | 결정권자 |
| 자기 일정·배정 조정 | 해당 사람 담당자(intent.md §7-4) |
| `impacted` 태스크 처리 확정 | 결정권자 |
| 분류 오류 되돌리기 | 결정권자 또는 검토자 |

사람 개입 없이 처리: 제안 기록, 완료 보고 기록, system-attested 증거 반영, 계획 안의 후속 작업 전달·수정 요청·재개·인계, `checked` 판정. 확인 요청은 다이제스트로 묶는다.

## 6. 증거 출처와 검증 실행 환경

- Ensemble은 실행을 호스팅하지 않고 **증거 수집·판정자**로 동작한다. 실행은 외부(CI, 사용자 쪽에 연결된 러너)가 한다.
- `attested_by` 등급: `ci_integration`(Ensemble이 CI API에서 직접 가져온 결과, 예: GitHub Actions check run + 커밋 SHA → `code_revision` 자동 채움), `connected_runner`, `human`, `agent_claim`(에이전트가 붙여 넣은 로그 텍스트 등).
- 첫 사이클 적용(intent.md §8 "고객 반응 확인"): 증거의 대부분은 사람과 Agent가 올린 산출물이다(`kind: artifact` — 인터뷰 기록, 경쟁사 조사 보고서, 사용 흐름 초안, 프로토타입 링크·파일). 고객 반응 관찰은 `kind: user_observation`으로 기록한다. 판정 대상 증거는 모두 `attested_by: human`이며, §5의 검증 승인 권한자(결정권자 또는 지정 검토자)가 검증 승인 카드로 기록한 것만 해당한다. 담당자가 산출물을 올린 것 자체는 증거가 아니라 claim이다(§2.6). 첫 사이클에는 CI 연동이 없으며 Phase 2에서 붙인다.
- 소프트웨어 대상 제품에서의 예: 테스트는 CI check run 수집으로 자동 `passed`(`ci_integration`), 사람의 판단이 필요한 품질 기준은 평가 결과 첨부와 사람 승인으로 처리한다.
- 나중에 호스팅 실행기를 붙이면 `attested_by` 값 하나가 늘어난다.

## 7. 단계적 도입

- **Phase 0 (이 문서)**: 사양 확정. codex 문서 병합(개념 배경), 본 문서 작성.
- **Phase 1 MVP (첫 사이클: intent.md §8 "고객 반응 확인", 한 대상 제품)**
  - 범위(intent.md §9 In Scope): 채널 1개, 사람 2명(사용자 = 결정권자, 디자이너), 실행 Agent 2개(경쟁사 조사 Agent, 프로토타입 제작 Agent), AI PM 1개. 팀은 역할 템플릿으로 구성한다. 계획은 결정권자가 승인한 뒤에 시작하고, 이후 후속 작업은 `dispatch: within_plan`으로 진행한다.
  - 데이터: `ps_*` 전체 테이블과 `plan`/`task`/`task_target` 마이그레이션
  - 모듈(경로는 제안): `product-state/ledger`(이벤트 쓰기·투영); `product-state/gap`(`computeGap` + 단위 테스트); `product-state/intake`(첫 사이클에서는 완료 보고와 solicited 답변 인식이 필수이고, 나머지 분류는 후보 표시까지만); `orchestrator/dispatch`(plan·`depends_on`·`checked` 기반 자동 시작, 수정 요청, 재개); `orchestrator/prompt-slice`(대상 criterion, 확정된 결정, 선행 산출물을 맥락으로 주입); `orchestrator/team-template`(역할 템플릿 1종 고정); Agent 보고 도구 `report_result`/`attach_evidence`; 사람 산출물 첨부 처리: 채널 첨부 → `ps_claim`(산출물 참조 포함) → 검증 승인 카드; solicited 처리: PM이 선택지로 요청한 결정·계획 승인에 대한 결정권자의 답을 `confirmed`/`approved`로 기록하고 undo를 제공
  - UI: Product State 패널(목표 / 현재 / 결정 / 증거·미확인 4칸, criterion 배지 `unverified/passed/failed/stale`, 부속 표시 `reported`/`agent_verified`); 계획 승인 카드, 검증 승인 카드, goal 승인 카드, 비요청 결정 확인 카드
  - 제외: CI 연동, 분류 결과 자동 반영, 여러 채널, 역할 템플릿 밖의 팀 구성
  - **성공 기준 (1순위, intent.md §9 명제)**: 디자이너가 사용 흐름 초안을 채널에 올리면, 누구도 다시 지시하지 않아도 PM이 인계 조건을 확인(`checked`)하고 프로토타입 제작 Agent의 작업을 시작한다. 가장 강한 데모: 초안이 결정 ①의 고객 문제를 다루지 않으면 PM이 무엇이 빠졌는지 구체적으로 수정을 요청하고, 보완되면 프로토타입 제작 Agent를 시작한다.
  - **성공 기준 (Product State 고유)**: (a) 디자이너의 "사용 흐름 초안 올렸어요"나 Agent의 완료 보고 뒤에도 해당 인수 조건은 `reported` 표시의 `unverified`로 남는다. 사용자가 검증 승인 카드로 승인한 뒤에만 `passed`가 된다. 프로토타입 작업은 이 승인을 기다리지 않고 `checked`만으로 시작된다. (b) 4개 태스크가 모두 `accepted`가 돼도, "고객 반응 관찰" 인수 조건이 `unverified`이므로 goal은 미달성으로 표시된다. PM은 이 gap을 계획 수정안(고객 반응 세션 태스크)으로 제안한다. (c) PM의 "①/② 중 어느 쪽으로 갈까요?"에 사용자가 "①로 가자"라고 답하면, 추가 카드 없이 결정이 `confirmed`로 기록된다. undo가 가능하다.
  - 측정 지표(목표치는 intent.md §10 Q6에서 미정): 후속 지시 없이 이어진 인계 수, 사람 확인 카드 수, `checked` 뒤 되돌림 수

### 7.1 첫 사이클 예시: 고객 반응 확인 (intent.md §8 시나리오 A·B 매핑)

대상 제품은 소프트웨어가 아니라 가설 단위일 수 있다. 이 예시의 대상 제품은 "**아이디어 X 검증**"이다. 수치(N건)는 예시값이며, 계획을 승인할 때 결정권자가 확정한다.

**목표 (`ps_goal`)**
- `problem`: 아이디어 X가 겨냥하는 고객 문제가 실제로 있는지, 해결안에 고객이 반응하는지 모른다.
- `outcome`: 2주 안에 검증할 고객 문제 하나를 확정하고, 그 문제를 다루는 프로토타입에 대한 고객 반응을 확인한다.

**요구사항과 인수 조건 (`ps_requirement` / `ps_criterion`)**

| requirement | criterion | verify_method | required_evidence_kinds |
| --- | --- | --- | --- |
| R1 고객 문제 근거 확보 | C1.1 대상 고객 인터뷰 5건의 기록이 첨부돼 있고, 각 기록에 고객이 겪는 문제가 적혀 있다 | `human_review` | `artifact` |
| R2 경쟁·대안 파악 | C2.1 경쟁·대안 5개 이상에 대해 대상 고객, 해결 방식, 한계를 정리한 조사 보고서가 있다 | `human_review` | `artifact` |
| R3 사용 흐름 | C3.1 사용 흐름 초안이 결정 D1에서 고른 고객 문제를 시작 지점부터 해결 지점까지 다룬다 | `human_review` | `artifact` |
| R4 고객 반응 확인 | C4.1 프로토타입이 사용 흐름 초안의 핵심 단계를 조작 가능하게 보여 준다 | `human_review` | `artifact` |
| R4 고객 반응 확인 | C4.2 대상 고객 3명 이상에게 프로토타입을 보여 주고 반응을 관찰·기록했다 | `observation` | `user_observation`, `artifact` |

**결정 (`ps_decision`)**

- D1: `kind: choice`. 내용은 "검증할 고객 문제는 후보 ①(인터뷰 기록 근거)". 근거는 인터뷰 기록 T2와 조사 결과 T1이다.
- PM이 결정 대기 질문 Q1(`ps_open_item`, kind=question)으로 결정권자에게 요청한 solicited 결정이다.
- `ps_decision_link`로 C3.1, C4.1, C4.2에 연결된다.
- D1이 ②로 바뀌면 이 세 조건의 version이 올라가고, 옛 증거는 `stale`, T3와 T4는 `impacted`가 된다(§4 결정 변경 시 영향 처리).

**계획 v1 (`plan`, 시나리오 A의 "좋아, 그렇게 가자"로 approved)**

| task | 담당 | depends_on | handoff_conditions | task_target |
| --- | --- | --- | --- | --- |
| T1 경쟁사 조사 | 경쟁사 조사 Agent | 없음 | 조사 보고서 첨부, 대안 5개 이상 항목 포함 | C2.1 |
| T2 고객 인터뷰 | 사용자 | 없음 | 인터뷰 기록 5건 첨부 | C1.1 |
| T3 사용 흐름 설계 | 디자이너 | T1, T2, Q1(해결됨) | 흐름 초안 첨부, D1에서 고른 문제를 다룸(PM 판정) | C3.1 |
| T4 프로토타입 제작 | 프로토타입 제작 Agent | T3 | 프로토타입 링크·파일 첨부, 흐름 초안의 핵심 단계 포함 | C4.1 |

C4.2(고객 반응 관찰)는 v1의 어떤 태스크도 겨냥하지 않는다. 계획을 승인할 때 Product State 패널에 "계획 밖 gap"으로 표시된다. intent.md §8은 프로토타입 시작까지만 서술하므로, 이 예시에서는 일부러 v1에서 뺐다.

**시나리오 B 사건 순서 (이벤트 → 상태 전이)**

1. T1이 `report_result`로 조사 보고서를 첨부한다. `claim_recorded`(C2.1)가 기록되고 T1은 `reported_done`이 된다. PM이 인계 조건을 확인해 T1을 `checked`로 올린다.
2. 사용자가 인터뷰 기록 5건을 올린다. 완료 보고로 분류돼 `claim_recorded`(C1.1)가 기록되고, T2는 `reported_done`을 거쳐 `checked`가 된다.
3. T3의 선행 태스크는 충족됐지만 Q1이 열려 있다. PM이 사용자에게 묻는다: "후보 ①/② 중 어느 쪽으로 갈까요?" (`open_item_opened`)
4. 사용자가 "①로 가자"라고 답한다. solicited 답변이므로 `decision_confirmed`(D1)와 `open_item_resolved`(Q1)가 기록된다. PM이 "기록했습니다"라고 알리고, 디자이너에게 맥락(D1, T1, T2 산출물)을 전달한다. T3는 `queued`에서 `running`으로 자동 시작된다.
5. 디자이너가 "사용 흐름 초안 올렸어요"라며 초안을 첨부한다. `claim_recorded`(C3.1, 산출물 참조 포함)가 기록되고 T3는 `reported_done`이 된다. **C3.1은 여전히 `unverified`(`reported`)다. 완료 보고만으로는 `passed`가 되지 않는다.**
6. PM이 인계 조건을 판정한다. 첨부가 있고, 초안이 D1의 문제 ①을 다루는지 본다. 충족이면 사유를 기록하고 T3를 `checked`로 올린다. T4의 선행 조건이 충족되므로 T4가 자동으로 `running`이 된다. PM이 "프로토타입 제작 Agent의 작업을 시작합니다"라고 알리고, 맥락으로 "기준: 고객 문제 ①, 사용 흐름 초안, 경쟁사 조사 결과"를 전달한다.
   - 6′ (가장 강한 데모): 초안이 문제 ①을 다루지 않으면 T3는 `running`으로 되돌아간다. PM이 디자이너에게 구체적으로 수정을 요청한다(예: "결정 ①의 '…' 단계가 흐름에 없습니다"). 보완된 초안이 올라오면 다시 판정해 `checked`로 올리고 T4를 시작한다.
7. 사용자가 검증 승인 카드에서 초안을 승인한다. `evidence_recorded`(C3.1, `artifact`, `attested_by: human`, `result: pass`)가 기록되고 C3.1이 `passed`, T3가 `accepted`가 된다. T4는 6단계에서 이미 시작됐다. 인계는 `checked`로, 상태 판정은 `passed`로 이뤄진다.
8. T4 보고, `checked`, 승인 카드를 거쳐 C4.1이 `passed`, T4가 `accepted`가 된다. T1, T2도 각자 승인 카드를 거쳐 `accepted`가 된다. **네 태스크가 모두 `accepted`여도 C4.2가 `unverified`이므로 goal은 미달성이다.** `computeGap`은 {C4.2}를 반환하고, 이를 덮는 열린 `task_target`이 없다. PM은 계획 수정안 v2(T5 "고객 반응 세션", 담당 사용자, C4.2 겨냥)를 계획 승인 카드로 제안한다.
9. T5가 끝나고 관찰 기록이 승인되면(`user_observation` + `artifact`, `attested_by: human`) 모든 criterion이 `passed`가 된다. PM이 goal 승인 카드를 보내고, 결정권자가 승인하면 goal 달성으로 기록된다.

**원칙이 드러나는 위치**

- "완료 보고만으로 passed 안 됨": 5단계(C3.1 `reported`)와 7단계(승인 카드 뒤에야 `passed`)
- "태스크 전부 accepted ≠ goal 달성": 8단계(T1~T4 `accepted`, C4.2 미충족, 계획 수정안 제안)
- "PM이 흐름을 판단하고, 증거가 상태를 판정한다": 6단계(`checked`로 T4 시작)와 7단계(`passed`는 사람 승인)

- **Phase 2**: gap 기반 태스크 초안 자동 생성·배정 제안, 검증 에이전트, CI 연동 증거(`code_revision`·`environment`), 결정 변경 영향 분석·`impacted` 처리·재배정, 확인 요청 다이제스트, 다중 프로젝트 동시성.
- **Phase 3**: 결정권자 고신뢰 결정 자동 반영(undo 제공), 코드 변경 감지(Actual 측 선행 변경), requirement↔구현·화면 그래프 뷰, 분류 정확도 지표, 호스팅 실행기(선택).
- 기술 스택은 미정이며, 위 모듈 경로는 제안이다.

## 8. 리스크와 완화

- 분류 오류 → 후보·확정 분리, 코드 권한 판정, 원장+undo, MVP 자동 반영 없음
- 상태 폭발 → 요구사항은 채팅에서 자동 생성하지 않음, criterion만 gap 단위, 제안·질문 만료/묶음, 대상 제품당 활성 requirement 상한 경고
- 사람 개입 피로 → 카드는 권한자에게만, 다이제스트, system-attested 증거 자동 반영, 개입 횟수 지표, 배정·검증 확정 권한 분산. 첫 사이클은 판정 증거가 모두 사람 승인이라 결정권자에게 카드가 몰린다 → criterion을 사이클당 소수(예시 5개)로 제한하고, 같은 태스크의 승인 카드를 묶는다
- 자기보고 게이밍 → 구현자와 증거 생산자 분리(`produced_by` 코드 검사), 근거 없는 검증 주장은 claim 강등
- 옛 증거 재사용 → version·revision 바인딩, `stale` 자동 표시
- 비용 → 프리필터 후 원샷 분류, 저가 모델, 월 예산 게이트
- 프롬프트 인젝션 → 채널 텍스트는 비신뢰 데이터, 상태 쓰기는 도구+권한 검사 필수, 분류기 readOnly
- "PM이 완료를 판단하는 문제" → 충족 판정 권한을 LLM에서 제거, 코드와 사람으로
- `checked` 오판으로 잘못 시작된 후속 작업 → 판정 사유 원장 기록, 되돌림 비율 지표, `dispatch: manual`로 전환 가능

## 9. 결정 기록 (2026-09-28)

각 결정을 "선택 / 이유 / 반대가 나은 조건 / 되돌리기 비용" 형식으로 기록한다.

1. **결정권자 모델**: 선택 — 결정권자 1인(`can_decide(target_product,user,kind)`). 이유 — MVP 팀 규모에서 kind별 역할 실익 적음, 확정자 단일화로 분류 오류 추적 용이, kind 인자를 미리 넣어 인터페이스 불변. 반대가 나은 조건 — 한 대상 제품에 5명 이상이고 범위·기술 책임자가 실제로 다를 때. 되돌리기 비용 — 낮음(`confirmed_by` 저장됨).
2. **검증 인정 기준**: 선택 — system-attested 증거 또는 사람 승인, 에이전트 검증은 `agent_verified` 참고용. 이유 — "자기보고로 판단하지 않는다"를 에이전트 상호 검증에도 적용, 산출물의 적합성(예: 사용 흐름이 결정한 고객 문제를 다루는가)은 본래 사람 판단 항목, 소프트웨어 대상에서 테스트로 결정되는 항목은 CI로 자동화(Phase 2). 반대가 나은 조건 — 검증 에이전트 정확도가 사람 수준으로 측정되고 사람 확인이 병목일 때. 되돌리기 비용 — 낮음(파생 규칙 변경 후 재계산).
3. **배정 자율성**(2026-09-28 intent.md §7·§9 정합으로 개정): 선택 — `dispatch: within_plan`. 이유 — intent.md MVP 명제("누구도 다시 지시하지 않아도 대기하던 Agent의 다음 작업이 시작되는가")가 계획 안의 자동 진행을 요구한다. 사람 통제는 계획 승인과 계획 수정 승인으로 모은다. PM 품질은 계획 수정안 수락률과 `checked` 뒤 되돌림 비율로 관찰한다. 반대(`manual`)가 나은 조건 — `checked` 오판으로 잘못 시작된 후속 작업의 비용이 크게 관찰될 때. 되돌리기 비용 — 낮음(정책 값). 개정 전 선택 `auto_assign: off`(PM 제안 후 매 배정 1클릭 확정)는 폐기.
4. **목표 입력**: 선택 — 대화 추출 + 확정 카드, 정본은 DB 엔티티, 구조화 패널 병행. 이유 — 채팅 협업이 핵심 방향, 편집기 정본은 대화를 주변화. 반대가 나은 조건 — PRD를 갖고 들어오는 조직, 요구사항 수십 개 이상. 되돌리기 비용 — 중~낮음(PRD 가져오기는 쓰기 경로 추가, "문서 정본"으로 바꾸려면 동기화 설계 필요).
5. **범위 단위**: 선택 — 대상 제품당 하나, MVP 1:1. 이유·비용 — 2.7절 참조. 반대가 나은 조건 — 지속 대상 제품 없는 일회성 프로젝트 용도.
6. **codex 문서**: 선택 — 병합, 지위는 개념 배경. 이유 — 5계층·Desired/Actual·버전 바인딩은 토대이나 결정·분류·권한·루프가 없어 정본 이원화 시 enum 분기 위험. 반대가 나은 조건 — 원저자가 그 문서를 사양으로 계속 발전시킬 계획일 때. 되돌리기 비용 — 낮음.
7. **검증 실행 환경**: 선택 — 비호스팅, 증거 수집·판정자. 이유 — 차별화 핵심은 연결과 판정, 실행 샌드박스는 별개의 멀티테넌트 보안 제품, `attested_by`로 신뢰 등급 명확화, 첫 사이클(사람 산출물 중심)은 실행 호스팅이 필요 없음. 반대가 나은 조건 — CI 없는 비개발자 대상, 브라우저 실시간 검증이 데모 핵심일 때. 되돌리기 비용 — 낮음(반대 방향은 높음).
8. **첫 사이클 시나리오**(사용자 결정 2026-09-28): 선택 — intent.md §8 "고객 반응 확인"(§7.1). 이유 — intent.md가 MVP 명제와 핵심 시연(§8 시나리오 B, §9)의 정본이며, 첫 사이클이 그 명제를 직접 검증해야 한다. 사람 산출물 중심의 증거는 비호스팅 원칙(결정 7)과 맞고 CI 연동 없이도 한 사이클을 돌릴 수 있다. 예시 안에서 "완료 보고 ≠ passed"와 "태스크 전부 accepted ≠ goal 달성"을 모두 보여 줄 수 있다. 반대(파일 검색·CI 중심)가 나은 조건 — 첫 대상 사용자가 소프트웨어 팀이고, 자동 증거로 사람 확인 카드를 줄이는 것이 검증 1순위일 때. 되돌리기 비용 — 낮음. 데이터 모델은 두 시나리오를 모두 지원하므로 예시와 성공 기준 문안, CI 연동 시점만 바뀐다.

**모순 점검 결과**: 2↔7 일관(system-attested = `ci_integration`/`connected_runner`). 1↔2·개정3의 단일 결정권자 피로는 계획 승인·수정 승인(결정권자), 검증 승인(지정 검토자 가능), 결정 확정(결정권자 전용)으로 분산해 해소. 4↔6은 데이터 정본과 문서 정본의 층위가 달라 충돌 없음. 5에 따라 `ps_*`는 `target_product_id`, `task`는 `project_id`. 결정 2(passed)와 개정 3(within_plan)은 `checked`/`accepted` 분리로 양립. 첫 사이클의 판정 대상 증거는 모두 `human`이다(결정 8).

## 10. intent.md와의 관계

| intent.md | 이 문서 | 양립 방식 |
| --- | --- | --- |
| §6 "담당자를 정하고", §8 시나리오 B "작업을 시작합니다", §9 "후속 작업 실행"·"자동으로 시작한다" | `dispatch: within_plan`, `checked` 트리거 | 계획 승인 후에는 계획 안에서 자동으로 다음 작업이 시작된다 |
| §7 원칙 5 "결과물 확인 후 다음 일 시작" | `checked`(PM 판정, 작업 흐름) vs `passed`(증거, 대상 제품 상태) 분리 | PM의 흐름 판단과 코드/증거의 상태 판정을 분리해 둘 다 만족 |
| §8 시나리오 B "Agent가 곧바로 작업 시작", §9 "후속 작업 실행" | PM 전달=지시, 실행은 Agent 런타임/외부 러너, 완료 판정은 attested 증거(§6) | Ensemble은 비호스팅 원칙을 유지하면서도 인계 자동화를 지시 계층에서 구현 |
| §7 "사람의 승인" 주체, §10 Q3 | MVP 결정권자 = intent.md의 "사용자" 1인(잠정) | 용어와 역할을 1:1 대응, 확장 시 intent.md §10 Q3 해소 필요 |
| §7 원칙 1 "제안과 확정된 결정 구분", §10 Q4 | 후보 분류(§3) + solicited 결정 즉시 `confirmed` + 비요청 결정성 발언은 확인 카드 | PM이 스스로 묻고 답을 받은 경우와, 사람이 먼저 던진 결정성 발언을 다르게 취급해 자동화와 안전장치를 모두 만족 |
| §9 In Scope(채널 1·사람 2·Agent 2·PM 1·역할 템플릿) | §7 Phase 1, §7.1 예시 | 첫 사이클 범위를 intent.md §9에 1:1로 맞춤 |

intent.md와 이 문서가 충돌하면 제품 의도는 intent.md, 데이터 모델·enum·규칙은 이 문서가 우선한다.

## 11. 미결 사항

- 다중 프로젝트가 한 대상 제품을 동시 변경할 때의 동시성·권한 충돌 (Phase 2)
- 기술 스택·모듈 경로 확정
- 분류기 모델·프리필터 규칙·예산 한도
- 검토자 지정 UX, 다이제스트 주기
- `docs/ensemble-direction-context.pdf`(main의 개념 비교 문서)는 텍스트 추출이 안 되어 본 설계에 반영되지 않았음
- `intent.md`는 로컬 main에만 있고 origin/main에는 아직 없음. 이 문서의 참조가 유효해지려면 intent.md가 먼저 main에 반영돼야 한다.
- 결정 1(결정권자)·solicited 결정 규칙을 intent.md §10 Q3·Q4 본문에 반영할지 사용자 승인 필요(intent.md는 이 브랜치에서 수정하지 않음).
- 사람 산출물의 검증 근거 인정 기준: 검증 승인 권한자가 `human_review` 승인 시 무엇을 확인하는지(criterion 문구의 수치 N, 체크리스트 여부). 예시 §7.1의 수치는 예시값이다.
- 담당자가 곧 승인자인 경우: 결정권자가 자기 산출물(예: T2 인터뷰 기록)을 스스로 승인하는 것을 MVP에서 허용하고 원장에 `produced_by = recorded_by`로 표시한다. 이후 제한할지는 미정이다.
- 역할 템플릿의 내용과 선택 주체(intent.md §10 Q2). Phase 1은 §7.1의 4개 역할 고정 템플릿 1종을 가정한다.
- PM의 의미적 인계 조건 판정(예: "D1의 문제를 다룸")의 판정 방식, 판정 사유 형식, 오판 시 되돌림 절차
- 첫 계획에 고객 반응 세션(T5)을 처음부터 넣을지 여부. 예시에서는 계획 밖 gap 시연을 위해 뺐다.
- 성공 지표의 측정 방식과 목표치(intent.md §10 Q6)
