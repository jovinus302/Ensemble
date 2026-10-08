# 실험 · 개인 Agent의 Space 참여와 PM Agent의 개인 환경 접근 (#81)

기준: 2026-10-07, jovinus302/Ensemble main@6eb0c04 위 브랜치 `jovinus302/issue-81-personal-agent`. 분류: EXPERIMENT. 제품 의도([#81](https://github.com/jovinus302/Ensemble/issues/81))는 고정이고, 아래 기술 수단은 첫 검증용 선택이다.

2026-10-08 갱신: PR #85 교차 리뷰의 F1–F4(재전달 누락, 요청함 링크 탈출 전 폴더 생성, 빈 허용 경로의 전체 허용, 인증 없는 폴더 연결)를 고치고 같은 방식의 실제 왕복을 다시 돌렸다. 바뀐 계약은 2절, 새 관찰은 3.2절, 고친 주장은 4절이다.

## 1. 선택한 경로와 이유

첫 대상은 **사용자의 기존 Codex CLI 하나, 이미 있던 작업 폴더 하나, Space(현재 프로젝트) 하나**다.

| 방향 | 수단 | 왜 이것부터 |
|---|---|---|
| 개인 Agent → Space | HTTP. `GET …/context?format=md`로 읽고 `POST …/posts`로 공유 | 브라우저나 curl만 있으면 되는 가장 낮은 공통분모다. 실험에서 Codex는 별도 설치 없이 PowerShell `Invoke-RestMethod`로 읽고 썼다. 같은 URL을 사람이 브라우저로 열어 볼 수 있다. |
| PM Agent → 개인 환경 | 사용자가 허락한 로컬 폴더 어댑터(`LocalFolderWorkspace`). 허용 경로만 읽고, 요청은 폴더 안 `.ensemble/inbox/<requestId>.md` 한 파일로만 쓴다 | PM이 Space에 올라온 글이 아니라 **폴더의 실제 파일**을 직접 확인해야 한다(완료 기준 3). 받은 쪽이 지금 실행 중이 아니어도 다음 확인 때 발견할 수 있는 비동기 수신함이다. |
| 개인 환경 → PM Agent | 같은 개인 Agent가 요청 파일을 읽고 같은 POST에 `inReplyTo=requestId`로 답 | 답의 경로를 하나(Space POST)로 두면 Figma·Slack·미팅 접점도 같은 기록 형태를 쓴다. |

MCP를 먼저 쓰지 않은 이유: MCP 서버는 도구별 설치·설정·신뢰 단계가 필요하고, 이 저장소에는 아직 MCP 서버가 없다. HTTP와 파일 수신함은 Codex·Claude·브라우저 Agent가 공통으로 다룰 수 있어 첫 왕복의 변수를 줄인다. MCP는 같은 라우트를 감싸는 **전달 수단 후보**로 남긴다(구현하지 않았다).

Skill의 위치: "작업 시작·막힘·결과 공유 시점에 Space를 읽고 쓴다", "다시 돌아오면 `.ensemble/inbox/`를 확인한다" 같은 **참여 시점과 공유 규칙의 안내** 후보다. 이번 실험은 Skill 없이 프롬프트 한 문단으로 안내했다. Skill 파일은 만들지 않았다.

## 2. 재사용 인터페이스 (#78 Figma, #79 Slack, #80 미팅)

### 2.1 이벤트 (`app/packages/core/src/participation.ts`, `EventPayloads`에 합쳐짐)

참여자(participant)는 프로젝트 멤버가 아니다. `project()` 투영과 계획 수립은 참여자를 보지 않고, 별도 투영 `participation(events)`가 읽는다.

| 이벤트 | 행위자 | 멱등 키 | 의미 |
|---|---|---|---|
| `participant_link_requested` | human(`me`로 요청한 사람) | 없음 | 연결 **요청**. 개인 Agent·도구·폴더·허용 경로·범위·Space URL, 확인 코드의 해시, 만료 시각(10분). 아무 권한도 주지 않는다 |
| `participant_linked` | human(대시보드에서 확인한 사람) | 없음(재연결이 덮어씀) | 확인된 연결. 요청의 내용 + `linkRequestId`, 연결 토큰의 SHA-256(`tokenHash`). 토큰 해시가 없는 예전 연결은 Agent 호출을 받지 않는다 |
| `space_context_read` | agent(참여자) | 없음 | Space 맥락을 읽음(도착 확인용). 읽힌 요청 id 포함 |
| `space_post_recorded` | agent(참여자) | `space-post:<participantId>:<clientPostId>` | 결과·질문·막힘·메모. `source{tool, workspaceRoot, via}`, `observedAt`, 선택 `taskId`, `inReplyTo` |
| `workspace_context_observed` | pm | 없음 | PM이 폴더에서 직접 읽은 파일 메타데이터(path, sha256, bytes, mtime)와 직전 관찰 대비 추가·수정·삭제. **파일 내용은 원장에 남기지 않는다** |
| `personal_request_created` | pm 또는 human | `request-from:<postId>`(글에서 나온 요청) 또는 `request-<dedupeKey>` | 요청 본문, 계기 글, 근거 관찰 id, 작업 id, 깊이 |
| `personal_request_delivered` | pm | `request-delivered:<requestId>` | 폴더 안 위치, 시도 번호 |
| `personal_request_delivery_failed` | pm | 없음(시도마다) | `unreachable` / `permission_denied` / `not_permitted` / `error`. 요청은 대기로 남음 |
| `personal_request_seen` | agent | `request-seen:<requestId>` | Space 맥락에서 요청이 보였음 |
| `personal_request_answered` | agent | `request-answered:<requestId>` | 답 글(`inReplyTo`) id |
| `liaison_considered` | pm | `liaison:<postId>` | 글 하나에 대한 PM의 판단: `request` / `none` / `needs_human` / `skipped`와 이유 |

요청 상태: `pending`(폴더에 못 전함) → `delivered`(폴더에 도착) → `seen`(Space에서 봄) → `answered`(답 받음). 전달·확인·응답을 따로 기록해 "Space 조회만으로 양방향 완료"를 주장하지 않게 한다. 상태는 가장 앞선 단계만 보여 주는 표시다. **폴더 전달 여부는 `delivered` 사실로 따로 본다**: Agent가 Space에서 먼저 보고(`seen`) 폴더에는 아직 못 간 요청도 있다. sweep은 상태가 아니라 "전달 안 됨 && 답 없음"으로 재전달 대상을 고른다(F1).

### 2.2 HTTP (`app/apps/web/app/api/[...path]/route.ts`)

모든 `space/…` 경로는 이 컴퓨터에서 온 요청만 받는다(아래 2.5). 아니면 403 `local_only`.

| 경로 | 호출자 | 동작 |
|---|---|---|
| `POST /api/space/participants { me, participantId, displayName, tool, workspaceRoot, allowedPaths?, scopes?, spaceUrl? }` | 사람(누구든 요청 가능) | 연결 **요청**. 202 `{ linkRequestId, status: "pending", expiresAt, … }`. 확인 코드는 응답에 없고 **서버 콘솔에만** 찍힌다. 사람이 아니면 403, 멤버 id와 겹치면 400, `allowedPaths`가 `[]`이거나 빈 글을 담으면 400(생략하면 `["."]`) |
| `POST /api/space/links/:linkRequestId/confirm { me, code }` | 사람(대시보드 "개인 Agent" 탭) | 서버 콘솔의 코드로 확인. 201 `{ participantId, workspaceRoot, allowedPaths, scopes, token }`. **토큰은 이 응답에서 한 번만** 나온다. 틀린 코드 403(요청당 5번까지), 만료 400, 이미 확인 400, 사람 아님 403 |
| `GET /api/space/participants/:id/context?format=md\|json` + `Authorization: Bearer <토큰>` | 개인 Agent | 목표·결정·열린 작업·나에게 온 요청·내 글·공유 방법. 읽기 기록. 토큰 없음/틀림 401 |
| `POST /api/space/participants/:id/posts { kind, text, clientPostId, taskId?, inReplyTo? }` + `Authorization: Bearer <토큰>` | 개인 Agent | 202 `{ accepted, postId, duplicate }`. 새 글이면 PM 연락 단계가 백그라운드로 돈다. 토큰 없음/틀림 401 |
| `POST /api/space/participants/:id/inspect { me, paths? }` | 사람 | PM이 지금 폴더를 읽고 관찰을 기록. 폴더가 없으면 503 `workspace_unreachable` |
| `POST /api/space/participants/:id/requests { me, text, taskId? }` | 사람 | 사람이 PM 전달 경로로 요청을 보냄 |
| `POST /api/space/requests/sweep {}` | 로컬 | 폴더에 아직 못 간(답도 없는) 요청 재전달. 5분 정체 점검 틱에서도 돈다 |
| `GET /api/space` | 화면·도구(로컬) | 참여자(허용 경로 포함)·확인 대기 연결·글·요청 상태(`/api/state`의 `space`와 같은 모양). 코드·토큰은 없다 |

### 2.3 코드 경계

- `PersonalWorkspace`(`app/packages/agents/src/personal/workspace.ts`): `inspect(paths?)`, `deliverRequest(request)`, `status()`. 원장을 쓰지 않는다. 실제 구현 `LocalFolderWorkspace`는 realpath로 링크·정션을 풀어 루트와 허용 경로 안인지 확인하고(SessionRunner의 결과 파일 확인과 같은 방식), 폴더를 훑을 때 링크는 따라가지 않으며, 파일당 16KB·전체 96KB까지만 내용을 읽고, 5MB 넘는 파일은 해시하지 않는다. 허용 경로를 생략하면 `.`(폴더 전체), **명시한 `[]`는 아무것도 읽지 않음**이고 빈 글 항목은 생성자에서 거부한다(F3). 쓰기는 `.ensemble/inbox/`의 새 파일 하나뿐이며 이미 있으면 덮어쓰지 않는다(임시 파일 후 rename). 요청함은 **한 단계씩** 만든다: 이미 있는 `.ensemble`·`inbox`를 먼저 realpath로 풀어 폴더 밖이면 그 아래를 만들기 전에 `permission_denied`로 멈춘다(F2. 예전 재귀 mkdir은 폴더 밖에 `inbox`를 먼저 만든 뒤 거부했다).
- `SpaceParticipation`(`app/packages/orchestrator/src/space-participation.ts`): `requestLink`, `confirmLink`, `readContext(id, token, format)`, `post(id, token, input)`, `inspect`, `createRequest`, `deliver`, `sweep`, `liaison(postId)`. 다른 접점은 `createRequest({ participantId, text, actor, dedupeKey: 'meeting:<id>:<item>' })`로 같은 전달·대기·응답 경로를 쓴다.
- `RequestComposer`: `(participant, context, trigger, observation?, depth) → 요청 본문 | null`. 웹 런타임 기본값은 PM 모델(`ENSEMBLE_PM_RUNTIME`)의 일반 텍스트 호출 `llmRequestComposer`, fake PM이면 규칙 기반 `ruleRequestComposer`.

### 2.4 반복·무한 왕복 방지

- 같은 `clientPostId`는 한 글(원장 멱등 키). 중복 글은 PM 단계를 다시 부르지 않는다.
- 글 하나에 판단 하나(`liaison:<postId>`), 요청 하나(`request-from:<postId>`). 동시에 두 번 불러도 작성기는 한 번 돈다(직렬 큐).
- PM·시스템이 쓴 글, 메모(`note`), 요청 받기를 허용하지 않은 참여자의 글은 계기가 되지 않는다(`skipped`).
- 깊이: 새 글에서 나온 요청이 1, 요청 N에 대한 답에서 나온 요청이 N+1. 3을 넘으면 묻지 않고 `needs_human`으로 멈춘다(`MAX_REQUEST_DEPTH`).
- 작성기가 `NONE`을 내면 `none`으로 기록하고 끝난다. `ENSEMBLE_SPACE_LIAISON=off`면 글만 기록한다.

### 2.5 연결 확인과 토큰 (F4)

리뷰 F4: 인증이 없어서 HTTP에 닿는 누구나 임의의 로컬 폴더를 연결해 PM이 읽고 요청 파일을 쓰게 만들 수 있었다(이미 연결된 참여자 사칭보다 넓은 영향). 고친 경계:

1. **로컬 전용**: `npm run dev`/`start`가 `127.0.0.1`에만 바인딩한다(`next dev -H 127.0.0.1`). 그리고 `space/…` 경로는 Host가 loopback(localhost, 127.0.0.0/8, ::1)이 아니거나, `X-Forwarded-For`에 loopback이 아닌 주소가 있거나, `Origin`이 대시보드 자신이 아니면 런타임을 부르기 전에 403으로 거절한다(`app/apps/web/lib/local-access.ts`). 헤더는 위조할 수 있으므로 원격 차단의 1차 수단은 바인딩이고, 헤더 검사는 프록시·DNS rebinding·다른 사이트 페이지(CSRF)용 2차 방어다.
2. **연결은 사람이 확인해야 생긴다**: `POST space/participants`는 대기 요청만 남긴다. 서버는 8자 확인 코드를 **서버 콘솔에만** 찍는다(응답·원장·`/api/state`에는 없음, 원장에는 해시만). 사람이 대시보드 "개인 Agent" 탭에서 폴더·허용 경로·권한을 보고 코드를 입력해야 `participant_linked`가 기록된다. 코드는 10분 뒤 만료되고 한 요청에 5번 틀리면 잠긴다(서버 실행 단위). HTTP를 부를 수 있는 Agent나 도구는 서버 콘솔을 보지 못하므로 스스로 폴더 권한을 얻지 못한다.
3. **Space별 연결 토큰**: 확인할 때 `ens_…` 토큰을 만들어 그 응답에서 한 번만 돌려주고, 원장에는 SHA-256만 남긴다. 개인 Agent는 맥락 읽기와 글 남기기(답 포함)에 `Authorization: Bearer <토큰>`을 보낸다. 다시 연결하면 새 토큰이 나오고 예전 토큰은 401이 된다.
4. **토큰 전달**: 대시보드가 확인 직후 토큰을 한 번 보여 준다. 사람이 그것을 개인 Agent에게 넘긴다(프롬프트에 붙이거나 폴더 안 파일에 저장해 Agent에게 경로를 알려 줌. 3.2절 실험은 `.ensemble/space-token`에 저장했다. PM의 폴더 읽기는 `.ensemble/`을 건너뛴다). 요청 파일과 Space 맥락 문서에는 토큰 값 대신 `Authorization: Bearer <연결 토큰>` 자리만 적힌다.

남는 경계(완료로 표현하지 않는다): 같은 컴퓨터의 같은 사용자 권한 프로세스는 데이터 폴더·개인 폴더를 직접 읽을 수 있어 이 경계의 대상이 아니다. 사람 쪽 호출(`inspect`, `requests`, `sweep`, `confirm`)은 기존 대시보드 API처럼 `me` 이름을 믿는다(로컬 전용 + 확인 코드가 권한 부여를 막는다). 서버 콘솔 출력을 다른 프로그램이 읽는 환경(로그 수집 등)에서는 코드가 새어 나갈 수 있다. 조직 인증·다중 사용자는 후속이다.

## 3. 실제로 확인한 것

### 3.1 2026-10-07 로컬 왕복 (리뷰 전 코드)

이 절은 작성자가 보고한 관찰이다. 원장 원문·전사 파일은 남기지 않았고(리뷰가 지적), 리뷰는 이 실행을 다시 돌리지 않았다. 당시 코드는 연결 확인·토큰이 없었고 F1–F3 결함이 있었다. 같은 방식의 재실행과 원문 증거는 3.2절이다.

환경: Windows 11, Node 24.18, `codex-cli 0.159.2`(ChatGPT 로그인), `next dev`(포트 3181), `ENSEMBLE_AGENT_RUNTIME=fake`, **`ENSEMBLE_PM_RUNTIME=codex`**(PM 계획 작성과 요청 작성 모두 실제 Codex app-server 호출). 데이터 폴더와 개인 폴더는 저장소 밖 임시 폴더다. 개인 폴더 `landing-copy`는 연결 **전에** 만든 git 저장소(README.md, copy.md, 커밋 1개)이며 Ensemble worker 폴더가 아니다.

1. **연결·Space 목표**: `free/start`로 목표("로그인 화면 문구를 이메일 로그인 기준으로 정리, 소셜 로그인 제외")를 넣자 Codex PM이 4개 작업 계획을 만들었고 승인했다. `POST space/participants`로 `owner-codex`(codex, 위 폴더, 범위 4개 모두)를 연결했다(seq 43, actor `human:owner`).
2. **개인 Agent → Space**: 그 폴더에서 `codex exec -s workspace-write -c sandbox_workspace_write.network_access=true`를 실행했다(세션 `01a11493-226b-7ba3-bf4f-a1adf7f75209`). Codex가 `Invoke-RestMethod`로 맥락 Markdown을 읽고(seq 47), `copy.md` 버튼 문구를 "구글로 계속하기"→"이메일로 계속하기"로 고친 뒤 결과(seq 48)와 질문 "비밀번호 방식인가요, 인증 링크/코드 방식인가요?"(seq 50)를 직접 POST했다. 응답 202 두 건. 사람의 복사·붙여넣기는 없었다.
3. **PM → 개인 환경**: 글마다 PM이 폴더를 직접 읽었다(seq 49·52: `copy.md:437d57c0ac87`, `README.md:123418a3964d`, 로컬 `sha256sum`과 일치). 결과 글은 `none`(seq 51), 질문 글은 Codex PM이 "인증 방식은 사람이 확정해야 하니 초안임을 표시하고 방식별 안내 항목을 정리"하는 요청을 작성해(seq 53, `request-from:post-9ee2…`, 관찰 `7e370526` 근거) 폴더의 `.ensemble/inbox/req-31b425df4d3a066a.md`에 전달했다(seq 54, attempt 1).
4. **개인 환경 → PM**: **같은 세션**을 `codex exec resume 01a11493-…`로 이어 "PM 요청이 도착했는지 확인하라"고만 했다. Codex는 Space 맥락을 다시 읽어(seq 57, 요청이 보임 → `personal_request_seen` seq 58) 요청 파일 경로를 얻고, 그 파일을 폴더에서 읽은 뒤(`Get-Content .ensemble/inbox/req-31b425df4d3a066a.md`), `copy.md`에 초안 표시와 방식별 안내 항목을 추가하고 `inReplyTo=req-31b4…`로 답했다(seq 59). 요청은 `answered`(seq 60). 이어진 PM 관찰은 `copy.md` 해시 변경(`68ff9c7a06ca`, `modified:["copy.md"]`, seq 61)을 기록했고, 답 글에 대해 Codex PM은 후속 요청 없음(`none`, depth 2, seq 62)으로 판단했다.
5. **반복·끊김**: 같은 `clientPostId`로 다시 POST하자 `{"duplicate":true}`, 새 이벤트 없음. 폴더 이름을 바꿔 연결을 끊은 상태에서 사람이 요청을 보내자 `unreachable`(attempt 1, 201)로 대기, sweep도 `unreachable`(attempt 2), `inspect`는 503. 폴더를 되돌린 뒤 sweep에서 전달(attempt 3), 다음 sweep은 시도 0건. **단서(리뷰 F1)**: 이 사이에 Agent의 Space 읽기가 없었다. 당시 코드에서는 끊긴 동안 Space를 읽으면 요청이 `seen`이 되어 sweep 대상에서 빠졌고 폴더에 끝내 도착하지 않았다. 고친 뒤의 같은 관찰은 3.2절 5. 그 사이 폴더의 다른 파일은 그대로였고 `git status`는 Codex가 고친 `copy.md`와 `.ensemble/`만 보였다. 이 요청은 개인 Agent를 다시 실행하지 않아 `delivered`로 남았다(비활성 Agent = 도착했지만 미확인).

PM 요청 작성 호출 3건의 Codex 응답 시간은 13.0s·17.4s·14.5s(`[ensemble:pm-model] operation:text`).

### 3.2 2026-10-08 재확인 — 리뷰 수정 후 같은 방식의 실제 왕복

원문 증거: `issue-81-roundtrip-2026-10-08.txt`(HTTP 전사, Codex 두 실행의 명령·메시지 요약, 원장의 #81 이벤트 전부, 폴더 상태. 토큰은 가렸다). 실행 당시 경로는 이 브랜치 작업 세션의 scratchpad(`C:\Users\siheon.ryu\AppData\Local\Temp\claude\C--Users-siheon-ryu-orca-workspaces-ensemble-issue-81-personal-agent\02315bd7-a170-4140-a65c-e1ed4d9c4e3f\scratchpad\`)이고, 같은 곳의 `rt/`에 Codex JSONL 원문(`codex-run1.jsonl`, `codex-run2.jsonl`), 서버 콘솔(`server.log`), 원장 DB(`data/ensemble.db`)가 있다. 임시 폴더라 영구 보존이 필요하면 PR에 첨부해야 한다. 아래 seq는 그 원장 기준이다.

환경: Windows 11, Node 24.18, `codex-cli 0.159.2`, `next dev -H 127.0.0.1 -p 3181`(서버 출력 `Local: http://127.0.0.1:3181`, netstat `127.0.0.1:3181 LISTENING`만), `ENSEMBLE_PM_RUNTIME=codex`, `ENSEMBLE_AGENT_RUNTIME=fake`. 개인 폴더 `landing-copy`는 연결 전에 만든 git 저장소(README.md, copy.md, 커밋 `3c3e42c`).

1. **목표**: `free/start`로 같은 목표를 넣고 Codex PM 계획을 승인했다.
2. **연결 거절·확인 (F3·F4)**: `X-Forwarded-For: 203.0.113.5` → 403 `local_only`, `Origin: http://evil.example` → 403, curl `Host: evil.example` → 403(Node fetch는 Host 헤더를 URL 호스트로 바꿔 보내 이 확인에 쓸 수 없었다. 그 요청은 202 대기 요청 `x`로 남았고 끝까지 확인되지 않아 아무 권한도 생기지 않았다). `allowedPaths:["   "]` → 400. `owner-codex` 연결 요청 → 202 대기(seq 36), 이 시점에 `GET /api/space`의 참여자 0명, 맥락 읽기·inspect 404, 폴더에 아무것도 생기지 않음. 확인 코드는 서버 콘솔에만 찍혔다. 틀린 코드 403, 멤버가 아닌 `me` 403, 콘솔 코드로 확인 201 + 토큰(seq 37 `participant_linked`, 원장에는 `tokenHash`만), 같은 요청 재확인 400. 토큰 없이/틀린 토큰으로 맥락 읽기·글 쓰기 401. 사람(작업자)이 토큰을 `landing-copy/.ensemble/space-token`에 저장했다.
3. **개인 Agent → Space**: 폴더에서 `codex exec --json -s workspace-write -c sandbox_workspace_write.network_access=true`(세션 `01a11aa2-3753-7f83-b552-8e1535c34e9e`). 프롬프트는 맥락 URL과 토큰 파일 위치, 할 일 네 줄. Codex가 토큰 파일을 읽어 `Authorization: Bearer` 헤더로 맥락 Markdown을 읽고(seq 38), copy.md의 "구글로 계속하기"를 이메일 로그인 문구로 고친 뒤 결과(seq 39)와 질문 "인증 방식은 이메일·비밀번호, 인증 링크, 일회용 인증번호 중 무엇인가"(seq 41)를 직접 POST했다(202 두 건). 사람의 복사·붙여넣기는 없었다. 토큰 값은 Codex 출력·JSONL에 나오지 않았다(검색 0건).
4. **PM → 개인 환경 → PM**: 글마다 PM이 폴더를 직접 읽었다(seq 40·43, `copy.md` `9c3de6de7d79`, 로컬 `sha256sum`과 일치). 결과 글은 `none`(seq 42), 질문 글은 Codex PM이 "인증 방식은 사람이 정할 결정이니 초안을 유지하고 방식별 비교 문구를 정리하라"는 요청을 써서(seq 44, `request-from:post-0b62…`) `.ensemble/inbox/req-d57cdd78cac4f884.md`에 전달했다(seq 45, attempt 1). 요청 파일에는 토큰 값이 없고 `Authorization: Bearer <연결 토큰>` 자리만 있다. **같은 세션**을 `codex exec resume`으로 이어 "PM 요청이 도착했는지 확인하고 처리한 뒤 답하라"고만 했다. Codex는 토큰으로 맥락을 읽어(seq 47, `personal_request_seen` seq 48) 요청 파일 경로를 얻고 그 파일을 폴더에서 읽은 뒤(`Get-Content .ensemble/inbox/req-d57….md`), copy.md에 인증 링크·일회용 인증번호 비교안을 추가하고 `inReplyTo=req-d57…`로 결과(seq 49)를 답했다. 요청은 `answered`(seq 50). PM 관찰은 `copy.md` 해시 변경(`4b98b8caec4d`, seq 51)을 기록했고 결과 답에는 `none`(seq 53, depth 2). Codex가 같은 요청에 단 두 번째 답(질문, seq 52)에는 PM이 depth 2 요청을 하나 더 보내 폴더에 전달했다(seq 55–57). 그 요청은 Agent를 다시 실행하지 않아 `delivered`로 남았다(비활성 Agent = 도착했지만 미확인).
5. **끊김 + Space 읽기 + 재연결 (F1)**: 폴더 이름을 바꿔 끊고 사람이 요청을 보내자 `unreachable`(attempt 1), `inspect` 503. 끊긴 상태에서 토큰으로 맥락을 읽어(이 읽기는 Codex가 아니라 작업자의 HTTP 호출) 요청이 `seen`이 됐다. 폴더를 되돌린 뒤 sweep이 그 요청을 전달했고(attempt 2, `req-e8de953b696c8e9e.md` 생성), 다음 sweep은 0건. 고치기 전 코드라면 이 sweep은 0건이었다(리뷰 재현).
6. 폴더의 `git status`는 Codex가 고친 `copy.md`와 `.ensemble/`(요청 파일 3개, 토큰 파일)뿐이었다. Codex는 사용자 전역 지침에 따라 별도 worktree를 만들려다 샌드박스의 `.git` 쓰기 제한으로 실패했고 커밋은 하지 않았다. 이 실험의 범위 밖이다.

PM 모델 호출: 계획 30.8s, 요청 판단 16.5s·20.2s 등(`[ensemble:pm-model]`).

## 4. 완료 기준별 상태

2026-10-08 리뷰 반영 후 기준. "검증됨"은 3.2절 원문 증거나 자동 테스트가 뒷받침하는 범위만 뜻한다.

| 완료 기준 | 상태 | 근거 |
|---|---|---|
| 개인 Agent/도구·작업환경·Space·참여자 식별, 접근 확인 | 검증됨 | 3.2절 1–3. Codex CLI 0.159.2, 기존 git 폴더, `owner-codex`. 연결은 사람이 콘솔 코드로 확인해야 생기고 Agent는 Space별 토큰으로 식별된다 |
| 선택 경로로 Space 맥락 읽기·결과/질문 직접 공유 | 검증됨 (HTTP + 토큰) | 3.2절 seq 38·39·41. 브라우저 UI를 Agent가 조작한 것은 아니다. 토큰이 헤더로 필요해져 사람이 같은 맥락 URL을 브라우저로 그냥 여는 것은 더는 안 된다(사람은 대시보드를 본다) |
| PM이 허용된 실제 작업환경 맥락 확인, Space 글과 구분 | 검증됨 | `workspace_context_observed`(해시가 로컬 `sha256sum`과 일치)가 `space_post_recorded`와 별도 이벤트. 허용 경로 안전성: 밖 경로·링크 탈출·허용 밖 내부 링크는 읽지 않음(테스트), **빈/공백 허용 경로는 거부**(F3 테스트, 3.2절 2의 400). 고치기 전에는 `["   "]`가 폴더 전체 허용이 됐다 |
| PM 요청이 개인 환경에 도착하고 같은 Agent의 응답이 돌아옴 | 검증됨, 단서 있음 | 3.2절 4: 같은 세션 id 재개, 요청 파일 읽기, `inReplyTo` 답(seq 49–50). 단 Codex는 요청 파일 경로를 **Space 맥락에서 먼저 보고** 폴더 파일을 읽었다(두 실행 모두). 폴더만 보고 수신함을 스스로 찾는 경우는 관찰하지 않았다 |
| 프로젝트·작업·작성 주체·원본 참조 보존, 중복·무한 왕복 방지 | 검증됨(실행 일부) + 테스트 | 실행: actor·source·observedAt·trigger·관찰 id, 같은 요청에 두 번째 답이 와도 `answered`는 한 번, depth 2로 증가. 작성 주체는 이제 연결 토큰으로 묶인다(토큰 없음/틀림 401, 재연결 시 이전 토큰 무효 — 테스트와 3.2절 2). 깊이 상한·PM 글 제외·동시 중복 판단은 테스트로만 확인 |
| 끊김/권한 부족/비활성에서 대기 유지·기존 작업 무방해, 수동 단계 명시 | 끊김·비활성 검증됨, 권한 부족은 테스트만 | 끊김 중 Space 읽기가 끼어도 재연결 후 sweep이 전달(3.2절 5, F1 테스트). 요청함 링크가 폴더 밖을 가리키면 그 밖에 아무 디렉터리도 만들지 않고 `permission_denied`(F2 테스트, 실제 정션). `permission_denied`의 실제 EACCES 폴더 관찰은 아직 없다(fake 어댑터 테스트) |
| managed 세션과 비교, 미검증 능력 기록 | 이 문서 5–6절 | — |

## 5. 관리형 CLI 세션과 비교

| | 관리형(managed) 세션 (`ENSEMBLE_AGENT_RUNTIME=codex/claude`) | 개인 Agent 참여 (이번 경로) |
|---|---|---|
| 작업 폴더 | Ensemble이 Agent별로 새로 만든 폴더 | 사용자가 원래 쓰던 폴더 |
| 실행 주체 | Ensemble이 세션을 열고 턴을 시작·중단 | 사용자가 자기 Agent를 원래 방식으로 실행. Ensemble은 실행을 제어하지 않음 |
| 변경 전달 | Codex `turnSteer`, Claude 후속 턴 | 폴더 수신함 파일 + Space 맥락의 요청 목록. 다음 확인 시점에 도달 |
| 결과 수집 | ensemble-report 블록과 제출 파일 첨부 | Agent의 Space POST. PM은 폴더를 직접 읽어 해시로 대조 |
| 성공 판정 | 결과 제출·PM 검토 | 전달·확인·응답 이벤트를 각각 기록 |

두 경로는 원장만 공유한다. 기존 managed 경로의 코드와 동작은 바꾸지 않았다(기존 회귀 테스트 6건 통과). 단 웹 서버의 `dev`/`start` 스크립트가 이제 `127.0.0.1`에만 바인딩한다(다른 기기에서 대시보드를 열려면 직접 `-H`를 바꿔야 한다).

## 6. 수동 단계와 미검증 능력

수동 단계(이번 실행 기준):

- Codex CLI 설치와 ChatGPT 로그인(`codex login`), PM을 Codex로 쓰려면 같은 로그인.
- 사람이 `POST /api/space/participants`로 폴더 경로·허용 경로·범위를 정해 연결을 요청하고, 서버 콘솔에 찍힌 확인 코드를 대시보드 "개인 Agent" 탭에 입력해 확인한다. 연결 요청을 만드는 화면 폼은 아직 없다(확인 폼만 있다). 3.2절 실행은 확인을 대시보드 버튼과 같은 HTTP 호출로 했고 화면을 눈으로 확인하지 않았다.
- 확인 직후 한 번 보이는 토큰을 사람이 개인 Agent에게 넘긴다(3.2절은 폴더의 `.ensemble/space-token`에 저장하고 프롬프트로 위치를 알려 줌).
- 개인 Agent에게 Space URL과 참여 규칙을 알려 주는 첫 프롬프트, 그리고 다시 돌아와 요청을 확인하라는 지시. 자동 깨우기는 없다.
- Codex 샌드박스에서 localhost에 접근하려면 `sandbox_workspace_write.network_access=true`가 필요했다.

미검증·미구현(완료로 표현하지 않는다):

- **Claude Code 실제 실행**: 같은 HTTP·수신함 경로를 쓸 수 있게 만들었지만 이번에 실행하지 않았다.
- **브라우저 UI를 Agent가 직접 조작**: Agent는 HTTP로 읽고 썼다. 사람용 대시보드 탭은 렌더 경로만 확인했고(페이지 200, `state.space` 채워짐) 화면을 눈으로 확인하지 않았다.
- **push·실시간 수신**: 개인 Agent는 다음 확인 때 요청을 본다. 실행 중인 개인 세션에 끼어드는 기능은 없다.
- **인증**: 2.5절의 로컬 전용 + 콘솔 코드 확인 + Space별 토큰까지다. 2026-10-07 판의 "로컬 누구나 참여자 이름으로 읽고 쓸 수 있다"는 설명은 영향이 좁게 적혀 있었다(리뷰 F4: 누구나 임의 폴더를 연결해 PM 읽기와 요청 파일 쓰기를 얻을 수 있었다). 같은 사용자 권한의 로컬 프로세스, 사람 쪽 호출의 `me` 신원, 서버 콘솔을 읽는 다른 프로그램, 조직 인증·다중 사용자는 여전히 범위 밖이다. 3.2절 5의 끊김 중 Space 읽기는 Codex가 아니라 작업자가 토큰으로 한 호출이다.
- **MCP 서버, Skill 패키지**: 만들지 않았다.
- **권한 부족(EACCES) 실제 폴더**: 분류 코드는 있으나 실제 폴더로는 재현하지 않았다.
- **변경분(diff) 수준 맥락**: PM은 파일 해시와 허용 범위의 내용 일부를 읽는다. git diff나 세션 로그는 읽지 않는다.
- **원격·다른 기기 폴더**: 로컬 폴더 어댑터만 있다.

## 7. 재현

```powershell
# app/ 에서. 개인 폴더는 저장소 밖의 기존 폴더를 쓴다. 서버는 127.0.0.1에만 뜬다.
$env:ENSEMBLE_DATA_DIR = "<저장소 밖 데이터 폴더>"; $env:ENSEMBLE_AGENT_RUNTIME = "fake"; $env:ENSEMBLE_PM_RUNTIME = "codex"
npm run dev -w @ensemble/web -- -p 3181
# 1) 목표: POST /api/free/start { me: "owner", goal } (한국어 본문은 UTF-8로 전송), 계획 카드 승인
# 2) 연결 요청: POST /api/space/participants { me: "owner", participantId: "owner-codex", displayName, tool: "codex", workspaceRoot: "<기존 폴더 절대 경로>" } → 202 { linkRequestId }
# 3) 확인: 서버 콘솔의 "개인 Agent 연결 확인 코드 XXXX-XXXX"를 대시보드 "개인 Agent" 탭에 입력
#    (또는 같은 호출 POST /api/space/links/<linkRequestId>/confirm { me: "owner", code }) → 응답의 token을 한 번만 받는다
# 4) 토큰을 Agent에게 넘긴다(예: <폴더>/.ensemble/space-token에 저장)
# 5) 개인 폴더에서: codex exec -s workspace-write -c sandbox_workspace_write.network_access=true "<맥락 URL·토큰 위치를 알려 주고 작업 후 결과와 질문을 공유하라>"
#    Agent의 모든 Space 호출: -H "Authorization: Bearer <토큰>"
# 6) 같은 폴더에서: codex exec resume <세션 id> -c 'sandbox_mode="workspace-write"' -c sandbox_workspace_write.network_access=true "<PM 요청을 확인하고 답하라>"
# 7) 상태: GET /api/space, 재전달: POST /api/space/requests/sweep {}
```

테스트: `app/test/essential-space-participation.test.ts`(연결 요청·확인·맥락 md/json, 글 멱등, 폴더 읽기 제한(밖 경로·정션 탈출·크기 상한), 실제 임시 폴더 수신함, 끊김/권한 부족 → 대기 → sweep, `inReplyTo` 답, PM 글·메모·중복 계기 제외, 깊이 상한, 웹 런타임 백그라운드 연락, 리뷰 회귀 F1(끊김 중 Space 읽기 후 재전달), F2(`.ensemble`/`inbox` 정션 탈출 시 폴더 밖 무변경, 허용 밖 내부 링크 읽기 거부), F3(빈/공백 허용 경로 거부, 명시 `[]`는 아무것도 읽지 않음), F4(확인 전 무권한·코드 오답 잠금·만료·토큰 없음/틀림 401·재연결 토큰 교체·예전 연결 거부, 비loopback·다른 Origin 403)).
