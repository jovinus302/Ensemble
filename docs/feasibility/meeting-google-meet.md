# 미팅 참여·주선 feasibility 기록 — Google Meet + Calendar (#80)

기준: 2026-10-07. 대상 이슈: [#80](https://github.com/jovinus302/Ensemble/issues/80). 제품 의도(미팅에 초대받아 참여하고, 위임 범위에서 미팅을 주선하고, 결과를 같은 Space와 후속 작업에 잇는다)는 확정이며 도구·매체·구현 수단은 EXPERIMENT다.

**이 기록의 결론부터.** Google 테스트 계정·OAuth client·테스트 참여자를 받지 못해 외부 왕복은 한 번도 실행하지 않았다. 아래 "구현만"은 코드와 fake·mock fetch 테스트로만 확인했다는 뜻이며, 이슈의 완료 기준은 하나도 충족되지 않았다. 링크 생성, Calendar의 초대 요청 수락, 종료 후 회의록 처리는 각각 그 자체로만 기록하고 초대 도착·입장·회의 중 응답 성공으로 보고하지 않는다.

## 1. 선택한 경로와 이유

| 결정 | 선택 | 이유 |
|---|---|---|
| 첫 도구 | Google Meet + Google Calendar | 이슈의 1차 후보. 방 생성(Meet REST `spaces.create`)과 초대(Calendar `events.insert`)가 GA REST API로 열려 있다. 실제 팀 도구가 Zoom/Teams로 정해지면 같은 adapter 계약으로 교체한다. |
| 방 생성 | Meet REST `spaces.create` 후 Calendar 일정에 링크 첨부 | 앱이 소유한 space 이름(`spaces/…`)을 얻어야 이후 `conferenceRecords`로 입장자를 조회할 수 있다. space 접근 유형(`TRUSTED` 기본)을 정할 수 있어 입장 거절 조건도 통제한다. |
| 초대 | Calendar `events.insert`, `sendUpdates=all`, 결정적 이벤트 id | 이벤트 id를 Space·조율 키에서 결정적으로 만들면 Calendar가 두 번째 insert를 409로 거절한다. 재시도는 기존 이벤트를 읽어 쓰므로 두 번째 초대 메일이 나가지 않는다. |
| Meet 링크 첨부 방식 | `location`과 `description`에 Meet URI | 확실히 동작하는 평문 첨부. `conferenceData`에 기존 Meet space를 붙이는 방식은 Calendar가 받아들이는지 미검증이라 첫 구현에서 쓰지 않는다. |
| 대안(채택 안 함) | Calendar `conferenceData.createRequest`만으로 Meet 생성 | API 한 번에 방과 초대가 나오고 `requestId`로 멱등하다. 대신 space 설정을 정하지 못하고 space 이름은 회의 코드로 다시 찾아야 한다. 실계정 검증에서 `spaces.create` 경로가 막히면 1순위 대체로 시험한다. |
| 회의 중 매체 | 의존하지 않음 | Meet Media API는 Developer Preview 신규 신청을 받지 않는다. Meet REST API에는 회의 중 채팅·음성 송신 경로가 없다. 회의 중 응답은 `unsupported`로 기록하고, 실제 경로는 아래 표의 후보로 남긴다. |
| MCP | 사용 안 함 | 이슈상 필수 전제가 아니다. |

## 2. 능력별 경로 비교와 상태

상태: **검증됨** = 실제 Google 계정으로 관찰, **구현만** = 코드·fake·mock fetch 테스트만 통과, **미검증** = 구현도 실관찰도 없음.

| 능력 | 브라우저 참여 | 플랫폼 봇/SDK/API | 일정 API | 현재 상태 |
|---|---|---|---|---|
| 초대 수신·방 입장 (A) | PM Agent용 Google 계정이 브라우저로 링크 입장. 조직 밖 계정은 호스트 승인 필요, 자동화 계정 차단 가능성 있음 | Meet REST에는 입장 API 없음. Media API는 신규 불가 | PM 계정 캘린더에서 초대 수신 확인 가능(미구현) | **미검증.** 사람이 Space·목적·링크를 지정하는 `registerInvitation`과 입장/거절/끊김을 남기는 `report`만 **구현만** |
| 회의 중 맥락 수신 | 브라우저 자막·채팅 화면 읽기(자동화 필요, 약관·안정성 확인 필요) | Media API(불가). Meet add-on SDK는 참가자 측 패널이며 PM 입장과 다름 | 없음 | **미검증.** 받은 발화를 Space에 넣는 `ingest`(자기 메시지 제외·중복 제거)만 **구현만** |
| 회의 중 응답 | 브라우저 채팅 입력(가설), 음성 발언은 별도 TTS·오디오 경로 필요 | Meet REST에 채팅 송신 없음 → `unsupported` | 없음 | **미검증.** Google adapter는 `chat_send`를 `unsupported`로 반환하고 그대로 기록. 질문 송신·답 수신·`no_response` 만료 흐름은 fake로 **구현만** |
| 방 생성·참여자 초대 (B) | 해당 없음 | Meet REST `spaces.create` | Calendar `events.insert` + `sendUpdates=all` | **구현만.** 요청 형태·오류 분류·409 재조회는 mock fetch로, 중복 방지·상태 구분은 fake로 확인. 실제 초대 메일 도착과 참여자 입장은 **미검증** |
| 입장 관찰 | 사람의 확인 | Meet REST `conferenceRecords` + `participants` | 참석 응답(`responseStatus`)은 일정 수락이며 입장이 아님 | **구현만.** 참여자 이름을 멤버로 추정하지 않고 원문 그대로 기록 |
| 후속 조율 | — | — | — | Space 기록(결정/제안/미해결, 작성 주체·원본 참조·관찰 시각)은 **구현만**. 작업환경으로의 후속 요청 전달은 #79/#81 접점 의존으로 **미검증** |
| 종료 후 회의록 | — | Meet REST transcript 산출물 | — | 보조 경로. 회의록 근거만 있으면 `transcriptOnly`로 표시하고 참여 증거로 세지 않음 |

## 3. 구현 구조

코드: [`app/packages/meeting`](../../app/packages/meeting/src/index.ts), 테스트: [`app/test/meeting.test.ts`](../../app/test/meeting.test.ts).

| 파일 | 역할 |
|---|---|
| `types.ts` | 원장 payload(`meeting_requested`, `meeting_observed`, `meeting_note_recorded`)와 `MeetingAdapter` 계약 |
| `google.ts` | Meet REST v2·Calendar v3 fetch 구현. access token은 주입된 provider에서 받고 오류 메시지에 남기지 않음 |
| `fake.ts` | 테스트 double. `spaces.create`는 매번 새 방, `events.insert`는 같은 id면 거절, 메일은 새 insert에서만 발송하는 공급자 동작을 흉내냄 |
| `coordinator.ts` | `arrange`(B), `registerInvitation`(A), `refreshResponses`, `observeParticipants`, `report`, `ingest`, `ask`, `expireQuestions`, `recordNotes` |
| `projection.ts` | Space 원장에서 미팅 상태를 계산. 성공/완료 상태가 없음 |
| `oauth.ts` | refresh token → access token 교환과 만료 전 캐시. 값은 오류·출력에 남기지 않음 |
| `scripts/live-meeting.ts` | 실연동 실행기(`check`/`create`/`observe`), 상태는 git 무시 SQLite 파일 |

### 멱등성

- 미팅 id와 Calendar 이벤트 id는 `(Space, 조율 키)`에서 결정적으로 만든다. 같은 키로 내용이 다른 요청은 `conflict`로 거절한다.
- `spaces.create`에는 요청 id가 없으므로 호출 전에 원장에 시도(`space_reserved`, attempt n)를 먼저 쓴다. 결과가 기록되지 않은 시도가 lease(기본 2분) 안에 있으면 다른 프로세스는 호출하지 않고 `pending`을 돌려준다. lease가 지나면 새 시도를 허용하며, 늦게 도착한 이전 결과는 `space-created` 키에서 버려진다. 이때 공급자에 초대가 없는 빈 방이 남을 수 있다. 빈 방은 아무도 초대받지 않으므로 참여자에게 중복 미팅으로 보이지 않지만, 공급자 측 정리는 미구현이다.
- 초대는 결정적 이벤트 id로 공급자가 중복을 막는다. 응답을 잃은 insert의 재시도는 409 → 기존 이벤트 조회(`extendedProperties.private.ensembleMeetingId` 일치 확인)로 끝나 두 번째 메일이 없다. 다른 미팅이 같은 id를 쓰거나 취소된 이벤트면 실패로 남긴다.
- 같은 프로세스 안의 동시 호출은 미팅별로 직렬화하고, 원장 기록은 모두 `idempotencyKey`로 한 번만 남는다.

### 상태 구분

`MeetingView.states`는 해당하는 상태를 모두, 급한 순서로 담는다: `failed` · `join_refused` · `disconnected` · `no_response` · `unsupported` · `pending` · `invite_sent` · `created` · `joined`.

- `invite_sent`는 "Calendar가 발송 요청을 수락함"이다. 참여자별 초대 상태는 `sent_unconfirmed`로 시작하고 Calendar 응답(`accepted`/`tentative`/`declined`)이나 시작 시각 이후 무응답(`no_response`)으로만 바뀐다.
- `joined`는 PM Agent의 입장이 관찰된 경우만이다. 참여자 입장은 `participants`에 근거(`api_poll`/`human_report`/`fake`)와 함께 따로 남는다.
- 실패에는 `uncertain`(요청이 반영됐는지 알 수 없음)을 구분한다. 조회 실패(`pollFailure`)는 미팅 실패로 세지 않는다.
- fake 근거가 섞이면 `fake: true`와 "테스트 기록"이 표시된다.

### Space 연결

같은 Space 원장(projectId)에 기록한다. 결정은 사람만 작성 주체가 될 수 있고 PM Agent는 제안·미해결만 남긴다. 같은 미팅·종류·문구·원본 참조는 한 번만 기록한다. 회의 중 발화 수집은 PM Agent 자신의 메시지를 제외한다.

실패·대기·초대 요청 상태는 기존 `pm_considered`/`pm_spoke` 경로로 Space 대화에 한 줄로 남긴다(같은 문장은 한 번). 공용 Space 화면 파일은 수정하지 않았고, 대시보드에 가상 미팅 기록을 채우지 않는다. 미팅 이벤트 타입은 core의 공통 이벤트가 아닌 meeting 패키지에 두었다. core 투영과 웹 보기 모델은 모르는 이벤트를 무시한다.

## 4. 사람이 제공해야 할 것

| 항목 | 권장 |
|---|---|
| Google Workspace 테스트 계정 | 운영 도메인과 분리된 테스트 Workspace(또는 무료 체험 테넌트). PM Agent 전용 사용자 1개(예: pm-agent@테스트도메인)와 사람 참여자 2개. 개인 Gmail은 Meet REST 일부 기능과 관리자 설정 제약이 달라 비권장 |
| OAuth client | 같은 Workspace의 Google Cloud 프로젝트에서 Meet REST API·Calendar API 사용 설정. 앱 유형은 데스크톱 또는 웹, 동의 화면은 Internal. PM Agent 사용자로 동의해 refresh token을 받고 호스트의 비밀 저장소에 둔다(저장소에 커밋 금지) |
| 범위(scope) | `https://www.googleapis.com/auth/meetings.space.created`, `https://www.googleapis.com/auth/calendar.events`. 입장자 조회가 거절되면 `meetings.space.readonly` 추가를 시험 |
| 테스트 참여자 | 실제 메일 수신·입장을 확인할 사람 2명(테스트 계정). 조직 밖 계정 1명으로 입장 승인(`TRUSTED`) 동작도 확인 |
| 테스트 미팅 | A용: 사람이 만든 짧은 Meet 1건(PM 계정을 초대). B용: PM Agent가 만들 30분 슬롯 1건과 참여자 확인 |
| Workspace 관리자 확인 | 외부 참여자 허용, Meet 녹화·자막 설정, 서드파티 앱 접근 허용 여부 |
| 브라우저 참여 결정 | PM 계정의 브라우저 자동 입장을 허용할지(약관·보안 검토), 회의 참가자에게 PM 참여·수집 범위를 알리는 문구 승인 |

## 5. 실연동 실행기 (`npm run live:meeting`)

fake는 단위 테스트 보조로만 쓰고, 외부 왕복 증거는 이 실행기로 남긴다. 코드: [`scripts/live-meeting.ts`](../../app/packages/meeting/scripts/live-meeting.ts), 토큰 발급: [`src/oauth.ts`](../../app/packages/meeting/src/oauth.ts).

- **자격 증명**: worktree 루트의 `.env.local`(git 무시 대상, `.gitignore`의 `.env.*`)에서 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`을 읽는다. `GOOGLE_CLOUD_PROJECT`는 기록용이며 실행기는 쓰지 않는다. 값은 출력하지 않고, 없으면 빠진 키 이름만 출력한다. 다른 파일은 `--env <경로>`로 지정한다.
- **토큰**: `RefreshTokenProvider`가 `https://oauth2.googleapis.com/token`에 `grant_type=refresh_token`으로 access token을 받고 만료 60초 전까지 캐시한다. 오류는 `invalid_grant` 같은 분류만 남긴다.
- **상태 파일**: 기본 `.local/meeting/ledger.db`(SQLite, git 무시 대상 `.local/`). 다른 프로세스에서 다시 실행해도 같은 원장을 읽으므로 같은 키는 같은 미팅이다. `--state <경로>`로 바꾼다.
- **출력**: 호출한 Google API의 메서드·호스트·경로·HTTP 상태, 미팅 URI, Calendar 이벤트 id, htmlLink, 이번 실행에서 쓴 원장 기록. 헤더·본문·토큰은 출력하지 않는다.

app/에서 순서대로 실행한다.

```powershell
# 1) 접근 확인: 토큰 교환 + Calendar events.list 1건 + Meet conferenceRecords.list 1건 (읽기만)
npm run live:meeting -- check

# 2) 드라이런: 실제 Meet space와 PM 캘린더 일정을 만들지만 참석자는 비우고 sendUpdates=none
npm run live:meeting -- create --key live-b-dry-1
#    같은 명령을 한 번 더: "ledger records written this run: 0", "api calls (0)"이면 프로세스 간 멱등성 확인
npm run live:meeting -- create --key live-b-dry-1

# 3) 실제 초대: --confirm-send가 있어야만 참석자를 넣고 sendUpdates=all. 드라이런과 다른 새 키를 쓴다
npm run live:meeting -- create --key live-b-send-1 --attendee <테스트 참여자 이메일> --start 2026-10-08T05:00:00+09:00 --minutes 30 --confirm-send
npm run live:meeting -- create --key live-b-send-1 --attendee <테스트 참여자 이메일> --start 2026-10-08T05:00:00+09:00 --minutes 30 --confirm-send

# 4) 관찰: 참석 응답(responseStatus)과 Meet 입장자(conferenceRecords/participants)를 원장에 기록
npm run live:meeting -- observe --key live-b-send-1
```

- `--confirm-send` 없이 `--attendee`를 주면 드라이런으로 처리하고 참석자를 넣지 않는다. 같은 키로 나중에 `--confirm-send`를 주면 다른 요청이므로 `conflict`로 거절된다. 실제 발송은 새 키로 한다.
- 다시 실행할 때 `--start`를 생략하면 원장에 저장된 일정을 재사용한다. 처음 실행에서 생략하면 다음 정시 + 1시간, 30분이다.
- 공급자 수준 멱등성(선택): 같은 키를 새 `--state` 파일로 실행하면 원장이 비어 있어 Meet space를 하나 더 만들지만, Calendar insert는 409 → 기존 이벤트 조회(`replayed=true`)로 끝나 메일이 다시 나가지 않는다. 이때 새 space는 쓰이지 않으며 실행기는 이벤트의 원래 링크를 보여준다. 빈 space가 하나 남으므로 필요할 때만 한다.
- 일정을 Calendar에서 지우면 그 이벤트 id는 다시 쓸 수 없다. 새 키를 쓴다.
- 이 저장소에서는 실행기의 원장 동작을 Google 대신 로컬 fetch 대체로만 돌려 보았다. 실제 Google 응답은 아직 관찰하지 않았다.

## 6. 수동 검증 절차 (자격 증명 확보 후)

1. 위 실행기의 `check`로 토큰과 범위를 확인한다(B 경로는 5절 명령 그대로).
2. **B**: `create`를 같은 키로 두 번 실행한다. Meet 링크 1개, 캘린더 이벤트 1개, 참여자별 메일 1통인지 각 계정에서 확인한다. 참여자가 응답하고 링크로 입장한 뒤 `observe`의 결과를 기록한다.
3. 실패 확인: 잘못된 token(`unauthenticated`), 범위 누락(`permission_denied`), 거절 응답(`declined`), 시작 후 무응답(`no_response`)이 각각 성공과 다른 상태로 남는지 본다.
4. **A**: 사람이 만든 미팅 링크로 `registerInvitation`을 호출한다. PM 계정이 브라우저로 입장을 시도하고 결과(입장/거절/끊김)를 `report`로 남긴다. 회의 중 채팅을 사람이 옮겨 적는 경우 근거는 `human_report`로 구분한다.
5. 결정/제안/미해결을 `recordNotes`로 원문 위치와 함께 남기고, 후속 요청 전달은 #79/#81 경로가 생긴 뒤 시험한다.
6. 관찰 결과를 이 문서의 표에 날짜·계정 종류·관찰 근거와 함께 갱신한다. 회의록 업로드만 성공하면 "회의록 처리만 검증"으로 남긴다.

## 7. 의존과 남은 일

- **#81 개인 Agent/작업환경 참여**: Space 공통 참여 경로와 공통 이벤트가 정해지면 `meeting_*` 이벤트를 core 공통 이벤트로 올릴지, 회의 결정을 `decision_recorded`와 어떻게 연결할지 함께 정한다. 후속 요청의 작업환경 전달은 여기에 의존한다.
- **#79 Slack**: 초대 안내·후속 연락을 Slack 스레드로 보낼 경우 그 접점을 재사용한다.
- 회의 중 맥락 수신·응답의 실제 경로(브라우저 참여 또는 add-on)는 정해지지 않았다.
- PM 계정 캘린더의 초대 수신 감지(`events.list`)는 미구현이다.
- lease 만료 뒤 남을 수 있는 빈 Meet space 정리는 미구현이다.
- 미팅 주선 권한은 현재 "사람(`confirmedBy`)이 참여자·일정을 확인함"으로만 표현한다. 프로젝트 위임 설정(`pmMayApply`)에 미팅 생성 권한을 넣을지는 제품 결정이 필요하다.
