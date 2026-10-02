# Local dual-provider browser QA — 2026-10-01

> Historical QA snapshot (2026-10-01). The results, failure counts, environment blockers and pending work below describe that run, not the current main merge status. For the later, separately scoped eight-cell benchmark merged in [PR #53](https://github.com/jovinus302/Ensemble/pull/53), see the [v4 results](../../../app/packages/benchmark/evidence/paired-validation-v4/README.md). Those results do not retroactively pass this snapshot's blocked checks or replace its evidence. Current documentation was reconciled against `main@c91234a` on 2026-10-02.

PR: https://github.com/jovinus302/Ensemble/pull/28

## Isolation and real providers

A dedicated branch/worktree backed by a separately cloned bare repository was used. No Orca working tree, index, branch or server was modified. Production Next servers used ports 3417/3418 and recovery servers 3427/3428, with separate data and worker directories outside the repository. Chromium was driven through Playwright clicks, keyboard input, uploads and downloads. No mock UI or API/provider fallback was used. Read-only state requests supplemented browser evidence.

The designated Codex account was verified through app-server account/read; the existing Claude account was explicitly approved before Claude execution. PM and worker runtime were both set to the provider under test. No credentials were copied or committed.

## Completed browser checks

| Path | Codex | Claude | Evidence |
| --- | --- | --- | --- |
| Prepared scenario, human submissions, approval, actual workers, payment scope removal | passed | passed | artifact-open/complete screenshots and generated interview-loop HTML |
| Open actual reservation artifact: invalid email, preserved name, missing time, select time, reservation confirmation; no payment button | passed | passed | artifact-complete.png |
| Free goal → PM plan → double approval → human uploads → actual counter worker | passed | passed | free-start.json, free-draft-C.png |
| Send A with duplicate Enter, correct with B, retain unsent C while working | passed | passed | free-flow.json and free-draft-C.png |
| Final requested counter: +1 twice gives 2, reset gives 0, no -1 control | passed | passed | counter-check.json, counter-complete.png, counter.html |
| Real worker timeout, visible stopped state, UI retry with note, real result checked | passed | passed | recovery-fail/retry.json and screenshots |
| Escape and Cancel preserve project; confirmed archive/start cancels running worker | passed | passed | final-regression.json |
| Double start / double Next produce exactly one request each; old worker results stay isolated | passed | passed | final-regression.json |
| Offline banner then SSE reconnection | passed | passed | final-regression.json |

The Codex free-result review initially rejected a valid +1 code citation. The narrow citation fix was tested against unrelated IDs and data-id attributes, then the same submitted artifact was rechecked through the UI and accepted in 18.309 seconds. Artifact acceptance was verified independently by opening the downloaded HTML and using its controls. A script-end label alone was never treated as artifact completion.

The first integrated browser regression ran on 6a42b91 (main through PR33). The full prepared scenario was then repeated on that production build for both providers, including fresh research, human revisions, workers and scope changes. All four tasks reached checked for each provider; both fresh HTML artifacts passed independent browser flows (repeat-* evidence). PR34 was subsequently merged as 314b739 and the live task visibility fix as 26658c0; final validation status is recorded below. The original full free flows ran before that upstream integration; they were not silently relabelled as fresh runs.

## Fixes

- Codex PM uses authenticated app-server with strict response schema, timeout and cancellation.
- Guard synchronous double clicks/Enter and preserve newer drafts during prior-send completion.
- Show disconnection and recover SSE; prevent stale state replacement.
- Derive elapsed activity from the matching PM/worker/waiting activity.
- Cancel Claude and CLI model children when requests abort or projects close.
- Ignore commentary-only worker events when deciding whether a PM interpretation/judgment transaction must be repeated; real planning changes still invalidate it.
- Ground code citations in exact labelled HTML controls, without accepting unrelated IDs or data-id attributes.
- Preserve real task visibility and task recovery controls while the new work projection is absent from the live API. Keep the new panel for servers that provide it.
- Display sub-minute worker timeouts in seconds instead of 0 minutes.

## Timing, not interchangeable phases

Controlled comparison used identical coordination input, fixed state/clock and one worker-progress event during the first model call, with the real Codex PM in both runs. This isolated decision test did not create a worker artifact and is not represented as browser end-to-end timing.

| Phase | Before | After |
| --- | ---: | ---: |
| Coordination total | 63.940 s | 29.690 s |
| Model calls | 4 | 2 |
| First interpretation response | 6.021 s | 5.854 s |
| First interpretation complete | 16.710 s | 13.379 s |
| First judgment complete | 15.848 s | 16.305 s |

Both runs committed the same requested +1/reset scope and excluded -1. This single paired sample is 53.6% shorter, driven by removing duplicated interpretation/judgment; it is not a general latency guarantee. Detailed model timings are in controlled-pm-comparison.json.

Browser free-start HTTP responses include synchronous plan generation: Codex 27.101 s and Claude 14.688 s, with plan visible at approximately 27.436 s and 15.198 s respectively. These are not immediate HTTP acceptance times or a provider benchmark. In a scripted asynchronous Codex path, HTTP acceptance was 70 ms and the browser click completed in 82 ms, first PM response 9.187 s and completion 41.750 s; PM queue wait was 0 ms. The CLI JSON-mode Claude first-token time is not observable and is not invented.

Latest project switch including running-worker cancellation on final code 26658c0: Codex 113 ms, Claude 99 ms. Final regression JSON records request counts, project IDs and isolation assertions.

## Validation and boundaries

- Latest unit/integration suite: 623 tests in 70 files passed on code commit 26658c0 (PR34 integration plus live task visibility fix).
- Typecheck passed on code commit 26658c0.
- Production build passed on 26658c0. Existing Turbopack dynamic filesystem tracing warnings remain; no build failure. Final desktop/mobile task visibility, actual counter artifact flows, real PM/worker startup/cancellation, Escape/Cancel, project isolation, double start/Next and offline/SSE reconnection passed for both providers on this build.
- Repository main has no branch protection or rulesets requiring CI/reviews; PR status checks were empty at inspection. Local validation is not represented as remote CI.
- Generated files use fictional demo inputs; no deployment, real payment, external write or new persistent authorization was performed.
- Screenshots and JSON intentionally preserve actual outcomes, including the earlier timeout wording and genuine failure before its correction.

The additional Codex prepared-scenario run observed one genuine initial-plan timeout at 240.031 s (first response 6.384 s). Process cleanup and the existing bounded retry recovered successfully; no replacement provider was used. This provider latency outlier is retained rather than hidden by the paired performance sample.

Artifact SHA-256 values are recorded in evidence/artifact-hashes.json. Provider session provenance contains only this QA run’s session/start identifiers and redacted workspace references.
