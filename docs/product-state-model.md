# Ensemble Product State 모델 (정본)

상태: Phase 0 확정 전제 및 설계안. 2026-09-28. 개념 배경은 `docs/structured-product-state.md`, 제품 의도는 `intent.md` 참조.

> **용어 표기 안내**: 이 문서의 `product`(제품)는 팀이 만들고 있는 **대상 제품**(예: 파일 검색 제품)을 가리킨다. `intent.md`의 "Product Intent"·"제품"은 Ensemble 앱 자체를 가리키는 다른 지칭이므로 혼동하지 않는다. `intent.md`의 "AI PM", "Agent/실행 Agent", "사람/사용자" 용어는 이 문서에서도 같은 의미로 쓴다(§5의 "제품 소유자"는 intent.md의 "사용자"에 해당하는 결정권자 역할이다).

## 0. 확정 전제

1. Product State는 `product` 단위로 소유한다. Project State(태스크)는 `project` 단위다. MVP는 product:project = 1:1이다.
2. 정본은 DB 엔티티와 이벤트 원장이다. 채팅 추출과 구조화 패널은 같은 원장을 거쳐서만 쓴다.
3. 채팅 발언은 후보로만 기록한다. 결정 확정은 결정권자(MVP에서는 제품 소유자 1인, `can_decide(product, user, kind)`로 판정)의 확인 카드로만 이루어진다.
4. 에이전트의 완료 보고는 claim이다. 태스크는 `reported_done`까지만 올린다. 인수 조건이 `passed`가 되려면 system-attested 증거나 사람 승인이 필요하고, 에이전트만의 검증은 `agent_verified`(참고용)로 둔다.
5. gap과 충족 판정은 결정적 코드(`computeGap`)가 한다. 목표 달성에는 결정권자의 명시적 승인이 필요하다.
6. AI PM은 태스크와 배정을 제안만 하고, 요청 멤버나 소유자가 확정한다(`auto_assign: off`).
7. Ensemble은 코드와 테스트 실행을 호스팅하지 않는다. 외부 실행 결과를 출처(`attested_by`), 요구사항 버전, 코드 revision, 환경과 함께 기록·판정한다.
8. `docs/structured-product-state.md`(codex 브랜치)는 개념 배경이다. enum과 규칙의 정본은 이 문서다.

## 1. 개념 정의

- Product State = 제품의 목표·현재 상태·결정을 유지하는 구조. 사람과 AI Agent가 "무엇을 만들기로 했고, 어디까지 만들어졌고, 무엇이 미해결인지" 공유하는 기준이다.
- Product State("제품이 어떤 상태인가") vs Project State("일이 어떤 상태인가"). 예: "검색 구현을 Agent A가 진행 중"은 Project State이고, "PDF 키워드 검색은 동작하지만 의미 검색은 미검증"은 Product State다. **태스크가 모두 완료돼도 제품이 목표 상태에 도달한 것은 아닐 수 있다.**
- 4대 구성
  - **목표 상태**: 누구의 어떤 문제, 제공해야 할 동작, 완료 조건
  - **현재 상태**: 구현 여부와 검증 여부를 구분하며, 미확인을 사실로 취급하지 않는다
  - **결정과 제약**: 무엇을 왜 선택했는지, 지켜야 할 조건, 제외 범위, 변경 이유·영향 추적
  - **증거와 미확인 사항**: 테스트·실행 결과·산출물·관찰을 연결하고, 미검증 가정·미해결 질문을 남긴다
- 파일 검색 제품 예시
  - 목표: "정확한 표현을 기억하지 못해도 자연어로 가져온 문서를 찾는다"
  - 현재: "PDF 가져오기·키워드 검색 동작, 의미 검색 미검증"
  - 결정: "이번 버전은 직접 가져온 파일만, 휴대폰 전체 색인 제외"
  - 증거: "PDF 가져오기 테스트 통과, 대표 자연어 질문 정확도 확인 필요"
- 설계 원칙
  1. gap·충족 판정은 LLM이 아닌 코드가 한다.
  2. 채팅 발언은 확정 상태가 아니라 후보로만 유입된다.
  3. 완료 보고는 `reported_done`까지만 올리고, 검증 증거가 붙어야 현재 상태가 바뀐다.

## 2. 데이터 모델

모든 `ps_*` 엔티티는 `product_id`로 범위를 정하고, `task`는 `project_id`로 범위를 정한다(`project.product_id` 참조). 쓰기는 서버 RPC와 도메인 서비스로만 허용한다(RLS + security definer 쓰기 방식).

### 2.1 목표 측

- `ps_goal`: `id`, `product_id`, `problem`(누구의 어떤 문제), `outcome`, `status`(`proposed | active | superseded | dropped`), `version`, `accepted_by`, `accepted_at`
- `ps_requirement`: `id`, `goal_id`, `behavior`(제공해야 할 동작), `status`(`proposed | accepted | excluded | superseded`), `version`, `origin_decision_id`
- `ps_criterion` (인수 조건, **gap 계산의 최소 단위**): `id`, `requirement_id`, `text`, `verify_method`(`automated_test | agent_check | human_review | observation`), `required_evidence_kinds[]`, `version`

### 2.2 결정·제약

- `ps_decision`: `id`, `product_id`, `kind`(`scope_in | scope_out | constraint | choice`), `statement`, `rationale`, `status`(`proposed | confirmed | revoked | superseded`), `proposed_by`, `confirmed_by`, `confirmed_at`, `supersedes_id`, `source_message_id`
- `ps_decision_link`: `decision_id` → `requirement_id` 또는 `criterion_id` (영향 추적의 근거)

### 2.3 현재 상태 측 (증거 기반)

- `ps_claim` (자기보고): `id`, `criterion_id`(또는 `requirement_id`), `claim`(`implemented | partial | not_done`), `actor`(`agent | human`), `task_id`, `source_message_id`, `created_at`. **이것만으로는 검증 상태가 절대 바뀌지 않는다.**
- `ps_evidence`: `id`, `criterion_id`, `kind`(`test_run | browser_check | artifact | user_observation | log`), `ref`(run id / url / message id / attachment), `result`(`pass | fail | inconclusive`), `attested_by`(`ci_integration | connected_runner | human | agent_claim`), `produced_by`, `recorded_by`, `criterion_version`, `requirement_version`, `code_revision`, `environment`, `captured_at`, `task_id`, `invalidated_at`
- `ps_open_item`: `id`, `product_id`, `kind`(`assumption | question | risk`), `text`, `links`(criterion/decision), `status`(`open | resolved`), `resolved_by`(decision_id 또는 evidence_id)

### 2.4 원장과 분류

- `ps_event` (append-only 원장): `id`, `product_id`, `type`(`goal_changed, requirement_accepted, decision_proposed, decision_confirmed, decision_superseded, claim_recorded, evidence_recorded, evidence_invalidated, open_item_opened, open_item_resolved` 등), `actor`, `payload`, `source_message_id`, `created_at`. "왜 바뀌었나"와 "변경의 영향"은 이 원장에서 거슬러 올라가 찾는다. 현재 상태는 원장에서 계산한 투영(projection)이며, MVP에서는 뷰 또는 동기 갱신 테이블로 단순화한다.
- `ps_intake` (발언 분류 후보): `message_id`, `product_id`(채널→project→product로 도출해 저장), `class`(`proposal | decision | completion_report | verification_result | question | other`), `confidence`, `extracted`(jsonb), `author_authority`(bool), `status`(`pending | applied | rejected | auto_logged`), `applied_event_id`

### 2.5 Project State와의 연결

- `task` (Project State): `id`, `project_id`, 상태 `queued | running | blocked | reported_done | accepted | cancelled | impacted`, `assignee`, `ps_snapshot`(배정 시점의 criterion·requirement version map)
- `task_target`: `task_id` ↔ `criterion_id`. 태스크의 "완료 조건"은 자유 텍스트가 아니라 이 링크와 criterion의 `required_evidence_kinds`에서 만든다.
- 프로젝트 정책: `auto_assign: off | low_risk | all` (MVP는 `off`)

**태스크 전이 규칙**

- `task_target`이 "열린" 것으로 계산에 포함되는 상태는 `accepted`·`cancelled`를 제외한 모든 상태다(§2.6 `computeGap` 참조).
- `reported_done` 태스크의 대상 criterion에 `failed` 증거가 새로 기록되면, 태스크는 `running`으로 되돌아가고 PM이 수정 요청을 전달한다(intent.md §7 "결과가 부족하면 수정 요청"에 대응).
- `blocked` 태스크는 막힘의 원인이 된 결정·정보가 원장(`ps_event`)에 기록되는 시점에 `running`으로 재개된다.
- 대상 criterion이 모두 `passed`가 되면 태스크는 `accepted`가 된다(§2.6).

### 2.6 파생 규칙 (코드, 결정적)

criterion 검증 상태: 판정은 해당 criterion의 유효 증거 중 `captured_at`이 가장 최신인 것을 기준으로 한다.

| 상태 | 조건 |
| --- | --- |
| `passed` | 유효한 증거(invalidated 아님, criterion_version·requirement_version이 현재와 같음, required kind 충족)가 있고, `attested_by`가 `ci_integration`/`connected_runner`(system-attested) 또는 `human`(사람 승인)일 때 |
| `failed` | 최신 유효 증거가 `fail` |
| `stale` | 증거는 있지만 현재 버전과 맞지 않음 |
| `unverified` | 증거 없음 |

`reported`와 `agent_verified`는 위 표의 별도 상태가 아니라 `unverified`의 부속 표시다: `unverified`인데 `ps_claim`이 있으면 `reported`, `attested_by = agent_claim`인 pass 증거만 있으면 `agent_verified`로 표시한다. 둘 다 `passed`로 치지 않는다.

- `produced_by`는 증거를 실제로 실행·생산한 주체다. `ci_integration`은 CI 시스템이 생산 주체이므로 구현 에이전트의 커밋에서 트리거됐어도 system-attested로 인정한다. `connected_runner`는 구현 에이전트 자신이 실행한 경우 system-attested로 인정하지 않고 `agent_claim`으로 강등한다(구현자와 증거 생산자 분리). 테스트 내용 자체의 적절성은 criterion의 `verify_method`·`required_evidence_kinds`와 사람 검토가 담당한다.
- requirement 충족 = criterion이 1개 이상 있고, 그 모두가 `passed`. criterion이 하나도 없는 `accepted` requirement는 충족으로 보지 않는다.
- goal 달성 = 모든 `accepted` requirement 충족 **+ 결정권자의 goal 승인 이벤트**
- 따라서 "태스크가 전부 `accepted`여도 goal 미달성"이 자연스럽게 표현된다.
- `computeGap(product)`: `passed`가 아닌 criterion 집합에서 이미 "열린" `task_target`이 겨냥한 criterion을 뺀 집합. "열린" task_target은 `accepted`·`cancelled`가 아닌 상태의 태스크가 가진 링크로 정의한다(§2.5 태스크 전이 규칙 참조). 순수 함수이며 단위 테스트 대상.

### 2.7 설계 선택과 트레이드오프

- **별도 도메인**(작업 테이블 확장 대신): 목표·결정·증거는 태스크보다 오래 살고 여러 태스크에 걸친다. 자유 텍스트 완료 기준 확장으로는 버전 관리·증거 만료·영향 분석이 불가능하다. 대신 초기 스키마가 커지고(약 9개 테이블) 태스크 생성 시 "어느 인수 조건을 겨냥하나" 입력 부담이 생긴다 → PM이 링크 초안을 채워 완화.
- **원장+투영**(단순 CRUD 대신): 결정 변경 이력과 근거 추적이 요구사항 자체이기 때문. 구현 복잡도 증가는 MVP에서 투영 단순화로 완화.
- **제품 단위 소유**(프로젝트 단위 대신): Product State는 작업보다 오래 사는 기준이라 v1 프로젝트의 목표·결정·증거가 v2의 출발점이어야 한다. 되돌리기 비용이 비대칭(제품 키→프로젝트 키로 접기는 거의 무료, 반대는 모든 FK·원장·권한·증거 바인딩 이관). MVP는 1:1 강제, UI에 드러내지 않음. 여러 프로젝트가 한 제품을 동시 변경할 때의 동시성·권한 충돌은 **미결**(Phase 2 이후).

## 3. 대화 → Product State 반영 파이프라인

삽입 위치: 메시지 저장 직후의 비동기 소비자. 에이전트 실행 큐와 분리해 응답 지연에 영향을 주지 않는다. "전량 일지 적재" 대신 "분류 → 후보 원장".

1. **입력 경로 두 개**
   - (a) 구조화 경로(신뢰도 높음): 에이전트는 자유 텍스트 마커 대신 도구로 보고한다. `report_result{task_id, claims[], evidence[], open_questions[]}`, `attach_evidence`, `propose_decision`, `raise_question`.
   - (b) 자유 발언 경로(신뢰도 낮음): 사람과 에이전트의 채널 메시지.
2. **자유 발언 분류**: 정규식 프리필터 → 도구를 쓸 수 없는 readOnly 원샷 LLM 분류(프롬프트 인젝션으로 상태를 쓰는 경로 차단). 결과는 `ps_intake`에만 기록.
3. **유형별 적용 정책 (MVP)**

   | 유형 | 처리 |
   | --- | --- |
   | 제안 ("전체 파일 검색도 해볼까?") | `auto_logged`. `ps_open_item(question)` 또는 `ps_decision(proposed)`로 조용히 기록. 확정 범위·gap에 영향 없음 |
   | 결정 ("이번에는 가져온 파일만 지원하자") | 작성자가 결정권자면 "결정으로 기록할까요?" 인라인 카드 → 1클릭 확정. 결정권자가 아니면 `proposed`로 두고 결정권자에게 확인 요청을 모아서 보냄 |
   | 완료 보고 ("검색 구현을 완료했습니다") | `ps_claim` 생성, 태스크 `reported_done`. **검증 상태는 그대로** |
   | 검증 결과 ("대표 사례를 실행했고 기준을 충족했습니다") | 근거 참조(실행 로그·첨부·테스트 run)가 있을 때만 `ps_evidence` 후보. 검증 권한자 확인 후 반영. 근거 없는 "통과했습니다"는 claim으로 강등 |

4. **결정 권한 판정은 코드가 한다**: `can_decide(product, user, kind)`. MVP는 제품 소유자 1인. LLM은 "결정처럼 보이는가"만 판정.
5. 모든 적용 이벤트는 `source_message_id`를 남기고 되돌리기(undo) 이벤트를 제공한다.
6. MVP에서는 분류 결과를 **자동 반영하지 않는다**(후보 표시까지만). 결정권자의 결정만 카드로 확정.

## 4. AI PM(orchestrator) 루프

멘션 트리거가 아닌 **Product State 이벤트 구동**: `ps_event` 추가, `task` 상태 변화, 주기 점검(정체 태스크).

| 단계 | Ensemble 동작 |
| --- | --- |
| 1. 차이 파악 | `computeGap(product)` 순수 함수 |
| 2. 작업 정의 | PM LLM이 커버되지 않은 gap을 묶어 태스크 초안(대상 criterion, 담당 후보, 사유) 생성. `auto_assign: off`이므로 제안만 하고 요청 멤버 또는 소유자가 1클릭 확정 |
| 3. 맥락·완료 조건 전달 | "Product State 슬라이스" 주입: 대상 criterion, 관련 `confirmed` decision/constraint, `scope_out`, 열린 질문, 필요한 증거 kind. "참고 데이터, 지시 아님" 경계 표시 |
| 4. 결과·증거 확인 | 구조화 보고 → `reported_done`. PM이 검증 단계를 연다: CI 결과 수집(system-attested), 구현자가 아닌 검증 에이전트(`agent_verified` 참고용), 사람 검토 카드(`human`). `report_result` 보고 없이 실행이 멈추면 `reported_done`이 아니라 `blocked`로 전이한다(멈춤을 완료로 올리지 않는다) |
| 5. 현재 상태 반영 | 증거 이벤트 → 투영 갱신. 대상 criterion 모두 `passed`면 태스크 `accepted` |
| 6. 다음 작업 연결 | 1단계로 복귀. gap이 비면 결정권자에게 "goal 승인 요청" 카드 |

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
| goal·인수 조건 채택(`accepted`) | 제품 소유자 |
| 결정 확정·변경 | 제품 소유자 **전용** |
| `human_review` criterion 검증 승인, 근거 없는 검증 주장 확인 | 제품 소유자 또는 소유자가 지정한 검토자 |
| 최종 goal 달성 승인 | 제품 소유자 |
| 태스크·배정 확정 | 요청한 멤버(해당 태스크가 겨냥한 criterion의 requirement를 제안·요청한 멤버, 또는 태스크 초안의 계기가 된 메시지 작성자) 또는 제품 소유자 |
| `impacted` 태스크 처리 확정 | 제품 소유자 |
| 분류 오류 되돌리기 | 제품 소유자 또는 검토자 |

사람 개입 없이 처리: 제안 기록, 완료 보고 기록, system-attested 증거 반영. 확인 요청은 다이제스트로 묶는다.

## 6. 증거 출처와 검증 실행 환경

- Ensemble은 실행을 호스팅하지 않고 **증거 수집·판정자**로 동작한다. 실행은 외부(CI, 사용자 쪽에 연결된 러너)가 한다.
- `attested_by` 등급: `ci_integration`(Ensemble이 CI API에서 직접 가져온 결과, 예: GitHub Actions check run + 커밋 SHA → `code_revision` 자동 채움), `connected_runner`, `human`, `agent_claim`(에이전트가 붙여 넣은 로그 텍스트 등).
- 첫 사이클 적용: PDF 가져오기 테스트 = CI check run 수집 → 자동 `passed`. 의미 검색 정확도 = 평가 스크립트 결과 첨부 + 사람 승인.
- 나중에 호스팅 실행기를 붙이면 `attested_by` 값 하나가 늘어난다.

## 7. 단계적 도입

- **Phase 0 (이 문서)**: 사양 확정. codex 문서 병합(개념 배경), 본 문서 작성.
- **Phase 1 MVP (한 제품, 파일 검색 예시 한 사이클)**: `ps_*` 전체 테이블 + `task`/`task_target` 마이그레이션; 모듈 `product-state/ledger`(이벤트 쓰기·투영), `product-state/gap`(`computeGap` + 단위 테스트), `orchestrator/prompt-slice`, 에이전트 도구 `report_result`/`attach_evidence`; UI: Product State 패널(목표/현재/결정/증거·미확인 4칸, criterion 배지 `unverified/passed/failed/stale` + 부속 표시 `reported`/`agent_verified`), 결정 확인 카드, 검증 승인 카드; 분류기는 후보 표시까지만. **성공 기준**: "검색 구현 완료" 보고 뒤에도 의미 검색 criterion이 `reported`로 남고, 증거를 붙인 뒤에만 `passed`가 되며, 태스크가 전부 `accepted`여도 goal은 승인 전까지 미달성으로 표시된다.
- **Phase 2**: gap 기반 태스크 초안 자동 생성·배정 제안, 검증 에이전트, CI 연동 증거(`code_revision`·`environment`), 결정 변경 영향 분석·`impacted` 처리·재배정, 확인 요청 다이제스트, 다중 프로젝트 동시성.
- **Phase 3**: 결정권자 고신뢰 결정 자동 반영(undo 제공), 코드 변경 감지(Actual 측 선행 변경), requirement↔구현·화면 그래프 뷰, 분류 정확도 지표, 호스팅 실행기(선택).
- 기술 스택은 미정이며, 위 모듈 경로는 제안이다.

## 8. 리스크와 완화

- 분류 오류 → 후보·확정 분리, 코드 권한 판정, 원장+undo, MVP 자동 반영 없음
- 상태 폭발 → 요구사항은 채팅에서 자동 생성하지 않음, criterion만 gap 단위, 제안·질문 만료/묶음, 제품당 활성 requirement 상한 경고
- 사람 개입 피로 → 카드는 권한자에게만, 다이제스트, system-attested 증거 자동 반영, 개입 횟수 지표, 배정·검증 확정 권한 분산
- 자기보고 게이밍 → 구현자와 증거 생산자 분리(`produced_by` 코드 검사), 근거 없는 검증 주장은 claim 강등
- 옛 증거 재사용 → version·revision 바인딩, `stale` 자동 표시
- 비용 → 프리필터 후 원샷 분류, 저가 모델, 월 예산 게이트
- 프롬프트 인젝션 → 채널 텍스트는 비신뢰 데이터, 상태 쓰기는 도구+권한 검사 필수, 분류기 readOnly
- "PM이 완료를 판단하는 문제" → 충족 판정 권한을 LLM에서 제거, 코드와 사람으로

## 9. 결정 기록 (2026-09-28)

각 결정을 "선택 / 이유 / 반대가 나은 조건 / 되돌리기 비용" 형식으로 기록한다.

1. **결정권자 모델**: 선택 — 제품 소유자 1인(`can_decide(product,user,kind)`). 이유 — MVP 팀 규모에서 kind별 역할 실익 적음, 확정자 단일화로 분류 오류 추적 용이, kind 인자를 미리 넣어 인터페이스 불변. 반대가 나은 조건 — 한 제품에 5명 이상이고 범위·기술 책임자가 실제로 다를 때. 되돌리기 비용 — 낮음(`decided_by` 저장됨).
2. **검증 인정 기준**: 선택 — system-attested 증거 또는 사람 승인, 에이전트 검증은 `agent_verified` 참고용. 이유 — "자기보고로 판단하지 않는다"를 에이전트 상호 검증에도 적용, 의미 검색 정확도는 본래 사람 판단 항목, 테스트로 결정되는 항목은 CI로 자동화. 반대가 나은 조건 — 검증 에이전트 정확도가 사람 수준으로 측정되고 사람 확인이 병목일 때. 되돌리기 비용 — 낮음(파생 규칙 변경 후 재계산).
3. **배정 자율성**: 선택 — PM 제안 후 1클릭 확정(`auto_assign: off`). 이유 — PM의 gap 해석 품질 자체가 관찰 대상, 확정 기록이 품질 데이터, 실행 비용·비가역성, Slack 흐름에 자연스러움. 반대가 나은 조건 — 수락률 90% 이상 안정 + 저비용 가역 작업 위주. 되돌리기 비용 — 낮음(플래그).
4. **목표 입력**: 선택 — 대화 추출 + 확정 카드, 정본은 DB 엔티티, 구조화 패널 병행. 이유 — 채팅 협업이 핵심 방향, 편집기 정본은 대화를 주변화. 반대가 나은 조건 — PRD를 갖고 들어오는 조직, 요구사항 수십 개 이상. 되돌리기 비용 — 중~낮음(PRD 가져오기는 쓰기 경로 추가, "문서 정본"으로 바꾸려면 동기화 설계 필요).
5. **범위 단위**: 선택 — 제품당 하나, MVP 1:1. 이유·비용 — 2.7절 참조. 반대가 나은 조건 — 지속 제품 없는 일회성 프로젝트 용도.
6. **codex 문서**: 선택 — 병합, 지위는 개념 배경. 이유 — 5계층·Desired/Actual·버전 바인딩은 토대이나 결정·분류·권한·루프가 없어 정본 이원화 시 enum 분기 위험. 반대가 나은 조건 — 원저자가 그 문서를 사양으로 계속 발전시킬 계획일 때. 되돌리기 비용 — 낮음.
7. **검증 실행 환경**: 선택 — 비호스팅, 증거 수집·판정자. 이유 — 차별화 핵심은 연결과 판정, 실행 샌드박스는 별개의 멀티테넌트 보안 제품, `attested_by`로 신뢰 등급 명확화, 첫 사이클에 즉시 부합. 반대가 나은 조건 — CI 없는 비개발자 대상, 브라우저 실시간 검증이 데모 핵심일 때. 되돌리기 비용 — 낮음(반대 방향은 높음).

**모순 점검 결과**: 2↔7 일관(system-attested = `ci_integration`/`connected_runner`). 1↔2·3의 단일 결정권자 피로는 배정 확정(요청 멤버 가능)·검증 승인(지정 검토자 가능)·결정 확정(소유자 전용)으로 분산해 해소. 4↔6은 데이터 정본과 문서 정본의 층위가 달라 충돌 없음. 5에 따라 `ps_*`는 `product_id`, `task`는 `project_id`.

## 10. 미결 사항

- 다중 프로젝트가 한 제품을 동시 변경할 때의 동시성·권한 충돌 (Phase 2)
- 기술 스택·모듈 경로 확정
- 분류기 모델·프리필터 규칙·예산 한도
- 검토자 지정 UX, 다이제스트 주기
- `docs/ensemble-direction-context.pdf`(main의 개념 비교 문서)는 텍스트 추출이 안 되어 본 설계에 반영되지 않았음
- `intent.md`는 로컬 main에만 있고 origin/main에는 아직 없음. 이 문서의 참조가 유효해지려면 intent.md가 먼저 main에 반영돼야 한다.
