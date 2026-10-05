# Ensemble

Ensemble은 사람과 AI 에이전트의 작업을 한 프로젝트에서 조정하는 로컬 웹 애플리케이션입니다. PM이 목표를 작업으로 나누고, 변경 요청과 의사결정, 결과 검토를 이벤트 기록으로 연결합니다. 제품 방향은 [intent](intent.md), 현재 동작은 [작업 모델](docs/work-model.md)에서 설명합니다.

최신 문서 지도와 앱·세 데모의 구분은 [docs 안내](docs/README.md)를 참고하세요(2026-10-05, `main@605521b`).

**문서 확인 기준:** 2026-10-05, `main@605521b`의 기능과 데모 분리를 반영했습니다. 제품 의도와 실제 구현, 스크립트 시연을 구분합니다.

## 현재 구현

- 프로젝트 채널·작업별 대화, 계획과 담당자, 결정 요청, 결과 첨부와 검토를 제공하는 Next.js UI
- 이벤트 ledger와 SQLite 저장, 재시작 시 상태 복원, 작업 변경 전달과 재작업 처리
- PM 런타임 `api`, `codex`, `claude`, 웹 데모용 `fake`; worker 런타임 `codex`, `claude`, `fake`
- 진행 중 PM 응답을 같은 작성자의 새 일반 채널 메시지로 선점하는 흐름 ([PR #49](https://github.com/jovinus302/Ensemble/pull/49)). 결정 카드·첨부·작업별 댓글은 이 경로와 구분합니다.
- 정체 작업 점검과 하루 요약: 실행 중인 서버가 자유 프로젝트를 5분마다 확인하며, 기본 요약 시각은 Asia/Seoul 09:00 이후 하루 한 번입니다. 별도 상시 스케줄러가 아닙니다.
- 제출 revision에 연결되는 검증·limitations 기록과 judge 전 검증 계약 ([PR #52](https://github.com/jovinus302/Ensemble/pull/52)). 신뢰 검증기는 host의 `ProjectManager` 코드가 `trustedValidator`와 `requireValidation`으로 제공·활성화합니다. 현재 웹 UI나 환경 변수에 이를 켜는 스위치는 없으며, 웹의 모든 작업이 자동으로 build/browser 검증을 받는다는 뜻은 아닙니다.


## 설치와 로컬 실행

Node.js 24 이상과 npm을 권장합니다. 저장소는 Node 버전을 `engines`로 고정하지 않지만 `node:sqlite`와 `process.loadEnvFile`을 사용합니다. 앱 명령의 작업 디렉터리는 **`app/`**입니다. [package.json](app/package.json)과 [웹 package.json](app/apps/web/package.json)이 명령의 기준입니다.

```sh
cd app
npm ci
```

모델을 호출하지 않는 데모는 PM과 worker를 **둘 다** `fake`로 설정합니다. 기본 worker는 `fake`이지만 기본 PM은 `api`이므로 worker 설정만으로는 모델 호출을 막을 수 없습니다.

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

실제 모델을 쓰려면 선택한 API 또는 CLI의 사용 가능한 인증과 모델 설정이 필요합니다. 기존 설정을 먼저 확인하고, 설치·로그인·과금은 별도로 관리하세요. 이 문서는 모델 사용 가능 여부나 계정 권한을 보장하지 않습니다.

| 설정 | 코드 기준 동작 |
|---|---|
| `ENSEMBLE_PM_RUNTIME` | 웹 PM: `api`(기본), `codex`, `claude`, `fake` |
| `ENSEMBLE_AGENT_RUNTIME` | worker: `fake`(기본), `codex`, `claude` |
| `ENSEMBLE_MODEL_PM`, `ENSEMBLE_MODEL_AGENT` | 역할별 모델 지정. PM별 fallback 차이는 [현행 아키텍처](docs/mvp-architecture.md) 참조 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | `api` PM의 Anthropic SDK 설정. 실제 값은 문서나 Git에 넣지 않음 |
| `ENSEMBLE_ENV_FILE` | 명시한 환경 파일 로드. 미지정 시 현재 디렉터리부터 상위의 가장 가까운 `.env` 탐색 |
| `ENSEMBLE_AGENT_WORKSPACE_ROOT` | 실제 CLI worker의 작업 폴더. 저장소 밖이어야 하며 기본값은 사용자 홈 아래 `ensemble-agent-workspaces` |
| `ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES` | worker turn 제한, 기본 20분 |
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

`npm test`는 provider 호출 없이 핵심 회귀 시나리오만 실행합니다. 범위와 이유는 [필수 테스트 안내](docs/qa/essential-regressions.md)에 있습니다. 이어지는 명령은 타입 검사와 웹 빌드이며, 마지막 명령은 빌드 후 서버를 실행합니다. 위 런타임 환경 설정을 동일하게 적용해야 합니다. 과거 테스트·벤치마크 증거는 현재 트리에서 제거했습니다. 남아 있는 `live:*` 관찰 도구는 실제 provider를 호출할 수 있으므로 별도 실행 승인이 필요합니다.


## 문서와 코드 위치

- [문서 안내](docs/README.md): 제품 범위·현재 구현·PM 원칙·결정 기록
- [데모 안내](app/demo/README.md): `scripted/`의 세 고정 시연과 `runtime/`의 실제 앱 시연 도구
- [현재 QA 안내](docs/qa/README.md): 실행 가능한 검사와 결과 관리

제품 웹앱은 `app/apps/web`, PM·원장·저장소는 `app/packages`에 있습니다. 데모 전용 코드·이미지·설명은 `app/demo`로 분리했습니다. 실제 앱은 `/`, 스크립트 데모는 `/demo/pm-coordination`, `/demo/marketing-campaign`, `/demo/design-to-code`에서 엽니다. 기존 `/demo`, `/s27`, `/handoff`는 해당 새 주소로 연결됩니다.
