# Ensemble

Ensemble은 **PM Agent 중심의 팀 협업 도구**입니다. 사람은 자신의 Agent와 직접 일하고, PM Agent는 팀에 공유된 목표·결정·산출물을 바탕으로 질문, 배정, 검토와 다음 담당자에게의 인계를 조율합니다. 개인 작업의 결과를 팀의 다음 일로 연결해 재설명과 수동 추적 부담을 줄이는 것이 제품의 방향입니다.

현재 저장소에는 이벤트 기록 기반의 로컬 웹 앱과 협업 경험을 보여 주는 시연 화면이 있습니다. 제품 방향은 [intent](intent.md), 앱의 작업·결정 흐름은 [작업 모델](docs/work-model.md)에서 설명합니다. 개인 Agent 연동과 지속적 공유 상태인 **Team Work State**는 제품 개념이며, 시연 화면이 이 전체를 실제 서비스로 구현했다는 뜻은 아닙니다.

**문서 확인 기준:** 2026-10-05, `main@079d632` ([PR #72 병합](https://github.com/jovinus302/Ensemble/pull/72)). 제품 방향은 PR #69, 협업 인계 시연은 PR #68, 데모·문서 분리는 PR #71, 시나리오별 이름·주소는 PR #72를 반영했습니다.

## 먼저 볼 화면

아래 경로는 같은 Next.js 서버에서 열 수 있습니다. 시연 소스와 이미지는 `app/demo/scripted/`에 모으고, 제품 UI·API는 `app/apps/web`에 유지합니다. 서버 실행 방법은 [설치와 로컬 실행](#설치와-로컬-실행)을 참고하세요.

| 경로 | 확인할 내용 | 실행 방식 |
|---|---|---|
| [`/demo/design-to-code`](http://localhost:3000/demo/design-to-code) | 사람 간 논의·합의 → 개인 UX 초안 공유 → 구현 → QA 보완 → 사람의 검토 → 다음 담당자 인계 | 선택에 따라 산출물이 달라지는 로컬 시연. 실제 모델·외부 Agent 연결·영속 저장 없음 |
| [`/demo/pm-coordination`](http://localhost:3000/demo/pm-coordination) | Pages 앱의 이야기 방향 비교, 사람의 합의, 화면 제작과 범위를 제한한 수정 | 고정 시나리오와 규칙 기반 입력 처리. 실제 모델 호출 없음 |
| [`/demo/marketing-campaign`](http://localhost:3000/demo/marketing-campaign) | S27 마케팅 팀의 미팅·메신저·허브를 오가며 결정·근거·산출물 버전 연결 | 발표용 스크립트 시연. 미팅·Slack·녹스 연동은 시뮬레이션 |
| [`/`](http://localhost:3000/) | 자유 목표 입력과 준비된 시나리오, 채널 대화, 작업·결정 요청·첨부·로드맵 | SQLite와 서버 런타임을 사용하는 앱. 환경 설정에 따라 실제 PM·worker 또는 `fake` 실행 |

기존 주소는 `/demo` → `/demo/pm-coordination`, `/s27` → `/demo/marketing-campaign`, `/handoff` → `/demo/design-to-code`로 리다이렉트됩니다.

`/demo/design-to-code`에서는 로그인 복구 방식과 이메일 가리기를 선택하고, 두 사람의 합의 뒤 각자의 Agent 작업을 시작합니다. 초안은 **팀에 공유**해야 다음 작업의 입력이 됩니다. 포커스 복귀를 빠뜨린 구현은 QA 보완 요청으로 돌아오며, 최종 검토자가 승인해야 다음 담당자에게 이어집니다. 이 화면의 QA는 선택한 시연 상태를 대조하는 예시이고, 실제 코드나 브라우저를 실행하는 검증기가 아닙니다. 새로고침하면 시연 상태가 초기화됩니다.

## 현재 구현

- 프로젝트 채널·작업별 대화, 계획과 담당자, 결정 요청, 결과 첨부와 검토를 제공하는 Next.js UI
- 이벤트 ledger와 SQLite 저장, 재시작 시 상태 복원, 작업 변경 전달과 재작업 처리
- PM 런타임 `api`, `codex`, `claude`, 웹 데모용 `fake`; worker 런타임 `codex`, `claude`, `fake`
- 진행 중 PM 응답을 같은 작성자의 새 일반 채널 메시지로 선점하는 흐름 ([PR #49](https://github.com/jovinus302/Ensemble/pull/49)). 결정 카드·첨부·작업별 댓글은 이 경로와 구분합니다.
- 정체 작업 점검과 하루 요약: 실행 중인 서버가 자유 프로젝트를 5분마다 확인하며, 기본 요약 시각은 Asia/Seoul 09:00 이후 하루 한 번입니다. 별도 상시 스케줄러가 아닙니다.
- 제출 revision에 연결되는 검증·limitations 기록과 judge 전 검증 계약 ([PR #52](https://github.com/jovinus302/Ensemble/pull/52)). 신뢰 검증기는 host의 `ProjectManager` 코드가 `trustedValidator`와 `requireValidation`으로 제공·활성화합니다. 현재 웹 UI나 환경 변수에 이를 켜는 스위치는 없으며, 웹의 모든 작업이 자동으로 build/browser 검증을 받는다는 뜻은 아닙니다.

제품의 전체 협업 경험과 현재 구현·미검증 가설의 구분은 [MVP 범위](docs/mvp-scope.md)를 참고하세요. 오래된 Product State 설계·초기 PM 구현 계획·날짜별 QA·벤치마크 자료는 PR #71에서 현재 트리에서 제거했습니다.

## 설치와 로컬 실행

Node.js 24 이상과 npm을 권장합니다. 저장소는 Node 버전을 `engines`로 고정하지 않지만 `node:sqlite`와 `process.loadEnvFile`을 사용합니다. 앱 명령의 작업 디렉터리는 **`app/`**입니다. [package.json](app/package.json)과 [웹 package.json](app/apps/web/package.json)이 명령의 기준입니다.

```sh
cd app
npm ci
```

모델 호출 없이 `/` 앱을 둘러보려면 PM과 worker를 **둘 다** `fake`로 설정합니다. 기본 worker는 `fake`이지만 기본 PM은 `api`이므로 worker 설정만으로는 모델 호출을 막을 수 없습니다. `/demo/design-to-code`, `/demo/pm-coordination`, `/demo/marketing-campaign`은 이 서버 런타임을 사용하지 않는 별도 로컬 시연입니다.

PowerShell:

```powershell
$env:ENSEMBLE_PM_RUNTIME = 'fake'
$env:ENSEMBLE_AGENT_RUNTIME = 'fake'
npm run dev
```

POSIX shell:

```sh
ENSEMBLE_PM_RUNTIME=fake ENSEMBLE_AGENT_RUNTIME=fake npm run dev
```

터미널에 표시된 로컬 주소를 엽니다. Next.js의 기본 주소는 `http://localhost:3000`입니다. 기본 데이터 위치는 `app/data/`이며 SQLite ledger, 프로젝트 메타데이터와 첨부 파일이 저장됩니다. `ENSEMBLE_DATA_DIR`로 다른 위치를 지정할 수 있습니다.

실제 모델을 쓰려면 선택한 API 또는 CLI의 인증과 모델 설정이 필요합니다. 예를 들어 Codex CLI가 설치되고 로그인된 환경에서 PM과 worker를 함께 연결하려면, 실행 중인 서버를 종료한 뒤 `app/`에서 다음과 같이 다시 시작합니다.

```powershell
$env:ENSEMBLE_PM_RUNTIME = 'codex'
$env:ENSEMBLE_AGENT_RUNTIME = 'codex'
npm run dev
```

Claude CLI를 사용하려면 두 값을 `claude`로 설정합니다. API 기반 PM은 `ENSEMBLE_PM_RUNTIME=api`와 아래 Anthropic 설정을 사용하며, worker 종류는 별도로 선택할 수 있습니다. 실제 런타임으로 프로젝트를 시작하면 선택한 provider를 호출하고 worker 작업 폴더에 결과물을 생성합니다.

| 설정 | 코드 기준 동작 |
|---|---|
| `ENSEMBLE_PM_RUNTIME` | 웹 PM: `api`(기본), `codex`, `claude`, `fake` |
| `ENSEMBLE_AGENT_RUNTIME` | worker: `fake`(기본), `codex`, `claude` |
| `ENSEMBLE_MODEL_PM`, `ENSEMBLE_MODEL_AGENT` | 역할별 모델 지정. PM별 fallback 차이는 [현행 아키텍처](docs/mvp-architecture.md) 참조 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | `api` PM의 Anthropic SDK 설정. 실제 값은 문서나 Git에 넣지 않음 |
| `ENSEMBLE_ENV_FILE` | 명시한 환경 파일 로드. 미지정 시 현재 디렉터리부터 상위의 가장 가까운 `.env` 탐색 |
| `ENSEMBLE_AGENT_WORKSPACE_ROOT` | 실제 CLI worker의 작업 폴더. 저장소 밖이어야 하며 기본값은 사용자 홈 아래 `ensemble-agent-workspaces` |
| `ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES` | worker turn 제한, 기본 20분 |
| `ENSEMBLE_DATA_DIR` | 앱 데이터 저장 위치. 기본 `app/data/` |
| `ENSEMBLE_FAKE_AGENT_DELAY_MS` | 자유 프로젝트의 fake worker 실행 지연. 기본 30,000ms |
| `ENSEMBLE_DIGEST=off` | 기본 활성화된 하루 요약 끄기 |

환경 변수 구현: [웹 runtime](app/apps/web/lib/runtime.ts), [PM provider 선택](app/packages/llm/src/runtime.ts), [환경 로더](app/packages/llm/src/env.ts), [worker 설정](app/packages/agents/src/codex/settings.ts). CLI PM과 웹 PM의 timeout·effort 기본값이 같다고 가정하지 마세요.

## 검증과 production 모드

`app/`에서:

```sh
npm test
npm run typecheck
npm run build
npm run start -w @ensemble/web
```

`npm test`는 Node 내장 테스트 러너와 `tsx`로 [app/test](app/test/)의 핵심 회귀 시나리오를 실행합니다. 현재 9개 파일에 36개 테스트가 있으며, 런타임의 결정 권한·중복 실행·종료·프로젝트 격리, 세 시연의 상태 전이, Pages v2.5 WORK CONTEXT 계약을 다룹니다. 외부 provider 호출은 하지 않으며 모델의 판단 품질이나 브라우저 렌더링을 검증하는 테스트는 아닙니다. 파일별 검사 범위와 한계는 [필수 테스트 안내](docs/qa/essential-regressions.md)에 있습니다.

이어지는 명령은 타입 검사와 웹 빌드이며, 마지막 명령은 빌드 후 서버를 실행합니다. 위 런타임 환경 설정을 동일하게 적용해야 합니다. 과거 테스트·벤치마크 증거는 현재 트리에서 제거했으며, 과거 테스트 수치는 현재 검증 결과가 아닙니다. `live:pm`과 `demo:full`은 실제 provider를 호출할 수 있는 관찰 스크립트입니다. `demo:full`의 실행기는 [app/demo/runtime/run.ts](app/demo/runtime/run.ts)로 이동했습니다. 특정 로컬 환경 파일 경로가 들어 있으므로 일반 설치 확인 명령으로 사용하지 않습니다. 실행 조건은 [런타임 시연 안내](app/demo/runtime/README.md)를 참고하세요.

현재 검사 실행과 로컬 결과 관리 방법은 [QA 안내](docs/qa/README.md), `/demo/design-to-code`의 동작 범위와 브라우저 검사 위치는 [인계 시연 안내](app/demo/scripted/design-to-code/README.md)를 참고하세요.

## 저장소 구조

| 경로 | 역할 |
|---|---|
| `app/apps/web` | 제품 Next.js UI·API와 기존 URL의 라우트 연결부 |
| `app/demo/scripted` | `pm-coordination`, `marketing-campaign`, `design-to-code` 시연의 화면·상태·이미지·설명 |
| `app/demo/runtime` | 실제 앱을 사용하는 시연 안내와 관찰 실행기 |
| `app/packages/core`, `store` | 이벤트·작업·결정 모델과 상태 계산, 메모리·SQLite 저장 |
| `app/packages/orchestrator` | PM의 계획·조율·배정·인계·검증 흐름 |
| `app/packages/agents`, `llm` | 실행 Agent 세션 연결과 PM 모델 provider |
| `app/packages/channel`, `scenarios` | 채널 계약과 준비된 시나리오 입력 |
| `app/test` | provider 없는 필수 회귀 테스트 |
| `docs`, `motion-remotion` | 제품·설계·QA·발표 자료, 별도 Remotion 영상 프로젝트 |

## 문서 지도와 읽는 순서

[문서 안내](docs/README.md)는 제품 방향·현재 구현·검증·참고 자료를 연결합니다. [데모 안내](app/demo/README.md)는 실제 앱 시연과 세 스크립트 시연의 선택·실행 방법을 설명합니다.

| 목적 | 문서 |
|---|---|
| 제품이 해결하려는 문제 | [제품 의도](intent.md) |
| 현재 기능과 미검증 가설 | [MVP 범위](docs/mvp-scope.md) |
| 실행 구조·설정·코드 위치 | [아키텍처](docs/mvp-architecture.md) |
| 작업·결정·결과의 연결 | [작업 모델](docs/work-model.md) |
| PM 행동과 결정 이유 | [PM 원칙](docs/pm-principles.md), [결정 기록](docs/pm-agent-decisions.md) |
| 검사 실행과 범위 | [QA 안내](docs/qa/README.md), [필수 회귀 검사](docs/qa/essential-regressions.md) |
| 실제 앱의 자유형식·시나리오 실행 | [런타임 시연](app/demo/runtime/README.md) |
| PM 조율 시연 | [Pages 조율 데모](app/demo/scripted/pm-coordination/README.md) |
| S27 마케팅 발표 시연 | [발표 문서](app/demo/scripted/marketing-campaign/README.md), [스토리 브리프](app/demo/scripted/marketing-campaign/brief.md) |
| 사람·개인 Agent·PM 협업 시연 | [인계 데모](app/demo/scripted/design-to-code/README.md) |
| 제품 발표와 참고 조사 | [PM·Agent 팀 발표](docs/presentations/ensemble-pm-agent-team.pptx), [Argo 구조 조사](docs/argo/structure.md) |
| 디자인·영상 자료 | [DESIGN](DESIGN.md), [MOTION](MOTION.md), [Remotion](motion-remotion/README.md) |
