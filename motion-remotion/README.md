# Ensemble Motion — Remotion (Phase 2a: S01-S04)

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
