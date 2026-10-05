# 현재 QA 안내

`app/`에서 Node.js 24 이상과 설치된 의존성을 사용한다.

```sh
npm test
npm run typecheck
npm run build
```

현재 자동 검사는 [18개 핵심 회귀 검사](essential-regressions.md)다. 실제 모델·provider 로그인·외부 서비스를 사용하지 않는다. 타입 검사와 웹 빌드는 별도로 실행한다. 자동 검사 통과는 실제 모델 판단 품질이나 팀의 조율 시간 감소를 증명하지 않는다.

## 브라우저 확인

[인계 데모 브라우저 검사](../../app/demo/scripted/handoff/qa/browser.cjs)는 `npm test`와 별개다. 기존 Playwright 설치와 실행 중인 로컬 서버를 사용한다.

`app/` 기준 PowerShell 예시:

```powershell
$env:ENSEMBLE_PLAYWRIGHT_PATH = '<기존 Playwright 모듈 경로>'
$env:ENSEMBLE_DEMO_URL = 'http://127.0.0.1:3000'
node demo/scripted/handoff/qa/browser.cjs
```

두 사람의 동의, 초안 공유, QA 보완, 사람 검토, 중복·오래된 입력, 중단·기록 이동, 좁은 화면과 이미지 실패 대체 표시를 확인한다. 출력은 저장소의 무시된 `.local/qa/handoff/`에 쓴다. 실제 provider나 제품 인증을 검증하지 않는다.

실제 앱 `/`의 브라우저 확인은 PM·Agent를 모두 fake로 설정하고 `ENSEMBLE_DATA_DIR`을 별도 로컬 경로로 지정한다([런타임 안내](../../app/demo/runtime/README.md)). provider를 호출하는 `demo:full`과 `live:pm`은 기본 검사에 포함하지 않는다.

## 결과 관리

날짜별 과거 QA 보고서·스크린샷·벤치마크 증거와 제거된 실행기 안내는 현재 트리에 보관하지 않는다. 새 실행 결과는 무시된 `.local/` 아래에 두고, 변경 설명에는 실행한 검사·환경·결과·제한을 적는다. 검증하지 않은 경로를 통과로 기록하지 않는다.
