# Ensemble Motion — Remotion

## Current source status (2026-10-02)

The repository contains several generations of compositions. Phase 2a below describes the original v2 SVG-world implementation, not the complete current composition list. [Root.tsx](src/Root.tsx) also registers `UiMockupFlat`, `PitchV3`, `StyleFrameV3`, `StyleFrameV4`, `OpeningV4` and `PitchV4`.

- `Preview2a` implements v2 S01–S04 (750 frames); `Full` remains its 1,500-frame timeline with S05–S08 holding the S04 end state.
- `PitchV3` is a registered intermediate implementation; its registration explicitly says full beat-by-beat motion is not complete. See [v3 review](review/log-v3-sf.md) and [v3 continuation notes](review/next-v3.md).
- V4 has implemented style-frame, opening and full-pitch components under `src/v4/`. `PitchV4` uses the [1,834-frame timeline](src/v4/pitch/pitchTimeline.ts) at 30 fps (about 61.1 seconds), with a 388-frame opening. Its design references are [storyboard v4](storyboard-v4.md), [design review](review/design-v4.md) and [style-frame review log](review/log-v4-sf.md).

This status is based on source and existing review documents at `main@c91234a`. No new render or visual acceptance was performed for this documentation update; composition registration and an implemented timeline alone do not establish final render approval. Earlier storyboards and review findings remain historical records.

## Original Phase 2a implementation

Persistent-world pitch video. One 3840x2160 SVG world (nodes/lines/packets/badges,
pure function of frame) + a continuous camera (translate/scale, spring-driven) that
pans/zooms through it. Scenes only drive state + headline copy — no cuts, no
remounting the world, per `storyboard-v2.md` and `MOTION.md`.

Phase 2a covers S01-S04 (0-25s / 0-750f). S05-S08 are Phase 2b (metadata reserved in
`src/scenes/scenes.ts`, `implemented: false`).

## Commands

```bash
npx remotion studio
npx remotion render Preview2a out/preview-2a.mp4 --codec=h264 --crf=18
npx remotion still Preview2a review/stills/f000.png --frame=0
```

`Preview2a` = S01-S04 (0-750f, 1920x1080 @30fps). `Full` = the full 1500f timeline
(S05-S08 currently just hold the S04 end-state visually, not yet built).

## Structure

- `src/tokens/` — `motion.ts` (durations/easings/springs incl. the `ad` art-direction
  pass), `colors.ts` (DESIGN.md tokens), `fonts.ts` (Pretendard loader).
- `src/world/` — `coords.ts` (world map), `camera.ts` (camera path), `state.ts`
  (per-frame world state, pure function), `s04Timing.ts` (shared S04 line/token
  timing used by both World and Camera), `World.tsx` (the persistent SVG).
- `src/primitives/Headline.tsx` — mask-reveal headline with per-scene variants
  (blur-in, per-char, PM-green-snap, default word reveal).
- `src/scenes/scenes.ts` — scene frame ranges + headline copy + variant.
- `src/compositions/PitchVideo.tsx`, `src/Root.tsx` — composition wiring.
- `review/log-2a.md` — defect-fixing rounds and documented deviations from storyboard.

## License

개인 사용 기준 무료 라이선스 적용, 회사 사용 전환 시 라이선스 재검토 필요.
