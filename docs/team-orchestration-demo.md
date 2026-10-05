# 팀 오케스트레이션 시연 (team-orchestration)

이 시연은 한 가지를 보여 줍니다. **PM은 사람과 Agent가 섞인 팀을 운영한다. 사람은 자기 Agent를 직접 써도 되고, 그 결과는 같은 Team Work State로 이어진다.**

예전 시연("Ensemble이 PM에게 로그인 구현을 맡김 → PM → Dev/UX Agent")은 멀티 Agent 오케스트레이션처럼 읽혔습니다. 이번 시연에서는 실행의 입구가 PM 하나가 아닙니다. 김상성은 Ensemble 밖에서 자기 Coding Agent로 일하고, 그 결과가 들어오면 PM이 인계 조건을 확인해 다음 작업을 UX Agent에게 맡깁니다.

## 흐름

| 단계 | 일어나는 일 | 화면에서 보이는 것 |
|---|---|---|
| 1 | 목표와 PM의 계획 v1이 들어온다. T-1 "로그인 API 구현"(김상성, 사람), T-2 "로그인 화면 UX 검토"(UX Agent, T-1 다음), T-3 "최종 출시 결정"(박OO, 사람) | 계획 카드의 작업마다 👤 사람 / 🤖 Agent 배지 |
| 2 | 박OO이 계획을 승인하면 PM이 채널에서 김상성을 호출한다 | `@김상성 로그인 API 구현을 곧 시작합니다.` |
| 3 | 김상성이 **자기 Coding Agent**로 Ensemble 밖에서 작업하고, 결과(PR URL과 요약, 결과 보고서)를 `POST /api/tasks/T-1/result`로 보낸다(스크립트가 이 역할을 대신함) | 김상성 이름으로 "결과를 IDE · 김상성의 Coding Agent(으)로 보냈어요"와 출처 칩, 🔗 Pull Request 링크 |
| 4 | PM이 결과를 받아 인계 판단을 하고(checked), T-2를 UX Agent에게 자동으로 맡겨 시작한다 | PM 줄 "… 결과(IDE · 김상성의 Coding Agent)를 확인했어요. … UX Agent에게 자동으로 맡겨 시작했습니다." + `자동 인계` 표시 |
| 5 | UX Agent의 점검 결과도 같은 인계 판단을 거치고, T-3 출시 결정은 다시 사람(박OO)에게 간다 | 작업 패널: T-1 완료, T-2 완료, T-3 박OO 차례. 시나리오 바: "시나리오 끝" |

계획과 인계 판단은 모델 없이 정해진 값으로 나옵니다(`ENSEMBLE_PM_RUNTIME=fake`). 계획 승인, 시작 알림, 인계 판단, 다음 작업 시작, 기록은 모두 실제 PM 코드가 처리합니다.

## 런북

`app/` 디렉터리에서 실행합니다.

```sh
# 0) 의존성
npm ci

# 1) 서버: 규칙 기반 PM과 가짜 Agent. 시연용 데이터 폴더는 따로 둔다.
#    `npm run dev`는 apps/web에서 돌기 때문에 상대 경로는 apps/web 기준이다. ../../data/team-demo = app/data/team-demo(gitignore 대상).
ENSEMBLE_PM_RUNTIME=fake ENSEMBLE_AGENT_RUNTIME=fake ENSEMBLE_DATA_DIR=../../data/team-demo npm run dev
#    PowerShell: $env:ENSEMBLE_PM_RUNTIME='fake'; $env:ENSEMBLE_AGENT_RUNTIME='fake'; $env:ENSEMBLE_DATA_DIR='../../data/team-demo'; npm run dev
#    packages/* 코드를 고친 뒤에는 서버를 다시 켠다. 핫 리로드는 이미 만든 런타임의 PM을 바꾸지 않는다.

# 2) 시나리오 시작: 브라우저 http://localhost:3000 → 상단 "팀 시연" 버튼
#    (진행 중인 프로젝트가 있으면 "진행 중인 프로젝트는 보관되고 화면에서 사라집니다." 확인이 한 번 뜬다)
#    (또는)
curl -s -X POST localhost:3000/api/scenario/start -H 'Content-Type: application/json' \
  -d '{"name":"team-orchestration","confirmReplace":true}' > /dev/null

# 3) 계획 승인: 채널의 계획 카드에서 "승인" 또는 시나리오 바의 "다음 단계"
#    (또는)
curl -s -X POST localhost:3000/api/scenario/next -H 'Content-Type: application/json' -d '{}'
#    → 채널: "@김상성 로그인 API 구현을 곧 시작합니다."
#    → 시나리오 바: "Ensemble 밖에서 진행" (다음 단계는 개인 Agent가 한다)
#    → 이때 T-1은 `reserved`(시작 알림을 보낸 사람 작업, 화면에는 "진행 중")다. 결과 API는 이 상태를 받는다.

# 4) 김상성의 개인 Coding Agent가 결과를 보낸다. 먼저 요청 본문을 확인하고:
node scripts/personal-agent-submit.mjs --task T-1 --member kim-sangsung \
  --pr https://github.com/example/ensemble/pull/1 --summary "로그인 API 구현" --dry-run
#    실제로 보낸다(기본 토큰 dev-token, 기본 주소 http://localhost:3000):
node scripts/personal-agent-submit.mjs --task T-1 --member kim-sangsung \
  --pr https://github.com/example/ensemble/pull/1 --summary "로그인 API 구현"

# 5) 화면에서 확인
#    - 채널: 김상성의 결과 줄(출처 칩 "IDE · 김상성의 Coding Agent", 🔗 Pull Request)
#    - 채널: PM의 "자동 인계" 줄 (T-1 확인 → T-2를 UX Agent에게)
#    - 작업 패널: T-2 진행 중 → 약 2초 뒤 완료, T-3는 박OO 차례("완료" 묶음은 접혀 있으니 눌러서 편다:
#      T-1 👤 사람 + 출처 칩, T-2 🤖 Agent + "자동 인계" 칩)
#    - T-2 상세의 활동 기록: "“로그인 API 구현” 확인 뒤 PM이 자동으로 맡겨 작업을 시작했어요"
```

스크립트 옵션: `--base`(기본 `ENSEMBLE_URL` 또는 `http://localhost:3000`), `--token`(기본 `ENSEMBLE_TOKEN` 또는 `dev-token`), `--agent`(기본 "김상성의 Coding Agent"), `--channel`(`ide|slack|knox|cli|ensemble`, 기본 `ide`), `--condition`(여러 번 줄 수 있음. 없으면 `GET /api/tasks/T-1`에서 인계 조건을 읽고, 읽지 못하면 T-1 기본값을 씀), `--no-report`(PR 링크만 보냄).

스크립트는 PR 링크와 함께 `T-1 결과 보고.md`를 파일 산출물로 보냅니다. 보고서에는 인계 조건마다 한 절(`### n. 조건`)이 있습니다. PM의 인계 판단은 결과 **파일**에서 근거를 인용해야 하고 결과 요약은 근거로 치지 않습니다. 그래서 PR 링크만 보내면 PM이 근거를 찾지 못합니다.

## 3장 메시지 요약

**1. Agent Orchestration → Team Orchestration**
- 예전에는 "PM이 Agent 여럿을 부린다"로 읽혔습니다. 이제는 "PM이 **사람과 Agent가 섞인 팀**을 운영한다"입니다.
- 계획에서부터 담당이 사람(👤)인지 Agent(🤖)인지 드러나고, PM은 두 경우를 같은 규칙(인계 조건, 의존 관계, 결정권자)으로 다룹니다.

**2. 사람은 자기 Agent를 직접 쓴다. PM이 실행의 유일한 입구가 아니다**
- 김상성은 Ensemble 안에서 일하지 않습니다. 자기 IDE의 Coding Agent로 일하고 결과만 보냅니다.
- 결과에는 어디서 왔는지(`via`: IDE · 김상성의 Coding Agent)가 붙고, PM은 출처와 상관없이 같은 인계 판단을 한 뒤 다음 담당(UX Agent)에게 넘깁니다.

**3. Persistent Team Work State가 해자다 (Context + Tasks + Decisions + Artifacts)**
- 누가 어떤 도구로 일했든 결과는 하나의 원장으로 모입니다. 목표와 맥락, 작업과 의존 관계, 결정, 산출물(PR 링크, 보고서)이 여기에 쌓입니다.
- 그래서 다음 작업이 자동으로 이어지고, 나중에 누가 무엇을 근거로 넘겼는지 되짚을 수 있습니다. 실행 도구는 바뀔 수 있지만 팀 작업 상태는 남습니다.

## 현재 한계

- **실제 IDE·Slack·Knox 연동은 없습니다.** 개인 Agent 쪽은 `scripts/personal-agent-submit.mjs`가 흉내 냅니다. `via.channel`은 표시용 라벨입니다.
- **인증은 단순 토큰입니다.** 개발 모드에서는 `Authorization: Bearer dev-token`을 받습니다. 사람별 토큰 발급, 권한 범위, 만료는 없습니다.
- 계획은 고정값이고(`apps/web/lib/fake-connector.ts`의 `TEAM_ORCHESTRATION_PLAN`), 모델이 계획을 만들지 않습니다. 인계 판단은 규칙 기반 PM이 결과 파일에서 조건을 인용하는 방식입니다.
- 시작 알림 문구는 PM 코드의 기본 문구("@김상성 로그인 API 구현을 곧 시작합니다.")입니다. 기획 문서의 예시("T-1 시작할 수 있습니다")와 표현이 조금 다릅니다.
- UX Agent의 점검 결과는 시연용 가상 문서입니다(실제 사용자 테스트 없음).

## 통합 상태 (W1 + W2, W3에서 확인)

W1(결과 수신 API, #65)과 W2(이 시연, #66)는 W3 브랜치에서 합쳐졌고, 위 런북을 그대로 처음부터 끝까지 돌렸습니다. 명령 출력과 화면은 [docs/qa/team-orchestration/](qa/team-orchestration/README.md)에 있습니다.

- 계약: `POST /api/tasks/:id/result`, `Authorization: Bearer <token>`(`ENSEMBLE_MEMBER_TOKENS`가 없으면 `dev-token`), 본문 `{ memberId, summary, artifacts?, via? }`, 응답 `{ ok: true, taskId, resultIndex }`. 모델 판단 없이 바로 기록합니다.
- 기록 순서: `attachment_recorded`(산출물마다) → `task_started`(아직 시작 기록이 없으면) → `result_submitted`(`via` 포함) → PM 인계 판단 → 의존 작업 시작. 받을 수 있는 상태는 `ready`, `running`, 그리고 사람 담당의 `reserved`입니다.
- `url` 산출물은 `text/uri-list` 첨부로 `artifactIds`에 들어가고, 인계 판단은 그 URL을 텍스트로 읽습니다. 그래서 PR 링크가 함께 있어도 보완 요청으로 끝나지 않습니다(W2가 걱정한 경우는 재현되지 않음). `file` 산출물은 `data:` URI 첨부입니다.
- `via`와 산출물은 `result_submitted`와 투영된 결과(`task.results[i].via`, `task.results[i].artifacts`) 양쪽에 있습니다.
- 회귀 테스트: `packages/orchestrator/test/external-result.test.ts`(HTTP 경로), `test/team-orchestration.test.ts`(실제 런타임에서 계획 승인 → 실제 엔드포인트로 T-1 제출 → T-2 자동 시작·완료 → T-3 사람 차례). 루트 `npm test`가 두 위치를 모두 돌립니다.

## 코드 위치

- 시나리오 시드와 `via` 도우미: `app/apps/web/lib/team-orchestration.ts`
- 고정 계획과 UX Agent 결과: `app/apps/web/lib/fake-connector.ts` (`TEAM_ORCHESTRATION_PLAN`, `uxReviewMarkdown`)
- 시나리오 시작과 "다음 단계": `app/apps/web/lib/runtime.ts` (`startScenario('team-orchestration')`, `teamNext`)
- 뷰 모델: `app/apps/web/lib/build-view-model.ts` (`latestResult`, `autoStartedBy`, `assigneeKind`, 채널의 결과 줄과 자동 인계 줄)
- 화면: `app/apps/web/components/TeamBadges.tsx`와 이를 쓰는 작업 패널, 일정, 계획 카드, 작업 상세, 메시지
- 개인 Agent 스크립트: `app/scripts/personal-agent-submit.mjs`
