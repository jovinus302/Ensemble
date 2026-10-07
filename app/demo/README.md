# PM Agent 대시보드 · CLI feasibility

/demo는 기존 서버의 목표·작업·담당·결정·산출물을 읽는 보조 뷰다. 각자의 에디터, 디자인 도구, Slack, 미팅을 한 화면에 재현하지 않는다. 처음부터 완성형 연동을 만드는 대신 기존 CLI 경로가 목표 → 계획 → 승인 → 실행 → 결과 확인으로 이어지는지 검증한다.

## 실행

Node.js 24 이상에서 app/으로 이동해 npm ci를 실행한다. Codex CLI 설치·로그인 후 PowerShell에서 아래 설정으로 실행한다. 작업 폴더는 저장소 밖의 사용자가 지정한 경로를 사용한다.

```powershell
$env:ENSEMBLE_PM_RUNTIME = 'codex'
$env:ENSEMBLE_AGENT_RUNTIME = 'codex'
$env:ENSEMBLE_AGENT_WORKSPACE_ROOT = '<저장소 밖의 작업 폴더 절대 경로>'
$env:ENSEMBLE_DATA_DIR = '<시연 데이터 폴더 절대 경로>'
npm run dev
```

/demo에서 목표를 입력하고 PM Agent의 결정 요청을 확인한다. 승인된 작업은 기존 connector로 실행되며 상태와 산출물이 갱신된다. 이미 프로젝트가 있다면 입력은 후속 요청으로 전달되며 프로젝트를 자동 교체하지 않는다. 사람 권한과 실행 중복 방지는 기존 API가 담당한다.

## 관찰과 한계

화면의 실행 설정은 연결 성공 보장이 아니다. 실제 CLI 성공은 작업 결과와 산출물로 확인한다. 기본 worker는 fake이고 PM Agent는 api이므로 실제 CLI 시연은 명시적으로 설정해야 한다. fake 또는 기존 시나리오 기록은 화면에서 구분하며 ?mock=1로 대시보드 데이터를 대체하지 않는다. 서버 오류와 연결 끊김도 표시한다.

현재 연결은 Ensemble 런타임이 관리하는 CLI 세션이다. 사용자가 다른 곳에서 실행 중인 임의의 CLI 세션을 자동 수집하는 기능은 아니다. 모델 판단 품질·운영 안정성·조율 시간 절감은 이 feasibility만으로 입증되지 않는다. 산출물 제출과 검토 완료도 구분한다.

## 다음 도구별 검증

- [Figma · 파일 댓글과 변경 맥락](https://github.com/jovinus302/Ensemble/issues/78)
- [Slack App · 멘션과 스레드 답변](https://github.com/jovinus302/Ensemble/issues/79)
- [Google Meet 후보 · 종료 후 회의 기록](https://github.com/jovinus302/Ensemble/issues/80)

각 이슈에서 먼저 대상 도구, PM Agent가 붙는 위치, 입력과 응답 경로를 검증한다. 미구현 도구의 가상 기록을 대시보드에 채우지 않는다. 제품 방향은 [intent.md](../../intent.md), 검사 방법은 [QA 안내](../../docs/qa/README.md)를 따른다.

CLI 현재 방식과 발전 방식은 [#81](https://github.com/jovinus302/Ensemble/issues/81)에서 관리한다. 현재 managed 세션과, 사용자의 기존 Agent·폴더가 Space에 참여하는 경로를 구분한다. 첫 실험은 MCP 대신 HTTP(Space 맥락 읽기·글 공유)와 폴더 안 요청함(`.ensemble/inbox/`)을 썼고, 실제 Codex CLI 한 세션의 왕복을 [실험 기록](../../docs/experiments/issue-81-personal-agent-space.md)에 남겼다. MCP와 Skill은 아직 후보다.

### 이번 실행에서 확인한 한계

기존 계획 생성은 조사·인터뷰·흐름·프로토타입 역할 템플릿을 사용한다. 단일 작업 요청에도 선행 단계가 남을 수 있다. 현재 관찰한 성공은 실제 Codex worker의 파일 제출과 대시보드 반영이며, 전체 로그인 서비스 완료는 아니다. 고정 템플릿과 개인 CLI 접점의 발전 방향은 #81에서 추적한다.
