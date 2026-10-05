# 팀 오케스트레이션 시연 e2e (W3 통합, 2026-10-05)

W1(#65 결과 수신 API)과 W2(#66 팀 오케스트레이션 시연)를 합친 브랜치에서 [런북](../../team-orchestration-demo.md)을 처음부터 끝까지 돌린 기록입니다. 모델은 쓰지 않았습니다(`ENSEMBLE_PM_RUNTIME=fake`, `ENSEMBLE_AGENT_RUNTIME=fake`). Windows 11, Node 24.18.0, Next.js 16.3.6 dev 서버를 썼고, 화면은 Playwright Chromium(1440×1000)으로 찍었습니다.

## 단계별 결과

| 단계 | 결과 |
|---|---|
| (a) dev 서버 | `Ready in 477ms` |
| (b) 시나리오 시작 | `POST /api/scenario/start` 200. 화면에서는 "팀 시연" 버튼 → 보관 확인 → 계획 카드 |
| (c) 계획 승인 | `POST /api/scenario/next` 202 → 채널에 `@김상성 로그인 API 구현을 곧 시작합니다.` 시나리오 바는 "Ensemble 밖에서 진행"을 표시 |
| (d) 개인 Agent 제출(실제 전송) | `접수됨: {"ok":true,"taskId":"T-1","resultIndex":0}` (exit 0) |
| (e) 상태 확인 | T-1 `checked`, T-2(UX Agent)는 T-1 결과를 계기로 자동 시작(`task_start_reserved.trigger` = T-1 결과 ID)된 뒤 `checked`, T-3는 박OO 차례(`reserved`). `results[0].via` = `{channel:"ide", agent:"김상성의 Coding Agent"}`, `results[0].artifacts`에 PR URL(`text/uri-list`)과 보고서(`data:` URI) |
| (f) 브라우저 | 계획 카드 배지(사람 2, Agent 1), 결과 줄의 출처 칩과 🔗 Pull Request 링크, "자동 인계" 줄, 작업 패널 배지와 칩, T-2 상세의 자동 시작 활동 기록 |

처음 돌렸을 때 (d)는 `409 invalid_state`로 실패했습니다. 계획 승인 뒤 사람 작업은 `reserved` 상태(시작 알림을 보낸 상태)로 남는데, 엔드포인트가 `ready`/`running`만 받았기 때문입니다. 아래 로그는 이것을 고친 뒤의 최종 실행입니다. 고친 내용은 PR 본문에 있습니다.

## 화면

| 파일 | 내용 |
|---|---|
| `01-plan-badges.png` | 계획 v1 카드: 작업마다 👤 사람 / 🤖 Agent 배지 |
| `02-approved-notice.png` | 승인 뒤 `@김상성 … 곧 시작합니다` 알림, 시나리오 바 "Ensemble 밖에서 진행" |
| `03-result-via-autohandoff.png` | 김상성의 결과 줄(출처 칩, PR 링크), PM 자동 인계 줄, 작업 패널(완료 묶음을 편 상태) |
| `04-result-via-pr-link.png` | 결과 메시지만: `↗ IDE · 김상성의 Coding Agent`, `🔗 Pull Request` |
| `05-autohandoff-line.png` | PM 메시지만: `자동 인계` 칩과 "T-1 확인 → T-2를 UX Agent에게" 한 줄 |
| `06-work-panel-badges.png` | 작업 패널: T-1 👤 + 출처 칩, T-2 🤖 + 자동 인계 칩, T-3 👤 진행 중 |
| `07-t2-detail.png` | T-2 상세: 자동 인계 표시, 활동 기록 "“로그인 API 구현” 확인 뒤 PM이 자동으로 맡겨 작업을 시작했어요" |

## 명령 출력 (최종 실행)

`/api/state`는 뷰 모델이라 `checked`가 `done`으로 보입니다. 그래서 (e-2)에서 같은 DB의 원장을 `project()`로 투영한 값도 함께 남겼습니다. (f)의 첫 `kind badges` 줄은 작업 패널의 "완료" 묶음을 펴기 전에 센 값이고, 편 뒤의 값은 그 다음 줄입니다.

```text
$ (a) ENSEMBLE_PM_RUNTIME=fake ENSEMBLE_AGENT_RUNTIME=fake ENSEMBLE_DATA_DIR=../../data/team-demo npm run dev
▲ Next.js 16.3.6 (Turbopack)
- Local:         http://localhost:3000
✓ Ready in 477ms

=== (b) 시나리오 시작
$ curl -X POST http://localhost:3000/api/scenario/start -d {"name":"team-orchestration","confirmReplace":true}
HTTP 200
scenario: {"name":"팀 오케스트레이션","done":false,"nextLine":{"authorName":"박OO","text":"PM의 계획 v1을 승인합니다","hasAttachment":false}}
-- 채널 메시지
 [human:박OO] 로그인 기능을 이번 주 안에 출시한다. 사람과 Agent가 함께 일하고, 김상성은 자기 Coding Agent로 API를 만든다.
 [pm:PM] 계획 v1 초안을 확인하고 승인해 주세요. 로그인 API는 김상성님이, 화면 검토는 UX Agent가 맡아요.
-- 작업

=== (c) 계획 승인 (시나리오 바 다음 단계)
$ curl -X POST http://localhost:3000/api/scenario/next -d {}
{"accepted":true}
HTTP 202
scenario: {"name":"팀 오케스트레이션","done":false,"nextLine":{"authorName":"김상성의 Coding Agent (Ensemble 밖)","text":"터미널에서 실행: node scripts/personal-agent-submit.mjs --task T-1 --member kim-sangsung --pr https://github.com/example/ensemble/pull/1 --summary \"로그인 API 구현\"","hasAttachment":false,"external":true}}
-- 채널 메시지
 [human:박OO] 로그인 기능을 이번 주 안에 출시한다. 사람과 Agent가 함께 일하고, 김상성은 자기 Coding Agent로 API를 만든다.
 [pm:PM] 계획 v1 초안을 확인하고 승인해 주세요. 로그인 API는 김상성님이, 화면 검토는 UX Agent가 맡아요.
 [system:system] 계획 v1 승인 — 박OO
 [pm:PM] @김상성 로그인 API 구현을 곧 시작합니다.
-- 작업
  T-1 로그인 API 구현 | 담당 김상성 (human) | in_progress
  T-2 로그인 화면 UX 검토 | 담당 UX Agent (agent) | todo
  T-3 최종 출시 결정 | 담당 박OO (human) | todo

=== (d) 김상성의 개인 Coding Agent가 T-1 결과를 실제로 보낸다
$ node scripts/personal-agent-submit.mjs --task T-1 --member kim-sangsung --pr https://github.com/example/ensemble/pull/1 --summary 로그인 API 구현
[김상성의 Coding Agent] T-1 결과를 보냅니다 → http://localhost:3000/api/tasks/T-1/result
접수됨: {"ok":true,"taskId":"T-1","resultIndex":0}
exit=0

=== (e) GET /api/state 확인 (T-2 완료까지 대기)
scenario: {"name":"팀 오케스트레이션","done":true}
-- 채널 메시지
 [human:박OO] 로그인 기능을 이번 주 안에 출시한다. 사람과 Agent가 함께 일하고, 김상성은 자기 Coding Agent로 API를 만든다.
 [pm:PM] 계획 v1 초안을 확인하고 승인해 주세요. 로그인 API는 김상성님이, 화면 검토는 UX Agent가 맡아요.
 [system:system] 계획 v1 승인 — 박OO
 [pm:PM] @김상성 로그인 API 구현을 곧 시작합니다.
 [human:김상성] 로그인 API 구현 결과를 IDE · 김상성의 Coding Agent(으)로 보냈어요: 로그인 API 구현  {result via=IDE · 김상성의 Coding Agent links=https://github.com/example/ensemble/pull/1}
 [pm:PM] 로그인 API 구현 결과(IDE · 김상성의 Coding Agent)를 확인했어요. 인계 조건을 채워 로그인 화면 UX 검토 작업을 UX Agent에게 자동으로 맡겨 시작했습니다.  {autoStart T-1→T-2 UX Agent}
 [pm:PM] @김상성 "로그인 API 구현" 결과를 확인했어요. 다음은 UX Agent가 "로그인 화면 UX 검토"를 시작합니다.
 [agent:UX Agent] [로그인 화면 UX 검토] UX Agent 결과 무엇이 됐나: 시연용 가상 자료: 로그인 화면 UX 검토 할 일: PM 검토 대기 확인하지 못한 점: 실제 사용자 테스트 없이 선행 결과 요약만 읽고 점검 확인할 곳: 로그인 화면 UX 검토.md
 [pm:PM] @박OO 최종 출시 결정을 곧 시작합니다.
-- 작업
  T-1 로그인 API 구현 | 담당 김상성 (human) | done
  T-2 로그인 화면 UX 검토 | 담당 UX Agent (agent) | done | 자동 시작(T-1→)
  T-3 최종 출시 결정 | 담당 박OO (human) | in_progress
T-1 latestResult: {
  "summary": "로그인 API 구현",
  "links": [
    {
      "name": "Pull Request",
      "url": "https://github.com/example/ensemble/pull/1"
    }
  ],
  "via": {
    "channel": "ide",
    "agent": "김상성의 Coding Agent",
    "label": "IDE · 김상성의 Coding Agent"
  }
}
T-2 autoStartedBy: {"fromTaskId":"T-1","fromTitle":"로그인 API 구현","toTaskId":"T-2","toTitle":"로그인 화면 UX 검토","agentName":"UX Agent","viaLabel":"IDE · 김상성의 Coding Agent"}

=== (e-2) 원장 투영 (packages/core project(), 같은 DB)
T-1 assignee=kim-sangsung(human) status=checked
T-2 assignee=ux-agent(agent) status=checked
T-3 assignee=owner(human) status=reserved
T-1 results[0].via = {"channel":"ide","agent":"김상성의 Coding Agent"}
T-1 results[0].artifacts = [{"name":"Pull Request","mimeType":"text/uri-list","uri":"https://github.com/example/ensemble/pull/1"},{"name":"T-1 결과 보고.md","mimeType":"text/markdown","uri":"data:text/markdown;base64,IyBULTEg6rKw6r…"}]
ledger order (T-1): estimate_updated → task_meta_set → task_start_reserved → attachment_recorded → attachment_recorded → task_started → result_submitted → validation_started → validation_finished → handoff_reviewed → task_checked
T-2 start trigger: {"taskId":"T-2","specVersion":1,"trigger":"result:f93ea12e-4cc2-4304-8ba6-8221c58fd50d"}

=== (f) 브라우저 (Playwright, Chromium 1440×1000): 팀 시연 버튼 → 다음 단계 → 스크립트 제출
replace prompt shown → confirming
[b] plan card badges: human 2 agent 1
[c] notice visible; scenario bar external hint: true
[d] [김상성의 Coding Agent] T-1 결과를 보냅니다 → http://localhost:3000/api/tasks/T-1/result
접수됨: {"ok":true,"taskId":"T-1","resultIndex":0}
[f] via chips: [ '↗ IDE · 김상성의 Coding Agent' ]
[f] PR links: [ '🔗 Pull Request → https://github.com/example/ensemble/pull/1' ]
[f] auto-handoff lines: [
  '자동 인계“로그인 API 구현” 확인 (IDE · 김상성의 Coding Agent) → “로그인 화면 UX 검토” 작업을 UX Agent에게 자동으로 맡김'
]
[f] kind badges: human 1 agent 0
[f] work panel badges: human 2 agent 1 | via chips 1 | 자동 인계 chips 1
[f] T-2 detail activity shows auto start
```
