# 런타임 시연

런타임 시연은 실제 제품 앱을 사용한다. 웹 UI·API는 [apps/web](../../apps/web), PM·원장·저장소는 [packages](../../packages)에 있으며 이 디렉토리에 복제하지 않는다. [스크립트 데모](../README.md)는 모델이나 서버 API를 호출하지 않는 별도 시연이다.

## 자유형식과 시나리오

`app/`에서 `npm ci`, `npm run dev` 후 기본 주소 `http://localhost:3000/`을 연다.

- **자유형식:** 상단 **자유형식** → **새 프로젝트 시작**에서 목표와 선택 기한을 입력한 뒤 직접 대화한다. 좁은 화면에서는 먼저 **메뉴**를 연다.
- **시나리오:** 상단 **시나리오**로 사람 발언·첨부를 재생한다. 입력만 대본이며 PM·Agent는 선택한 런타임으로 실행된다. 공유 입력·재생기는 [@ensemble/scenarios](../../packages/scenarios/src/index.ts)에 있다.
- 진행 중인 프로젝트를 교체하면 기존 기록을 보관하는 확인 흐름을 따른다. 데이터 위치는 기본 `app/data/`이며 `ENSEMBLE_DATA_DIR`로 분리할 수 있다.

모델 호출 없이 앱의 흐름을 보려면 PM과 Agent를 둘 다 fake로 설정한다.

### Pages v2.5 (WORK CONTEXT)

상단 **대본**에서 **Pages v2.5 · WORK CONTEXT**를 고르고 **시나리오**를 누른 뒤 **다음 발언**을 반복한다. 장면 03(감지)→04(정렬·pool·Proposal·"A로 가면?")→05(확정·제작 도구 전달·v1.0 빌드)→06(v1.1 변경)이 채팅 | WORK CONTEXT 캔버스·LOG | 모바일 미리보기로 진행된다. 장면 06의 "변경 적용"은 대본이 결정권자 김서연으로 누르며, 사람이 카드에서 직접 누를 수도 있다.

- 대본은 사람 발언만 재생한다. 예외로 장면 03의 Story Agent·UI Agent 두 줄은 실행기가 기록한다(시연 대본의 한계). PM 출력은 대본에 없다.
- `ENSEMBLE_PM_RUNTIME=fake`이면 PM이 규칙으로 답해 매번 같은 기록을 남긴다([golden ledger](../../packages/scenarios/src/pages-v25/golden.ts)와 같은 WORK CONTEXT). api·codex·claude PM은 같은 `update_work_context` 계약을 모델이 채운다.
- 인력 pool 합류와 Figma·프롬프트 스튜디오·개발 도구의 진행·빌드는 모든 PM 런타임에서 시뮬레이션이며 외부 서비스를 부르지 않는다. 한 단계는 약 2초다.
- 설계와 소유 경계는 [Pages v2.5 설계](../../../docs/pages-v25-runtime-demo.md)를 따른다.

```powershell
$env:ENSEMBLE_PM_RUNTIME = 'fake'
$env:ENSEMBLE_AGENT_RUNTIME = 'fake'
npm run dev
```

실제 provider 선택과 작업 공간 규칙은 [아키텍처](../../../docs/mvp-architecture.md)를 따른다. 자유형식이라는 이름이 실제 모델 설정을 자동으로 켠다는 뜻은 아니다.

## 연속 시연 관찰 도구

[run.ts](run.ts)는 기존 `app/scripts/demo-full.ts`에서 이동한 관찰 실행기다. `app/`의 `npm run demo:full` 명령은 유지된다. 앱 루트를 찾아 이미 빌드된 웹 서버를 시작하고 시나리오·원장·결과를 관찰한다.

이 도구는 **Codex worker를 실제로 실행**하며 PM은 환경 설정을 따른다. 코드에는 기존 작성자 환경의 `ENSEMBLE_ENV_FILE` 경로와 사용자 홈의 출력 위치가 남아 있다. 일반 설치용 provider-free 검사로 실행하지 않는다. 사용 환경과 실제 provider 실행 범위를 확인한 후 사용한다. 이번 디렉토리 정리에서는 이 도구의 실제 모델 실행을 재검증하지 않았다.

현재 기본 검사는 `npm test`, `npm run typecheck`, `npm run build`이며 [QA 안내](../../../docs/qa/README.md)에 범위를 기록한다.
