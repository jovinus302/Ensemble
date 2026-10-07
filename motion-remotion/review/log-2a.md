# Review log — Phase 2a (S01-S04)

> **과거 영상 자료 · 2026-10-07 정리:** 이 문서는 이전 영상의 제작·검토 기록이다. 현재 제품은 여러 사람과 Agent의 맥락을 목표 아래 연결하고 다음 행동을 조율하는 PM Agent이며 [제품 의도](../../intent.md)가 기준이다. 아래 대본·표현·화면은 새 메시지로 재제작된 결과가 아니다.


Reference: storyboard-v2.md, MOTION.md §13 checklist, and the art-direction pass
(jitter.video/templates + getdesign.md reference research) forwarded mid-build.
Springs/timings from that pass live in `src/tokens/motion.ts` (`ad` export) and
`src/world/camera.ts` / `src/world/s04Timing.ts` — single source of truth for retuning.

## Round 1 — first full pass after applying the art-direction notes

Rendered stills at f0, 30, 90, 190, 200, 260, 340, 355, 375, 460, 505, 512, 535, 560,
600, 700, 745 (Preview2a). Findings:

1. **f200/f340 (S02, dark bg)** — headline color was hardcoded to `colors.onSurface`
   (near-black ink), which is close to invisible against the S02 ink background
   (`#0E1311`). Visually it read as a faint ghost, well under WCAG contrast.
   Fix: headline color now interpolates onSurface -> darkOnSurface with the same
   `darkAmount` the World uses for bg (`getDarkAmount`, exported from `world/state.ts`).
2. **f355 (S03 headline "PM" word)** — the pmSnap variant checked `word === 'PM'`,
   but the actual token is `PM이` (Korean particle glued on with no space), so the
   green + scaleX-snap treatment never fired. Fix: match `startsWith('PM')` and only
   color/snap the `PM` prefix, leaving the particle in the default ink color.
3. **f460/f505 (PM harmony ring)** — the ring was implemented as a stroke-dasharray
   perimeter reveal (like the line draws), but the approximate perimeter length didn't
   match the actual rounded-rect path length, so it rendered as a partial diamond/arc
   instead of a clean ring. Fix: replaced the literal per-degree draw with a simpler
   opacity + scale-in (0.7->1) reveal over the same 24f window — reads as "the ring
   materializes with the node" without the geometry mismatch.
4. **f560/600/700/745 (post-handoff, S04 hold)** — the context-5 packet's outer white
   card never faded out after its bars folded on arrival, leaving a stray empty white
   box floating over the research agent's AI badge for the rest of the scene (184
   frames of dead visual clutter, also breaking "no orphaned decoration" hygiene).
   Fix: added `handoffToken.groupOpacity` (fades in just before travel, holds through
   the delivery beat, fades out ~6f after arrival) wrapping the whole token+trail+packet
   group.
5. **Token travel curve** — `tokenTravelT` used `ease.standard` (M3 decelerate curve),
   which front-loads motion hard enough that the token looked ~90% arrived at the
   halfway point of its 22f window. Switched to `ease.inout` for a genuinely symmetric
   ease-in-out travel, matching the art-direction note literally.

## Round 2 — verify round-1 fixes

Re-rendered f340, 355, 460, 505, 535, 545, 560, 610, 700, 745. Confirmed:
- Headline legible in both light and dark passes (f340 now reads white-on-ink).
- "PM" renders in forest-green with the scaleX snap; "이" particle stays ink-colored.
- Ring reveals cleanly, no partial-arc artifact.
- Token clearly visible mid-travel at f545 (comet trail + all 5 context bars fanned in);
  no leftover packet/badge ghost at f560/610/700/745.

## Round 3 — boundary / detail spot-check

Rendered f82 (cursor drop+ripple settled), f188/f198 (S01->S02 headline handoff),
f349 (S02->S03 handoff mid dark->paper crossfade). No new defects found — headline
overlap window (previous scene mask-out while next scene's pre-roll enters) reads as
intended layered motion, not visual collision. Hand cursor holds post-drop as designed
(no idle bobbing, per MOTION.md Do/Don't).

## Round 4 — orchestrator review of contact-2a.png (post art-direction pass)

Four issues raised after reviewing the first full contact sheet, all addressed:

1. **Framing too zoomed-out vs. approved style frames.** S01's camera zoom was the
   storyboard's literal 0.50, which (combined with the world map's larger absolute
   node coordinates vs. the style-frame's compact 1920x1080 layout) made nodes/lines
   read tiny and the frame read empty rather than intentional. Raised the S01 base
   zoom to 0.75 (`camera.ts` `S01_BASE_ZOOM`) and re-timed the S02/S03 zoom targets
   to continue a coherent push-in (0.75 -> 0.795 -> 0.90 -> 1.0 -> 1.05 into S04,
   which was already close to the style frame's implicit ~1.0 and unchanged).
   Verified against `style-frames/S01_problem.png` and `style-frames/S04_flow.png`
   side-by-side with fresh stills — node density now reads comparable while still
   leaving >=35% empty space (not the ~80% before).
2. **Dead holds.** S01's ~5s hold had a single one-shot cursor drop then ~110f of
   stillness; S04's back half was a static held frame. Fixes:
   - S01: replaced the one-shot hesitate/drop with a continuous cosine loop
     (`cursorPacket.travelP`, ~2 round trips across the scene) carrying the packet
     between the User-side and Designer-side tangle. The cosine's natural
     deceleration at each end reads as "hesitate"; a ripple + touch-scale pulse there
     reads as "drop" — then it picks up and heads back. Chaos lines also bumped
     4->5px / 3.5->4.5px and darkened (`outlineVariant` -> `onSurfaceVariant`/`outline`)
     so the flow reads at a glance.
   - S04: added a second handoff beat, PM -> prototype agent (`handoffToken2` in
     `state.ts`, `TOKEN2_*` constants in `s04Timing.ts`), starting once the first
     beat has settled and arriving with 45% of the scene still to hold. This makes
     the core claim ("PM keeps the flow going", not a one-shot) show twice, and the
     proto line now actually activates (coral) instead of staying inert gray for the
     whole scene.
3. **S02 node ghosts nearly invisible.** Dim floor was 0.25-0.3 opacity. Raised to a
   0.5 floor (`peripheralOpacity` in `state.ts`) so "team without a conductor" stays
   legible against the ink background while still reading as dimmed/backgrounded.
4. **Possible label/node overlap early in S04.** Checked stills at f515/525/535/545
   (S04's first ~1s) after the framing fix — no text crosses a node. The likely
   source was the round-1 "ghost packet card" defect (already fixed before that
   report), which at contact-sheet thumbnail size can look like stray text near the
   research agent's AI badge; confirmed clean at full res.

## Round 5 — PM ring shape defect (still-S04-f660.png)

The harmony ring was implemented as a rotating rounded-square `<rect>` (`transform:
rotate(deg)` on the ring's `<g>`), which visibly offsets the ring's corners from the
PM node's corners as it spins — reads as broken/misaligned rather than "working"
motion, and doesn't match the concentric, axis-aligned ring in the approved
`S04_flow.png` / `S08_closing.png` style frames.

Fix: the ring `<rect>` no longer rotates (kept only its pop-in `scale`, which is
uniform and preserves concentricity). Instead, added a second gradient definition
`harmonyRing` (same stops as `harmony`) with a `gradientTransform={rotate(deg, 0.5,
0.5)}` driven by the same `pmRingRotationDeg` (360°/240f, unchanged). The ring shape
now stays perfectly concentric and axis-aligned with the PM node at all times; the
"working" cue comes entirely from the gradient's hue sweeping around the fixed ring,
same as a conic "loading" indicator. The original `harmony` gradient (used for the
PM baton tip, both handoff tokens, and later S08) is untouched, so this only affects
the ring. Verified at f460 (S03, ring mid-draw) and f660 (S04, the exact frame the
defect was reported on) — ring now reads as clean and concentric in both.

## Deviations from storyboard-v2.md (all pre-cleared with the orchestrator)

- **Camera pacing**: storyboard §1.3 gives per-scene start/end camera values; the
  actual move is front-loaded within each scene (CAMERA spring, ~30-40f) and then
  *holds* for the remainder, with low-amplitude life during holds (S01 push-in
  1.0->1.06 drift across the whole scene, S02 pre-swoop breathing, PM ring slow
  rotation) rather than a move spread evenly across the whole scene. This satisfies
  the >=40%-hold rhythm rule given scenes are 150-240f but the spring settles in
  30-40f.
- **S04 token travel**: spec literally states an ~800ms/full-scene-synced pan; in
  practice the handoff token travels in a short 22f burst (with 4f shrink anticipation)
  once the four assignment lines have drawn, camera lead-panning 3f ahead of it, then
  everything holds for the remaining ~180f of the scene. Reads snappier and matches
  the anticipation -> pop -> settle grammar better than a slow scene-long crawl.
- **PM ring rotation**: per storyboard this is a continuous slow rotation of the
  harmony ring; because the ring is a rounded *square* (not a circle), continuous
  rotation reads as a slowly reorienting diamond rather than a spinning halo. Kept as
  specified (period is long enough — 240f — that it's not distracting), flagging in
  case a future pass wants to swap to a circular ring for this effect specifically.
- **TransitionSeries**: not used in 2a. Every transition inside S01-S04 is
  `camera-continuous` per the storyboard (the two `cut` transitions in the full
  storyboard are S04->S05 and S07->S08, both outside this phase's scope), so there is
  no cut to hand to `TransitionSeries` yet. Reserved for the 2b pass.
- **S02 node "paper-30% outline" + async drift**: implemented as a peripheral-opacity
  dim to 0.3 with node stroke/fill interpolating toward the dark theme's on-surface
  tone (not a full re-skin), plus a small ramped ±8px async sine drift on the node
  group only (not on the connecting line endpoints, to avoid visibly detaching lines
  from their nodes at this opacity/zoom the mismatch is sub-pixel-perceptible).
