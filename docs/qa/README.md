# QA guide and historical archives

Run the following from `app/` with existing dependencies (Node 24+). These are provider-free unit/type/build checks. The cleanup PR records its fresh verification separately from historical test counts below.

```sh
npm test
npm run typecheck
npm run build
npm run benchmark:preflight
npm run benchmark:schema-repro
```

For provider-free real-browser controls, use `npm run benchmark:browser` with an existing Playwright/Chromium installation; set `BENCH_PLAYWRIGHT` to its module path if necessary and `BENCH_APP_ROOT` to the absolute `app/` directory. The [benchmark guide](../../app/packages/benchmark/README.md) contains full fixture/snapshot commands and limitations. Handwritten fixtures are [reference.jsx](../../app/packages/benchmark/fixtures/reference.jsx) and [oracle-variants.mjs](../../app/packages/benchmark/fixtures/oracle-variants.mjs); the [starter](../../app/packages/benchmark/starter/) is intentionally incomplete. Fixture success is not model performance evidence.

Write new QA screenshots, reports, logs and generated artifacts beneath an ignored `.local/` directory, never into these historical folders. Check `git check-ignore` for the intended destination before collecting output. Preserve failures and distinguish fixture, offline re-evaluation and authorized live observations.

The ignore rules cover generated output, not the maintained fixtures and test runners. If a small new regression fixture or curated evidence file needs publication, review its contents and references first, then explicitly stage that exact file with `git add -f <path>` when necessary. Link bulk execution evidence from an approved immutable commit instead of duplicating it. Do not publish credentials or unrelated provider logs.

## Retained historical reproduction scripts

The ten scripts in [codex-login/browser](codex-login-2026-10-01/browser/) and [issue-47 browser harness](issue-47-2026-10-01/browser-harness.cjs) are preserved byte-for-byte. They are historical browser procedures, **not provider-free tests or turnkey current-main commands**. They can send real messages, approve work and start workers through an already running app; running them requires separate live authorization and suitable existing authentication.

The Codex scripts expect Playwright, `/usr/bin/chromium`, port 3000 and `/workspace/ensemble-qa` output paths. The issue-47 harness expects a sibling Playwright installation, ports 3527/3528, captured server logs and `qa-runtime/issue47-final` output folders. Prepare an isolated copy, adapt paths/ports/output to `.local/`, and verify selectors and state against the intended historical revision. Do not copy credentials, weaken sandbox settings or treat these old prerequisites as new permission. The archive contains generated HTML/Markdown artifacts, not automatically imported test fixtures.

## Archived batches (2026-10-01)

These fixed-commit links preserve original documents and generated evidence removed from the current checkout. Historical failures are retained, not converted into passes. Later benchmark results do not validate unrelated QA flows.

| Batch | Recorded outcome and limits | Immutable archive |
|---|---|---|
| codex-login-2026-10-01 | 508 tests; PM worked; nested cloud worker sandbox blocked final artifact completion. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/codex-login-2026-10-01) |
| local-dual-provider-2026-10-01 | 623 tests; both providers completed browser/artifact flows; genuine timeout and recovery retained. Single isolated PM timing sample is not general performance evidence. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/local-dual-provider-2026-10-01) |
| md2-dual-provider-2026-10-01 | Original failure and later delivery fixes retained; issues #46/#47 subsequently closed. External provider latency is not guaranteed. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/md2-dual-provider-2026-10-01) |
| issue-47-2026-10-01 | 689 tests plus both-provider browser evidence; app preemption/cancellation improved. External completion latency and required FIFO waits remain limitations. | [Full directory](https://github.com/jovinus302/Ensemble/tree/cb84ecc2849f8194e0d5d44d22642a5174ef4c4f/docs/qa/issue-47-2026-10-01) |

Issues [#46](https://github.com/jovinus302/Ensemble/issues/46) and [#47](https://github.com/jovinus302/Ensemble/issues/47) retain additional commit-pinned evidence links; PR #49 links its final results and browser screenshots. The [benchmark archive index](../../app/packages/benchmark/evidence/README.md) separately records the original pilot, validation-only run and v4 paired experiment. The [v4 benchmark](../../app/packages/benchmark/evidence/paired-validation-v4/README.md), merged in PR #53, remains n=1 with unknown complete cost and unchanged frozen baseline; its generated evidence is also preserved at the immutable commit.
