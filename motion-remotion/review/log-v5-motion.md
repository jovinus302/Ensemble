# log-v5-motion.md — Stage 1 (PitchV5, B1–B3 애니메이션)

구성 `PitchV5` 1680f 등록, B1–B3(f0–660) 완전 애니메이션 + 오디오, B4 이후(f660–1680)는 B3 세계를 그대로 유지하는 플레이스홀더. 티저는 시작하지 않음.
산출물: `out/pitch-v5-stage1.mp4`(gitignore, f0–659, h264 crf18, 오디오 포함, 22.06s), `review/v5-motion/contact-stage1.png`(15f 간격 45장).

## 구조
- 타이밍: `src/v5/timeline.ts`가 유일한 이벤트 표(비트 시작 + 오프셋, 비트 경계는 timing.json → `timing.ts`). SFX 표도 여기. 다른 파일에 프레임 상수 없음.
- 순수 함수: `anim.ts`, `camera.ts`(키 포즈, 구간별 이징, 줌 로그 보간), `filmAnim.ts`(DOM 없는 애니메이션 값), `PitchV5.tsx`(렌더).
- 스타일 프레임 코드 재사용: WorldStage/SurfaceFrame/바디/config. 바디는 `surfaces/film.tsx` 컨텍스트가 있을 때만 애니메이션 경로(스틸은 컨텍스트 없음 → 바이트 동일).
- 앵커(M 타일, D 핀, S 답글, A 슬롯)는 프레임마다 DOM에서 측정해 라이브 배치로 투영(레이아웃이 애니메이션되므로).
- 실: `fx/ThreadDraw`(선두 snappy 스프링, 후미 smooth 스프링, 사이 가는 필라멘트가 두꺼워짐). 선두 도착이 정확히 목표 프레임이 되도록 스프링 길이를 역산.
- 칩 모핑: 나가는 칩 4f(.96+페이드), 들어오는 칩은 그 후 2f에 시작해 이벤트 프레임에 보임. 겹침·블러 없음.
- Chrome 주의사항: 3D 면 큰 box-shadow 없음, 측면층 ≤14(기존), will-change 없음, 블러는 면/측면층별(기존). 캡슐의 그림자는 2D 오버레이.
- 모션 블러: `@remotion/motion-blur` CameraMotionBlur, T-cam 구간(f156–180, f210–246, f505–540)만, 셔터 100°, 4샘플. 단일 워커 실측 1.52s/프레임(예산 1.5s 경계), 비-블러 프레임 0.28s. 5샘플은 1.9s로 예산 초과라 4로 낮춤. 라이브러리 특성상 블러 프레임은 f+0.5~f+1의 하위 프레임을 합성(약 0.75f 선행).
- DOF 예외(상시 흐림 ≤4px, A 3→1.5px, P 2.5px)는 MOTION.md·storyboard §7에 기록(2026-10-13 승인).

## 스틸 재현
| 프레임 | 대비 | PSNR |
|---|---|---|
| f140 vs TA-B1f140 | 의도된 차이만(말하는 사람 윤곽, D의 서연 커서, S 입력 점, 카렛) | 약 35dB |
| f600 vs TA-B3f600 | 기본 일치(S 카렛·점, D 커서) | 약 37dB |
초기(마이크로 모션 추가 전) 46.9dB / 40.0dB. 
회귀: StyleFrameV5 TA B1/B3/B3-headline/B7, SF-A1, StyleFrameV4 SF1b 모두 md5 동일. tsc 0.

## 렌더 속도
f0–659 전체 6m03s(블러 포함, 약 1.8f/s). 블러 없이는 3m45s(2.9f/s). 이 머신에서는 --concurrency를 1→8로 바꿔도 처리량이 같음(GPU/래스터 직렬화로 추정): 프레임당 ≈0.3s가 병렬과 무관하게 합산됨. 단일 워커 기준 일반 0.28s, 블러 프레임 1.52s.

## 동기 검사 (QA d, `scripts/qa/sync.ts`)
애니메이션 순수 함수를 직접 평가해 "보이는 프레임"(시작=값 ≥.03, 안착=≥.98, 실=≥.995)을 구함. 픽셀 측정이 아니라 모델 측정이며, 별도로 mp4 오디오는 SFX 프레임이 표와 같음을 믿는 방식.
| 이벤트 | 목표 f | 실제 f(보임) | Δ | 목표 격자 | 판정 |
|---|---|---|---|---|---|
| B1 headline settle | 45 | 45 | +0 | beat | OK |
| B1 headline exit starts | 150 | 151 | +1 | beat | OK |
| B2 chip 1 pops | 180 | 181 | +1 | bar | OK |
| B2 capsule forms | 210 | 209 | -1 | beat | OK |
| B2 amber ring D | 270 | 271 | +1 | beat | OK |
| B2 amber ring S | 278 | 279 | +1 | off-grid | OK |
| B2 amber ring P | 285 | 286 | +1 | beat | OK |
| B2 headline settle | 300 | 300 | +0 | bar | OK |
| B3 PM tile lights | 360 | 361 | +1 | bar | OK |
| B3 headline settle | 390 | 390 | +0 | beat | OK |
| B3 thread M->D lands | 420 | 420 | +0 | bar | OK |
| B3 D pin opens | 420 | 421 | +1 | bar | OK |
| B3 headline exit starts | 450 | 451 | +1 | beat | OK |
| B3 S reply + 전달됨 | 495 | 496 | +1 | beat | OK |
| B3 brief arrives in A | 540 | 539 | -1 | bar | OK |
| B3 glow pulse peak | 600 | 600 | +0 | bar | OK |

| SFX | 프레임 | 격자 |
|---|---|---|
| typing (B1 A types) | 66 | off-grid |
| chip-morph (B2 chip 1) | 180 | bar |
| chip-morph (B2 chip 2) | 195 | beat |
| chip-morph (B2 capsule forms) | 210 | beat |
| click (B2 line 1 breaks) | 275 | off-grid |
| chip-morph (B3 word swap 은->을) | 374 | off-grid |
| capsule-arrive (B3 capsule absorbed) | 390 | beat |
| thread-draw (B3 thread M->D) | 390 | beat |
| click (B3 pin opens) | 420 | bar |
| thread-draw (B3 thread ->S) | 465 | beat |
| chip-morph (B3 reply 전달됨) | 495 | beat |
| thread-draw (B3 thread ->A) | 510 | beat |
| capsule-arrive (B3 brief arrives (f540)) | 540 | bar |

rows outside +-1f: 0

## QA 요약
- (a) 컨택트 시트: `review/v5-motion/contact-stage1.png`.
- (b) 무음 읽기: 새 Explore 서브에이전트가 시트 한 장만 보고 세 헤드라인과 "각자 도구 → 맥락 끊김 → PM Agent가 이음" 흐름을 정확히 재구술. 지적: 작은 UI 글자(컨택트 해상도 한계), 자막 띠가 자막인지 불명, 주황 하이라이트 의미는 추정, 오른쪽 A 패널은 정체 불명(항상 어둡고 잘림). 전부 반영하지 않음(A는 DOF·어둠이 설계 의도).
- (c) 프레임 차이 스파이크(>3×이웃): 0건. 8f 창 움직임 최저 0.44(임계 0.4 미만 구간 없음). 최대 d=24.9(f163, B1 돌리).
- (e) 감독 비평 → 상위 3 수정: ① 모션 블러가 5샘플·180°에서 글자 다중 노출 줄무늬 → 100°·4샘플로(예산도 충족). ② B2/B3 카메라가 D 윗변·P 아랫변을 잘라 먹음 + 캡슐이 M 타이머를 가림 → 포즈 s .90→.88, 캡슐 정지점 우측 이동. ③ 헤드라인 안착이 비트보다 3–7f 일찍 보임(이징 꼬리) → 창을 1/LAND로 늘려 안착 프레임에 맞춤, 스레드 도착도 f420 정확히. 추가: SFX가 음악보다 15–20dB 낮아 안 들릴 수 있어 볼륨 상향(피크 0.90, 클리핑 없음).
- 남은 약점: f0–15는 어두운 무대에 S 창 하나뿐(스펙 그대로). B3 f450–660은 헤드라인이 없어 좌상단이 비고 새 모션이 적음(스펙). B2 헤드라인은 "중앙"이 아니라 D와 겹치지 않도록 좌상단 영역에서 가운데 정렬(108px, 3줄 아님 2줄).

## 스토리보드와 다른 점(의도)
- B3 카메라 이동: 스펙 f450–540(90f)은 추적 이동 ≤40f 규칙과 충돌 → A 가지가 그려지는 f505–540(35f)로 축소. S 가지(f465–495)는 B2 끝 포즈에서 이미 화면에 있음.
- B3 f600 후광 .3은 스펙 ≤.22보다 높음(승인된 TA 스틸과 일치시키려고 유지).
- 말하는 사람 윤곽, D 서연 커서, S 입력 점, 자막 타이핑은 "읽는 동안 반 박자 이상 정지 금지"를 위한 마이크로 모션(스틸에는 없음). 카메라 읽기 표류(s ≤0.5%, tx ±9)도 같은 목적.
- B2 화면 간격 벌림은 +40px로 f240–270, B3 f360–390에 원복(f600 스틸과 일치).

## 플레이스홀더
f660–1680은 f660의 세계 그대로(헤드라인·B4–C 없음). 렌더 범위는 f0–659.
