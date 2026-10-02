# Fixed-demo scope and schedule coordination

Base: `5216ec5bb823c87fcae2611a42e2a9d6768b57f9`. This change affects only the disclosed fixed demo, its existing two regression cases, and documentation.

## Reproduced before editing

An isolated production build of the base was tested through actual Chromium input. Both requests below changed `agreement → executing → delivered`, despite carrying an unresolved scope or schedule change:

- `이 방향으로 화면 만들어 주세요. 결제 기능도 추가해 주세요.`
- `이 기준으로 화면 만들어 주는 건 다음 주에 하죠.`

The reducer reproduction independently confirmed the same premature authorization. During review, the analogous mixed-scope D2 request also reproduced premature revision: `fiction 안내를 추가하고 노래는 빼주세요. 결제 기능도 추가해주세요.`

## Resulting behavior

Execution authorization checks the complete supported utterance rather than searching for approval-like substrings. Payment additions enter a pending coordination branch: PM asks UI/Story for a clearly scripted dependency checklist, then the human explicitly chooses existing-preview-only with payment retained separately, or holds the preview for scope review. No duration or effort estimate is invented.

Next-week requests pause screen execution. Preparing the existing criteria is separate from explicitly changing the plan to preview now. The screen labels next week as a requested time; no calendar event, reminder, or automatic future execution is created.

Unknown, negative, conditional, and combined requests retain the original text and ask for clarification without inventing impact. New constraints invalidate older pending choices. The result-revision gate also holds mixed instructions without changing the existing artifact. Pending records survive explicit deferral; reset/back and request/run bindings prevent stale choices or callbacks from executing.

PM remains the coordinator: humans own scope and timing, Story/UI own their respective work, and the concise card and graph expose the unresolved owner and wait reason. The existing messenger viewpoint and normal fixed flow are preserved.

## Validation

- `npm test`: 8/8, extending the two existing demo cases without adding suites or dependencies.
- `npm run typecheck` and `npm run build`: pass; the same three existing filesystem tracing warnings remain.
- Actual browser checks cover both original failures, supported paraphrases, negative/conditional/unknown/mixed scope, incomplete or superseded choices, repeated clarification, explicit payment deferral, preparation-only scheduling, pending reset/back, stale timers, and the normal complete flow.
- 1440px desktop and 390/320px mobile checks: no horizontal overflow; pending text remains accessible through disclosure; reduced motion respected.
- Focused review of bounded authorization, role attribution, pending-state retention, and representative screenshots.
- No demo API calls or browser errors.

This is intentionally not general natural-language understanding. Detailed coordination examples are limited to payment addition and next-week deferral at the first-preview gate. Other unresolved combinations are retained for clarification; the fixed presentation can return to the previous step to separate them. No paid providers, live integrations, real calendar scheduling, real-device browser, or screen-reader speech-output checks were performed. Browser runners and screenshot evidence remain outside the repository.
