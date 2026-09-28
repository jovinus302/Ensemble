# log-v3-sf.md — v3 style-frame review (SF1 f185 / SF2 f505 / SF3 f1305)

Reviewed as a pitch-video art director against the Linear/Raycast-grade bar
(the user rejected the first motion graphic as "그림이 구려"). One defect class
per round, per MOTION.md §13.

## Round 1 — projection / camera-framing correctness (blocking)

**Defect found**: `Callout`'s anchor dot (2D, projected via `project.ts`)
landed far from `DebugAnchorDot3D` (a real 3D dot rendered inside the Rig at
the same logical anchor) — tens of px apart at SF3's s=2.0 zoom, not the ±1px
spec §6 requires. Root cause: `Rig`/`TypeRig` divs used the CSS default
`transform-origin: 50% 50%` (element center, i.e. 960,540), while
`project.ts`'s DOMMatrix math (per spec §6) composes from the element's local
origin with no re-centering step. The two disagreed on where "no rotation"
sits, so every rotated pose was framed differently on screen than the
DOMMatrix projection assumed.

**Fix**: added `transformOrigin: '0px 0px'` to both `Rig` and `TypeRig`
(`src/v3/stage/Stage.tsx`). Re-rendered SF3 with `debugProjection`: the pink
3D dot and the green projected-anchor outline now overlap (sub-pixel at this
zoom). This also happened to fix SF1's framing — before the fix the board
rendered small and mis-cropped in a corner; after, it reads as a large,
clearly tilted floating panel per storyboard-v3.md §5's "보드 아래쪽 1/4은
프레임 밖" intent.

**Secondary bug caught in the same pass**: `MessageRenderer`'s `GlowField`
call passed raw logical coordinates into a component that lives inside the
K=2-scaled board DOM (everything else there is `px()`-doubled) — the glow
rendered at half scale/position. Fixed by wrapping the call site in `px()`.

**Also fixed**: `RightPanel` had used flexbox flow instead of the fixed
absolute y-coordinates storyboard-v3.md §2 specifies for the acceptance-
criteria rows. That's what caused the callout-vs-badge mismatch discovered
above (independent of the transform-origin bug) — rewrote it to position
every block (goal, criteria rows, decision, evidence) at its literal
board-absolute y, matching `content.ts`'s `Criterion.y` and `C3_1_CENTER`.

## Round 2 — callout legibility + glow softness

**Defect found**: SF2's two callouts used arbitrary large `chipOffsetX`
values (520/560px), producing leader lines that ran almost edge-to-edge
across the frame and crossed over unrelated UI text — the opposite of spec
§3's "짧은 40px 수평 스텁 + 짧은 대각선" callout language. Separately, SF1's
AI-glow behind the headline showed a visible hard rectangular edge instead of
a soft diffuse bloom, traced to the radial-gradient's `transparent 60%` stop
coinciding almost exactly with the glow box's own edge at the chosen box
size (coincidental alignment, not a logic bug).

**Fix**: shortened all three style frames' callout `chipOffsetX/Y` to
150-230px so leader lines stay short and don't cross card content (SF2, SF3).
Changed `GlowField`'s stop from `transparent 60%` to `transparent 42%` and
enlarged/recentered SF1's glow box so the fade completes well inside the box
regardless of size, removing the edge artifact.

## Round 3 — not run

Given the scope approved for this pass (spec §7 step 11: stills + stop, no
full beat-by-beat motion), a third full round was not spent. One known,
unresolved minor artifact from the current renders is called out below
instead of chasing it into a third round.

## Round 3 (2026-09-28, resumed) — re-render after the K-doubling fixes

`tsc --noEmit` clean (the `Button.tsx` px() fix was already complete on disk).
Re-rendered all three as `*_r3.png` (the `_r2` files are byte-copies of r1).
Confirmed landed: SF1 glow is soft/borderless and the grey smear is gone;
SF1 headline sits in screen perspective; chips/badges render at full size;
SF3 hero "검증됨" badge is ~60px on screen. Still open after r3:
(a) SF3 grey smear left of the hero badge, (b) SF3 callout label covers
C2.1's "미검증" badge and its leader points at the row, not the badge,
(c) SF2 headline overlaps M1 message text.

## Round 4 — SF3 cast-shadow smear (one defect type)

Root cause: the risen C3.1 row had no surface — it was bare text with a
row-sized `CastShadow` under it, so the shadow read as a grey smear.
Fix (`RightPanel.tsx`): give the risen row a white card surface (radius 16,
rim highlight) between the shadow and the success glow; make the row's text
block `position: relative` so it paints above the new surface. Result
`SF3-f1305_r4.png`: smear gone, C3.1 reads as a lifted card. SF1/SF2
re-rendered byte-identical to r3 (change is gated on `c31Risen && verified`).
Next rounds, one each: (b) SF3 callout, (c) SF2 headline overlap.

## Checklist against spec §5 requirements

- **SF1 (f185)**: T1 headline "잇는 건 이제 PM" centered, "PM" primary green,
  harmony glow behind it — present. Board at the P0.5<->P1 bridge pose,
  blurred (3px) + veiled (.35), beat① state (M1 only, team flat, panel 0/5) —
  present. Ground contact shadow / slab thickness / sheen band — present.
  **Open item**: a soft grey rectangular smear is visible mid-board in the
  blurred render; most likely the blur filter haloing across the (still
  flat-at-this-moment) message-row / channel-header edges rather than a
  logic bug, but not root-caused — flagged for the next pass rather than
  guessed at further.
- **SF2 (f505)**: camera pose matches spec exactly. M2 plan card risen +90
  with AI glow and a visibly separated cast shadow, 4 assignment rows with
  clay avatars (2 circle / 2 square), embossed chips, "계획 승인" button
  un-pressed. Two short callouts present and legible. Headline T2 top-left.
  M1 partially visible above the card. Matches the brief.
- **SF3 (f1305)**: camera pose matches spec exactly. Right panel risen +40,
  C3.1 row risen +70, badge popped to "검증됨" with a visible ground shadow,
  evidence block's third row ("사용 흐름 초안 v1 · 사람 승인") shown, progress
  "3/5". One short callout "검증됨" pointing at the row. Headline T2 top-left
  with "증거로" carrying the Z+80 lift (visible as a subtle forward pop in
  the KineticHeadline transform, not a strong depth cue at this camera
  angle — acceptable given the headline sits in TypeRig, decoupled from the
  board's zoom).

## Projection-accuracy check (spec §6 requirement)

Rendered `review/v3/SF3-debug.png` (`StyleFrameV3` with `debugProjection:
true`): a magenta dot rendered directly inside the Rig at the C3.1 anchor
(board-logical 1232,384, risen z=110) versus a green-outlined circle drawn by
`Callout`'s 2D projection at the same anchor. After the `transform-origin`
fix, the two overlap at SF3's s=2.0 zoom (sub-pixel, well inside the ±1px
target). No manual 4x4 matrix was needed — the DOMMatrix approach in
`project.ts` was correct; the bug was the CSS side's implicit transform-origin,
not the matrix composition order.
