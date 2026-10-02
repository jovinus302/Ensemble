# MD2 local browser QA — 2026-10-01

> Historical QA snapshot (2026-10-01). The results, failure counts, environment blockers and pending work below describe that run, not the current main merge status. For the later, separately scoped eight-cell benchmark merged in [PR #53](https://github.com/jovinus302/Ensemble/pull/53), see the [v4 results](../../../app/packages/benchmark/evidence/paired-validation-v4/README.md). Those results do not retroactively pass this snapshot's blocked checks or replace its evidence. Current documentation was reconciled against `main@c91234a` on 2026-10-02.

Follow-up: [completed Claude delivery and obsolete-judgement fixes, validation, and commit-pinned evidence are recorded in issue #46](https://github.com/jovinus302/Ensemble/issues/46). [Remaining provider response/queue latency is tracked separately in open issue #47](https://github.com/jovinus302/Ensemble/issues/47). The full-log maximum queue wait is 511.111 seconds; earlier values below describe individual observations.

Baseline: `726c54e` (PR #36). Narrow fix: `5e72839`; integrated with main through `776e374` (PR #38) at `31ca433`.

Execution used an independent Git worktree, dedicated localhost ports/data/worker directories, and Playwright Chromium clicks, typing, uploads, downloads and screenshots on Windows. Orca's worktrees/processes and the benchmark workspace were not modified. PM and workers used the selected login-backed Codex or Claude runtimes; the separately labelled fake run is not evidence of real-provider success.

## Finding fixed by this PR

After all tasks completed, a designer requested a separate contact page. Claude repeatedly produced `create_task` with `parentId: prototype`: the schema required an existing parent even for independent work. Both attempts failed validation with `Task prototype is checked; only waiting or ready work can be split`, so the owner received no decision card. A read-only replay of the captured QA ledger reproduced the exact validation failure without modifying the live project or running workers.

Make `parentId` optional and explain when it is appropriate. Preserve all existing split/authority validation. A deterministic regression starts with all existing tasks checked, checks the emitted schema, exercises both ordinary and Codex strict/null representations, and verifies that a non-decider's independent request creates an owner decision. No fake/API fallback was added.

## Actual browser results

| Path | Codex | Claude |
|---|---|---|
| Free goal → plan → double approval → real worker | Passed | Passed |
| Research parent + two child tasks, owner/status display | Passed | Passed |
| Actual worker question → unauthorized answer rejected → owner double answer | 403 / one accepted UI POST | 403 / one accepted UI POST |
| Human upload → review/revision → designer handoff → automatic prototype start | Passed | Passed |
| Message A, correction B, unsent draft C | Exactly two messages; draft retained | Exactly two messages; draft retained |
| Counter downloaded and opened, +1 twice, reset, excluded -1 absent | 0 → 2 → 0 | 0 → 2 → 0 |
| Prepared scenes 1→3, real research and prototype | All four tasks checked | All four tasks checked |
| Prepared final HTML downloaded and clicked | Signup → missing-time error → confirmation → completion; no payment button | Same |
| Work hierarchy, team tab, 390px mobile | Two nested children; no horizontal overflow | Same |
| Browser offline/SSE reconnect | Disconnect visible, then recovered | Same |
| Independent work after schema fix: reject / edited approve | One POST each; rejected work absent; edited high-priority work created | Same |

Completed text alone was not treated as artifact validation. Final HTML was downloaded through the UI and opened as a local file; screenshots and action logs show interactive behavior.

The Codex task comment was recorded, sent to the active worker, and explicitly acknowledged with both requested changes. The Claude comment was recorded, but that sample does **not** prove delivery to an active Claude worker.

## Known overlapping fixes and boundaries

Baseline reproduced a text-answer card's recommended button returning 400 and an already-open detail drawer retaining `waiting_human` after its task resumed. Plan cards also flattened the task hierarchy. These are owned by Orca's web follow-up and are not silently claimed fixed by this schema PR.

PR #38 removed the coordination/sweep import cycle, fixed digest categorization and fake handoff/scoping. Before it, the fake prepared run stalled at scene 1 on a handoff citation validation failure. After integrating it, the same UI-driven fake scenes completed all four tasks at 16:11:50 UTC. This result is labelled fake throughout.

PR #28's prior cancellation/timeout/project-replacement/old-worker-isolation evidence is in [the earlier QA report](../local-dual-provider-2026-10-01/README.md). Those prior results are not presented as newly executed MD2 tests.

## Timing observations (not a new benchmark)

| Observation | Codex | Claude |
|---|---:|---:|
| Initial Start click completion | 96 ms | 94 ms |
| Start click to visible plan | 32.991 s | 19.778 s |
| B/draft C to checked revised counter | 482.190 s | 109.971 s |

Click completion is a browser interaction measurement, not model latency or HTTP acceptance. The free-start endpoint returns 200 with the plan; response and plan visibility timestamps are recorded separately. This sample did not retain enough start timestamps to calculate independent HTTP acceptance latency accurately.

Codex's long revised-counter path included a genuine **240.045 s model timeout** and **307.536 s PM queue wait**, followed by bounded recovery, plan v2, a revised worker result and a functioning final artifact. Other completed calls report model first-response and completion separately in local server logs. These are concurrent QA observations, not equivalent-input before/after performance measurements; no latency improvement is claimed from this PR.

## Verification

- Targeted coordination-work suite: 13 passed.
- Integrated code `31ca433`: 73 test files, **640 tests passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- GitHub at inspection: no required status checks/reviews configured; main protection endpoint reports unprotected, rulesets empty. This is configuration evidence, not a claim that remote CI ran.

The final integration results below supersede the web-follow-up pending status.

Evidence: [Codex counter](codex-counter-complete.png), [Claude counter](claude-counter-complete.png), [Codex reservation completion](codex-scenario-artifact-complete.png), [Claude reservation completion](claude-scenario-artifact-complete.png), [Codex mobile hierarchy](codex-work-mobile.png), [Claude mobile hierarchy](claude-work-mobile.png), [captured validation failure](claude-create-diagnostic.json), [test result](fixed-tests.txt). The neighbouring JSON files contain browser action observations and card POST counts.

## Final integration: PR #40 + PR #39

PR #40 merged at 16:15:53 UTC (`6c1e6f9`), and PR #39 merged at 16:20:09 UTC (`b05b684`). The final merge therefore also contained Orca's UI changes; the earlier 640-test result alone was not treated as final-main validation. Rebuilt `b05b684`: **651 tests / 73 files**, typecheck and production build passed.

Fresh, separately isolated actual Codex and Claude projects then both passed:

- Plan approval card renders two nested children.
- A real worker question has no invalid recommended-approve action; empty answer is disabled and another member receives 403.
- Double answer produces one POST; a second browser tab's open drawer updates from waiting for a decision to in progress without closing/reopening.
- Task comment is recorded and routed. Codex delivers through steering; Claude records `next_turn` because its live CLI turn cannot accept steering.
- With a real worker still running: project replacement Escape and Cancel preserve the project; double archive/start and double Next produce one POST each. New project IDs differ and no old-worker messages/attachments appear after the switch.
- Existing real artifacts are downloaded and clicked again from the final UI; desktop/mobile hierarchy and SSE disconnect/reconnect pass again without additional model inputs.

See `codex-final-ui.json`, `claude-final-ui.json`, the final screenshots, and comment-delivery ledgers. The switch observations (8.235 s Codex, 5.241 s Claude) include an intentional 4-second post-switch observation and the Next click; they are **not** pure cancellation latency.

The Codex final ordinary approval also passed with exactly one POST and one added task, after its original queued request recovered. That request had two model timeouts, 240.032 s and 240.042 s, first responses at 6.084 s and 7.284 s, and a later maximum queue wait of **442.489 s**. No new input was submitted to obtain the recovered card. Long model/queue latency remains an observed limitation.

The final cancellation test intentionally stopped Claude before its queued comment's next turn, so real Claude acknowledgement was not observed. A new deterministic regression reproduces the captured `sendUpdate: false` behavior, finishes the current turn, and verifies one next-turn delivery and no duplicate on another pending-delivery pass. It is explicitly a mocked connector regression, not a claim of an additional real-model run.

The final evidence follow-up changes only tests/documentation; production code remains the rebuilt `b05b684` version. GitHub has no configured required checks/reviews; local check logs are supplied rather than claiming remote CI ran.

After adding the queued-comment regression: **652 tests / 73 files passed**, final typecheck passed. The production build result is unchanged because the follow-up only changes a test and QA evidence.
