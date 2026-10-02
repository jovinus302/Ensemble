# Ensemble

Ensemble은 사람과 AI 에이전트의 작업을 한 프로젝트에서 조정하는 로컬 웹 애플리케이션입니다. PM이 목표를 작업으로 나누고, 변경 요청과 의사결정, 결과 검토를 이벤트 기록으로 연결합니다. 제품 방향은 [intent](intent.md), 현재 동작은 [작업 모델](docs/work-model.md)에서 설명합니다.

**문서 확인 기준:** 2026-10-02, `main@c91234a01b2d597a4c452592ff2f58a49fa48acf` ([PR #53 병합](https://github.com/jovinus302/Ensemble/pull/53)). 아래 내용은 이 코드 시점의 설명이며, 과거 계획과 QA 결과에는 각각의 기준 시점이 있습니다.

## 현재 구현

- 프로젝트 채널·작업별 대화, 계획과 담당자, 결정 요청, 결과 첨부와 검토를 제공하는 Next.js UI
- 이벤트 ledger와 SQLite 저장, 재시작 시 상태 복원, 작업 변경 전달과 재작업 처리
- PM 런타임 `api`, `codex`, `claude`, 웹 데모용 `fake`; worker 런타임 `codex`, `claude`, `fake`
- 진행 중 PM 응답을 같은 작성자의 새 일반 채널 메시지로 선점하는 흐름 ([PR #49](https://github.com/jovinus302/Ensemble/pull/49)). 결정 카드·첨부·작업별 댓글은 이 경로와 구분합니다.
- 정체 작업 점검과 하루 요약: 실행 중인 서버가 자유 프로젝트를 5분마다 확인하며, 기본 요약 시각은 Asia/Seoul 09:00 이후 하루 한 번입니다. 별도 상시 스케줄러가 아닙니다.
- 제출 revision에 연결되는 검증·limitations 기록과 judge 전 검증 계약 ([PR #52](https://github.com/jovinus302/Ensemble/pull/52)). 신뢰 검증기는 host의 `ProjectManager` 코드가 `trustedValidator`와 `requireValidation`으로 제공·활성화합니다. 현재 웹 UI나 환경 변수에 이를 켜는 스위치는 없으며, 웹의 모든 작업이 자동으로 build/browser 검증을 받는다는 뜻은 아닙니다.

[Product State 모델](docs/product-state-model.md)은 설계 제안입니다. 현재 이벤트 기반 프로젝트 상태가 그 제안 전체를 구현한 것은 아닙니다. 이 저장소의 로컬 앱·데모·벤치마크를 운영 서비스의 인증·배포 보장으로 해석하지 마세요.

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

앞의 세 명령은 unit/integration 테스트, 타입 검사, 웹 빌드입니다. 마지막 명령은 빌드 후 서버를 실행하며, 위 런타임 환경 설정을 동일하게 적용해야 합니다. `smoke:*`, `live:*`, `benchmark:live`는 이름만 보고 오프라인 검사로 실행하지 마세요. 실제 provider 호출 여부와 별도 실행 승인을 먼저 확인해야 합니다.

이 기준 main에 기록된 v4 사전 검증은 **813개 테스트, typecheck, build 통과**입니다. 당시 build의 기존 동적 파일 추적 경고 3건은 남아 있습니다. [당시 검증 기록](https://github.com/jovinus302/Ensemble/blob/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/app/packages/benchmark/evidence/paired-validation-v4/preflight/code-checks.json)과 [현재 검증 실행 안내](docs/qa/README.md)를 참조하세요.

## 문서 지도와 읽는 순서

| 순서 / 목적 | 문서 | 성격 |
|---|---|---|
| 1. 제품이 해결하려는 문제 | [intent](intent.md) | 제품 방향 |
| 2. 현재 사용자·PM·worker 흐름 | [작업 모델](docs/work-model.md) | 현재 구현 설명과 동작 원칙 |
| 3. 구조와 초기 범위 | [MVP 아키텍처](docs/mvp-architecture.md), [MVP 범위](docs/mvp-scope.md) | 초기 기준과 후속 구현 구분 |
| 4. PM 행동·결정의 근거 | [PM 원칙](docs/pm-principles.md), [PM 계획](docs/pm-agent-plan.md), [결정 기록](docs/pm-agent-decisions.md) | 원칙·계획·시점별 결정 |
| 5. 아직 설계 중인 모델 | [Product State](docs/product-state-model.md) | 제안, 구현 완료 아님 |
| 6. 비교 측정 | [벤치마크 안내](app/packages/benchmark/README.md), [v4 결과](app/packages/benchmark/evidence/paired-validation-v4/README.md) | 고정 기준의 실험·재현 자료 |
| 7. 검증 실행과 과거 증거 | [QA 실행 안내·증거 보관 위치](docs/qa/README.md) | 재현 명령, 유지한 fixture와 스크립트, 고정 커밋의 역사적 실패·수정 기록 |
| 8. 화면·영상·외부 조사 | [DESIGN](DESIGN.md), [MOTION](MOTION.md), [Remotion](motion-remotion/README.md), [Argo 비교](docs/argo/ensemble-comparison.md) | 디자인/영상 제안과 조사; 앱 구현과 구분 |

## 비교 결과의 범위

[PR #53](https://github.com/jovinus302/Ensemble/pull/53)에 합쳐진 v4의 8회는 모두 기능 검사를 통과했습니다. 같은 provider·과제의 네 쌍에서 Ensemble의 총시간이 direct보다 길었습니다. **조건당 1회(n=1)**로 일반적 우열을 결론 내릴 수 없으며, 실제 비용과 숨겨진 API 호출 수는 미상입니다. 변경 요구사항의 context hash가 갖는 메타데이터 한계도 [결과 보고서](app/packages/benchmark/evidence/paired-validation-v4/README.md)에 남아 있습니다.

실험 기준은 PR #53 이전 `7cd8de8`이고, 이 문서의 최신 main 기준과 다릅니다. 과거 실패·오프라인 재평가·v4 측정은 합산하지 않습니다. [PR #51](https://github.com/jovinus302/Ensemble/pull/51)은 별도의 미병합 Draft이며, 승인된 실험 8슬롯은 모두 소진되어 추가 실행을 의미하지 않습니다.
