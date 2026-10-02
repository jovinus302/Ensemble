# QA guide and historical archives

Run the following from `app/` with existing dependencies (Node 24+). These provider-free commands check types and build the web app; they do not run automated tests.

```sh
npm run typecheck
npm run build
```

Automated test suites, dedicated browser/smoke runners, and the standalone benchmark execution package have been removed from this checkout. Historical results below are preserved as observations of their recorded revisions, not current coverage. The removed source remains recoverable through Git at the [pre-removal snapshot](https://github.com/jovinus302/Ensemble/tree/64373b8f9dbf2cbc27c77c220ed46f809822b3e2). Restoring historical code does not authorize provider calls.

Write new QA screenshots, reports, logs and generated artifacts beneath an ignored `.local/` directory, never into these historical folders. Check `git check-ignore` for the intended destination before collecting output. Preserve failures and distinguish fixture, offline re-evaluation and authorized live observations.

The ignore rules cover generated output. Review any curated evidence file and its references before publication; do not publish credentials or unrelated provider logs.

## Historical reproduction scripts

The former Codex-login browser scripts and issue-47 harness are no longer shipped. Their original versions remain in the [historical QA archive](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa). They can send real messages, approve work, and start workers, so they were never provider-free current-main checks. Existing archive documents and generated HTML/Markdown evidence are retained; they are not executable test fixtures.

## Archived batches (2026-10-01)

These fixed-commit links preserve original documents and generated evidence removed from the current checkout. Historical failures are retained, not converted into passes. Later benchmark results do not validate unrelated QA flows.

| Batch | Recorded outcome and limits | Immutable archive |
|---|---|---|
| codex-login-2026-10-01 | 508 tests; PM worked; nested cloud worker sandbox blocked final artifact completion. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/codex-login-2026-10-01) |
| local-dual-provider-2026-10-01 | 623 tests; both providers completed browser/artifact flows; genuine timeout and recovery retained. Single isolated PM timing sample is not general performance evidence. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/local-dual-provider-2026-10-01) |
| md2-dual-provider-2026-10-01 | Original failure and later delivery fixes retained; issues #46/#47 subsequently closed. External provider latency is not guaranteed. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/md2-dual-provider-2026-10-01) |
| issue-47-2026-10-01 | 689 tests plus both-provider browser evidence; app preemption/cancellation improved. External completion latency and required FIFO waits remain limitations. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/issue-47-2026-10-01) |

Issues [#46](https://github.com/jovinus302/Ensemble/issues/46) and [#47](https://github.com/jovinus302/Ensemble/issues/47) retain additional commit-pinned evidence links; PR #49 links its final results and browser screenshots. The [benchmark archive index](../../app/packages/benchmark/evidence/README.md) separately records the original pilot, validation-only run and v4 paired experiment. The [v4 benchmark](../../app/packages/benchmark/evidence/paired-validation-v4/README.md), merged in PR #53, remains n=1 with unknown complete cost and unchanged frozen baseline; its generated evidence is also preserved at the immutable commit.
