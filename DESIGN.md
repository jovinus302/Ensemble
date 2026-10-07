---
version: alpha
name: Ensemble
description: 여러 사람과 Agent의 협업에서 맥락을 이해하고 다음 행동을 조율하는 PM Agent. 기존 작업 환경을 주 공간으로 유지하고 프로젝트 맥락은 보조 뷰로 확인한다.
colors:
  # Brand anchor (concept PDF에서 추정한 톤)
  brand-ink: "#173B30"
  primary: "#2B6A52"
  on-primary: "#FFFFFF"
  primary-container: "#D3EBDD"
  on-primary-container: "#0D3325"
  secondary: "#52635A"
  on-secondary: "#FFFFFF"
  secondary-container: "#E3EDE7"
  on-secondary-container: "#101F18"
  tertiary: "#6D4FD8"
  on-tertiary: "#FFFFFF"
  tertiary-container: "#E9E1FF"
  on-tertiary-container: "#25105E"
  # Neutrals (light)
  background: "#F6F6F3"
  surface: "#FFFFFF"
  surface-container-low: "#F1F2EE"
  surface-container: "#ECEEE9"
  surface-container-high: "#E5E8E3"
  on-surface: "#18201C"
  on-surface-variant: "#4A5650"
  outline: "#7A867F"
  outline-variant: "#C9D1CB"
  scrim: "#0E1311"
  # Semantic status
  success: "#1E7F4F"
  success-container: "#D2EFDD"
  warning: "#9A5B00"
  warning-container: "#FFE7C2"
  error: "#BA1A1A"
  error-container: "#FFDAD6"
  info: "#2A64D6"
  info-container: "#DCE6FF"
  # Harmony gradient stops (Labs spectrum)
  harmony-1: "#3DBE8B"
  harmony-2: "#4C8DF6"
  harmony-3: "#9B7BF7"
  harmony-4: "#F08BB4"
  # Agent voices (light): base / container / on-container
  voice-pm: "#2B6A52"
  voice-pm-container: "#D3EBDD"
  voice-pm-on: "#0D3325"
  voice-1: "#6D4FD8"
  voice-1-container: "#E9E1FF"
  voice-1-on: "#25105E"
  voice-2: "#2A64D6"
  voice-2-container: "#DCE6FF"
  voice-2-on: "#0B2A66"
  voice-3: "#B34626"
  voice-3-container: "#FFE0D6"
  voice-3-on: "#4A1406"
  voice-4: "#946200"
  voice-4-container: "#FCEBC8"
  voice-4-on: "#2E1E00"
  voice-5: "#007873"
  voice-5-container: "#CCF0EC"
  voice-5-on: "#00302E"
  voice-6: "#B0337E"
  voice-6-container: "#FBDCEC"
  voice-6-on: "#3F0A2A"
  voice-7: "#557A12"
  voice-7-container: "#E2F0CC"
  voice-7-on: "#1B2A00"
  voice-8: "#4A56A6"
  voice-8-container: "#E0E3F8"
  voice-8-on: "#151C4A"
  # Dark theme
  dark-background: "#0E1311"
  dark-surface: "#151B18"
  dark-surface-container-low: "#19201D"
  dark-surface-container: "#1E2622"
  dark-surface-container-high: "#27302C"
  dark-on-surface: "#E3E9E5"
  dark-on-surface-variant: "#A8B4AD"
  dark-outline: "#87938C"
  dark-outline-variant: "#3B4640"
  dark-primary: "#8FD5B3"
  dark-on-primary: "#00382A"
  dark-primary-container: "#1F513F"
  dark-on-primary-container: "#C0EBD5"
  dark-tertiary: "#C8B8FF"
  dark-error: "#FFB4AB"
  dark-voice-1: "#C8B8FF"
  dark-voice-1-container: "#33236E"
  dark-voice-2: "#AFC6FF"
  dark-voice-2-container: "#173A7A"
  dark-voice-3: "#FFB59E"
  dark-voice-3-container: "#6A2410"
  dark-voice-4: "#F2C35C"
  dark-voice-4-container: "#4A3300"
  dark-voice-5: "#6FD8D1"
  dark-voice-5-container: "#00423F"
  dark-voice-6: "#F7A8D2"
  dark-voice-6-container: "#5E1A43"
  dark-voice-7: "#B5D67A"
  dark-voice-7-container: "#2C4200"
  dark-voice-8: "#BCC3FF"
  dark-voice-8-container: "#2A3372"
typography:
  display-lg:
    fontFamily: Google Sans Flex
    fontSize: 57px
    fontWeight: 500
    lineHeight: 64px
    letterSpacing: -0.25px
    fontVariation: "'ROND' 100, 'opsz' 57"
  display-md:
    fontFamily: Google Sans Flex
    fontSize: 45px
    fontWeight: 500
    lineHeight: 52px
    fontVariation: "'ROND' 100, 'opsz' 45"
  headline-lg:
    fontFamily: Google Sans Flex
    fontSize: 32px
    fontWeight: 500
    lineHeight: 40px
  headline-md:
    fontFamily: Google Sans Flex
    fontSize: 28px
    fontWeight: 500
    lineHeight: 36px
  headline-sm:
    fontFamily: Google Sans Flex
    fontSize: 24px
    fontWeight: 500
    lineHeight: 32px
  title-lg:
    fontFamily: Google Sans Flex
    fontSize: 22px
    fontWeight: 500
    lineHeight: 28px
  title-md:
    fontFamily: Google Sans Flex
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: 0.1px
  title-sm:
    fontFamily: Google Sans Flex
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0.1px
  message-body:
    fontFamily: Google Sans Text
    fontSize: 15px
    fontWeight: 400
    lineHeight: 23px
  body-lg:
    fontFamily: Google Sans Text
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-md:
    fontFamily: Google Sans Text
    fontSize: 14px
    fontWeight: 400
    lineHeight: 21px
  body-sm:
    fontFamily: Google Sans Text
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
  label-lg:
    fontFamily: Google Sans Flex
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.1px
  label-md:
    fontFamily: Google Sans Flex
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.4px
  label-sm:
    fontFamily: Google Sans Flex
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.5px
  code:
    fontFamily: Google Sans Code
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  lg-plus: 20px
  xl: 28px
  xl-plus: 32px
  xxl: 48px
  full: 9999px
spacing:
  unit: 4px
  "0": 0px
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "8": 32px
  "10": 40px
  "12": 48px
  "16": 64px
  rail-width: 72px
  sidebar-width: 280px
  thread-width: 400px
  message-max: 760px
  message-gap: 4px
  group-gap: 16px
components:
  app-rail:
    backgroundColor: "{colors.background}"
    width: "{spacing.rail-width}"
  sidebar:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface-variant}"
    width: "{spacing.sidebar-width}"
    padding: "{spacing.3}"
  channel-item:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 36px
    padding: "0 {spacing.3}"
  channel-item-active:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    typography: "{typography.title-sm}"
    rounded: "{rounded.full}"
  message-human:
    backgroundColor: transparent
    textColor: "{colors.on-surface}"
    typography: "{typography.message-body}"
    padding: "{spacing.2} {spacing.4}"
  message-agent:
    backgroundColor: "{colors.voice-1-container}"
    textColor: "{colors.voice-1-on}"
    typography: "{typography.message-body}"
    rounded: "{rounded.lg-plus}"
    padding: "{spacing.3} {spacing.4}"
  message-pm:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.message-body}"
    rounded: "{rounded.xl}"
    padding: "{spacing.4} {spacing.5}"
  card-assignment:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.4}"
  card-handoff:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.xl}"
    padding: "{spacing.5}"
  card-direction:
    backgroundColor: "{colors.brand-ink}"
    textColor: "{colors.secondary-container}"
    rounded: "{rounded.lg-plus}"
    padding: "{spacing.5}"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.xl}"
    padding: "{spacing.3} {spacing.4}"
  mention-agent:
    backgroundColor: "{colors.voice-1-container}"
    textColor: "{colors.voice-1-on}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    padding: "0 {spacing.2}"
  thread-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    width: "{spacing.thread-width}"
    rounded: "{rounded.xl}"
  chip-status:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 24px
    padding: "0 {spacing.2}"
  chip-working:
    backgroundColor: "{colors.info-container}"
    textColor: "{colors.on-surface}"
  chip-needs-you:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.on-surface}"
  chip-done:
    backgroundColor: "{colors.success-container}"
    textColor: "{colors.on-surface}"
  chip-failed:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.on-surface}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 40px
    padding: "0 {spacing.6}"
  button-tonal:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 40px
    padding: "0 {spacing.6}"
  button-outlined:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 40px
  button-text:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
  avatar-human:
    rounded: "{rounded.full}"
    size: 36px
  avatar-agent:
    rounded: "{rounded.md}"
    size: 36px
  avatar-pm:
    rounded: "{rounded.md}"
    size: 40px
---

# Ensemble Design System

## Overview

### 제품 정의와 화면의 역할

Ensemble은 여러 사람과 Agent가 동시에 일하는 환경에서 흩어진 맥락을 목표 아래 연결하고 다음 행동을 조율하는 **PM Agent**다. North Star와 여섯 역할은 [intent.md](intent.md)를 따른다. 다양한 협업을 대상으로 하며 개발·디자인은 데모 사례다.

주 작업 공간은 팀원이 원래 쓰는 도구다. PM Agent는 그곳에서 필요한 결정·자료·결과를 전달하고 다음 행동을 챙긴다. 우측은 목표, 작업·담당, 결정·이유·출처, 산출물·버전, 남은 일과 행동 결과를 확인하는 보조 뷰다. 그래프나 상태 편집을 제품의 주인공으로 삼지 않는다.

### 브랜드 메타포: 각자의 연주를 하나의 목표로

- 사람은 제작·판단·검토에 직접 참여한다.
- 작업 Agent는 각자의 환경에서 업무를 수행한다.
- PM Agent는 서로 필요한 맥락과 다음 행동을 조율한다.
- 연결을 표현할 때는 출처·대상·의미를 함께 보여준다. 선이 있다는 이유만으로 전달·실행·완료를 의미하지 않는다.

### 왜 Google Labs 스타일인가
- Ensemble은 "사람과 AI가 한 팀"이라는 **아직 정답이 없는 실험**이다. Labs 스타일의 정서, 즉 "완성품보다 가능성을 먼저 보여주는 밝은 실험실"이 이 제품의 위치와 맞는다.
- Labs와 Gemini 시대 Google 제품이 쓰는 **스펙트럼 그라디언트는 "AI가 지금 여기서 일한다"는 신호**로 읽힌다. Ensemble은 이 그라디언트를 AI가 개입하는 순간(생각 중, 배정, Handoff)에만 **아껴서** 쓴다. 그래서 그라디언트가 곧 의미를 갖는다.
- M3 Expressive의 **모양 대비와 스프링 모션**은 여러 참여자를 한눈에 구분하게 해 준다. 사람은 원, Agent는 둥근 사각이다. 또 대화가 살아 움직이는 느낌을 준다.
- 기저는 차분하다. 오프화이트 종이 배경, 흰 카드, 포레스트 그린 잉크를 쓴다. 유희적인 요소는 전체의 10% 정도로 제한하고, 나머지 90%는 오래 일해도 피곤하지 않은 업무 도구로 만든다.

### 무드 키워드
밝은 실험실 · 정돈된 유희 · 따뜻한 지휘 · 화음 · 이어짐 · 종이와 잉크 위의 빛

### 제품 아이덴티티
- **워드마크**: 소문자 `ensemble`로 쓴다. Google Sans Flex에 `ROND` 100, weight 560 정도, 자간 -1%를 적용한다. 글자 `e`가 둘 이상 반복되는 리듬을 살린다. 컬러 버전은 `brand-ink` 단색을 기본으로 한다. 히어로 영역에서만 첫 글자 `e`의 카운터(속 공간) 안에 harmony gradient 점 하나를 넣어 "지휘봉 끝의 빛"을 표현할 수 있다. Google "G"의 그라디언트나 형태는 흉내 내지 않는다.
- **심볼(제안)**: 원 1개(사람)와 서로 다른 M3 Expressive 모양 3개(둥근 사각, 쿠키, 알약: Agent들)가 부드러운 호(arc) 위에 겹쳐 놓인 코드(chord) 형태다. 호는 지휘봉이 그리는 궤적이자 Handoff 라인이다. 앱 아이콘은 `brand-ink` 배경에 도형만 harmony 톤으로 채운다.
- **키비주얼·히어로 이미지 방향**: 오프화이트(라이트)나 딥 그린 블랙(다크) 위로 부드러운 harmony gradient 리본이 흐르고, 그 위에 색색의 도형 연주자들이 떠 있다. 리본은 대화와 맥락의 흐름이고, 도형은 참여자다. 사진풍 로봇, 인간형 AI 얼굴, 은하·회로기판 같은 SF 클리셰는 쓰지 않는다.
- **일러스트 스타일**: 평면 기하 도형(M3 Expressive shape library 계열)으로 그린다. 두께 있는 선이나 그림자는 쓰지 않고, 빛 번짐은 그라디언트로만 표현한다. 도형 캐릭터에 눈은 점 2개까지만 허용한다(빈 상태·온보딩 한정). 색은 voice 팔레트와 harmony를 쓴다.
- **보이스 & 톤**
  - 전체: 명료하고 따뜻하게, 짧게 말한다. 결론을 먼저, 이유는 한 줄로.
  - PM Agent: 무대감독처럼 말한다. "누가 · 무엇을 · 언제까지 · 무엇이 필요하다" 순서를 지킨다. 과장이나 사과를 늘어놓지 않는다.
    - 예: "디자인 시안은 @Iris에게 맡겼어요. 금요일 오전까지 받을 수 있어요. 결정이 하나 필요해요: 다크 모드 포함 여부."
  - 시스템 문구는 존댓말 해요체를 쓴다. 에러 문구는 원인과 다음 행동을 함께 적는다.
  - "마법처럼", "완벽하게" 같은 과장어는 쓰지 않는다. AI의 한계는 숨기지 않는다.

## Colors

### 원칙
1. **중립이 90%**다. 배경 `background`(#F6F6F3), 카드 `surface`(#FFFFFF), 텍스트 `on-surface`(#18201C)가 화면을 지배한다.
2. **브랜드 앵커는 포레스트 그린**이다. `brand-ink`(#173B30), `primary`(#2B6A52), `secondary-container`(#E3EDE7) 세 색은 기존 브랜드 팔레트를 유지한 값이다. 주 행동 버튼, 활성 채널, 방향·요약 카드에 쓴다.
3. **harmony gradient는 AI의 신호**다. #3DBE8B → #4C8DF6 → #9B7BF7 → #F08BB4. 다음 경우에만 쓴다: PM Agent 아바타 링, 생각 중 shimmer, Handoff 연결선, 온보딩·히어로. 일반 버튼, 배경 전면, 텍스트에는 쓰지 않는다.
4. **사람과 Agent는 색만으로 구분하지 않는다**. 반드시 모양(원 대 둥근 사각)과 라벨(`AI` 배지, Agent 역할명)을 함께 쓴다.

### 역할별 팔레트 (Light)
| 토큰 | Hex | 역할 |
|---|---|---|
| brand-ink | #173B30 | 워드마크, 방향 카드 배경, 다크 강조면 |
| primary / on-primary | #2B6A52 / #FFFFFF | 주 버튼, 링크, 포커스 링, PM voice (대비 6.39:1) |
| primary-container / on- | #D3EBDD / #0D3325 | PM 메시지 강조, 선택 상태 (11.0:1) |
| secondary-container / on- | #E3EDE7 / #101F18 | 활성 채널, Handoff 카드, tonal 버튼 |
| tertiary / container | #6D4FD8 / #E9E1FF | 실험 기능·Labs 배지, "새 기능" 표시 |
| background | #F6F6F3 | 앱 바탕(종이) |
| surface | #FFFFFF | 메시지 열, 카드, 컴포저 |
| surface-container-low/ /-high | #F1F2EE / #ECEEE9 / #E5E8E3 | 사이드바, 칩 바탕, hover |
| on-surface / variant | #18201C / #4A5650 | 본문 / 보조 텍스트 (15.4:1 / 7.1:1) |
| outline / variant | #7A867F / #C9D1CB | 입력 테두리(3.8:1) / 구분선 |

### 상태 색 (항상 아이콘과 라벨을 함께 표시)
| 상태 | 색 / container | 쓰임 |
|---|---|---|
| working (진행 중) | info #2A64D6 / #DCE6FF | Agent가 작업 중 |
| needs-you (사람 필요) | warning #9A5B00 / #FFE7C2 | 승인·결정 대기, blocked |
| done (완료) | success #1E7F4F / #D2EFDD | 완료·승인됨 |
| failed (실패) | error #BA1A1A / #FFDAD6 | 실패·거절·실행 상태 불명 |

### Agent voice colors
각 Agent는 채널에 처음 들어올 때 voice 1~8 중 하나를 받는다. 같은 채널 안에서는 8개가 다 찰 때까지 겹치지 않게 배정하고, 이후에는 이름 해시로 배정한다. **그린 계열은 PM 전용**이며 다른 Agent에게 주지 않는다.

| voice | Light base / container / on | Dark base / container | 이름 예시 |
|---|---|---|---|
| pm | #2B6A52 / #D3EBDD / #0D3325 | #8FD5B3 / #1F513F | Conductor |
| 1 Violet | #6D4FD8 / #E9E1FF / #25105E | #C8B8FF / #33236E | 리서치 |
| 2 Blue | #2A64D6 / #DCE6FF / #0B2A66 | #AFC6FF / #173A7A | 개발 |
| 3 Coral | #B34626 / #FFE0D6 / #4A1406 | #FFB59E / #6A2410 | 디자인 |
| 4 Amber | #946200 / #FCEBC8 / #2E1E00 | #F2C35C / #4A3300 | 데이터 |
| 5 Teal | #007873 / #CCF0EC / #00302E | #6FD8D1 / #00423F | QA |
| 6 Magenta | #B0337E / #FBDCEC / #3F0A2A | #F7A8D2 / #5E1A43 | 마케팅·카피 |
| 7 Olive | #557A12 / #E2F0CC / #1B2A00 | #B5D67A / #2C4200 | 운영 |
| 8 Indigo | #4A56A6 / #E0E3F8 / #151C4A | #BCC3FF / #2A3372 | 법무·문서 |

- 대비(직접 계산): light base 색은 흰 배경 대비 4.6~6.6:1이라 이름 텍스트로 써도 된다. container 위 본문은 반드시 `*-on`을 쓴다(10.9~13.7:1). base 색을 container 위에 쓰는 것은 아이콘·테두리(3:1 이상)에만 허용한다.
- blue(voice-2)와 info 상태가 비슷하다. 상태 칩은 모양(알약 + 상태 아이콘)으로, Agent는 아바타 모양과 이름으로 구분한다.

### Dark theme
| 토큰 | Hex |
|---|---|
| dark-background | #0E1311 (그린 기운이 도는 near-black) |
| dark-surface / container-low / container / high | #151B18 / #19201D / #1E2622 / #27302C |
| dark-on-surface / variant | #E3E9E5 (15.2:1) / #A8B4AD (8.2:1) |
| dark-outline / variant | #87938C / #3B4640 |
| dark-primary / on / container / on-container | #8FD5B3 / #00382A / #1F513F / #C0EBD5 |
| dark-error | #FFB4AB |

다크에서는 Agent 메시지 바탕에 `dark-voice-N-container`, 텍스트에 `dark-on-surface`를 쓴다. harmony gradient는 다크에서 채도를 유지하고, 밝기만 85%로 낮춘 버전을 허용한다(`opacity: .85`).

## Typography

- **패밀리**
  - Display, Headline, Title, Label: `Google Sans Flex` (가변: `wght`, `wdth`, `opsz`, `slnt`, `GRAD`, `ROND`)
  - 본문, 메시지: `Google Sans Text`. 구할 수 없으면 `Google Sans Flex`에 `opsz` 14를 준다.
  - 코드: `Google Sans Code`
  - **한글 폴백은 필수**다. Google Sans 계열은 한글 글리프가 없으므로 `"Google Sans Flex", "Pretendard Variable", "Noto Sans KR", system-ui, sans-serif` 순서로 쓴다. Pretendard 라이선스(OFL)는 도입 시 확인한다.
- **Expressive 축 사용 규칙**: `ROND` 100(둥글게)은 display와 워드마크, 빈 상태 헤드라인에만 쓴다. 본문은 `ROND` 0을 쓴다. 강조는 weight 500→600으로 올려서 한다. 굵기 700 이상은 쓰지 않는다.
- **스케일** (M3 type scale 기반, 메시지·본문은 한글 가독성을 위해 line-height 1.5 이상)

| 토큰 | size / line | weight | 용도 |
|---|---|---|---|
| display-lg | 57 / 64 | 500 | 온보딩·랜딩 히어로 |
| display-md | 45 / 52 | 500 | 빈 상태 대제목 |
| headline-lg/md/sm | 32/40 · 28/36 · 24/32 | 500 | 프로젝트 개요, 모달 제목 |
| title-lg | 22 / 28 | 500 | 채널 헤더 이름 |
| title-md | 16 / 24 | 600 | 카드 제목, 발신자 이름 |
| title-sm | 14 / 20 | 600 | 활성 채널, 섹션 라벨 |
| message-body | 15 / 23 | 400 | 채팅 메시지 본문 |
| body-lg/md/sm | 16/24 · 14/21 · 12/18 | 400 | 컴포저, 보조 설명, 메타 |
| label-lg/md/sm | 14/20 · 12/16 · 11/16 | 500 | 버튼, 칩, 타임스탬프 |
| code | 13 / 20 | 400 | 인라인·블록 코드 |

- 숫자(진행률, 시간)는 `font-variant-numeric: tabular-nums`로 쓴다.

## Layout

### 현재 데모의 골격

```text
[ 기존 작업 환경: 개발 / 디자인 / Slack / 미팅 ][ 프로젝트 맥락 보조 뷰 ]
[ 해당 환경에 함께하는 PM Agent               ][ 결정·출처·결과·다음 행동 ]
```

- 주 영역은 코드·디자인·논의·미팅 결정을 실제 내용으로 보여준다. 모든 환경을 하나의 중앙 채팅 UI로 바꾸지 않는다.
- PM Agent는 해당 작업 아래에서 근거와 다음 행동을 짧게 설명한다.
- 보조 뷰는 목표와 관계를 확인하는 용도이며 숨길 수 있다. 숨겨도 작업 공간의 공유·반영·산출물 열기는 동작한다.
- 원본으로 돌아가는 출처 링크, 내용과 버전을 확인하는 산출물 열기를 제공한다.
- 결정 전달, 산출물 반영, 최종 검토는 라벨과 문구로 구분한다. 색상만으로 상태를 전달하지 않는다.

### 반응형과 접근성

760px 이하에서는 주 영역 다음에 보조 뷰를 배치한다. 480px 이하에서는 코드·디자인 예시와 설명도 한 열로 바꾼다. 좁은 화면에서 본문 가로 스크롤을 만들지 않는다. 터치 동작은 충분한 높이로 제공하고 키보드 포커스, 작업 공간 선택 상태, 다이얼로그 닫기와 포커스 복귀를 유지한다.

### 기존 앱과 토큰

아래 색·타입·컴포넌트 토큰과 기존 앱의 채널 구성 요소는 내부 UI 자산으로 유지한다. 자체 Slack형 앱의 골격을 새 제품의 필수 형태로 해석하지 않는다. 새 데모의 스타일은 .ens-demo 아래에 한정해 기존 앱에 영향을 주지 않는다.

## Elevation & Depth

- **톤이 먼저, 그림자는 나중**이다. 층은 surface tonal 단계(background → surface-container-low → surface → surface-container-high)로 구분한다. 그림자는 떠 있는 요소에만 쓴다.

| 레벨 | 대상 | 그림자 (light) |
|---|---|---|
| 0 | 타임라인, 사이드바 | none |
| 1 | 카드(배정·Handoff), 컴포저 | `0 1px 2px rgba(23,59,48,.08), 0 1px 3px 1px rgba(23,59,48,.05)` |
| 2 | hover 카드, 떠 있는 스레드 패널 | `0 1px 2px rgba(23,59,48,.10), 0 2px 6px 2px rgba(23,59,48,.06)` |
| 3 | 메뉴, 멘션 자동완성, 토스트 | `0 4px 8px 3px rgba(23,59,48,.08), 0 1px 3px rgba(23,59,48,.12)` |
| 4 | 모달, 명령 팔레트 | `0 8px 24px 6px rgba(23,59,48,.12), 0 2px 6px rgba(23,59,48,.10)` |

- 그림자 색은 순수 검정이 아니라 `brand-ink` 기반 rgba로 한다.
- 다크 테마에서는 그림자를 거의 쓰지 않는다. 대신 한 단계 밝은 surface와 1px `dark-outline-variant` 테두리로 층을 구분한다.
- **Glow**: AI 작업 중인 요소만 harmony 색의 12% 불투명 blur 24px glow를 가질 수 있다. 화면에 동시에 하나만 둔다.

## Shapes

- **스케일** (M3 Expressive corner): xs 4 · sm 8 · md 12 · lg 16 · lg-plus 20 · xl 28 · xl-plus 32 · xxl 48 · full.
- **정체성을 드러내는 모양**
  - 사람 아바타는 **원**(`full`), Agent 아바타는 **둥근 사각**(`md` 12, 36px 기준 superellipse 느낌)이다.
  - PM Agent 아바타는 둥근 사각에 **harmony gradient 2px 링**을 두른다. 작업 중이면 링이 회전한다.
  - 빈 상태·온보딩 일러스트에서만 M3 Expressive shape library 도형(쿠키, 클로버, 알약, 아치 등)을 쓴다. UI 컨트롤에는 쓰지 않는다.
- **컴포넌트별**
  - 버튼, 칩, 채널 아이템, 멘션: `full`(알약)
  - Agent 메시지 말풍선: `lg-plus` 20. 발신자 쪽 첫 모서리(좌상단)만 `xs` 4로 줄여 "누가 말했는지" 방향을 준다.
  - PM 메시지, 카드(배정·Handoff), 컴포저, 스레드 패널: `xl` 28
  - 입력 필드(설정 화면): `md` 12
  - 모달: `xl-plus` 32
- **Shape morph**: 누르면 모서리가 작아지고(full → md), 선택되면 커지는(md → full) M3 Expressive 방식을 버튼·토글에 적용한다. 전환은 `spring.fast-spatial`.

## Components

### 1. Sidebar / Channel list
- 섹션 헤더(`label-md`, `on-surface-variant`, 대문자 변환 없음): "프로젝트", "채널", "다이렉트", "Agents".
- 채널 아이템: 높이 36, 알약 모양, 아이콘 `tag`(공개) / `lock`(비공개) 20px, 이름 `label-lg`.
  - hover는 `surface-container-high`, active는 `secondary-container` + `title-sm`.
  - 안 읽음: 이름 굵게(600) + 오른쪽 숫자 배지(`primary` 배경, `on-primary`, 최대 99+).
  - Agent가 이 채널에서 작업 중이면 이름 옆에 해당 voice 색 6px 점이 `pulse` 모션으로 뛴다.
- Agents 섹션: 각 Agent 행에 아바타 24(둥근 사각, voice 색), 이름, 상태 칩 축약형(점과 한 단어: "작업 중", "대기", "쉬는 중")을 둔다.

### 2. Message — Human
- 말풍선 없이 **평평한 행**이다: 원형 아바타 36, 이름 `title-md`, 시간 `label-sm on-surface-variant`, 본문 `message-body`. 사람의 말은 "종이 위의 글씨"처럼 그대로 둔다.
- 내 메시지도 좌측 정렬을 유지한다(팀 채팅 관례). hover 시 행 배경 `surface-container-low`와 액션 바(반응, 스레드, 더보기)가 나온다.

### 3. Message — Agent
- 둥근 사각 아바타 36(voice base 배경에 흰 이니셜 또는 Material Symbol), 이름 `title-md` voice base 색, 이름 옆 `AI` 배지(`label-sm`, tertiary-container, 알약), 역할명(`label-sm on-surface-variant`, 예 "디자인 담당").
- 본문은 **voice container 말풍선**(`rounded.lg-plus`, 좌상단 `xs`)에 `voice-N-on` 텍스트로 담는다. 사람과 Agent가 섞인 타임라인에서 Agent 발화가 색 띠처럼 읽힌다.
- 첨부·산출물은 말풍선 아래 흰 카드(`surface`, `rounded.lg`, 레벨 1)에 파일 아이콘, 이름, "열기" text 버튼으로 둔다.
- 사고 과정과 도구 로그는 채팅에 펼치지 않는다. "과정 보기" text 버튼을 누르면 thread·context panel에서 연다.

### 4. Message — PM Agent (지휘자)
- PM 아바타 40과 harmony 링, 이름 옆 `PM` 배지(primary-container).
- 일반 대화는 Agent 메시지와 같되 `voice-pm-container`를 쓴다.
- **요약·계획 메시지**는 흰 카드(`surface`, `rounded.xl`, 레벨 1, 왼쪽에 3px harmony gradient 세로 바)로 한다.
  - 구조: 제목(`title-md`) → 결론 한 줄 → 목록(누가·무엇·언제) → 필요한 결정(needs-you 칩) → 액션 버튼(tonal "계획 승인", text "수정 요청").

### 5. Agent assignment card
- PM Agent가 일을 배정할 때 타임라인에 삽입한다. `card-assignment`(흰 카드, `rounded.xl`, padding 16).
- 레이아웃: 좌측 PM 아바타 24 → `arrow_forward` → 담당 Agent 아바타 36(voice 색) + 이름/역할.
  - 본문: 작업 제목(`title-md`), 완료 기준 1~3개(체크 아이콘 없는 불릿), 마감(`label-md`, `schedule` 아이콘), 예산·위임 깊이 표시(`label-sm`, 예 "자동 턴 3/8").
  - 하단: 상태 칩 + 버튼(tonal "담당 변경", text "세부").
- 여러 Agent를 경쟁시켜 초안을 받을 때는(compete) 아바타를 겹쳐 쌓아(-8px) 보여주고 "초안 3개 받는 중"이라고 표시한다.
- 등장 모션은 카드가 `spring.default-spatial`로 올라오고, 담당 Agent 아바타가 0.6 → 1 스케일로 `spring.fast-spatial` 오버슈트하며 들어온다.

### 6. Task handoff card (맥락 바통) — Ensemble의 시그니처
- 담당이 A → B로 바뀔 때 삽입한다. `card-handoff`(`secondary-container` 바탕, `rounded.xl`, padding 20).
- 헤더: [A 아바타] ──harmony 선── [B 아바타], "맥락을 넘겼어요 · A → B" (`title-sm`).
- **맥락 5요소**를 고정 순서로 넣는다. 각 줄은 `label-md` 라벨과 `body-md` 값이다.
  1. 목적 2. 배경 3. 결정 이유 4. 진행 상태 5. 결과·산출물
- 결정 이유 항목은 결정 레코드 링크(`gavel` 대신 `fact_check` 아이콘 권장)로 연결한다.
- 하단: "B가 이해한 내용" 한 줄 확인문(B의 voice 색 이탤릭 없이 `body-md`)과 사람용 버튼(text "맥락 보완").
- 요약·방향을 크게 보여줄 때는 `card-direction`(brand-ink 배경, `secondary-container` 텍스트)을 쓴다. concept PDF의 짙은 방향 카드와 같은 계열이다.

### 7. Agent presence & typing indicator
- **presence 점**(아바타 우하단 10px, 2px surface 테두리)
  - 작업 중: voice 색 + `pulse`
  - 대기(부르면 옴): `outline`
  - needs-you: warning 색
  - 오프라인·중지: 빈 원 테두리
- **생각 중(typing)**: 타임라인 하단에 "Iris가 시안을 만드는 중…" 행을 둔다(`body-sm on-surface-variant`).
  - 앞에 voice 색 점 3개가 150ms 간격으로 위아래로 튄다(`spring.fast-spatial` 유사 bounce, 4px).
  - PM Agent가 생각 중이면 점 대신 harmony shimmer 바(폭 48, 높이 4, 알약)를 쓴다.
  - 진행 단계가 있으면 "3/5 단계 · 레이아웃 정리"처럼 단계만 한 줄로 표시하고, 상세는 패널에서 연다.
- 답변이 도착한 뒤 1.5초 안에 늦게 온 typing 신호는 무시한다(깜빡임 방지).

### 8. Composer with @agent mention
- `composer`: 흰 카드, `rounded.xl`, 레벨 1, 최소 높이 56, 최대 40vh. 포커스 시 2px `primary` 링(바깥 2px offset).
- 좌측 `add` (첨부) 버튼. 우측 전송은 `arrow_upward` 원형 filled 버튼 40(`primary`)이며, 비어 있으면 `surface-container-high`로 비활성.
- `@` 입력 시 자동완성 메뉴(레벨 3, `rounded.lg`)가 뜬다. 사람과 Agent를 **섹션으로 분리**해 보여준다. Agent 항목에는 아바타, 이름, 역할, 현재 상태 칩을 붙인다. 맨 위에 "@PM에게 맡기기"를 고정한다.
- 확정된 멘션은 **mention pill**이 된다. Agent는 voice container 배경과 `*-on` 텍스트, 사람은 `surface-container-high`와 `on-surface`다.
- `@A > @B` 순서 표기를 입력하면 pill 사이에 `arrow_forward` 아이콘을 넣어 순차 실행임을 보여준다.
- 컴포저 위 힌트 줄(선택): "PM Agent가 담당자를 추천해요" text 버튼(`auto_awesome` 아이콘).

### 9. Thread / context panel
- 떠 있는 패널(`thread-panel`, `rounded.xl`, 레벨 2, 오른쪽 400).
- 헤더: 탭(스레드 · 작업 · 맥락 · 과정), 닫기 `close`.
- 스레드 탭: 루트 메시지를 상단에 고정하고(`surface-container-low` 바탕), 답글은 메인과 같은 규칙을 따른다.
- 작업 탭: 목표, 완료 기준, 담당 Agent 목록(상태 칩 포함), 타임라인(배정 → Handoff → 결과)을 세로 스테퍼로 보여준다. 스테퍼 선은 2px `outline-variant`이고, 완료 구간은 `primary`다.

### 10. Status chips
- 높이 24, 알약, `label-md`, 좌측 아이콘 16.
  - working: `progress_activity`(회전)
  - needs-you: `front_hand`
  - done: `check_circle`
  - failed: `error`
  - queued: `schedule`
- 색은 Colors의 상태 표를 따르고, 텍스트는 항상 `on-surface`(가독성 우선)다.
- 상태가 바뀔 때 배경은 crossfade(`spring.fast-effects`)하고, 아이콘은 스케일 0.8 → 1 morph로 바꾼다.

### 11. Buttons
- 모두 알약 모양이고 높이 40(compact 모바일 48)이다. 아이콘은 20px, 아이콘과 텍스트 간격 8, 좌우 padding 24(아이콘이 있으면 왼쪽 16).
- 계층: `button-primary`(화면당 1개) > `button-tonal` > `button-outlined` > `button-text`.
- 승인 카드의 "승인"은 primary, "거절"은 outlined로 한다. 외부 영향이 있는 승인 버튼은 라벨에 대상을 명시한다(예 "메일 3통 발송 승인").
- 상태 레이어: hover 8%, focus 10%, pressed 10% `on-*` 색 오버레이. pressed 시 모서리 morph(full → lg).
- FAB는 쓰지 않는다. 채팅 앱에서는 컴포저가 주 행동이다.

### 12. Approval card (사람 승인)
- warning-container 4px 좌측 바가 있는 흰 카드(`rounded.xl`)다.
- 구성: 목적 · 작업 · 필요 사항 3줄, 위험도 high이면 상세를 기본 펼침, 버튼 2개.
- 결정된 뒤에는 카드가 접히며 "승인됨 · 류시헌 · 14:02" 한 줄(done 칩)로 바뀐다.

## Do's and Don'ts

**Do**
- 화면의 90%는 중립 톤으로 두고, 색은 "누가(voice)"와 "상태(status)"를 말할 때만 쓴다.
- harmony gradient는 AI가 개입하는 순간에만, 한 화면에 한두 곳만 쓴다.
- 사람은 원, Agent는 둥근 사각이다. 모양, 라벨, 색 세 겹으로 구분한다.
- Handoff에는 반드시 맥락 5요소(목적·배경·결정 이유·진행 상태·결과)를 채운다.
- 결과는 채널에, 과정은 패널에 둔다. 채널은 화음, 패널은 악보다.
- 외부 영향이 있는 행동은 항상 사람 승인 카드를 거친다.
- 모든 스프링 모션에 `prefers-reduced-motion` 대안을 둔다.
- 한글 폴백 폰트를 지정하고 한글 본문 line-height는 1.5 이상으로 한다.

**Don't**
- 배경 전면 그라디언트, 그라디언트 텍스트, 무지개 버튼을 쓰지 않는다.
- 로봇 얼굴(`smart_toy`), 인간형 AI 얼굴, 회로기판·은하 SF 이미지를 쓰지 않는다.
- 그린 voice를 PM 외 Agent에게 주지 않는다.
- Agent의 사고 과정 전문이나 도구 로그를 채팅에 스트리밍으로 쏟아내지 않는다.
- 모서리 반경을 스케일 밖 값(예 10px, 14px)으로 쓰지 않는다.
- 굵기 700 이상, 전부 대문자 라벨을 쓰지 않는다.
- 한 화면에 primary 버튼을 둘 이상 두지 않는다.
- Google 로고, "G" 그라디언트, Gemini 스파클 형태를 브랜드 요소로 모방하지 않는다.

## Motion

M3 Expressive 방식을 따른다. **공간 변화(위치·크기·모양)는 스프링**, **효과(색·불투명도)는 감쇠 1.0 스프링 또는 easing**으로 처리한다. 기본 스킴은 Expressive, 밀도 높은 목록·설정 화면은 Standard를 쓴다.

### Spring tokens (androidx Material3 소스 값 · damping ratio / stiffness)
| 토큰 | Expressive | Standard | CSS 근사 정착 시간* |
|---|---|---|---|
| fast-spatial | 0.6 / 800 | 0.9 / 1400 | 350ms (오버슈트 약 9%) |
| default-spatial | 0.8 / 380 | 0.9 / 700 | 410ms (오버슈트 약 1.5%) / std 220ms |
| slow-spatial | 0.8 / 200 | 0.9 / 300 | 570ms |
| fast-effects | 1.0 / 3800 | 1.0 / 3800 | 140ms |
| default-effects | 1.0 / 1600 | 1.0 / 1600 | 210ms |
| slow-effects | 1.0 / 800 | 1.0 / 800 | 300ms |

\* mass 1, 잔여 변위 0.2% 기준으로 직접 계산한 근사값이다. 네이티브 스프링 라이브러리(Compose, Framer Motion, Motion One 등)가 있으면 damping과 stiffness를 그대로 쓴다.

### Easing & duration (M3 MotionTokens)
- emphasized `cubic-bezier(0.2, 0, 0, 1)`, emphasized-decelerate `cubic-bezier(0.05, 0.7, 0.1, 1)`, emphasized-accelerate `cubic-bezier(0.3, 0, 0.8, 0.15)`
- standard `cubic-bezier(0.2, 0, 0, 1)`, standard-decelerate `cubic-bezier(0, 0, 0, 1)`, standard-accelerate `cubic-bezier(0.3, 0, 1, 1)`, linear(루프용)
- duration: short 50/100/150/200 · medium 250/300/350/400 · long 450/500/550/600 · extra-long 700/800/900/1000 ms

### Ensemble 모션 순간
| 순간 | 동작 | 토큰 |
|---|---|---|
| 메시지 도착 | opacity 0→1, translateY 8→0px | opacity: default-effects · 이동: default-spatial |
| 내 메시지 전송 | 컴포저에서 타임라인으로 이동, 전송 버튼 scale 0.9→1 | fast-spatial |
| Agent 생각 중 | 점 3개 4px bounce, 150ms stagger, 1200ms 루프 / PM Agent는 harmony shimmer 1600ms linear 루프 | linear 루프 |
| PM 아바타 작업 중 | harmony 링 회전 3000ms linear | linear |
| 배정 | 카드 등장 후 Agent 아바타 scale 0.6→1 오버슈트 | default-spatial → fast-spatial |
| Handoff | A→B 연결선 그리기(stroke-dashoffset) 450ms, 그다음 B 아바타 pop, 카드 본문 순차 fade(50ms stagger) | emphasized-decelerate 450ms, fast-spatial, default-effects |
| 상태 변경 | 칩 배경 crossfade, 아이콘 morph | fast-effects, fast-spatial |
| 스레드 패널 | 오른쪽에서 슬라이드 인 24px + fade / 닫기는 emphasized-accelerate 200ms | slow-spatial(열기) |
| 버튼 press | 모서리 morph full→lg | fast-spatial |
| 승인 완료 | 카드 높이 접힘, done 칩으로 교체 | default-spatial |

### Reduced motion
`prefers-reduced-motion: reduce`에서는 모든 이동·스케일·회전을 없애고 opacity 150ms `standard`만 남긴다. shimmer와 회전 링은 정지된 gradient 링으로 바꾸고, 타이핑 점은 정지 상태에서 "생각 중" 텍스트만 보여준다.

## Iconography

- **Material Symbols Rounded**를 쓴다. 기본 `FILL 0, wght 400, GRAD 0, opsz 24`(사이드바·칩은 opsz 20). 활성·선택 상태는 `FILL 1`로 전환하고 `default-effects`로 채움을 보간한다.
- 크기: 칩 16, 리스트·버튼 20, 헤더·레일 24.
- 색: 기본 `on-surface-variant`, 활성은 `on-secondary-container`, Agent 관련은 voice base.
- 주요 매핑
  - 채널 `tag` / 비공개 `lock` / 스레드 `forum` / 멘션 `alternate_email` / 전송 `arrow_upward` / 첨부 `add`
  - AI 표시 `auto_awesome` / 배정 `assignment_ind` / Handoff `swap_horiz` (`conversion_path`가 있으면 우선, 존재 여부 미확인)
  - 결정 레코드 `fact_check` / 승인 `front_hand` / 완료 `check_circle` / 실패 `error` / 대기 `schedule` / 진행 `progress_activity`
- 금지: `smart_toy`(로봇), 이모지로 상태 표현.

## Agent Prompt Guide

이 문서를 읽고 화면을 만드는 AI(Stitch, Claude Code, Cursor 등)에게 줄 지침이다.

### 공통 지시(프롬프트 앞에 붙이기)
> DESIGN.md의 토큰만 사용해. 색은 `{colors.*}`, 모서리는 `{rounded.*}`, 간격은 `{spacing.*}` 값 외의 임의 값은 쓰지 마. 사람은 원형 아바타와 말풍선 없는 행, Agent는 둥근 사각 아바타와 voice container 말풍선으로 구분해. harmony gradient는 PM 아바타 링, 생각 중 표시, Handoff 선에만 써. 한글 폴백 폰트를 지정하고, 라이트와 다크 둘 다 만들고, prefers-reduced-motion 대안을 넣어.

### 화면별 예시 프롬프트
1. **메인 채널 화면**: "Expanded(1280px) 기준 4열 레이아웃으로 #launch-plan 채널을 만들어. 사람 2명, PM Agent, 디자인 Agent(voice-3), 개발 Agent(voice-2)가 대화 중이다. PM Agent의 계획 요약 카드 1개, 배정 카드 2개, 하단에 '개발 Agent가 API 스펙을 정리하는 중' typing 행을 넣어. 사이드바 Agents 섹션에 상태 점을 표시해."
2. **Handoff 순간**: "디자인 Agent → 개발 Agent Handoff 카드를 만들어. 맥락 5요소를 한국어 예시로 채우고, 연결선 그리기와 아바타 pop 모션을 motion 표 그대로 구현해."
3. **컴포저 멘션**: "컴포저에서 '@' 입력 시 자동완성을 만들어. 사람과 Agent 섹션을 분리하고, 맨 위에 '@PM에게 맡기기'를 고정해. 선택한 멘션은 pill로 표시하고 `@A > @B` 순차 표기를 지원해."
4. **모바일(compact 390px)**: "같은 채널을 단일 열로. sidebar는 drawer, 스레드는 전체 화면 push, 컴포저는 하단 고정 알약 모양으로."
5. **빈 상태·온보딩**: "새 프로젝트 빈 상태 화면. display-md 헤드라인 'ROND 100', harmony 리본 위에 M3 Expressive 도형 연주자 4개 일러스트, primary 버튼 '목표 알려주기' 1개."

### 검수 체크리스트 (생성 결과를 확인할 때)
- [ ] 스케일 밖의 hex, radius, spacing 값이 없다
- [ ] 한 화면에 primary 버튼이 1개 이하다
- [ ] 그라디언트 사용처가 지정된 3곳 이내다
- [ ] Agent 식별이 모양, 라벨, 색 3중이다
- [ ] 상태 칩에 아이콘과 텍스트가 모두 있다
- [ ] 다크 테마와 reduced-motion이 있다
- [ ] 본문 텍스트 대비 4.5:1 이상이다

## CSS Tokens

```css
:root {
  /* Brand */
  --ens-brand-ink: #173B30;
  --ens-primary: #2B6A52; --ens-on-primary: #FFFFFF;
  --ens-primary-container: #D3EBDD; --ens-on-primary-container: #0D3325;
  --ens-secondary: #52635A;
  --ens-secondary-container: #E3EDE7; --ens-on-secondary-container: #101F18;
  --ens-tertiary: #6D4FD8; --ens-tertiary-container: #E9E1FF; --ens-on-tertiary-container: #25105E;

  /* Neutrals */
  --ens-background: #F6F6F3;
  --ens-surface: #FFFFFF;
  --ens-surface-container-low: #F1F2EE;
  --ens-surface-container: #ECEEE9;
  --ens-surface-container-high: #E5E8E3;
  --ens-on-surface: #18201C;
  --ens-on-surface-variant: #4A5650;
  --ens-outline: #7A867F;
  --ens-outline-variant: #C9D1CB;

  /* Status */
  --ens-success: #1E7F4F; --ens-success-container: #D2EFDD;
  --ens-warning: #9A5B00; --ens-warning-container: #FFE7C2;
  --ens-error: #BA1A1A;   --ens-error-container: #FFDAD6;
  --ens-info: #2A64D6;    --ens-info-container: #DCE6FF;

  /* Harmony gradient (AI signal only) */
  --ens-harmony: linear-gradient(120deg, #3DBE8B 0%, #4C8DF6 35%, #9B7BF7 65%, #F08BB4 100%);
  --ens-harmony-conic: conic-gradient(from 0deg, #3DBE8B, #4C8DF6, #9B7BF7, #F08BB4, #3DBE8B);

  /* Agent voices: base / container / on */
  --ens-voice-pm: #2B6A52; --ens-voice-pm-container: #D3EBDD; --ens-voice-pm-on: #0D3325;
  --ens-voice-1: #6D4FD8; --ens-voice-1-container: #E9E1FF; --ens-voice-1-on: #25105E;
  --ens-voice-2: #2A64D6; --ens-voice-2-container: #DCE6FF; --ens-voice-2-on: #0B2A66;
  --ens-voice-3: #B34626; --ens-voice-3-container: #FFE0D6; --ens-voice-3-on: #4A1406;
  --ens-voice-4: #946200; --ens-voice-4-container: #FCEBC8; --ens-voice-4-on: #2E1E00;
  --ens-voice-5: #007873; --ens-voice-5-container: #CCF0EC; --ens-voice-5-on: #00302E;
  --ens-voice-6: #B0337E; --ens-voice-6-container: #FBDCEC; --ens-voice-6-on: #3F0A2A;
  --ens-voice-7: #557A12; --ens-voice-7-container: #E2F0CC; --ens-voice-7-on: #1B2A00;
  --ens-voice-8: #4A56A6; --ens-voice-8-container: #E0E3F8; --ens-voice-8-on: #151C4A;

  /* Typography */
  --ens-font-display: "Google Sans Flex", "Pretendard Variable", "Noto Sans KR", system-ui, sans-serif;
  --ens-font-text: "Google Sans Text", "Google Sans Flex", "Pretendard Variable", "Noto Sans KR", system-ui, sans-serif;
  --ens-font-code: "Google Sans Code", ui-monospace, "D2Coding", monospace;
  --ens-type-message: 400 15px/23px var(--ens-font-text);
  --ens-type-body-md: 400 14px/21px var(--ens-font-text);
  --ens-type-title-md: 600 16px/24px var(--ens-font-display);
  --ens-type-label-lg: 500 14px/20px var(--ens-font-display);
  --ens-type-label-md: 500 12px/16px var(--ens-font-display);

  /* Radius */
  --ens-radius-xs: 4px; --ens-radius-sm: 8px; --ens-radius-md: 12px;
  --ens-radius-lg: 16px; --ens-radius-lg-plus: 20px; --ens-radius-xl: 28px;
  --ens-radius-xl-plus: 32px; --ens-radius-xxl: 48px; --ens-radius-full: 9999px;

  /* Spacing */
  --ens-space-1: 4px; --ens-space-2: 8px; --ens-space-3: 12px; --ens-space-4: 16px;
  --ens-space-5: 20px; --ens-space-6: 24px; --ens-space-8: 32px; --ens-space-10: 40px;
  --ens-space-12: 48px; --ens-space-16: 64px;
  --ens-rail-width: 72px; --ens-sidebar-width: 280px; --ens-thread-width: 400px; --ens-message-max: 760px;

  /* Elevation */
  --ens-elev-1: 0 1px 2px rgba(23,59,48,.08), 0 1px 3px 1px rgba(23,59,48,.05);
  --ens-elev-2: 0 1px 2px rgba(23,59,48,.10), 0 2px 6px 2px rgba(23,59,48,.06);
  --ens-elev-3: 0 4px 8px 3px rgba(23,59,48,.08), 0 1px 3px rgba(23,59,48,.12);
  --ens-elev-4: 0 8px 24px 6px rgba(23,59,48,.12), 0 2px 6px rgba(23,59,48,.10);

  /* Motion: easing (M3) */
  --ens-ease-emphasized: cubic-bezier(0.2, 0, 0, 1);
  --ens-ease-emphasized-decel: cubic-bezier(0.05, 0.7, 0.1, 1);
  --ens-ease-emphasized-accel: cubic-bezier(0.3, 0, 0.8, 0.15);
  --ens-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ens-ease-standard-decel: cubic-bezier(0, 0, 0, 1);
  --ens-ease-standard-accel: cubic-bezier(0.3, 0, 1, 1);

  /* Motion: durations (M3) */
  --ens-dur-short-2: 100ms; --ens-dur-short-3: 150ms; --ens-dur-short-4: 200ms;
  --ens-dur-medium-2: 300ms; --ens-dur-medium-4: 400ms;
  --ens-dur-long-1: 450ms; --ens-dur-long-4: 600ms;

  /* Motion: spring approximations via linear() (computed; mass 1) */
  --ens-spring-fast-spatial: linear(0, 0.071, 0.235, 0.435, 0.631, 0.8, 0.929, 1.017, 1.069, 1.092, 1.094, 1.083, 1.065, 1.046, 1.028, 1.014, 1.003, 0.996, 0.992, 0.991, 0.991, 0.993, 0.995, 0.996, 1);
  --ens-spring-fast-spatial-dur: 350ms;           /* expressive: damping 0.6, stiffness 800 */
  --ens-spring-default-spatial: linear(0, 0.047, 0.155, 0.291, 0.432, 0.563, 0.677, 0.771, 0.846, 0.903, 0.945, 0.974, 0.994, 1.005, 1.012, 1.015, 1.015, 1.014, 1.012, 1.01, 1.008, 1.006, 1.004, 1.003, 1);
  --ens-spring-default-spatial-dur: 410ms;        /* expressive: damping 0.8, stiffness 380 */
  --ens-spring-slow-spatial: var(--ens-spring-default-spatial);
  --ens-spring-slow-spatial-dur: 570ms;           /* expressive: damping 0.8, stiffness 200 (same curve shape, longer) */
  --ens-spring-effects: linear(0, 0.049, 0.157, 0.284, 0.41, 0.525, 0.623, 0.705, 0.771, 0.824, 0.866, 0.898, 0.923, 0.942, 0.957, 0.968, 0.976, 0.982, 0.987, 0.99, 0.993, 0.995, 0.996, 0.997, 1);
  --ens-spring-fast-effects-dur: 140ms;           /* damping 1.0, stiffness 3800 */
  --ens-spring-default-effects-dur: 210ms;        /* damping 1.0, stiffness 1600 */
  --ens-spring-slow-effects-dur: 300ms;           /* damping 1.0, stiffness 800 */

  color-scheme: light;
}

:root[data-theme="dark"] {
  --ens-background: #0E1311;
  --ens-surface: #151B18;
  --ens-surface-container-low: #19201D;
  --ens-surface-container: #1E2622;
  --ens-surface-container-high: #27302C;
  --ens-on-surface: #E3E9E5;
  --ens-on-surface-variant: #A8B4AD;
  --ens-outline: #87938C;
  --ens-outline-variant: #3B4640;
  --ens-primary: #8FD5B3; --ens-on-primary: #00382A;
  --ens-primary-container: #1F513F; --ens-on-primary-container: #C0EBD5;
  --ens-secondary-container: #25332C; --ens-on-secondary-container: #D6E6DC;
  --ens-tertiary: #C8B8FF;
  --ens-error: #FFB4AB;
  --ens-voice-pm: #8FD5B3; --ens-voice-pm-container: #1F513F; --ens-voice-pm-on: #E3E9E5;
  --ens-voice-1: #C8B8FF; --ens-voice-1-container: #33236E; --ens-voice-1-on: #E3E9E5;
  --ens-voice-2: #AFC6FF; --ens-voice-2-container: #173A7A; --ens-voice-2-on: #E3E9E5;
  --ens-voice-3: #FFB59E; --ens-voice-3-container: #6A2410; --ens-voice-3-on: #E3E9E5;
  --ens-voice-4: #F2C35C; --ens-voice-4-container: #4A3300; --ens-voice-4-on: #E3E9E5;
  --ens-voice-5: #6FD8D1; --ens-voice-5-container: #00423F; --ens-voice-5-on: #E3E9E5;
  --ens-voice-6: #F7A8D2; --ens-voice-6-container: #5E1A43; --ens-voice-6-on: #E3E9E5;
  --ens-voice-7: #B5D67A; --ens-voice-7-container: #2C4200; --ens-voice-7-on: #E3E9E5;
  --ens-voice-8: #BCC3FF; --ens-voice-8-container: #2A3372; --ens-voice-8-on: #E3E9E5;
  --ens-elev-1: 0 0 0 1px #3B4640;
  --ens-elev-2: 0 0 0 1px #3B4640, 0 2px 8px rgba(0,0,0,.35);
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* 위 dark 블록과 동일 값을 적용 (빌드 도구로 중복 생성 권장) */ }
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --ens-spring-fast-spatial: linear(0, 1);
    --ens-spring-default-spatial: linear(0, 1);
    --ens-spring-fast-spatial-dur: 0ms;
    --ens-spring-default-spatial-dur: 0ms;
    --ens-spring-slow-spatial-dur: 0ms;
  }
}
```
