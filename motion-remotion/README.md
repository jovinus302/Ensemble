# Ensemble Motion — Remotion

> **v5 초안 진행 중 · 2026-10-12:** 현재 메시지 기준 영상은 [storyboard-v5.md](storyboard-v5.md)이며 사용자 승인 전이다. 순서는 storyboard 승인 → 스타일 프레임 3장 승인 → 모션 구현이다. 제품 기준은 [제품 의도](../intent.md). v4 이하 문서·렌더는 과거 자료이며 현재 메시지가 아니다.

## Current source status (2026-10-12)

[Root.tsx](src/Root.tsx)에 등록된 composition:

- `StyleFrameV4`, `OpeningV4`, `PitchV4` — 과거 참조용(v4, 1,834f). 문서: [storyboard v4](storyboard-v4.md), [design review](review/design-v4.md), [style-frame log](review/log-v4-sf.md).
- `StyleFrameV5` — 계획됨(미구현). storyboard-v5 §5의 스타일 프레임 3장 게이트 대기.

공용 모듈: `src/type/RevealUnit.tsx`(마스크 리빌), `src/tokens/`, `src/v3/`의 stage·fx·ui 일부(v4가 재사용). v2–v3 산출물은 git 기록에서 확인.

## License

개인 사용 기준 무료 라이선스 적용, 회사 사용 전환 시 라이선스 재검토 필요.
