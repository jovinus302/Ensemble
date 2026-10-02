# Paired validation v4: new eight-cell batch

## Final results: eight completed cells

**All eight new v4 cells completed and passed their final browser checks:** 10/10 for each A cell and 13/13 for each B cell. The eight newly approved slots are consumed, **zero remain**, and no additional attempt, rerun or model substitution is authorized. [batch-completion.json](batch-completion.json) records verification of the eight atomic claims/receipts against the raw-report hashes. These observations remain separate from the eight earlier consumed slots.

Primary measurements are in [results.json](results.json), with independently reviewed arithmetic and role-level calls in [comparison.json](comparison.json). Report versions are retained by raw-report SHA-256 under `reports/`; failures and provisional teardown-time writes must not be discarded. The final collector view has eight reports and no missing report. File existence alone was not used to infer completion.

| Cell | Task / condition | Status | Total elapsed (s) | Top-level attempts | Final browser checks |
|---|---|---|---:|---:|---:|
| v4-01 | A / Ensemble + Codex | Passed | 282.223 | 4 | 10/10 |
| v4-02 | A / Direct Codex | Passed | 210.974 | 1 | 10/10 |
| v4-03 | A / Direct Claude | Passed | 247.013 | 1 | 10/10 |
| v4-04 | A / Ensemble + Claude | Passed | 341.269 | 4 | 10/10 |
| v4-05 | B / Ensemble + Claude | Passed; binding audit below | 952.191 | 8 | 13/13 |
| v4-06 | B / Direct Claude | Passed | 558.913 | 2 | 13/13 |
| v4-07 | B / Direct Codex | Passed; worker limitation below | 256.737 | 2 | 13/13 |
| v4-08 | B / Ensemble + Codex | Passed | 322.126 | 8 | 13/13 |

Ensemble had longer total elapsed time in **all four observed pairs**, while both arms passed the same functional checks. This is n=1 per condition/task, not statistical superiority evidence or a subjective design-quality assessment. Do not interpret differences between Codex and Claude, or between tasks A and B, as an Ensemble effect. Cache state remains unknown and shared machine/provider load is not controlled.

| Within-provider pair | Ensemble (s) | Direct (s) | Elapsed difference E − D (s) | E relative to D |
|---|---:|---:|---:|---:|
| Codex / A | 282.223 | 210.974 | +71.249 | +33.8% |
| Claude / A | 341.269 | 247.013 | +94.256 | +38.2% |
| Claude / B | 952.191 | 558.913 | +393.278 | +70.4% |
| Codex / B | 322.126 | 256.737 | +65.389 | +25.5% |

For each A pair, Ensemble made 2 PM + 1 worker + 1 judge top-level attempts versus 1 direct worker attempt. For each B pair, Ensemble made 4 PM + 2 worker + 2 judge attempts versus 2 direct worker attempts. These are request/turn attempts, not hidden API-call counts. No additional in-task human intervention or request was recorded; standardized B changes and between-cell supervision are excluded from that metric.

## Preregistered scope and historical separation

This batch is separate from the invalid legacy pilot, the corrected Codex A pair, and the single v3 validation observation. Those eight earlier slots remain consumed and their data/verdicts remain unchanged. The user explicitly approved eight new slots after being told that history (Sentinel_44444b08f3fc8191bf1bf2dc740c6247). Each cell is attempted once; no automatic rerun or model substitution.

Production baseline: `main@7cd8de808caf046e0bcc3894a27054dca133d987` (merged PR #52). Benchmark-only preflight corrections and final adapter/evaluator hashes are frozen before launch. No production dependency changes are planned.

[preregistration.json](preregistration.json) records the frozen model configuration, source/evaluator/implementation hashes, approval scope, stop policy and original execution order. Its implementation commit is `74f8abcfe81fb3493cedb8162509f26b8d86e49d`. Earlier observations and offline retests remain separate evidence; none is substituted into this table.

| Order | Task | Condition | Model | Effort |
|---|---|---|---|---|
| 1 | A | Ensemble + Codex | gpt-6-astra | low |
| 2 | A | Direct Codex | gpt-6-astra | low |
| 3 | A | Direct Claude | claude-opus-4-8 | xhigh |
| 4 | A | Ensemble + Claude | claude-opus-4-8 | xhigh |
| 5 | B | Ensemble + Claude | claude-opus-4-8 | xhigh |
| 6 | B | Direct Claude | claude-opus-4-8 | xhigh |
| 7 | B | Direct Codex | gpt-6-astra | low |
| 8 | B | Ensemble + Codex | gpt-6-astra | low |

Within each provider pair, model, effort, source starter, task requirements and native worker tools/settings match. Ensemble includes PM/worker/judge orchestration, current-revision trusted build/browser validation and limitations preservation. The direct arm uses the neutral development instructions without Ensemble reporting protocol. Task B uses the same incomplete starter, independently validated actual-controls/build checkpoint, then the same maximum-8/after-18:00/invalidation-reason/edit-after-confirmation change. Initial/checkpoint/change/post-change and total elapsed times are retained separately.

Each cell has a 20-minute total deadline and 24 top-level CLI request/turn attempts including PM/worker/judge. Hidden API requests and dollar cost remain unknown. Existing ChatGPT and Claude Max authentication are reused; no API keys, new billing, permission or authentication changes. Codex CLI 0.159.2, Claude Code 2.1.287. Codex multi-agent/web-search/node-repl are disabled; Claude Agent/Task/WebSearch/WebFetch are disallowed with existing acceptEdits settings. Both providers receive the same restrictions in direct and Ensemble workers. The trusted browser blocks external HTTP/WebSocket and service workers.

Acceptance remains semantic date/time/party functionality, fixed error fixtures, confirmation/persistence, 390/1440px layout and console; B adds maximum/early-time invalidation with explanation and edit/save/reload. A does not require functional edit. Fixture positives and negative controls are provider-free and never performance observations. Any identified harness/orchestration design defect stops the remaining batch; corrections require a distinct version rather than pooling mixed criteria.

Results are n=1 exploratory within-provider comparisons, not statistical superiority evidence. Failures, timeouts, unavailable models and interruptions remain observations. No extra slots beyond these eight are authorized. The result PR will remain a draft; PR #51 is outside this scope.

## Timing and usage interpretation

`totalMs` includes preparation, PM/worker/judge work, host validation and cleanup. `taskMs` is total elapsed minus preparation. Evidence serialization/copy after measured termination is not task execution. Do not sum overlapping role durations into total wall time.

For B, `initialMs` is the original `checkpointMs`: elapsed time from the run's start, including preparation. `initialImplementationMs` subtracts `preparationMs`. `afterChangeMs` includes work, final validation and cleanup after change injection. Preserve both initial and post-change measurements alongside the full total.

| Reported B cell | Preparation (s) | Initial elapsed through checkpoint (s) | Initial excluding preparation (s) | After change (s) | Total (s) |
|---|---:|---:|---:|---:|---:|
| v4-05 | 0.011 | 267.365 | 267.354 | 684.826 | 952.191 |
| v4-06 | 0.012 | 155.630 | 155.618 | 403.283 | 558.913 |
| v4-07 | 0.011 | 94.145 | 94.134 | 162.592 | 256.737 |
| v4-08 | 0.011 | 131.836 | 131.825 | 190.290 | 322.126 |

Worker entries in `calls` measure **submission latency**, not the entire worker turn. Use `fullWorkerDurations` for recorded worker wall time. Top-level attempts include PM/worker/judge attempts and are not a count of all hidden API calls. Complete `usage`, `underlyingApiCalls`, `actualModelInvocations` and `costUsd` remain unknown where the primary reports say null.

The separately scoped `supplemental-usage-v4-*.json` files contain additional session-log observations collected by the coordinator. Keep their source hashes, coverage limits and deduplication rules attached. They do not replace primary null fields or establish complete billing. Cache categories may be subsets of total input, and reasoning tokens may be a subset of output; do not add those subsets again. No inferred dollar prices are reported.

[usage-method.json](usage-method.json) records the external usage helper's hash, extraction/deduplication rules, nine synthetic scope checks and the corrected v4-04 attribution. That helper and private provider logs are not packaged, so this is audit metadata rather than self-contained usage reproduction. [comparison.json](comparison.json) separates worker counters from successful PM/judge response usage and labels their sum as observed, not billing-complete, tokens.

## v4-05 binding audit: metadata limitation, no observed stale reuse

[binding-audit-v4-05.json](binding-audit-v4-05.json) is an **offline audit with zero model calls**, not another live attempt. The batch was briefly held because initial and final `contextDigest` values were equal despite the requirement change. The digest covers goal/plan/decisions; a same-plan reopen does not separately encode the new request text. `policyFingerprint` also does not separately label the dynamic phase. These are audit-metadata limitations that could be hardened in a later version.

The audit found distinct result IDs and artifact digests, with trusted validation at ledger sequences **21 and 44**. The authoritative change was recorded at sequence 26, followed by revision request 28, update delivery 30 and acknowledgement 34. A new submission cleared prior validation; the host cache included checkpoint phase; and final inspection required final-phase evidence. The final judge received the reopen request and evaluated the changed requirements.

The final submitted revision passed **build plus all 13 B browser checks** (14 host checks), including 7–8-person timing restrictions, invalid-time clearing with explanation, and edit/save/reload. Thus the recorded audit found **no observed stale evidence reuse or reachable false pass in this registered phase/order**. The valid v4-05 observation is retained. This finding does not establish that equal digests are universally safe. Runtime, criteria and model settings were not changed during the hold.

## Evidence layout and reproduction limits

In v4-07, the Direct Codex worker explicitly reported that its local build attempt was blocked by esbuild `spawn EPERM`, and that successful build/browser checks remained unverified by the worker. Those statements are preserved in `directReplies` and the sanitized report/ledger versions. The independent host subsequently built the artifact and passed all 13 final B browser checks. The worker's environment limitation is therefore retained as a limitation of its own verification, not reclassified as a failed host acceptance. The report records two worker attempts, no human intervention and no final run error.

- `results.json`: current curated report view, pending-report list, metric definitions and raw-report hashes.
- `reports/<cell>/<raw-report-hash>.json`: sanitized observed report versions, including failures; do not infer finalization merely from file existence.
- `ledgers/`: sanitized sequence and limitations. Native ledger order is preserved within its parent report event, without inventing a global wallclock order.
- `artifacts/`: exact captured source bytes and per-file hashes, including limitations/comments and exception text. Availability is not a successful-acceptance claim; mutable worker folders are not used as a fallback.
- `screenshots/`: scoped checkpoint/final or submitted-revision browser evidence with hashes.
- `preflight/`: provider-free code/browser/snapshot controls, separate from the live observations.

[preflight-redaction-provenance.json](preflight-redaction-provenance.json) links the original and published hashes of `preflight/snapshot/summary.json`. Publication replaced absolute path prefixes in 13 diagnostic summary/detail/snapshot-location fields and normalized JSON formatting; source artifact bytes and measured outcomes were unchanged. Diagnostic publication redaction is not a runtime or rubric change.

The original incremental collector is a workspace-level helper, `collect_v4_evidence.py`, outside the repository's frozen runtime hash. A portable standard-library-only Python 3.9+ adaptation is now supplied in [tools/collect_evidence.py](tools/collect_evidence.py). Both read this v4 batch's report JSON and explicitly scoped frozen artifacts/screenshots; neither launches models or scans provider logs. Report versions are preserved by hash and the current result view is written atomically. The portable tool is artifact tooling, not part of the measured runtime; its independent recollection did not replace the original published result view.

From this evidence directory:

```sh
python tools/collect_evidence.py --self-test
python tools/collect_evidence.py --run-root /path/to/raw/paired-validation-v4 --output /path/to/separate/curated-v4
```

If the raw bundle was relocated, add `--recorded-run-root` with its exact original raw directory path. This permits only `validation/<same-cell>/<sequence>-<64-character-hash>` snapshot roots to map beneath the explicit new raw root. Wrong-cell paths, traversal, unapproved original prefixes, and outputs overlapping raw input are rejected. No default live directory is created.

Exact recollection needs the scoped raw `reports/v4-*.json`, `blind/`, `validation/` and `evidence/<cell>/` files referenced by those reports. The public sanitized report copies cannot reproduce an original raw-report SHA-256 because embedded source contents and sensitive fields are intentionally redacted. Do not include global provider logs, credentials or approval files in a portable input bundle. Source artifacts are copied byte-for-byte, retaining exception text and comments; review those exact sources before sharing them. Supplemental usage files are separate inputs and are not inferred or regenerated by this collector.

Synthetic self-tests cover missing-root noncreation, failed-report version retention, source/screenshot hashes, secret-field redaction, relocated snapshot mapping, wrong-cell/traversal rejection and preservation of raw inputs. Collector reproduction and self-tests make zero model calls and do not authorize a live rerun.

After all eight cells completed, the portable CLI recollected them into a new `.local/v4-portable-check` directory. [portable-reproduction-check.json](portable-reproduction-check.json) records **eight matching raw-report hashes and primary metric records, 70 matching source-file copies, and 24 matching screenshot copies**, with zero model calls and no collector warnings. The file counts include copies across frozen and submitted revisions, not necessarily unique contents. Collection timestamps and sanitized path placeholders may differ; ledger JSON byte identity is not claimed. The portable CLI processes all eight named report paths and should be run after the batch is complete when a currently active report must not be read.
