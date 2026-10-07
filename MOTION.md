---
version: alpha
name: Ensemble Motion
description: >
  코드로 만드는 모션그래픽(제품 UI 모션, 설명 영상, 프로모 영상)을 위한 디자인 시스템.
  Claude Code(Opus 5.5)가 읽고 그대로 따르도록 작성했다. 기준 캔버스는 1920x1080 @30fps.
colors:
  bg: "#0E1311"          # DESIGN.md dark-background
  surface: "#151B18"     # DESIGN.md dark-surface
  surface-raised: "#27302C" # DESIGN.md dark-surface-container-high
  line: "#3B4640"        # DESIGN.md dark-outline-variant
  text: "#E3E9E5"        # DESIGN.md dark-on-surface
  text-muted: "#A8B4AD"  # DESIGN.md dark-on-surface-variant
  text-dim: "#87938C"    # DESIGN.md dark-outline
  accent: "#8FD5B3"      # DESIGN.md dark-primary
  accent-soft: "#C0EBD5" # DESIGN.md dark-on-primary-container
  signal: "#1E7F4F"      # DESIGN.md success (긍정적 연결 신호)
  agent-pm: "#8FD5B3"    # DESIGN.md voice-pm(dark) = dark-primary
  agent-dev: "#AFC6FF"   # DESIGN.md voice-2(dark)
  agent-research: "#C8B8FF" # DESIGN.md voice-1(dark)
  human: "#A8B4AD"       # DESIGN.md dark-on-surface-variant (사람은 색으로 구분하지 않는 중립 톤)
  success: "#1E7F4F"     # DESIGN.md success
  danger: "#BA1A1A"      # DESIGN.md error
  paper: "#F6F6F3"       # DESIGN.md background (light)
  ink: "#18201C"         # DESIGN.md on-surface (light)
typography:
  display-xl:
    fontFamily: Google Sans Flex
    fontSize: 160px
    fontWeight: 800
    lineHeight: 1.0
    letterSpacing: -0.04em
  display:
    fontFamily: Google Sans Flex
    fontSize: 112px
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: -0.03em
  headline:
    fontFamily: Google Sans Flex
    fontSize: 72px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.02em
  title:
    fontFamily: Google Sans Flex
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: Google Sans Text
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: Google Sans Flex
    fontSize: 44px
    fontWeight: 600
    lineHeight: 1.3
  ui-message:
    fontFamily: Google Sans Text
    fontSize: 30px
    fontWeight: 400
    lineHeight: 1.45
  mono:
    fontFamily: Google Sans Code
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.4
rounded:
  none: 0px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  full: 9999px
spacing:
  unit: 8px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 48px
  xl: 96px
  xxl: 160px
  safe-x: 96px
  safe-y: 64px
components:
  message-bubble:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ui-message}"
    rounded: "{rounded.lg}"
    padding: 24px
  agent-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.full}"
    padding: 12px
  caption-bar:
    backgroundColor: "#0B0D12CC"
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: 20px
  cta-button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    padding: 28px
---

# Ensemble Motion — DESIGN.md

> 시각 토큰(색·서체·모양)의 기준은 ./DESIGN.md다. 이 문서는 모션·영상 제작 규칙을 정의한다.

> 이 문서는 AI 에이전트(Claude Opus 5.5 / Claude Code)가 모션그래픽을 만들 때 **반드시 먼저 읽는** 기준 문서다.
> 형식은 Google Stitch DESIGN.md(alpha) 스펙을 따른다. 표준 8개 섹션 뒤에 모션 전용 확장 섹션(§9~§16)이 이어진다.
> 여기 정의된 토큰에 없는 값을 새로 만들지 않는다. 꼭 필요하면 "토큰 추가 제안"으로 따로 보고한다.

## Overview

**한 줄 원칙: 모션은 장식이 아니라 문장이다.** 모든 움직임은 "무엇이 들어오는가 → 무엇이 중요한가 → 무엇이 다음인가"를 설명해야 한다.

핵심 원칙 7가지:

1. **의도(Purpose)** — 움직이는 모든 요소에는 이유가 있다: 등장, 강조, 연결(인과), 퇴장. 이유가 없으면 가만히 둔다.
2. **위계(Hierarchy)** — 한 순간의 주인공은 하나다. 동시에 크게 움직이는 요소는 최대 1개, 보조 모션은 최대 2개.
3. **리듬(Rhythm)** — 움직임과 정지(hold)가 번갈아 나와야 한다. 계속 움직이는 화면은 읽을 수 없다. 장면마다 hold가 최소 40%는 있어야 한다.
4. **연속성(Continuity)** — 요소는 순간이동하지 않는다. 같은 대상은 같은 위치나 형태에서 이어서 변형한다(morph, shared element).
5. **물리감(Physicality)** — 가속과 감속이 있다. 같은 크기의 움직임은 같은 토큰을 쓴다. linear는 연속 회전, 진행바, 마퀴에만 쓴다.
6. **가독성(Legibility)** — 텍스트는 읽을 시간이 확보된 뒤에 움직인다. 글자 크기는 최소 기준 이상, 대비는 WCAG AA(4.5:1) 이상.
7. **결정성(Determinism)** — 같은 코드는 같은 프레임을 낸다. 모든 애니메이션은 시간(frame)의 순수 함수이고, 난수는 시드로 고정한다.

톤: **정밀하고 따뜻한 협업 도구.** 기본 톤은 오프화이트 종이(`paper` #F6F6F3)와 포레스트 그린 잉크(`ink` #18201C)다(DESIGN.md 브랜드 기준). 다크 캔버스(`bg`/`surface`)는 채팅·UI 데모 장면에서 쓰는 보조 무드다. harmony gradient(DESIGN.md 정의)는 AI가 개입하는 순간에만 아껴서 쓴다. 네온, 글로우, 보라-파랑 그라디언트 같은 "AI 제품 클리셰"는 피한다.

## Colors

색 값은 `./DESIGN.md`가 기준이다. 아래 front matter `colors`는 그 값을 영상 캔버스용 이름으로 다시 부른 별칭이며, 값을 바꿀 때는 먼저 DESIGN.md를 바꾸고 이 별칭을 맞춰 갱신한다. 모션 토큰(§9 이하)은 색과 무관하게 그대로 유지한다.

- **bg / surface / surface-raised / line**: DESIGN.md 다크 테마 `dark-background` / `dark-surface` / `dark-surface-container-high` / `dark-outline-variant`. 깊이는 그림자보다 명도 차이로 표현한다.
- **text / text-muted / text-dim**: DESIGN.md `dark-on-surface` / `dark-on-surface-variant` / `dark-outline`. dim은 장식용(타임스탬프 등)에만 쓰고, 읽혀야 하는 문장에는 쓰지 않는다.
- **accent**: DESIGN.md `dark-primary`(#8FD5B3, 라이트에서는 `primary` #2B6A52). 화면당 **하나의 초점**에만 쓴다(CTA, 핵심 숫자, 현재 발화자). 한 프레임에서 accent가 차지하는 면적은 10% 이하. `accent-soft`(`dark-on-primary-container`)는 hover·보조 강조에만 쓴다.
- **signal**: DESIGN.md `success`. 긍정적 연결(핸드오프 완료)을 나타낸다.
- **agent-pm / agent-dev / agent-research**: DESIGN.md voice 팔레트의 다크 변형(각각 `voice-pm`=`dark-primary`, `voice-2`, `voice-1`). 아바타 링, 칩, 타이핑 인디케이터에만 쓰고 넓은 면에는 칠하지 않는다. 그린 계열(agent-pm)은 PM 전용이다.
- **human**: Ensemble은 사람을 색으로 구분하지 않는다(DESIGN.md 원칙). `dark-on-surface-variant` 중립 톤에 원형 아바타·라벨을 함께 써서 구분한다.
- **paper / ink**: DESIGN.md 라이트 테마 `background`(#F6F6F3) / `on-surface`(#18201C). 라이트 테마나 인쇄물 느낌의 장면에 쓴다. 한 영상에서 다크와 라이트 전환은 최대 1회.
- **harmony gradient**: DESIGN.md가 정의한 harmony gradient(#3DBE8B → #4C8DF6 → #9B7BF7 → #F08BB4)는 AI가 개입하는 순간(PM 아바타 링, 생각 중 표시, Handoff 연결선)에만 쓴다. 그 외 그라디언트는 같은 색상 계열 안에서 명도만 바꾸는 방식(예: bg→surface)만 허용한다. 보색 그라디언트는 금지.

## Typography

- 기본 서체는 DESIGN.md와 동일 패밀리를 쓴다: **Google Sans Flex**(display/headline/title/caption), **Google Sans Text**(body/ui-message), **Google Sans Code**(mono). Google Sans 계열은 한글 글리프가 없으므로 렌더 시 `"Google Sans Flex", "Pretendard Variable", "Noto Sans KR", system-ui, sans-serif` 순서로 폴백한다(본문 계열은 Google Sans Text를 앞에 둔다).
- 한 영상에서 서체는 최대 2종(Flex/Text 조합), 굵기는 최대 3단계.
- 기준 캔버스 1920x1080 기준 **최소 크기**: 본문 36px, 자막 44px, UI 목업 속 텍스트 28px(목업 확대 장면에서만). 1080x1920(세로)은 같은 px값을 그대로 쓴다(가로폭이 좁으니 줄바꿈 기준을 조정).
- 한 줄 최대 글자수: 한글 18자 / 영문 32자(display 이상), 본문 한글 28자 / 영문 48자.
- 숫자 카운터는 `font-variant-numeric: tabular-nums`로 폭이 흔들리지 않게 한다.
- 텍스트 애니메이션 단위: 헤드라인은 **단어 단위**, display-xl 짧은 단어는 **글자 단위**를 허용하고, 본문은 **줄 단위**. 본문을 글자 단위로 쪼개지 않는다.
- **읽기 시간 규칙**: 화면 유지 시간(등장이 끝난 뒤부터 퇴장 시작 전까지) ≥ `max(1.2s, 단어수 / 3 + 0.5s)`. 한국어는 어절을 단어로 센다. 자막은 초당 17자 미만.

## Layout

- 기준 캔버스: **1920x1080 @30fps**(기본), 60fps는 UI 마이크로모션 데모에만 쓴다. 세로형 1080x1920, 정사각 1080x1080, 피드형 1080x1350을 파생 포맷으로 둔다.
- **Safe zone**: 좌우 `safe-x`(96px), 상하 `safe-y`(64px) 안쪽에 모든 텍스트를 둔다. 세로 소셜 포맷은 상단 220px와 하단 380px에 플랫폼 UI가 겹치므로 텍스트를 두지 않는다(플랫폼마다 다르니 납품 전에 확인).
- 그리드: 12컬럼, 거터 24px, 8px 베이스라인. 모든 위치와 크기는 8의 배수.
- 구도: 중앙 정렬만 반복하지 않는다. 장면마다 **좌측 정렬 / 중앙 / 비대칭(2:1)** 중 하나를 의도적으로 고르고, 연속된 3장면이 같은 구도가 되지 않게 한다.
- 여백: 화면의 최소 35%는 비워 둔다. 요소를 더 넣고 싶으면 장면을 나눈다.
- 카메라(가상): 줌은 1.0→1.08 이내, 패닝은 화면폭 15% 이내. 한 장면에 카메라 무브는 하나만.

## Elevation & Depth

- 깊이는 **명도 단계(bg < surface < surface-raised)** 로 먼저 표현하고, 그림자는 보조로만 쓴다.
- 허용 그림자 2종: `0 8px 24px rgba(0,0,0,0.35)`(카드), `0 24px 64px rgba(0,0,0,0.45)`(떠오른 모달, 포커스 카드).
- 떠오르는 요소는 **scale 1.00→1.02 + 그림자 한 단계 증가**로 표현한다. translateZ나 3D 회전은 쓰지 않는다(3D 장면은 예외).
- 블러: 배경 초점 이동(rack focus)용 `blur(0→12px)`만 허용. glassmorphism(반투명 블러 카드)은 기본 금지.
- 필름 그레인과 노이즈를 쓸 경우 opacity 0.04 이하, 시드 고정.

## Shapes

- 모서리 반경: 카드 `lg`(24), 버튼/칩 `full`, 이미지 `md`(16). 한 화면에서 반경은 2종까지만 섞는다.
- 선: 1.5px(UI), 3px(다이어그램 강조). 두꺼운 외곽선은 유치해 보이므로 피한다.
- 아이콘: 한 세트(예: Lucide, stroke 1.75)만 쓴다. **이모지를 아이콘 대신 쓰지 않는다.**
- 도형 모핑(SVG path morph)을 쓰려면 두 path의 점 개수와 순서가 호환되게 만든다(flubber 등 보간 라이브러리를 쓰거나 path를 미리 정규화).

## Components

- **message-bubble**: 채팅 메시지. 아바타 48px + 이름(title 크기의 70%) + 본문(ui-message). 진입 모션은 §9 `enter-rise`.
- **agent-chip**: 에이전트 이름이나 상태 배지. 역할 색 점(10px) + mono 텍스트.
- **caption-bar**: 번역, 내레이션 자막. 하단 safe-y 위에 배치하고 한 번에 최대 2줄.
- **cta-button**: 엔딩 CTA. 등장은 `pop` spring, 등장 후 1회 가벼운 강조(scale 1→1.04→1, 400ms)만 허용.
- **counter**: 숫자 카운트업. `ease-out-expo`로 800–1200ms, tabular-nums. 최종값에서 최소 1.5초 유지.
- **cursor / pointer**: 제품 데모용 가상 커서. 이동은 `ease-in-out` 곡선 경로(직선 금지), 클릭은 scale 1→0.9→1(160ms)과 ripple.

## Do's and Don'ts

**Do**
- 스토리보드(프레임 번호 포함)를 먼저 확정하고 나서 코드를 쓴다.
- 핵심 프레임마다 스틸을 렌더해 직접 보고(이미지 Read) 판단한다.
- 같은 종류의 움직임에는 같은 토큰을 쓴다. 차이는 의도적으로만 둔다.
- 진입은 감속(decelerate), 퇴장은 가속(accelerate)으로 한다. 퇴장은 진입보다 짧게(약 70%).
- 요소는 **순서대로** 들어오게 한다(stagger). 전체 stagger 합은 600ms 이하.
- 실제 자료(제공된 로고, 스크린샷, 수치)만 쓴다. 없으면 플레이스홀더임을 표시하고 보고한다.
- 사운드가 있으면 시각 이벤트를 비트에 0–2프레임 **이르게** 맞춘다. 늦게 맞추지 않는다.

**Don't (안티패턴 / "AI 룩" 신호)**
- 보라-파랑 네온 그라디언트, 떠다니는 파티클, 렌즈플레어, 과한 글로우.
- 모든 요소가 같은 fade-up(같은 거리, 같은 easing, 같은 duration)으로 등장.
- 모든 요소가 동시에 등장하거나, 전부 균일한 stagger로 기계적으로 나열됨.
- 끝없이 둥둥 뜨는(bobbing) 아이들 애니메이션, 이유 없는 카메라 흔들림.
- 모든 곳에 overshoot/bounce. bounce는 장면당 1회까지(주인공 요소).
- linear easing으로 이동하는 UI 요소.
- 읽기 시간보다 짧게 스쳐 지나가는 텍스트, 최소 크기보다 작은 글자.
- 장면마다 다른 종류의 전환(wipe→flip→zoom→spin…). 전환 종류는 영상 전체에서 2종까지.
- lorem ipsum, 지어낸 통계, 가짜 고객 로고, 이모지 아이콘.
- 텍스트가 오브젝트나 다른 텍스트와 겹침, safe zone 밖 텍스트.
- 효과로 효과를 덮기(문제가 되는 모션을 블러나 글로우로 가리기).

---

## 9. Motion Tokens (확장 섹션)

> Stitch 스펙에는 모션 키가 없어 본문에 정의한다. 코드에서는 `src/tokens/motion.ts`로 **그대로 옮겨 쓴다**.

### 9.1 Duration (30fps 기준 프레임 병기)

| 토큰 | ms | @30fps | @60fps | 용도 |
|---|---|---|---|---|
| `instant` | 100 | 3f | 6f | hover, 클릭 피드백, 색 전환 |
| `xs` | 160 | 5f | 10f | 아이콘, 체크마크, 작은 칩 |
| `sm` | 240 | 7f | 14f | 메시지 버블 진입, 토스트 |
| `md` | 360 | 11f | 22f | 카드, 패널 진입, 레이아웃 이동 |
| `lg` | 560 | 17f | 34f | 헤드라인 진입, 장면 내 큰 이동 |
| `xl` | 800 | 24f | 48f | 장면 전환, 카메라 무브, 카운터 |
| `xxl` | 1200 | 36f | 72f | 오프닝 타이틀, 로고 리빌 |

- 제품 UI 모션은 `instant`~`md`, 영상 연출은 `sm`~`xxl`을 쓴다.
- 이동 거리가 클수록 긴 토큰을 쓴다: 이동량 < 40px는 `sm`, < 200px는 `md`, 그보다 크면 `lg` 이상.
- 퇴장 duration은 진입 토큰의 한 단계 아래.

### 9.2 Easing (cubic-bezier)

| 토큰 | cubic-bezier | 용도 |
|---|---|---|
| `standard` | `(0.2, 0, 0, 1)` | 화면 안에서 이동, 크기 변화(기본값) |
| `enter` (decelerate) | `(0.05, 0.7, 0.1, 1)` | 화면 밖에서 들어옴, 나타남 |
| `exit` (accelerate) | `(0.3, 0, 0.8, 0.15)` | 화면 밖으로 나감, 사라짐 |
| `expressive` (out-expo) | `(0.16, 1, 0.3, 1)` | 헤드라인, 로고, 카운터: 빠르게 도착하고 길게 안착 |
| `inout` (in-out-quint) | `(0.83, 0, 0.17, 1)` | 장면 전환, 카메라 무브, 모핑 |
| `overshoot` (out-back) | `(0.34, 1.56, 0.64, 1)` | 장면당 1회 주인공 강조(spring 대체가 필요할 때) |
| `linear` | `(0, 0, 1, 1)` | 연속 회전, 진행바, 마퀴, 타이핑 캐럿 이동**만** |

- 반복 루프(타이핑 점, 펄스)는 사인파 `0.5 - 0.5*cos(2πt)`를 쓴다(끊김 없는 루프).

### 9.3 Spring (Remotion `spring()` config, Motion/framer-motion 동등값)

| 토큰 | mass | damping | stiffness | 느낌 / 용도 | 대략 안착 시간 |
|---|---|---|---|---|---|
| `spring-smooth` | 1 | 200 | 100 | 오버슈트 없음, 부드러운 안착(기본) | ~0.6s |
| `spring-snappy` | 1 | 26 | 260 | 빠르고 단단함: 버블, 칩, 토스트 | ~0.4s |
| `spring-pop` | 1 | 14 | 200 | 살짝 튕김: CTA, 알림 배지(장면당 1회) | ~0.7s |
| `spring-heavy` | 1.6 | 30 | 140 | 무게감: 큰 카드, 패널, 로고 | ~0.9s |

- Remotion에서는 `spring({frame, fps, config: {mass, damping, stiffness}})`를 쓰고, 필요하면 `durationInFrames`로 길이를 고정한다.
- 안착 시간은 추정치다. 실제 값은 스틸과 그래프로 확인하고 조정한다.

### 9.4 Stagger & Choreography

| 토큰 | 값 | 용도 |
|---|---|---|
| `stagger-char` | 25ms (≈1f @30) | display-xl 짧은 단어의 글자 |
| `stagger-word` | 60ms (≈2f) | 헤드라인 단어 |
| `stagger-item` | 80ms (≈2–3f) | 리스트, 카드, 메시지 |
| `stagger-group` | 160ms (≈5f) | 그룹 간(제목 → 본문 → CTA) |
| `stagger-cap` | 600ms | 한 그룹의 stagger 총합 상한(초과 시 그룹을 나눔) |

- 순서: **주인공 → 맥락 → 보조 → CTA.** 읽는 방향(좌→우, 위→아래)을 따른다.
- 겹침(overlap): 앞 요소가 60% 진행됐을 때 다음 요소를 시작한다(완전 순차는 느리고, 완전 동시는 산만하다).
- 균일한 stagger가 기계적으로 보이면 뒤로 갈수록 간격을 줄인다(예: 80→70→60ms).

### 9.5 Distance & Transform

- 진입 이동량: 작은 요소 16px, 카드 32px, 헤드라인 48px(8의 배수). 화면 밖에서 날아오는 연출은 장면 전환에만 쓴다.
- scale 진입: 0.96→1(카드), 0.8→1(아이콘, 배지). 0→1은 로고와 점 요소에만 쓴다.
- 회전: ±6° 이내(장난스러운 강조), 3D flip은 카드 뒤집기 전용.
- 불투명도: 진입 0→1은 이동의 앞 60% 구간에 끝낸다(`opacity`가 이동보다 먼저 완료).
- 모든 이동은 `transform`/`opacity`로만 처리한다(레이아웃 속성 애니메이션 금지 — jank 원인).

## 10. Scene & Storyboard Structure (확장 섹션)

### 10.1 영상 구조 템플릿

| 구간 | 길이(30초 기준) | 목적 |
|---|---|---|
| Hook | 0–1.5s | 첫 프레임부터 무언가 움직이고 있어야 한다. 로고로 시작하지 않는다. |
| Problem / Context | 1.5–6s | 최고의 장면(또는 그 예고)이 5초 안에 나와야 한다. |
| Demonstration | 6–22s | 3~4개 비트. 비트당 하나의 메시지. |
| Payoff | 22–27s | 결과나 핵심 숫자 하나. |
| CTA / Logo | 27–30s | 로고와 한 줄 문구, 최소 2초 hold. |

- 비트 길이: 2–5초. 음악 BPM이 있으면 비트 경계를 마디에 맞춘다(120BPM → 1마디 = 2s = 60f).
- 장면 전환: 기본은 **컷 또는 cross-fade 8f**. 강조 전환(wipe/shared-element morph)은 영상 전체에서 2종까지.

### 10.2 storyboard.md 형식 (구현 전에 반드시 작성)

```markdown
# Storyboard — <제목> (1920x1080 @30fps, 900f = 30s)

| ID | 시작f | 길이f | 화면 텍스트(원문 그대로) | 주요 모션(토큰) | 전환 out | 오디오 큐 | 상태 |
|----|------|------|------------------------|----------------|---------|----------|------|
| S01 | 0 | 45 | "팀의 대화가 흩어질 때" | 단어 stagger-word, enter, lg | cut | kick @0 | draft |
| S02 | 45 | 120 | ... | ... | xfade 8f | ... | draft |
```

- 모든 상태(state)에 이름을 붙인다(예: `bubble:hidden → bubble:rising → bubble:settled → bubble:dimmed`).
- 각 장면에 **대표 프레임(key frame) 번호**를 1~3개 지정한다. 스틸 리뷰 대상이다.

## 11. Toolchain (확장 섹션)

### 11.1 주 도구: **Remotion** (React + TypeScript)

선택 이유: 프레임 기반 결정적 렌더링, 공식 Agent Skills(`npx skills add remotion-dev/skills`), `Sequence`/`Series`/`TransitionSeries`, `spring`/`interpolate`, `npx remotion still`로 특정 프레임 스틸 렌더, 타입 안정성.

> **라이선스 확인 필수**: Remotion은 일정 규모 이상의 회사에서 쓰려면 유료 Company License가 필요하다. 도입 전에 https://www.remotion.dev/license 를 확인한다. 라이선스를 쓸 수 없으면 11.2의 HyperFrames를 쓴다. 이 문서의 토큰과 워크플로는 그대로 적용된다.

Remotion 필수 규칙:
- 모든 애니메이션은 `useCurrentFrame()` 기반의 `interpolate`/`spring`으로 계산한다. **CSS transition, CSS @keyframes, setTimeout, requestAnimationFrame, Framer Motion 자체 타이머는 쓰지 않는다**(렌더에서 프레임이 맞지 않는다).
- `interpolate(..., {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})`를 기본으로 쓴다.
- easing은 `Easing.bezier(x1, y1, x2, y2)`에 §9.2 값을 넣는다.
- 난수는 `random('seed-string')`만 쓴다(`Math.random` 금지).
- 에셋은 `public/`에 두고 `staticFile()`로 참조한다. 원격 URL은 쓰지 않는다.
- 폰트는 로컬 파일 + `@remotion/fonts` `loadFont()`(또는 `@remotion/google-fonts`)로 로드하고, 0프레임부터 폰트가 적용됐는지 스틸로 확인한다.

### 11.2 대안 / 보조 도구

| 도구 | 언제 | 비고 |
|---|---|---|
| **HyperFrames** (HTML+GSAP, Apache-2.0) | Remotion 라이선스를 쓸 수 없을 때, 순수 HTML 산출이 필요할 때 | `hyperframes lint / snapshot / render`. 애니메이션은 seekable(GSAP 타임라인 paused + seek)로 작성 |
| 단일 HTML + SVG (+GSAP) | 8초 루프, 짧은 UI 모션 샘플, GIF | 가장 빠른 탐색용. Chrome에서 프레임 단위 검토 |
| Canvas `draw(ctx, t)` | 생성형 그래픽, 수천 개 입자, 손그림 스타일 | 순수 함수로 작성하고 시드 난수를 쓴다 |
| three.js | 3D 오브젝트, 카메라 연출 | Remotion에서는 `@remotion/three` |
| Lottie | 앱 안에 들어갈 UI 모션 에셋 | 영상이 아닌 제품 탑재용 |
| Motion (framer-motion) | 실제 제품 UI 구현 | 영상 렌더에는 쓰지 않는다. 토큰 값은 공유한다 |
| Manim | 수학, 알고리즘 설명 | 별도 스타일 매핑이 필요 |
| Blender Python | 사실적 3D 렌더 | 헤드리스 EEVEE. 비용이 크다 |
| FFmpeg | contact sheet, 포맷 변환, 오디오 정규화 | 아래 명령 참조 |

### 11.3 프로젝트 구조 (Remotion)

```
motion/
├─ DESIGN.md                # 이 문서 (항상 먼저 읽는다)
├─ brief.md                 # 목적, 대상, 길이, 포맷, 원문 카피, 제공 에셋, 금지 사항
├─ storyboard.md            # §10.2 형식
├─ review/
│  ├─ stills/               # S01_f030.png ...
│  ├─ contact/              # contact sheet
│  └─ log.md                # 라운드별 결함 → 수정 기록
├─ public/
│  ├─ fonts/ audio/ img/
├─ src/
│  ├─ Root.tsx              # <Composition> 등록 (id, width, height, fps, durationInFrames)
│  ├─ tokens/
│  │  ├─ colors.ts  type.ts  motion.ts
│  ├─ primitives/           # 토큰만 쓰는 재사용 모션 컴포넌트
│  │  ├─ Enter.tsx  Stagger.tsx  WordReveal.tsx  Counter.tsx  Cursor.tsx
│  ├─ scenes/               # 장면 1개 = 파일 1개, 로컬 frame 0부터 시작
│  │  ├─ S01Hook.tsx  S02Problem.tsx ...
│  └─ compositions/
│     └─ Promo30s.tsx       # Series/TransitionSeries로 장면 조립
└─ out/
```

`src/tokens/motion.ts` 기준 구현:

```ts
import {Easing} from 'remotion';

export const FPS = 30;
export const ms = (v: number, fps = FPS) => Math.round((v / 1000) * fps);

export const duration = {instant: 100, xs: 160, sm: 240, md: 360, lg: 560, xl: 800, xxl: 1200} as const;

export const ease = {
  standard: Easing.bezier(0.2, 0, 0, 1),
  enter: Easing.bezier(0.05, 0.7, 0.1, 1),
  exit: Easing.bezier(0.3, 0, 0.8, 0.15),
  expressive: Easing.bezier(0.16, 1, 0.3, 1),
  inout: Easing.bezier(0.83, 0, 0.17, 1),
  overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
  linear: Easing.linear,
} as const;

export const springs = {
  smooth: {mass: 1, damping: 200, stiffness: 100},
  snappy: {mass: 1, damping: 26, stiffness: 260},
  pop: {mass: 1, damping: 14, stiffness: 200},
  heavy: {mass: 1.6, damping: 30, stiffness: 140},
} as const;

export const stagger = {char: 25, word: 60, item: 80, group: 160, cap: 600} as const;
```

자주 쓰는 명령:

```bash
npx remotion studio                                   # 프리뷰 (작업 내내 켜 둔다)
npx remotion still Promo30s review/stills/S01_f030.png --frame=30
npx remotion render Promo30s out/promo30s.mp4 --codec=h264 --crf=18
ffmpeg -i out/promo30s.mp4 -vf "fps=2,scale=480:-1,tile=6x5" -frames:v 1 review/contact/sheet.png
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration out/promo30s.mp4
```

## 12. Opus 5.5 Prompting Workflow (확장 섹션)

에이전트(Claude Code, Opus 5.5)는 아래 단계를 **순서대로** 수행하고, 각 게이트를 통과한 뒤에만 다음 단계로 간다.

**Phase 0 — Brief 확정** (`brief.md`)
- 필수 항목: 목적과 시청자, 길이, 해상도, fps, 납품 포맷, **화면 문구 원문**, 제공 에셋 경로, 레퍼런스(URL, 이미지), 금지 사항("로고를 지어내지 말 것", "외부 다운로드 금지").
- 빠진 항목은 가정을 명시해 채우고, 가정 목록을 사용자에게 보고한다.

**Phase 1 — 디자인 기준 로드**
- 이 DESIGN.md를 읽는다. brief에 브랜드 토큰이 있으면 `colors`/`typography`만 덮어쓴다.

**Phase 2 — Storyboard** (`storyboard.md`)
- §10 형식으로 모든 장면의 프레임 범위, 원문 텍스트, 모션 토큰, 상태 이름, 대표 프레임을 적는다.
- 읽기 시간 규칙(Typography)과 5초 훅 규칙을 스스로 계산해 표에 반영한다.
- **게이트**: 사용자(또는 PM Agent)가 storyboard를 승인해야 한다.

**Phase 3 — Style frames**
- 애니메이션 없이 장면별 대표 프레임 1장씩을 정적으로 구현하고 `npx remotion still`로 렌더한다.
- 렌더한 PNG를 **직접 열어 보고**(이미지 Read) 구도, 대비, 크기, 여백을 판단한다.
- **게이트**: 스타일 프레임 승인(룩을 먼저 고정해야 모션 수정 라운드가 줄어든다).

**Phase 4 — 구현**
- 장면 하나가 파일 하나다. primitives와 tokens만 써서 구현한다. 하드코딩한 ms, bezier, 색값은 금지한다.
- 한 번에 한 장면씩 구현하고, 장면마다 Phase 5를 돌린다.

**Phase 5 — Render & Frame Review 루프**
1. 장면마다 **진입 시작, 진입 중간, 안착, 퇴장 직전** 4개 프레임의 스틸을 렌더한다.
2. 전체를 렌더한 뒤 contact sheet(2fps)를 만든다.
3. 이미지를 보고 §13 체크리스트로 결함을 찾아 `review/log.md`에 적는다(프레임 번호, 결함, 원인, 수정).
4. **한 라운드에는 한 종류의 결함만** 고친다(예: "이번 라운드는 텍스트 겹침만"). 고친 뒤 같은 프레임을 다시 렌더해 비교한다.
5. 최대 5라운드. 5라운드 뒤에도 결함이 남으면 남은 목록과 선택지를 보고한다.
- 여유가 되면 **비평 역할을 분리**한다. 구현과 독립된 서브에이전트가 contact sheet만 보고 "AI 룩" 신호와 가독성을 블라인드로 평가한다.

**Phase 6 — 최종 렌더와 검증**
- `ffprobe`로 해상도, fps, 길이, 코덱을 확인한다. 오디오가 있으면 -14 LUFS로 정규화한다.
- 텍스트, 숫자, 이름, 로고를 brief 원문과 한 글자씩 대조한다.

### 12.1 프롬프트 템플릿

**초기 지시 (사용자 → 에이전트)**
```
DESIGN.md를 읽고 그 토큰만 사용해라.
목표: <목적>. 포맷: 1920x1080 @30fps, 20초.
화면 문구(원문 그대로): 1) "..." 2) "..." 3) "..."
에셋: public/img/logo.svg, public/img/screen-01.png (그 외 이미지를 만들거나 받지 말 것)
레퍼런스: <URL/이미지> — 참고할 점: <리듬/타이포/전환>. 따라 하지 말 점: <...>
먼저 storyboard.md만 작성하고 멈춰라. 코드는 승인 후에.
```

**단일 모션 샘플 (Charlie Hills식 3단계)**
```
모션 하나만 만든다: "막대차트가 선그래프로 변형되는 8초 루프".
상태: A(막대 5개 정지) → B(막대 상단이 점으로 수축) → C(점이 선으로 연결) → D(선 정지 hold) → A로 복귀.
각 상태 전환에 사용할 duration/easing 토큰을 먼저 제시하고, 단일 HTML+SVG로 구현해라.
```

**리뷰 라운드 지시**
```
review/stills의 S03 프레임 4장을 열어 봐라. 이번 라운드는 '텍스트 가독성'만 본다:
최소 크기, 대비 4.5:1, 읽기 시간, safe zone. 결함을 프레임 번호와 함께 log.md에 쓰고 수정 후 같은 프레임을 다시 렌더해 비교해라.
```

## 13. Quality Checklist (확장 섹션)

**구조**
- [ ] 첫 프레임(0f)부터 화면이 비어 있지 않고 움직임이 있다. 핵심 장면이 5초 안에 나온다.
- [ ] 모든 장면이 storyboard 프레임 범위와 일치한다(±2f).
- [ ] 로고와 CTA가 최소 2초 유지된다.

**타이포와 가독성**
- [ ] 모든 텍스트가 최소 크기 이상이고 safe zone 안에 있다.
- [ ] 텍스트 대비 ≥ 4.5:1(display ≥ 3:1).
- [ ] 텍스트 유지 시간 ≥ 읽기 시간 공식. 자막 < 17 cps.
- [ ] 텍스트 겹침과 잘림이 없다(모든 대표 프레임에서 확인).
- [ ] 폰트가 0프레임부터 적용된다(FOUT나 대체 폰트 없음).

**모션**
- [ ] 하드코딩한 duration, easing이 없다(토큰만 씀).
- [ ] 진입은 enter/expressive, 퇴장은 exit이고 퇴장이 진입보다 짧다.
- [ ] 한 순간에 크게 움직이는 주인공은 1개다.
- [ ] 장면마다 hold 구간이 있다(장면 길이의 40% 이상).
- [ ] bounce와 overshoot는 장면당 1회 이하, 전환 종류는 영상 전체 2종 이하.
- [ ] 떨림, 깜빡임이 없다(시드 난수, 정수 px 스냅, 텍스트에 fractional scale 금지).
- [ ] 루프 영상은 마지막 프레임과 첫 프레임이 이어진다.

**콘텐츠와 납품**
- [ ] 문구, 숫자, 이름이 brief 원문과 일치한다. 지어낸 데이터나 로고가 없다.
- [ ] 해상도, fps, 길이, 코덱이 요구사항과 일치한다(ffprobe).
- [ ] 오디오는 -14 LUFS이고, 싱크는 시각 이벤트가 0–2f 이르게 맞는다.

## 14. Failure Modes & Fixes (확장 섹션)

| 증상 | 흔한 원인 | 해결 |
|---|---|---|
| "제네릭 AI 룩" | 브랜드와 레퍼런스가 막연함, 기본값 그라디언트와 글로우 | 토큰과 레퍼런스를 명시하고, 장식 대신 타이포와 여백으로 위계를 만든다 |
| 둥둥 뜨고 느림 | 모든 곳에 ease-in-out과 긴 duration | enter/exit를 분리하고, 이동량에 맞는 duration 토큰을 쓴다 |
| 산만함 | 동시 등장, 과한 보조 모션 | 주인공 1개 규칙, stagger-group, hold 확보 |
| 기계적인 나열 | 균일한 stagger | 점점 짧아지는 간격, 60% overlap |
| 텍스트 겹침과 잘림 | 절대좌표를 추정해서 배치, 긴 번역 문구 | 플렉스 레이아웃 + 최대 글자수 규칙, 대표 프레임 스틸로 확인 |
| 렌더 결과가 프리뷰와 다름 | CSS 애니메이션이나 타이머 사용, 원격 폰트나 에셋 | frame 기반 계산으로 교체, `staticFile` + 로컬 폰트 |
| 깜빡임, 떨림 | `Math.random`, 서브픽셀 이동, 레이아웃 속성 애니메이션 | 시드 난수, `Math.round` 스냅, transform/opacity만 사용 |
| 모핑이 뒤틀림 | path 점 개수와 순서 불일치 | path 정규화 또는 보간 라이브러리 사용 |
| 정적인 구간이 김 | storyboard에 hold만 있음 | 느린 카메라 드리프트(1.0→1.03) 또는 보조 요소 1개 추가 |
| 수정할수록 다른 곳이 망가짐 | 한 라운드에 여러 결함을 수정, 범위 밖 파일 편집 | 라운드당 한 종류만 수정, diff 확인, 장면 파일 격리 |
| 사실 오류 | 모델이 숫자, 이름을 채워 넣음 | brief 원문만 사용하고 최종 대조 단계를 둔다 |

## 15. Ensemble 적용 기준

제품 방향은 [intent.md](intent.md), 화면 역할은 [DESIGN.md](DESIGN.md)를 따른다. PM Agent는 다양한 협업의 맥락과 다음 행동을 조율한다. 특정 개발 업무나 중앙 메신저를 제품의 전체로 표현하지 않는다.

### 대시보드에서 전달할 의미

이번 데모는 작업 공간 재현이나 작업 간 이동 연출 없이 대시보드만 보여준다. 담당·결정·출처·산출물·다음 행동의 관계를 읽을 수 있게 한다. 전달·반영·검토 완료를 구분하며 입력·결정 승인·근거 펼치기·산출물 링크는 키보드로 조작할 수 있어야 한다. 장면 재생이나 타이머는 사용하지 않는다.

과거 영상의 대본·스타일 프레임·렌더는 [Remotion 안내](motion-remotion/README.md)의 역사 자료다. 해당 파일이 새 메시지로 재제작되었다고 표시하지 않는다.

## 16. Appendix — References

**Opus 5.5 모션그래픽 사례와 워크플로 (2026-09)**
- Charlie Hills, 16개 모션그래픽 3단계 방법: https://x.com/charliejhills/status/2103893708550914076 , https://charliehills.substack.com/p/opus-55-motion-graphics
- OfficeChai, Opus 5.5 모션그래픽 사례 10선: https://officechai.com/ai/claude-opus-5-5-motion-graphic-videos/
- Vedmeena21/Opus-5.5-Motion-Graphics (단일 HTML+SVG, 프레임 검토 워크플로): https://github.com/Vedmeena21/Opus-5.5-Motion-Graphics
- agentic-motion-graphics (HyperFrames+GSAP+TTS+Whisper 파이프라인): https://github.com/siyuanfeng636-cpu/agentic-motion-graphics
- jaiskills motion-design skill (크루 모델, 프레임 단위 규칙, AI-slop tell): https://github.com/JairoTorregrosa/jaiskills/pull/1
- iArt.ai, 캔버스 `draw(ctx, t)` 프레임 렌더링: https://www.iart.ai/blog/ai-javascript-animation

**도구**
- Remotion Agent Skills: https://www.remotion.dev/docs/ai/skills
- Tella, Remotion + Claude Code 사용법: https://www.tella.com/blog/how-to-use-remotion-agent-skills-with-claude-code
- HyperFrames: https://github.com/heygen-com/hyperframes

**DESIGN.md 형식**
- 스펙: https://github.com/google-labs-code/design.md , https://stitch.withgoogle.com/docs/design-md/format/
- 예시 모음: https://github.com/VoltAgent/awesome-design-md

**이전 모델 시기 참고** (Opus 5.5 이전, 기법 참고용)
- Codrops, Claude 마스코트 애니메이션을 SVG+GSAP로 역공학 (2026-05): https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/

> 수치 출처: easing 값은 Material 3 easing 등 업계 표준 곡선에서, spring 값은 Remotion `spring()` 기본값에서 조정한 이 문서의 설계값이다. 훅 1.5초와 5초 규칙, 싱크 0–2프레임, 자막 17cps, -14 LUFS는 위 motion-design skill과 agentic-motion-graphics에서 가져왔다. 프로젝트에 맞게 조정할 때는 이 문서를 수정하고 변경 이유를 커밋 메시지에 남긴다.
