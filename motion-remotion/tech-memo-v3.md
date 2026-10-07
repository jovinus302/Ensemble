# tech-memo-v3.md

> **과거 영상 자료 · 2026-10-07 정리:** 이 문서는 이전 영상의 제작·검토 기록이다. 현재 제품은 여러 사람과 Agent의 맥락을 목표 아래 연결하고 다음 행동을 조율하는 PM Agent이며 [제품 의도](../intent.md)가 기준이다. 아래 대본·표현·화면은 새 메시지로 재제작된 결과가 아니다.


출처: review/spec-v3-architect.md §6 (architect 원문 그대로, verbatim).

## 6. 기술 메모

**결정: Remotion DOM + CSS 3D. @remotion/three는 쓰지 않는다.**
- three를 쓰면 UI를 텍스처로 만들어야 한다. 그러면 (a) 줌 2배에서 텍스트가 선명하려면 4K 이상의 텍스처가 필요하다. (b) 메시지 도착·칩 morph 같은 UI 상태가 바뀔 때마다 텍스처를 다시 만들어야 한다. (c) drei `<Html>`은 WebGL 안이 아니라 DOM 오버레이라 3D 이점이 없다. (d) `--gl=angle`이 필요하고 `<Sequence layout="none">` 같은 제약이 붙는다. (e) 기존 헤드라인·스프링 코드를 다시 쓰지 못한다.
- 얻을 수 있었던 것(실제 조명·DOF)은 §3의 가짜 조명·베일로 대체한다.

**3840 월드**: 쓰지 않는다. 이유는 v3의 좌표계가 "보드 논리 1440x900 + 스크린 1920x1080" 두 개뿐이라서다. `World.tsx`·`camera.ts`는 v2 컴포지션용으로 그대로 두고 v3에서는 마운트하지 않는다. 카메라 패턴(`getCamera(frame)` → 상태, 스프링 진행률 보간, 매치무브 선행)만 새 상태 `{tx,ty,s,rx,ry,rz,ax,ay,dz}`로 옮긴다.

**텍스트 선명도**
- 보드 DOM을 K=2로 만든다. Rig 스케일 S=s/2 ≤ 1.05가 되도록 s ≤ 2.1로 제한한다. 이렇게 하면 늘 축소 방향으로 래스터해서 흐림을 피한다.
- `will-change` 금지. 초기 스케일로 래스터가 고정될 위험이 있다(**미검증**).
- MOTION.md의 "텍스트 fractional scale 금지"는 v3 카메라에서는 지킬 수 없다. 대신 2x DOM으로 완화하고, 리뷰 때 hold 구간의 반짝임(shimmer)을 확인한다.
- 폰트 추가(OFL 1.1): `public/fonts/Pretendard-ExtraBold.woff2`(800), `PretendardVariable.woff2`(wght 모핑용)를 Pretendard GitHub 릴리스에서 받는다.
- 아이콘은 Material Symbols Rounded SVG path(Apache 2.0)를 `icons.tsx`에 인라인으로 넣는다. 필요한 것: tag, lock, add, arrow_upward, auto_awesome, schedule, check_circle, front_hand, fact_check, progress_activity, search, bolt, forum, info, description.

**preserve-3d 평탄화 함정**
- 다음 속성이 preserve-3d 요소에 있으면 그 요소의 자식이 평면으로 눌린다: `overflow≠visible`, `opacity<1`, `filter`, `clip-path`, `mask`, `mix-blend-mode`, `isolation`, `contain: paint`, `backdrop-filter`.
- 대책 1: 타임라인·패널에 **overflow:hidden을 쓰지 않는다**. 스크롤 영역은 (a) 헤더 불투명 띠(Z +4)와 컴포저 띠가 가리게 하고, (b) boardY<80 구간에 들어가는 메시지는 투명도를 낮추고, (c) boardY 범위 밖이면 렌더하지 않는다.
- 대책 2: 부상한 카드에는 opacity를 걸지 않는다. 진입 중에만 opacity를 쓰고, 0.999 이상이 되면 속성을 제거한다.
- 대책 3: 패널의 둥근 모서리는 border-radius만으로 처리하고 clip은 쓰지 않는다.
- 대책 4: backdrop-filter는 전면 금지다. 유리 느낌이 필요하면 `rgba(255,255,255,.72)`와 노이즈로 흉내 낸다.
- 대책 5: 노이즈·콜아웃·배경은 3D 밖 2D 레이어에 둔다.
- 교차하는 평면의 깊이 정렬은 Chrome이 처리하지만 (**미검증**), 부상한 레이어끼리 Z 값이 같으면 z-fighting이 난다. Z 값은 최소 2 이상 떨어뜨린다.

**콜아웃 투영**
- CSS와 같은 행렬을 쓴다: `new DOMMatrix()`에 translateSelf(ax,ay,dz) → rotateAxisAngleSelf(1,0,0,rx) → (0,1,0,ry) → (0,0,1,rz) → scaleSelf(S,S,S) → translateSelf(−tx·2, −ty·2) 순서로 적용한다. `transformPoint(x·2, y·2, z·2)`로 q를 얻는다.
- 원근 나눗셈: `X = 960 + (q.x−960)·P/(P−q.z)`, Y도 같다(원점 540).
- **미검증**: DOMMatrix의 post-multiply 순서가 CSS와 일치하는지. Studio에서 같은 앵커에 3D 디버그 점을 찍어 ±1px인지 확인하고, 틀리면 4x4 행렬을 직접 구현한다.

**필터·렌더 비용**
- 비용이 거의 없는 것: 방사형·선형 그라디언트, box-shadow(inset 포함), transform. Remotion GPU 문서는 이것들을 GPU 가속 목록에 올려 두었지만, 헤드리스 기본 설정에서는 GPU가 꺼져 있을 수 있다.
- 비싼 것: `filter: blur`. 비용이 면적 × 반경에 비례한다. 캐스트 섀도는 1/4 크기로 그려 blur한 뒤 키우고 동시에 3개까지, 보드 전체 blur는 오프닝·클로징에서만 쓴다.
- 금지: SVG feGaussianBlur·feTurbulence·inner-shadow 필터. inner-shadow는 inset box-shadow로 대체한다.
- 렌더 시간: **미검증**. 추정치는 1080p에서 프레임당 0.3–1.0s, 전체 1710f에 10–30분이다.
- 벤치마크 절차: ⑤ 비트 f1250–1310 60프레임을 기본 설정과 `--gl=angle`로 각각 렌더해 비교한다. 목표는 ≤1.0 s/f다. 넘으면 blur를 베일로 바꾸고, 배경을 정적 PNG 한 장으로 미리 렌더한다.
