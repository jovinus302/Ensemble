# Natural workplace dialogue and bounded PM coordination

Base: `b09f491c2babca483d3f76f0868b10fc4e18d9aa`. Fixed `/demo` only; no production orchestration/provider changes.

The team now starts with an actual concern about indirect identification. PM defines a first-screen preview scope and commissions two concrete Story examples. Story authors the alternatives; Seoyeon discusses their direction and Doyun critiques the wording. People set the wording, identification-clue, and three-level fiction criteria. A natural bounded request such as “그럼 이 기준으로 화면 한번 볼까요?” starts the preview work. Story creates the template, UI creates the screen, Doyun reviews, and PM connects the decision, assignments, revision scope, and closure.

The chosen umbrella story and “뜻밖의 도움” wording appear in the visible template and screen. PM does not invent the final story or replace human judgment. Jin's paired chat/work-context design and the PM-first supporting graph are preserved; the added comparison fits above the graph and stacks on mobile.

## Input contract

This is a disclosed scripted demo with small conservative intent checks, not general natural-language understanding. Supported paraphrases can advance; the exact draft sentence is no longer required. A preferred comparison plus wording constraint advances human discussion, while a bounded first-screen request is separately required to start the preview. Concerns, ambiguous assent, negation, contradictory or expanded scope, and partial/reversed revision requests remain waiting and elicit clarification. Revision verbs are bound to their respective targets rather than matched as an unordered keyword bag.

## Verified

- `npm test`: 8/8; the two existing demo tests were updated, with no new suite or dependency.
- `npm run typecheck`: pass.
- `npm run build`: pass; three pre-existing dynamic filesystem tracing warnings remain.
- Focused source and visual review for role clarity, naturalness, entity/verb binding, and mobile readability.
- Actual Chromium clicks on this worktree's production build at `127.0.0.1:3491`, fake runtimes and isolated data.
- Story comparison precedes human judgment; natural paraphrases and question-form bounded preview requests work.
- Empty, ambiguous, negative, premature, duplicate, contradictory, expanded, partial, and reversed requests do not silently authorize work.
- Scoped revision preserves D1 and remaining formats; the previous artifact remains visible until completion.
- Comparison and execution timers cannot finish after back/reset; replay, reload, and browser-back work.
- 1440px desktop and 390/320px mobile, no horizontal overflow; reduced-motion suppresses graph animation.
- No browser errors or demo API requests.

Temporary browser scripts and screenshot evidence are outside the repository. Representative clean-flow captures show Story comparisons, human judgment followed by PM handoff, and the reviewed final output. No paid provider runs, external integration, real-device browser, or screen-reader speech-output checks were performed.
