# log-v4-sf.md — v4 style frames, round 1

2026-09-28. Built against `review/design-v4.md` r1 (the review of record).
Stills: `review/v4/SF1a.png`, `SF1b.png`, `SF2.png`, `SF3.png`; projection
debug: `SF3-debug.png` (lifted), `SF3-debug-rise0.png` (resting), `SF2-debug.png`.
Render: `npx remotion still src/index.ts StyleFrameV4 <out> --props=<json>`
with `{"still":"SF1a"|"SF1b"|"SF2"|"SF3","debugProjection":bool,"heroRise":0..1,"measure":bool}`.
`measure: true` logs one `V4MEASURE {...}` line (visible with `--log=verbose`);
sizes come from `getBoundingClientRect()` in the rendered page, so they include
every 3D transform and the perspective divide.

## What was built (`src/v4/`, v3 untouched)

- `config.ts` — held rotations (frontal (0,0,0), opening (0,-40,0)) with
  `assertHeldPose` (throws on anything else), the still pose table, hero lift
  (scale 1.02, Z 40 logical, shadow (8,16) blur 24), slab thickness 48, wall
  shadow, and the §8 copy with an 18-code-point assert at module load.
- `stage/StageV4.tsx` — background (v3 `Background`) + detached `WallShadow`
  → optional `slab` rig → board rig (v3 `rigTransform`) → 2D overlays → noise.
- `stage/projectV4.ts` — hero transform (scale about card center, translateZ)
  in front of v3 `projectPoint`; that is the only projection path for anchors.
- `ui/BoardV4.tsx`, `ui/TimelineV4.tsx`, `ui/RightPanelV4.tsx` — adapted copies
  of the v3 files: the beat's hero is drawn once, in the hero layer; the panel
  is flat (board layer) instead of v3's Riser at Z+18/+40; no v3 slab plane,
  ground ellipse, board drop shadow or sheen band.
- `ui/HeroLift.tsx` (layer 3), `ui/BoardThickness.tsx`, `fx/WallShadow.tsx`,
  `callouts/CalloutV4.tsx` (+ `DebugDot3D` / `DebugRing2D`), `measure.ts`.
- `StyleFrameV4.tsx`, registered in `src/Root.tsx` (1920x1080, 30fps, 1 frame).

Framing decision: in every frontal still the headline sits in a background band
above the board's top edge (board top at y 200–252), so it cannot overlap UI.
Feature zoom s = 1.45 everywhere — the smallest that keeps board body text
(bodyMd 14) ≥ 20px and hero chips (24 tall) ≥ 36px.

## Iterations (one defect class each)

1. Wall shadow invisible — a true perspective projection onto a far wall
   shrinks the shadow toward the screen center, behind the board. Switched to
   screen-space offset proportional to each point's height above the wall.
2. SF3 grey band bleeding through the board's top-right (frontal) and, in SF1a,
   board-face pixels missing near the right side face. Isolated by experiment:
   no-thickness render = correct; straight faces only = still broken; faces
   moved 1px behind = still broken. Cause: side planes in the same 3D context
   as the board body. Fix: thickness renders in its own rig composited behind
   the board rig (`StageV4 slab`); faces outward + backface-hidden; back face
   dropped; corners as parallel disc stacks. Frontal stills pass no slab
   (every side face is back-facing at (0,0,0)).
3. SF2 callout chips overlapped the plan card's right edge by ~8px, and the
   anchors sat 9px low / 17px right of their chips. Moved chips right of the
   card and corrected the row-center offset (−6 logical, measured).
4. SF3 hero row card's lower edge touched the C4.1 label (lift magnification +
   perspective push ~6px away from center). Card vertical margin 6 → 2.

## Checks on the final revision

- `npx tsc --noEmit`: exit 0.
- `git diff --stat 0dc8e10 -- motion-remotion/src/v3`: empty.
- v3 regression: StyleFrameV3 f185 / f505 / f1305 re-rendered, SHA256 identical
  to `SF1-f185_r3.png` (c5a4a5dc…), `SF2-f505_r8.png` (e075496c…),
  `SF3-f1305_r8.png` (5dd57fc2…). `PitchV3 --frame=600` rendered, exit 0.
- Held poses (`STILL_POSES`, asserted at render): SF1a (0,−40,0) s 0.8;
  SF1b / SF2 / SF3 (0,0,0) s 1.45. No other held rotation exists in v4.
- Headlines (code points): 16 / 16 / 14 (SF1b / SF2 / SF3); all §8 lines ≤ 16.
- On-screen sizes (px, measured):
  - SF2: M1 message body 21.8; panel goal bodyMd 20.3; hero-card bodyMd 21.3;
    hero chips 36.5 tall; hero-card secondary line (bodySm) 18.2.
  - SF3: hero row bodyMd 21.3; hero badge "검증됨" 58.3 tall (text 29.2);
    panel row bodyMd 20.3; timeline message body 21.8; C4.1 id label 17.4.
  - SF1b: M1 21.8; panel goal 20.3.
  - SF1a: not measurable by bounding box (rotated); computed 11–13px — see open item.
- Anchor projection error (3D dot vs 2D projected ring, measured centers):
  SF3 lifted 0.01px, SF3 resting (`heroRise 0`) 0.01px, SF2 lifted 0.01px.
- Hero-vs-board parallax: the lift moves the SF3 anchor 19.6px (Z + 1.02
  scale). Under a camera pan Δ the lifted card leads the board by
  Δ·58/2142 ≈ 2.7% → 8–16px for pans of 300–590px. Background-vs-board
  parallax is motion-only; not applied to held stills.
- Overlap (eye + measured rects): headlines end at y 151–190, boards start at
  y 200–252. SF2 chips x 1294–1547 sit between the card (right 1278) and the
  panel (left 1576). SF3 chip sits on the background right of the board edge
  (x 1499). Every leader ends under its chip. SF3 hero card clears C2.1 text by
  15px and the C4.1 label line box by 3px.

## Open items

- SF1a UI text is ~11–13px on screen (whole board at −40°); the ≥20px body-text
  invariant is not met there. A whole-board opening at ≥20px would need s ≥ 1.43,
  which pushes the near edge (and its side face / shadow) off-frame at −40°.
- SF3 marks C1.1 and C2.1 "검증됨" (v3 SF3 showed them "미검증" while the panel
  reads 3/5 with three approved evidence items).
- "AI PM이" / "PM이" accent includes the particle (KineticHeadline accents whole words).

## Round 2 — SF1b framing: chips/badges cut by the frame edge (one defect type)

Proposition r2 (design-v4.md §4): body ≥ 20px, secondary (bodySm/labels) ≥ 18px,
hero ≥ 36px; SF1a exempt from text sizes (must still read as UI).

Defect: at s 1.45 centered, the right panel's "미검증"/"보고됨" badges were cut
at x = 1920 and the 4th team row's "작업 중" chip at y = 1080. The frame must
hold sidebar text (logical x 84) through the panel badges (x 1412): 1328
logical, i.e. 1926px at 1.45. Fix (`config.ts`): SF1b zoom 1.435 (bodyMd
14 → 20.1px), tx 748 (≈7px margin each side), board top 252 → 212 so the
bottom edge falls between team rows 4 and 5; headline top 72 → 64.
`measure.ts` gained a whole-frame scan (smallest on-screen text, every text
element / pill cut by a frame edge).

Result `review/v4/SF1b.png`: clippedByFrame = [] (was 16 entries); body text
M1 21.5px, panel goal 20.1px; headline ends y 181.6, board starts y 212 (30px).
Tradeoff, not hidden: side margins are only ~7px, and the headline-to-board gap
shrank from ~62px to 30px — the price of fitting the full width at ≥ 20px.
Seen, not fixed (other stills, same defect type, outside this round's scope):
SF2's out-of-focus panel is cut by the right edge, including its "확정 · 김도윤" chip.

## Round 3 — secondary text below 18px (one defect type)

Defect (whole-frame scan): labels and bodySm read 15.8–17.4px in SF1b/SF2/SF3
(labelSm 11 → ~16px: 프로젝트, 채널, 오늘, timestamps, 보고됨; labelMd/bodySm 12
→ ~17.3px: C-ids, 목표, 인수 조건, subtitles, chips, badges, attachments,
inline lines); sidebar avatar initials 16.1px.

Fix (v4 files only): `ui/typeV4.ts` sets bodySm / labelMd / labelSm to 13
logical (the smallest board zoom is SF1b's 1.435: 18 / 1.435 = 12.54 → 13),
line heights unchanged so nothing moves. Used by `BoardV4`, `RightPanelV4`,
a new `ui/BadgeV4.tsx` (copy of v3 Badge with the 13 label) and a new
`ui/messages/MessageRendererV4.tsx` (copy of v3 MessageRenderer; only the
type scale and chip label size differ) now used by `TimelineV4` and the SF2
hero. EmbossChip labels get `fontSize 13`. Sidebar avatars 28 → 32 logical
(initials 18.4px). Knock-on fix: the wider plan-card chips put SF2's callout
dots on the chip text; anchors moved to 3 logical inside the new chip edges
(732 / 779), dots now 3.5–4px clear of the text.

Result (final revision, measured): smallest on-screen text SF1b 18.4px
(avatar initial; labels 18.7), SF2 18.6 (18.8 labels), SF3 18.8. Frame-edge
clipping lists identical to round 2 (SF1b none; SF2 panel at the right edge,
pre-existing; SF3 left-edge timeline avatars/text, pre-existing) — no new
clipping. SF1a re-rendered too (same components; exempt from sizes, still
reads as UI).

Final verification (this revision): `tsc --noEmit` exit 0; `git diff --stat
0dc8e10 -- motion-remotion/src/v3` empty; StyleFrameV3 f185/f505/f1305 SHA256
identical to r3/r8/r8; `PitchV3 --frame=600` exit 0. Body text: SF1b 20.1–21.5,
SF2 20.3–21.8, SF3 20.3–21.3px. Hero: SF2 chips 36.5px tall, SF3 badge 58.3px
tall. Anchor error 0.01px (SF3 lifted, SF3 rise 0, SF2). Held poses: SF1a
(0,−40,0) s 0.8; SF1b (0,0,0) s 1.435; SF2/SF3 (0,0,0) s 1.45.
