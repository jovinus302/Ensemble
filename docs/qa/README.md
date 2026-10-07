# 현재 QA 안내

Node.js 24 이상에서 app/의 의존성을 설치한 뒤 실행한다.

```sh
npm test
npm run typecheck
npm run build
```

[필수 회귀 검사](essential-regressions.md)는 기존 제품의 권한·중복 실행·종료·격리와 새 데모의 출처 연결·결정 반영을 확인한다. 실제 모델이나 외부 서비스는 호출하지 않는다. 타입 검사와 웹 빌드는 별도로 수행한다.

## 브라우저 확인

[브라우저 검사](../../app/demo/workspaces/qa/browser.cjs)는 실행 중인 서버와 기존 Playwright 설치를 사용한다. app/에서 서버를 실행하고 다른 터미널에서 다음을 실행한다.

```powershell
$env:ENSEMBLE_PLAYWRIGHT_PATH = '<Playwright 모듈의 절대 경로>'
$env:ENSEMBLE_DEMO_URL = 'http://127.0.0.1:3000'
node demo/workspaces/qa/browser.cjs
```

기본 브라우저는 Edge이며 ENSEMBLE_BROWSER로 Playwright의 다른 설치된 채널을 지정할 수 있다. 개발·디자인 공유 순서, 미팅 선행, 중복 방지, 결정의 개별 반영, 원본 이동, 산출물 내용, 키보드·닫기·포커스 복귀, 보조 뷰 숨기기, 초기화·새로고침, 좁은 화면, 과거 URL 연결, 페이지 오류와 API·외부 요청 부재를 확인한다.

스크린샷은 .local/qa/workspaces/에 저장하며 Git에 포함하지 않는다. 코드·디자인의 실제 동작이나 로그인 백엔드를 테스트하는 것이 아니라 데모의 사용자 동작과 표시 내용이 일치하는지 검사한다.

## 제품 검증과의 구분

검사 통과는 실제 PM Agent의 판단 품질이나 다양한 팀의 조율 부담 감소를 입증하지 않는다. 실사용 검증에서는 [intent.md](../../intent.md)의 판단 기준에 따라 재설명·수동 추적·누락·지연·불필요한 개입과 실제 후속 행동을 관찰한다.

기존 / 앱의 확인은 PM과 Agent를 모두 fake로 설정하고 별도 ENSEMBLE_DATA_DIR을 사용한다([설치 안내](../../README.md)). live:pm은 실제 provider를 호출할 수 있는 제품 개발용 명령이며 기본 검사나 새 데모 실행에 포함하지 않는다.
