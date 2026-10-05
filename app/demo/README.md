# 데모 안내

확인 기준: **2026-10-05, main `605521b`**. 세 데모는 한 기능의 버전별 화면이 아니라 서로 다른 시나리오다. 실제 프로젝트 앱은 `/`이며 [작업 모델](../../docs/work-model.md)을 따른다.

## 목적과 선택

코드 소유 경계는 다음과 같다. 실제 제품 런타임을 데모 폴더로 옮기거나 화면을 하나로 합치지 않는다.

```text
app/
  apps/web/              실제 웹앱·API와 기존 URL의 라우트 연결부
  packages/              PM·원장·저장소·공유 시나리오 입력/재생기
  demo/
    runtime/             실제 앱을 이용하는 시연 안내·관찰 실행기
    scripted/
      pm-coordination/   PM 조율 화면·상태·스타일
      marketing-campaign/ 마케팅 캠페인 화면·상태·이미지·발표 자료
      design-to-code/    디자인→개발 협업 화면·상태·이미지·브라우저 검사
```

스크립트 데모는 제품 런타임을 import하지 않는다. Next.js 라우트가 각 화면을 연결하며 이미지 파일은 각 데모의 `assets/`에서 정적 import로 배포된다. 런타임 시연 방법과 실행기의 제한은 [runtime 안내](runtime/README.md)를 참고한다.

**자유 시연:** `/`에서 상단 **자유형식**을 누르고 **새 프로젝트 시작** 폼에 목표와 선택 기한을 입력한다. 좁은 화면에서는 먼저 **메뉴**를 연다. 진행 중인 프로젝트가 있으면 기존 기록을 보관하고 바꿀지 확인한다. 목표·발언을 직접 입력하는 서버 앱이며 아래 세 고정 시연과 다르다. 같은 앱의 **시나리오** 버튼은 사람 입력을 대본으로 재생한다.

| 경로 | 주제 | 진행 방식 | 주로 보여주는 것 |
|---|---|---|---|
| `/demo/pm-coordination` | 사람 의견을 반영하는 PM과 Story·UI Agent | 지원하는 자연어 문장·선택지와 고정 결과 | 비교 예시→사람 판단→범위·일정 조율→화면 초안→요청한 부분만 수정 |
| `/demo/marketing-campaign` | S27 마케팅팀의 공유 업무 맥락 | 다음/이전 장면과 근거 노드 탐색 | 미팅 결정→메신저 요청→소재 v1.0→근거 확인→다른 팀원의 수정 v1.1 |
| `/demo/design-to-code` | 두 사람과 각자의 Agent 사이의 협업 | 역할을 표시한 선택 버튼·초안 공유·검토 | 합의→UX 초안→구현→QA 보완→사람 승인→모바일 담당 인계 |

기능 설명 발표에는 [마케팅 캠페인 발표 문서](scripted/marketing-campaign/README.md), UX 초안을 공유하고 구현·검토로 이어가는 체험에는 [디자인→개발 협업 안내](scripted/design-to-code/README.md)를 사용한다. PM 조율 데모는 의견·실행 승인·추가 범위를 구분한다.

## 실행

Node.js 24 이상에서 저장소의 `app/`을 작업 디렉터리로 사용한다.

```sh
npm ci
npm run dev
```

터미널에 표시된 주소의 `/demo/pm-coordination`, `/demo/marketing-campaign`, `/demo/design-to-code`를 연다. 기본 주소는 `http://localhost:3000`이다. 세 시연 자체는 API 키·provider 로그인·런타임 환경변수가 필요 없다. 실제 앱 `/`에서 모델 없이 실행하려면 PM과 worker를 모두 fake로 설정한다([실행 안내](../../README.md#설치와-로컬-실행)).

기존 `/demo`, `/s27`, `/handoff`는 각각 위의 새 주소로 연결된다. `S27`은 마케팅 캠페인 데모 안의 가상 제품 이름으로 유지한다.

## PM 조율 진행 예시

1. 시작 후 Story가 두 예시를 제시할 때까지 기다린다.
2. “2안이 좋아요. 표현은 조금 낮춰주세요.”로 선호와 우려를 전달한다. 이것만으로 화면 제작을 승인하지 않는다.
3. “그럼 이 기준으로 화면 한번 볼까요?”로 기존 범위의 초안을 요청한다.
4. 결과를 본 뒤 “fiction 표시를 넣고 노래는 제외해 주세요.”로 제한된 수정을 요청한다.

결제 추가나 다음 주로 미루는 요청은 별도 조율로 들어간다. 지원하지 않거나 조건이 섞인 요청은 확인을 기다리며, 실제 일정 예약·자동 재개는 하지 않는다. 문장을 처리하는 코드는 고정 규칙이며 자유형식 LLM 이해의 증거가 아니다.

## 코드와 검증 범위

| 경로 | UI / 상태 코드 | 현재 자동 검사 |
|---|---|---|
| `/demo/pm-coordination` | [PmCoordinationDemo](scripted/pm-coordination/PmCoordinationDemo.tsx), [pm-coordination](scripted/pm-coordination/pm-coordination.ts) | [2개 검사](../test/essential-pm-coordination.test.ts): 사람 판단·조율, 수정 범위·오래된 콜백 |
| `/demo/marketing-campaign` | [MarketingCampaignDemo](scripted/marketing-campaign/MarketingCampaignDemo.tsx), [시나리오·상태](scripted/marketing-campaign/index.ts) | [6개 검사](../test/essential-marketing-campaign.test.ts): 참조·5단계·문구 밀도·이동·선택·근거 추적 |
| `/demo/design-to-code` | [DesignToCodeDemo](scripted/design-to-code/DesignToCodeDemo.tsx), [design-to-code](scripted/design-to-code/design-to-code.ts) | [4개 검사](../test/essential-design-to-code.test.ts): 동의·공유·QA·수정·취소와 기록 이동 |

이 검사는 시나리오와 상태 전이를 확인한다. 실제 모델 추론·작업 실행, 브라우저 레이아웃, 외부 서비스 연동이나 제품 효과를 입증하지 않는다. 브라우저 검사 실행과 결과 관리는 [QA 안내](../../docs/qa/README.md)를 따른다. 새로고침 후 시연을 다시 시작하며 프로젝트 원장에 결과를 저장하지 않는다.
