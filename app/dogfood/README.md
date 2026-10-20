# 도그푸딩 하네스

별도 레포를 Agent 개발팀이 만드는 동안 Ensemble PM Agent가 [일곱 단계](../../docs/dogfooding/pm-workflow.md)를 얼마나 닫는지 재는 도구다. 사람이 맡던 역할(승인, 결정, 사람 몫 작업, 팀원, 마찰 기록, 현황 파악)을 모두 에이전트나 코드가 맡는다. 계획과 근거는 [도그푸딩 계획](../../docs/dogfooding/plan.md)에 있다.

하네스는 제품 코드(`app/packages`, `app/apps`)를 바꾸지 않는다. 증거는 `run_started.productDirty`다. 모든 명령은 `app/`에서 실행한다.

## 명령

```
cd app
npm run dogfood -- preflight --skip-live
npm run dogfood -- smoke
npm run dogfood -- run --target seed --max-cycles 2
npm run dogfood -- run --target <대상 git 레포> --iteration 1
npm run dogfood -- run --continue-from <Iter 1 runDir> --iteration 2
npm run dogfood -- report --run-dir <runDir> [--compare <Iter 1 runDir>]
```

| 명령 | 하는 일 | 종료 코드 |
|---|---|---|
| `preflight` | 실행 환경을 점검하고 표로 출력한다. `--skip-live`가 없으면 claude를 실제로 호출한다(로그인, allowedTools 패턴, `$ref` 스키마). | 실패가 하나라도 있으면 1 |
| `smoke` | 규칙 모드로 seed 프로젝트를 한 바퀴 돈다. claude·네트워크·모델을 쓰지 않는다. 계획 확정, verifiedDone 4건, beyondPlan 1건 이상이면 통과한다. | 통과 0, 실패 1 |
| `run` | 반복 한 번을 실행한다. 실제 모델을 쓰는 live는 사용자 승인 뒤에 한다. | 정상 정지 0, 오류 1, 점검이 필요한 정지(stalled·infra·argv_limit·interrupted) 2 |
| `report` | runDir의 두 원장으로 `report.md`와 `metrics.json`을 다시 쓴다. `--compare`는 이전 실행의 지표를 나란히 싣는다. | 0 |

오류는 `오류: ...` 한 줄을 출력하고 1로 끝난다. 처음에는 `preflight`, `smoke`, `run --target seed --mode rule --max-cycles 2` 순으로 확인한다.

## 플래그

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--target` | (run에서 `--continue-from`이 없으면 필수) | 대상 레포 경로 또는 `seed`. 하네스는 이것을 `runDir/target/main`에 clone해서만 작업한다. |
| `--continue-from` | 없음 | Iter 2용. 이전 runDir의 `target/main`을 clone 원본으로 쓴다. 이전 실행을 이어 가는 것이 아니다. |
| `--run-dir` | `~/ensemble-dogfood/<YYYYMMDD-HHmm>-iter<N>` | 없거나 비어 있어야 하고 Ensemble 저장소 밖이어야 한다. report에서는 필수다. |
| `--iteration` | 1 | 1, 2, 3. `DOGFOOD_GOAL.md`의 `## Iter N` 절과 BACKLOG의 `[iter:N]` 에픽을 고른다. |
| `--mode` | live | `live` 또는 `rule`. |
| `--max-cycles` | 120 | 사이클 상한. |
| `--cycle-minutes` | 20 | live에서 사이클 사이에 기다리는 분. 1초 단위로 기다리며 정지 신호를 확인한다. rule에서는 기다리지 않는다. |
| `--max-hours` | 48 | 시간 상한. 0이면 제한하지 않는다. |
| `--budget-tokens` | 20000000 | 가중 토큰 상한(캐시 없는 입력 + 출력 + 0.1×캐시 읽기 + 1.25×캐시 생성, PM 출처는 입력 전체). 0이면 제한하지 않는다. |
| `--teammates` | 2 | 가상 팀원 수(1 또는 2). 템플릿의 flow 작업이 designer 몫이라 0은 받지 않는다. |
| `--probe-every` | 3 | 현황 프로브를 몇 사이클마다 돌릴지. |
| `--port` | 0 | HTTP 어댑터 포트. 0이면 빈 포트. |
| `--pm-runtime` | claude | `claude` 또는 `api`. codex PM은 지원하지 않는다. |
| `--agent-runtime` | claude | 실행 Agent 런타임(`claude` 또는 `codex`). |
| `--next-step-assignee` | pm | `pm` 또는 `designer`. designer이면 다음 단계 요청에 "디자이너에게 맡겨 주세요"를 덧붙인다. |
| `--harness-model` | 없음 | 하네스 역할(대리, 팀원, 기록자, 프로브)의 claude 모델. |
| `--session-timeout-minutes` | 25 | 팀원·프로브 세션 하나의 제한 시간. |
| `--teammate-budget-usd` | 3 | 팀원 세션 하나의 예산. |
| `--proxy-budget-usd` | 0.5 | 결정 대리·기록자·프로브 호출 하나의 예산. |
| `--settle-seconds` | live 300, rule 10 | 제품이 가라앉기를 기다리는 최대 시간. |
| `--human-result-wait-seconds` | live 300, rule 15 | 사람 결과 제출 뒤 PM의 처리 증거를 기다리는 최대 시간. |
| `--argv-limit` | 30000 | PM 요청의 명령줄 추정 길이 한도. 넘으면 `argv_limit`로 정지한다. |
| `--env-file` | 없음 | `runDir/.env.dogfood`로 복사해 제품이 읽게 한다. API 키처럼 제품 설정을 넘길 때 쓴다. `SLACK_`로 시작하는 줄은 복사하지 않는다(제품이 이 파일을 다시 읽어 Slack 연동이 켜지는 것을 막는다). 걸러낸 키 이름은 `run.json`의 `strippedSlackKeys`에 남는다. |
| `--compare` | 없음 | report 전용. 비교할 이전 runDir. |
| `--skip-live` | 꺼짐 | preflight 전용. claude를 호출하는 점검을 건너뛴다. |

`smoke`는 `--mode rule`, `--target seed`, `--max-cycles 20`, `--cycle-minutes 0`, `--probe-every 2`, 임시 `--run-dir`를 기본값으로 덮어쓴다. 같은 이름의 플래그를 직접 주면 그 값이 이긴다.

## runDir 구조

| 경로 | 내용 |
|---|---|
| `.lock` | 실행 중인 하네스의 pid. |
| `run.json` | 설정, 시작 시각, 걸러낸 `SLACK_*` 키 이름(`strippedSlackKeys`). |
| `.env.dogfood` | 제품이 읽는 환경 파일(`--env-file`의 복사본에서 `SLACK_*` 줄을 뺀 것, 없으면 빈 파일). |
| `data/` | 제품 원장 `ensemble.db`, `runtime.json`, `attachments/`. |
| `agents/` | 실행 Agent의 작업 폴더. |
| `target/main` | 대상 레포 clone. 팀원 브랜치는 하네스가 여기에 머지한다. |
| `target/teammate-a`, `target/teammate-b` | 팀원 git worktree. |
| `secrets/<id>.token` | 팀원의 Space 토큰. 원장과 로그에는 `***`로 가린다. |
| `dogfood.db` | 하네스 원장(SQLite). 지표와 귀속의 정본이다. |
| `logs/c<cycle>-<역할>.json` | claude 호출 기록. 프롬프트와 시스템 프롬프트는 남기지 않는다. `pids.json`은 정리한 자식 프로세스다. |
| `probe-cwd/` | 현황 프로브의 빈 작업 폴더. |
| `report.md`, `metrics.json` | 사이클마다 덮어쓴다. |

지표와 리포트는 `data/ensemble.db`와 `dogfood.db` 두 원장에서만 계산한다. 공식의 정본은 [metrics.ts](metrics.ts)다.

## 사이클

한 사이클은 다음 순서다.

1. `cycle_started`. rule이면 `tick`을 한 번 부른다.
2. settle(제품이 가라앉을 때까지 대기).
3. 결정 대리 owner, designer. 대기 중인 사람 결과 재확인. 사람 몫 작업 대리. settle.
4. 팀원 A, B를 차례로(머지, 통합 테스트, backlog_progress까지). settle.
5. 다음 단계 요청(07에서 02로 가는 고리). settle.
6. live이면 실행 Agent 토큰 수집. 마찰 기록. 프로브(probe-every마다).
7. `cycle_finished`. `report.md`와 `metrics.json` 갱신.

정지 사유는 `run_stopped.reason`에 남는다.

| 사유 | 조건 |
|---|---|
| `done` | 이번 반복 백로그가 모두 verifiedDone(대상 레포 main에 머지되고 테스트 통과)이고, 진행 중 작업과 열린 결정이 없다. |
| `max_cycles`, `max_hours`, `budget` | 상한에 닿았다. |
| `argv_limit` | PM 요청의 명령줄 추정 길이가 `--argv-limit`을 넘었다. |
| `infra` | 인프라 대기가 연속 6사이클 일어났다. |
| `stalled` | 진척 서명이 같고 하네스 행동이 0인 사이클이 3번 연속이다. 하네스 행동은 성공한 대리 행동, 사람 결과 제출, 그리고 팀원 세션 중 건너뛰지 않았고 오류가 없으며 커밋이나 제출이 있는 것이다(오류로 끝난 세션은 세지 않는다). 자동 행동 상한에 걸려 있으면 detail이 `automation_limit`, 후보 없이 상한에 걸리면 즉시 정지한다. 모든 항목이 보드에서는 끝났는데 verified가 아닌 채 3사이클 머물면 detail이 `board_only`다. |
| `interrupted` | SIGINT, SIGTERM, SIGHUP, SIGBREAK(Windows)를 받았다. 진행 중인 claude를 끝내고 정리한다. |
| `error` | 예외. 계획 초안이 3번 실패하면 detail이 `plan_draft_failed`다. |

정리 순서는 run_stopped, 리포트, 호스트 종료, 남은 자식 프로세스 정리(Windows는 `taskkill /T /F`), `logs/pids.json`, 원장 닫기, 잠금 해제다.

## 규칙 모드

`--mode rule`은 claude·네트워크·모델 없이 돈다. PM과 Agent는 제품의 fake 런타임이고, 결정 대리·사람 몫 작업·팀원은 결정적 규칙이다. 하네스 배선과 지표 계산을 점검하는 용도라서 모델의 판단 품질은 재지 못한다. `npm test`의 스모크가 이 모드를 쓴다. `DOGFOOD_FORBID_CLAUDE=1`이면 claude 해석과 호출 자체를 막는다.

## Windows 메모

- **claude.exe 해석.** 제품의 셸 없는 `spawn('claude')`는 `claude.cmd`를 실행하지 못한다. 하네스는 `DOGFOOD_CLAUDE_EXE`, PATH의 `claude.exe`, `claude.cmd` 옆 npm 설치, `~/.local/bin/claude.exe` 순으로 찾는다. 설정했는데 파일이 없으면 오류다. 찾은 폴더가 PATH에 없으면 앞에 붙이고, 그 사실을 `run_started.adapters.pathPrepend`에 남긴다.
- **argv 어댑터.** Windows에서 PM CLI는 시스템 프롬프트와 해석 스키마를 명령줄 인자로 넘긴다. 사람 메시지가 쌓이면 32,767자 한도를 넘는다. 하네스는 스키마를 의미가 같은 `$defs/$ref`로 압축한다(`adapters.pmSchemaRef`). 압축 뒤에도 추정 길이가 `--argv-limit`을 넘으면 마찰 R13을 남기고 `argv_limit`로 정지한다.
- **argv_limit로 멈추면.** WSL에서 다시 돌리거나 `--pm-runtime api`로 바꾼다. api 런타임은 명령줄을 쓰지 않아 한도를 두지 않는다. API 키와 비용은 사용자가 정한다. 이 전환은 기준선과 다른 점이라 리포트에 기록한다.
- **Git Bash.** Claude Code는 Windows에서 Git Bash가 필요하다. 기본 경로는 `C:\Program Files\Git\bin\bash.exe`이고, 다르면 `CLAUDE_CODE_GIT_BASH_PATH`를 설정한다. preflight가 확인한다.
- 장시간 실행에는 `claude setup-token`으로 만든 `CLAUDE_CODE_OAUTH_TOKEN`을 권장한다. 절전과 화면 잠금 절전에 들어가면 멈추므로 전원 설정을 바꾼다.
- 대상 레포 git은 항상 `-c core.longpaths=true`로 부른다.

## 재개 미지원과 잠금

재개는 지원하지 않는다. 턴 타이머가 메모리에만 있어 중간에 끊기면 고아 작업이 생기기 때문이다. 끊긴 실행은 `report`로 부분 결과를 보고, 새 `--run-dir`로 다시 돈다. 비어 있지 않은 runDir은 거부한다.

runDir의 `.lock`에 하네스 pid가 있다. 살아 있는 pid면 다른 하네스가 쓰는 중이라 거부하고, 죽은 pid거나 깨진 파일이면 덮어쓴다.

## 인프라 대기

사용량 한도, 로그인 만료, 과부하처럼 하네스 밖의 사정으로 claude가 실패하면 `dogfood_infra_pause`를 남기고(메시지의 `resets 5pm`은 KST로 읽고, 못 읽으면 60분) 그 시각까지 기다린다. 대기 중인 사이클은 tick, settle, 마찰 기록, 리포트만 돌고 대리·팀원·프로브는 건너뛴다. 대기 사이클은 정체(stalled) 판정에 세지 않는다. 대기가 풀린 뒤 다시 실패하는 일이 연속 6사이클이면 `infra`로 정지한다. 프로브가 인프라 사유로 실패하면 기록하지 않고 다음 사이클에 다시 한다. 인프라 외 사유로 실패한 프로브는 `failed: true`로 남고 현황 파악 지표의 분모에서 빠진다(`statusLookup.failedProbes`).

제품 실행 Agent가 같은 사유로 막힌 경우(`task_blocked`)도 하네스가 같은 `dogfood_infra_pause`(`source: ensemble-agent`)로 남긴다. 이 막힘은 결정 대리의 retry 횟수(`blockCount`)에 넣지 않는다. 대기가 끝나면 인박스의 `infraRetryReady`가 참이 되고, 규칙·live 대리 모두 그 작업을 retry할 수 있다.

## 목표 기한

대상 레포 `DOGFOOD_GOAL.md`의 `기한: YYYY-MM-DD`(또는 `기한은 YYYY-MM-DD…`) 줄만 `goal_set.deadline`이 된다. 그 줄은 목표 본문에서 빠진다. 줄이 없으면 기한 없이 시작한다. `--max-hours`는 정지 판정에만 쓰고 제품에 기한으로 넘기지 않는다(기준선이 하네스 설정에 흔들리지 않게).

## 사후 열람

끝난 실행을 화면으로 보려면 원본을 건드리지 말고 `data/`를 복사해 fake 런타임으로 Next를 띄운다. WebRuntime이 시작할 때 `runtime.json`을 쓰기 때문이다.

```
# PowerShell
Copy-Item -Recurse <runDir>\data $env:TEMP\dogfood-view
$env:ENSEMBLE_DATA_DIR = "$env:TEMP\dogfood-view"
$env:ENSEMBLE_PM_RUNTIME = "fake"
$env:ENSEMBLE_AGENT_RUNTIME = "fake"
# app/.env가 로드되어 SLACK_* 키로 실제 Slack에 붙는 것을 막는다.
New-Item -ItemType File -Force "$env:TEMP\dogfood-view.env" | Out-Null
$env:ENSEMBLE_ENV_FILE = "$env:TEMP\dogfood-view.env"
Get-ChildItem Env: | Where-Object Name -like "SLACK_*" | ForEach-Object { Remove-Item "Env:$($_.Name)" }
cd app; npm run dev
```

`ENSEMBLE_ENV_FILE`은 복사본 data 밖의 빈 파일로 두고(원본 env를 가리키지 않는다), `SLACK_`로 시작하는 환경변수는 모두 지운 셸에서 띄운다. 하네스가 실행 중에 같은 차단을 하므로 사후 열람에서도 맞춘다. 위 예시의 마지막 두 줄이 그 절차다. 빈 파일을 지정하지 않으면 `app/.env`를 읽는다.

화면의 PM은 fake라서 새 판단을 하지 않는다. 기록된 원장만 본다.

## 문서

- [도그푸딩 계획](../../docs/dogfooding/plan.md): 목적, 역할, 지표, 반복 계획, 위험.
- [PM Workflow 7단계](../../docs/dogfooding/pm-workflow.md): 단계별 정의와 현재 구현 판정.
- [기능 모판](../../docs/dogfooding/feature-seedbed.md): 마찰이 매핑되는 갭 G1~G16.
