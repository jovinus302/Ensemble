# Ensemble 문서 안내

기준: 2026-10-07. **제품 방향은 [intent.md](../intent.md)**다. 여러 사람과 Agent가 일하는 다양한 협업에서 PM Agent가 목표 아래 맥락을 연결하고 다음 행동을 조율한다. 기존 환경의 접점과 우측 보조 뷰는 이를 구체화하는 제품 경험이며 로그인 개발·디자인은 시연 사례다.

| 읽을 내용 | 문서 |
|---|---|
| 문제·제품 경험·성공 기준 | [제품 의도](../intent.md) |
| 새 컨셉과 현재 구현의 차이 | [MVP 범위](mvp-scope.md) |
| 실행과 코드 구조 | [설치 안내](../README.md), [아키텍처](mvp-architecture.md) |
| 기존 제품의 내부 계약 | [작업 모델](work-model.md) |
| PM Agent의 개입 기준과 결정 | [원칙](pm-principles.md), [결정 기록](pm-agent-decisions.md) |
| 로그인 개발·디자인 연결 체험 | [데모 안내](../app/demo/README.md) |
| 검사와 검증 한계 | [QA](qa/README.md), [회귀 검사](qa/essential-regressions.md) |
| 화면·움직임의 기준 | [DESIGN](../DESIGN.md), [MOTION](../MOTION.md) |
| 이번 변경의 의도와 증거 | [변경 제안](change-proposition.md) |

## 현재 구현과 자료의 역할

/demo는 브라우저 안에서 관계를 확인하는 예시다. 실제 도구·Agent 연동의 성공 증거가 아니다. /의 기존 앱과 app/packages의 내부 원장·권한 로직은 유지되며, 새 컨셉의 모든 환경에 PM Agent가 붙는 기능을 구현한 것으로 설명하지 않는다.

[Argo 조사](argo/structure.md)는 과거 참고 자료다. [발표 자료 안내](presentations/README.md)와 [영상 프로젝트](../motion-remotion/README.md)의 과거 산출물은 당시 표현을 보존하며 현재 제품 명세로 사용하지 않는다. 최신 발표 메시지는 각자의 작업 환경 → PM Agent의 연결 → 프로젝트 맥락 확인 순서로 설명한다.
