# Ensemble MVP 아키텍처 (M0 결정)

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
