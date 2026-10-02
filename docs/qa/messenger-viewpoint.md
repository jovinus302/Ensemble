# Messenger viewpoint and concise work context

Base: `cb771a305d6af1cc310345e53adcfed8e032a19b`. Only fixed-demo presentation files changed; reducer, gates, tests, and production runtime remain unchanged.

The conversation has a persistent Seoyeon viewpoint: her messages align right with a self label; Doyun, PM, and execution agents align left with explicit identities. The comparison-stage composer says that Doyun's answer is being entered on his behalf. Changing the input role does not realign historical messages. Long bubbles wrap and avatars remain attached to their actual speakers.

The work context now uses short decision-owner labels, criteria chips, a compact coordination graph, visible wording replacement, and add/remove/keep chips. Detailed template rules are available through a disclosure. Concrete Story comparison examples and the actual UI result remain visible. PM leadership is shown through the existing causal exchange: one human request → PM scopes and assigns → Story/UI update → Doyun reviews → PM closes the work.

## Validation

- `npm test`: 8/8 unchanged essential tests pass.
- `npm run typecheck` and `npm run build`: pass; three existing dynamic filesystem tracing warnings remain.
- Actual Chromium against this worktree's production build on port 3492 with fake runtimes and separate data.
- Full natural-dialogue flow, human gates, ambiguity/negation/scope checks, duplicate handling, scoped revision, reset/back/replay/reload, stale timers, graph responses, and reduced motion pass; no demo API calls or browser errors.
- 1440px desktop and 390/320px mobile: correct own/other identity and avatar/bubble alignment, stable historical alignment across input-role changes, long text wrapping, and no horizontal overflow.
- Template-rule disclosure remains operable, with retained criteria and formats accessible.
- Focused source and screenshot review found no role-identity, causal-clarity, or mobile readability blockers.

Temporary browser runners and screenshots are outside the repository. No paid provider calls, external integrations, real-device browsers, or screen-reader speech-output checks were performed. Changes are prepared locally; publication requires separate authorization.
