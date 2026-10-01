# Remaining QA items — closed with focused fixes

Baseline `129731406a3c1b312a8edf4fc64491e3e08230fd`; fixed production code `d6b88a325147ed495cea063e0224337cf97c7473`; final test-context correction `f609f06e56fd353b53d6bea43990c50733a5185f`. Work stayed in the independent QA worktree. Orca's active QA worktrees had no tracked changes to these files, and no overlapping remote PR was open. No credentials, benchmark workspace, timeout values, or judgement criteria changed.

## 1. Actual Claude next-turn comment

The baseline run did not cancel the worker. A unique nonsecret marker was submitted through the task-detail comment UI while the real Claude worker was running. The application recorded `change_notified(via=next_turn)` but then accepted the old result, checked `research-1`, and started its dependent task. The comment had **zero update_sent / zero update_acknowledged** on the original task. A later PM-created different task contained the marker; that was explicitly rejected as evidence of delivery to the original task. See [baseline ledger](claude-comment-before-ledger.json).

Cause: the session runner queues unsupported live steering, but recording the old `result_report` moves the task to `submitted`, so end-of-turn delivery can no longer continue that task. Withhold that superseded turn's result while it has undelivered changes, leave the task running, and deliver the existing queued update at turn end. The next turn's result still undergoes normal schema/path/file validation and PM handoff review. Late duplicates of the superseded result stay ignored. The CLI fixture reproduces the baseline failure before this fix and passes afterwards, including duplicate delivery/result checks and the existing timeout/cancellation tests.

**Actual fixed run passed**, with no cancellation, API fallback, or fake provider:

| UTC | Ledger evidence |
|---|---|
| 16:52:03.309 | UI comment recorded on `research-1` |
| 16:52:03.314 | Comment queued for the next turn |
| 16:53:17.850 | Old result withheld because its update is still pending |
| 16:53:18.625 | Exactly one `update_sent`, new turn `7741ba2d-e35c-431d-8dbb-f1fdfe573840` |
| 16:53:25.059 | Exactly one worker `update_acknowledged`, no dropped changes |
| 16:53:36.330 | Original `research-1` artifact `input-method-comparison.md` contains the marker once |
| 16:53:45.478 | Normal PM review checks the original task |

Marker: `QA-COMMENT-20261001-F8D3`. The artifact was opened by an actual browser click in a new tab and inspected, not accepted from a completion message. [Ledger](claude-comment-after-ledger.json), [browser observations](claude-comment-fixed-ui.json), [screenshot](claude-comment-fixed-artifact.png), [actual Markdown](claude-comment-fixed-marker.md).

## 2. Model wait, FIFO backlog, obsolete judgement and cancellation

Reaggregating the **already collected** Codex logs gives a maximum queue wait of **511.111 s**. The previously reported 442.489 s is a valid individual observation, not the full-log maximum. No new live latency benchmark was run.

The long PM operation took **517.539 s**. Its consecutive provider calls were 240.032 s timeout, 240.042 s timeout, 21.424 s interpretation and 16.004 s judgement: **517.502 s combined**, only 37 ms short of the entire operation. Provider first responses were observed after 6.084 s and 7.284 s in the timeout calls. This isolates the dominant delay to provider completion waiting, bounded retries and the resulting serialized queue backlog, rather than CPU-heavy queue bookkeeping. The logs do not separate remote network delay from model computation. Relevant projected state changed while waiting, so the bounded fresh-snapshot interpretation cannot safely be dropped just to report a faster result. [Captured metrics](queue-captured-metrics.json).

One avoidable app-side call was separately confirmed: when the same author corrected a message during interpretation, the previous message still consumed an entire judgement call before supersession was checked. Check supersession immediately after interpretation while retaining the final transactional check. Deterministic delayed-input tests fail before and pass after: the superseded path makes **one call instead of two**; another author's message still permits both calls. No wall-clock model speedup is inferred from this call-count test.

A real WebRuntime/ProjectManager test holds the provider promise unresolved. Both initial and correction messages are durably accepted while that promise remains pending. Confirmed project replacement closes the provider first, then drains/stops the old PM/worker, with no old messages in the new project. Thus explicit replacement cancellation does not wait for the configured model timeout. This does not claim that a natural-language cancellation instruction bypasses PM interpretation or that all queued semantic work can safely run concurrently. [Cancellation test](queue-cancel.txt), [failing obsolete-call test](queue-before.txt), [passing test](queue-after.txt).

## Final validation and limits

- 74 files / **656 tests passed**; final typecheck passed; production build passed.
- Actual Claude marker delivery, acknowledgement and original-task artifact: passed.
- Deferred-result/late-duplicate/timeout and delayed-message/cancellation regressions: passed.
- Tests/documentation after `d6b88a3` do not change the live-verified production code.
- External provider completion latency remains variable; the 240-second samples are not claimed fixed. Timeout limits and result/judgement requirements were not reduced. No broader concurrency redesign or new feature was added.
- GitHub required CI/reviews/rulesets are unconfigured; local logs are supplied rather than claiming a remote CI run.
