# Ensemble collaborative handoff — UX revision

## Outcome

The `/handoff` route now starts with Jiyoon and Sangseong discussing a visible, broken expired-login screen. The conversation, not the sidebar, explains why PM intervenes. PM proposes a recovery route based on their messages, waits for both people, and connects a shared UX draft to implementation, implementation to QA evidence, and accepted evidence to a human review and mobile rollout handoff.

Two choices produce different artifacts: return to the existing login screen, or resend with a 60-second restriction. An added privacy constraint masks the example email. Objection reopens discussion. A QA failure requests only focus recovery; a human revision changes the button copy while preserving the decision and passing behavior. Private draft creation never changes the shared artifact.

Compact cards carry proposal, agreement/work ownership, artifact changes, QA findings, and handoff. Their disclosures point back to immutable source dialogue/results. The right column shows a one-line goal, latest shared artifact, owners/waiting states, and the PM's next action. The fixed viewer remains Sangseong; role-play controls identify the current participant.

## Local checkout

- Worktree: `C:\Users\siheon.ryu\Documents\Codex\2026-10-05\task\ensemble-pm-handoff`
- Branch: `demo/pm-team-handoff-20261005`
- Upstream base: `7256395f47ce913b3be032df30a47b2c039105db` (merged PR64).
- Previous local implementation: `4a8353de7b332a688224139923fe478add739dc1`.
- Existing owned development server retained at `http://127.0.0.1:3497/handoff`; no unrelated processes/trees modified.
- No push, PR, merge, or PR67 integration. The restricted document commit was not incorporated.

## Identity, images, and readability

Original repository-native vectors: `app/apps/web/public/handoff/ensemble-logo.svg` and `ensemble-symbol.svg`. Two circular endpoints and a square endpoint join three lines into a compact E-like team mark. This product mark is distinct from the PM participant's lime robot/coordination icon. UX, Coding, and QA use different vector glyphs and colors, with explicit role labels.

The human profiles are newly generated fictional adult portraits, not actual Jiyoon/Sangseong photographs. `jiyoon-generated.png` and `sang-generated.png` live in the same public directory. No stock photographs are used in the final implementation. The built-in ImageGen path was used, without API/CLI fallback. Both returned images were visually checked and copied as unchanged PNG bytes into the repository. Shared prompt:

> Use case: photorealistic-natural. A single square professional profile photograph for a fictional team demo. [subject] Friendly calm expression, authentic skin texture, soft diffused daylight, warm gray seamless background. Centered head and shoulders, face fills upper central area, generous margins for circular crop. No real person reference, no text, no logo, no watermark. Photographic, not illustration.

Subjects: (1) fictional adult Korean woman UX designer in her early 30s, natural shoulder-length dark hair, muted sage blouse; (2) fictional adult Korean man software engineer in his early 30s, short dark hair, navy knit shirt.

Heading 24px, decision 20px, conversation 16px (15px mobile), with smaller metadata and progressive disclosure. Body copy wraps Korean by word where possible and breaks long tokens safely. Generated photos use circular `object-fit: cover` crops, descriptive alt text, and named fallback avatars. An effect checks failures occurring before React hydration as well as the normal image error handler.

## Verification

Commands run from `app/`: `npm test`, `npm run typecheck`, `npm run build`. The 18-test suite includes four risk-based tests covering both human consents, changed constraints, dependency flow, revision/old-version guards, duplicate actions, and interrupted/history-restored callbacks. Three existing dynamic-filesystem tracing build warnings remain in unrelated connector/settings sources.

`app/scripts/handoff-browser.cjs` runs actual local Chromium clicks against port 3497 using an existing Playwright installation (no new dependency):

- Discussion, objection, alternate route, additional privacy constraint, both explicit consents.
- UX draft remains private until shared; shared draft feeds Coding; selected implementation affects QA.
- Missing focus creates a QA request; scoped repair updates the artifact; human copy revision is preserved.
- Duplicate agreement/share/approval; stale result/approval; human review blocks handoff.
- Cancel/reset during UX, Coding, and QA callbacks; internal Back/Forward restores coherent snapshots without restarting timers; browser Back/Forward during a pending callback resets the session.
- Interactive artifact focus behavior, Escape, and opener focus restoration.
- 1440px desktop, complete 390px/320px mobile flows, no horizontal overflow; 720px viewport reflow is the layout-equivalent check for 200% zoom of a 1440px viewport (not an OS/browser zoom-setting test).
- Real image-request failures show accessible fallbacks; generated images load and crop correctly.
- Browser page errors, application API calls, and external requests must all be zero.

Evidence: ignored local `docs/qa/pm-handoff-2026-10-05/ux-result.json` and `ux-*.png`. Core screenshots: `ux-consensus.png`, `ux-qa-feedback.png`, `ux-artifact-review.png`. Mobile: `ux-mobile-390.png`, `ux-mobile-320.png`. Logo source is the SVG above.

QA found and fixed an early image-error/hydration race. The focus assertion was adjusted to wait for the real focus transition rather than sample before the pending DOM update.

## Boundaries

This remains an interactive scripted UI/state demonstration: finite reply choices, fixed scenario data, role-played approvals, and example QA checks. Only explicitly started local preparations have a short timer; timers never approve decisions or share private drafts. The artifact can simulate login navigation/resend/focus without making requests. The resend cooldown is a displayed sample state, not a real email service or elapsed-time implementation. There is no model inference, external Agent/API integration, production authorization, persistence, or measured quality claim. Reload/route departure starts a new demo.

## Final verified result

2026-10-05: `npm test` PASS (18/18), `npm run typecheck` PASS, `npm run build` PASS. Build retains three existing dynamic filesystem tracing warnings. Actual Chromium 153.0.8010.12 click QA PASS, with zero page errors, application API calls, or external requests. See `ux-result.json` for the executed checks.

Current core screenshots were successfully saved in Library:

| Screenshot | Confirmed library_file_id |
| --- | --- |
| ux-consensus.png | libfile_083a0179158081919647d80040ea0e52 |
| ux-qa-feedback.png | libfile_92cd5a6516d48191902e768738059094 |
| ux-artifact-review.png | libfile_1cdc2dcec9848191b27ce047ded72474 |

The official metadata helper was attempted immediately after upload for each original local file. Windows Python failed with `AttributeError: module 'os' has no attribute 'setxattr'`. Library creation succeeded; only local extended-attribute tracking failed. No duplicate uploads or workaround metadata were created.
