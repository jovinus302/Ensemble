# 현재 QA 안내

Node.js 24 이상에서 app/의 의존성을 설치한 뒤 npm test, npm run typecheck, npm run build를 실행한다. 기존 회귀 검사는 권한·중복 실행·종료·격리를 확인하며 실제 모델을 호출하지 않는다.

## 대시보드 브라우저 확인

실행 중인 별도 테스트 서버와 Playwright 설치를 사용한다. 아래 검사는 상태 조회만 수행하며 실제 프로젝트를 시작하거나 승인하지 않는다.

```powershell
$env:ENSEMBLE_PLAYWRIGHT_PATH = '<Playwright 모듈의 절대 경로>'
$env:ENSEMBLE_DEMO_URL = 'http://127.0.0.1:3000'
node demo/workspaces/qa/browser.cjs
```

기본 브라우저는 Edge다. 실제 상태 API와 표시 작업 수의 일치, /demo의 mock 쿼리 무시, 작업 공간 UI 부재, 모바일 넘침, 과거 URL, 서버 오류에서 가상 기록을 표시하지 않는지 확인한다. 오류 응답은 이 검사 탭에서만 가로챈다. 캡처는 저장소 .local/qa/dashboard/에 저장한다.

## 실제 CLI feasibility

[데모 실행 안내](../../app/demo/README.md)에 따라 별도 데이터·작업 폴더와 인증된 CLI를 사용한다. 작은 목표 하나를 입력하고 계획을 검토·승인한 뒤 실제 Agent의 결과와 산출물을 대시보드에서 확인한다. 실행 설정 표시는 성공 증거가 아니다. 실제 호출 결과·산출물·실패 원인을 기록하고 fake 테스트와 구분한다.

이 검증은 임의의 개인 CLI 세션 자동 수집, Figma·Slack·미팅 연결, 실제 인증 서비스 또는 PM Agent의 판단 품질·팀 생산성 개선을 입증하지 않는다. 각 후속 도구는 별도 이슈에서 검증한다.
