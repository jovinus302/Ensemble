# Ensemble

**여러 사람과 여러 Agent가 동시에 일하는 환경에서, 흩어진 맥락을 하나의 목표 아래 연결하고 다음 행동을 조율하는 PM Agent.**

제품 출시, 마케팅, 리서치, 채용, 영업, 컨설팅, 행사 준비와 운영 대응처럼 여러 역할과 도구가 얽히는 협업을 돕습니다. 팀원은 기존 환경에서 자신의 Agent와 일하고, PM Agent는 맥락 수집·목표와 상태 파악·전달·선제 개입·실제 조율 행동·조직의 기억을 맡습니다.

현재 feasibility는 기존 CLI 연결을 재사용해 PM Agent의 작업·결정·산출물·다음 행동을 대시보드에서 확인하는 것입니다. 각자의 작업 공간을 한 페이지에 재현하지 않습니다.

제품 정의는 [intent.md](intent.md)가 기준입니다. 새 컨셉과 실제 구현의 차이는 [MVP 범위](docs/mvp-scope.md)에 정리했습니다.

## 먼저 볼 화면

| 경로 | 내용 | 실행 범위 |
|---|---|---|
| [/demo](http://localhost:3000/demo) | PM Agent의 프로젝트 대시보드 | 기존 서버·원장·CLI 연결을 사용하는 보조 뷰. fake 설정은 실제 CLI 실행이 아님 |
| [/](http://localhost:3000/) | 기존 프로젝트 관리 앱 | 서버·원장·worker를 사용하는 기존 구현. 새 도구 연동의 구현 완료를 뜻하지 않음 |

목표 입력, 결정 승인, 작업 상태와 실제 공유된 산출물을 확인합니다. 빈 프로젝트에 가상 작업이나 결과를 채우지 않습니다. [조작 안내](app/demo/README.md).

과거 데모 주소 세 개와 /s27, /handoff는 /demo로 연결됩니다. 기존 대본 재생기와 데모용 실행기는 제거했습니다. 실제 제품의 PM·Agent·저장소 패키지는 유지합니다.

## 설치와 로컬 실행

Node.js 24 이상과 npm을 권장합니다. 저장소는 Node 버전을 `engines`로 고정하지 않지만 `node:sqlite`와 `process.loadEnvFile`을 사용합니다. 앱 명령의 작업 디렉터리는 **`app/`**입니다. [package.json](app/package.json)과 [웹 package.json](app/apps/web/package.json)이 명령의 기준입니다.

```sh
cd app
npm ci
```

모델 호출 없이 `/` 앱을 둘러보려면 PM과 worker를 **둘 다** `fake`로 설정합니다. 기본 worker는 `fake`이지만 기본 PM Agent는 `api`이므로 worker 설정만으로는 모델 호출을 막을 수 없습니다. `/demo`도 같은 서버 런타임을 사용하며 실행 설정을 화면에 표시합니다.

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

Claude CLI를 사용하려면 두 값을 `claude`로 설정합니다. API 기반 PM Agent는 `ENSEMBLE_PM_RUNTIME=api`와 아래 Anthropic 설정을 사용하며, worker 종류는 별도로 선택할 수 있습니다. 실제 런타임으로 프로젝트를 시작하면 선택한 provider를 호출하고 worker 작업 폴더에 결과물을 생성합니다.

| 설정 | 코드 기준 동작 |
|---|---|
| `ENSEMBLE_PM_RUNTIME` | 웹 PM: `api`(기본), `codex`, `claude`, `fake` |
| `ENSEMBLE_AGENT_RUNTIME` | worker: `fake`(기본), `codex`, `claude` |
| `ENSEMBLE_MODEL_PM`, `ENSEMBLE_MODEL_AGENT` | 역할별 모델 지정. PM별 fallback 차이는 [현행 아키텍처](docs/mvp-architecture.md) 참조 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | `api` PM Agent의 Anthropic SDK 설정. 실제 값은 문서나 Git에 넣지 않음 |
| `ENSEMBLE_ENV_FILE` | 명시한 환경 파일 로드. 미지정 시 현재 디렉터리부터 상위의 가장 가까운 `.env` 탐색 |
| `ENSEMBLE_AGENT_WORKSPACE_ROOT` | 실제 CLI worker의 작업 폴더. 저장소 밖이어야 하며 기본값은 사용자 홈 아래 `ensemble-agent-workspaces` |
| `ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES` | worker turn 제한, 기본 20분 |
| `ENSEMBLE_DATA_DIR` | 앱 데이터 저장 위치. 기본 `app/data/` |
| `ENSEMBLE_FAKE_AGENT_DELAY_MS` | 자유 프로젝트의 fake worker 실행 지연. 기본 30,000ms |
| `ENSEMBLE_DIGEST=off` | 기본 활성화된 하루 요약 끄기 |

환경 변수 구현: [웹 runtime](app/apps/web/lib/runtime.ts), [PM provider 선택](app/packages/llm/src/runtime.ts), [환경 로더](app/packages/llm/src/env.ts), [worker 설정](app/packages/agents/src/codex/settings.ts). CLI PM과 웹 PM Agent의 timeout·effort 기본값이 같다고 가정하지 마세요.


## 검증

app/에서 다음을 실행합니다.

```sh
npm test
npm run typecheck
npm run build
npm run start -w @ensemble/web
```

검사는 기존 제품의 권한·중복 실행·종료·격리와 대시보드의 서버 상태 표시를 다룹니다. 브라우저 검사는 [QA 안내](docs/qa/README.md)를 따릅니다. 실제 팀의 조율 시간 감소와 외부 도구 연동은 별도 검증 대상입니다. live:pm은 실제 provider를 호출할 수 있는 제품 개발용 명령이며 데모 실행에 필요하지 않습니다.

## 저장소 구조

| 경로 | 역할 |
|---|---|
| app/demo/workspaces | 기존 CLI 실행 상태를 확인하는 PM Agent 대시보드 |
| app/apps/web | Next.js 라우트, 기존 제품 UI·API |
| app/packages/core, store | 기존 이벤트·작업·권한과 저장소 |
| app/packages/orchestrator | 기존 PM 계획·조율·검토·인계 |
| app/packages/agents, llm | 실제 제품의 모델·Agent 연결 |
| app/packages/channel, scenarios | 기존 앱 채널 계약과 개발용 입력 fixture |
| app/packages/meeting | 미팅 참여·주선 feasibility(#80) adapter와 Space 기록. 외부 왕복 미검증, [실험 기록](docs/feasibility/meeting-google-meet.md) |
| app/test | 외부 provider 없는 회귀 검사 |
| docs | 방향·구현·QA 안내 |
| motion-remotion, docs/presentations | 과거 영상·발표 자료. 현재 제품 정의는 intent.md |

## 문서

[intent](intent.md) → [범위](docs/mvp-scope.md) → [데모](app/demo/README.md) 순서로 읽습니다. 구현 계약은 [아키텍처](docs/mvp-architecture.md)와 [작업 모델](docs/work-model.md), 행동 기준은 [PM 원칙](docs/pm-principles.md), 변경 배경은 [결정 기록](docs/pm-agent-decisions.md)에 있습니다. [문서 지도](docs/README.md), [디자인](DESIGN.md), [모션](MOTION.md)도 같은 제품 방향을 따릅니다.
