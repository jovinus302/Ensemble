# PM-first supporting graph

Local demo UI correction based on main `6f509bac7a319b6805c755877e24935c91ce88a6`.

The `/demo` conversation remains the main surface. A compact graph replaces the causal strip and four separate owner cards: two human participants → Ensemble PM → Story/UI owners → their artifacts. Human decision ownership stays explicit in D1. The D2 revision highlights affected outputs while retained D1 rules stay quiet. All events remain labeled scripted; no provider or external tool success is claimed.

## Reference

Re-inspected Jin Jeon's original `Ensemble-Pages-scenario.html` from the email “Ensemble-Pages-scenario 전달 건,” including rendered Deliver/Tuning screens and Align/Deliver/Tuning source. SHA-256: `30a59d74961fac0583f36a65a175e4148ac173c85d01af4b62ce7e5b1c22ba38`.

Preserved the dark panels, role colors, curved dependency links, paired chat/artifact view, and selective change emphasis. The graph is deliberately smaller than Jin's original, without broad glow or looping animation, to make PM coordination primary. No external integration nodes, original embedded fonts, or new dependencies were added.

## Validation

- `npm test`: all 8 essential local regression tests pass; no new test suite or benchmark added.
- `npm run typecheck`: pass.
- `npm run build`: pass; the same 3 existing dynamic filesystem tracing warnings remain in Claude connector, Codex RPC, and Codex settings.
- Separate Chromium browser against this worktree's production build on `127.0.0.1:3490`, fake runtimes and a task-specific data directory.
- Actual clicks: full flow; empty input disabled; disagreement recorded without progression; both human gates remain waiting; duplicate input deduplicated; automatic scripted handoff only after final decision; scoped revision preserves D1 and remaining formats; reset, replay, back, reload, navigation, and stale timer interruption.
- Graph-specific checks: state changes immediately with accepted input, no active execution before human decision, D2 highlights only affected output paths, previous artifact retained during revision, no running graph animation after transitions, reduced-motion disables graph motion.
- Readability: 1440px desktop, 390px and 320px mobile; no horizontal document overflow. Desktop chat is wider than work context. Mobile uses human → PM → owner → output rows with readable statuses.
- Browser console errors: none. Demo API requests: none. Navigation to the real screen was separately exercised with fake runtimes.

Screenshots and temporary browser runners are kept outside the repository in the task workspace; screenshot binaries and browser dependencies are not added to the project. Real paid providers, external Figma/repository integrations, hardware mobile browsers, and screen-reader speech output were not exercised.
