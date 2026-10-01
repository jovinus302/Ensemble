# Paused legacy pilot: diagnostic evidence, not a valid comparison

Baseline: `a6bfc345bde634422421c500fad264419bc04ec9`. Source and acceptance criteria were frozen. Five of eight authorized cell attempts were consumed conservatively: four completed reports and one interrupted cell. Three cells were never run. No revised-protocol live runs occurred.

| Cell | Condition | Recorded outcome | Total | Top-level attempts | Browser |
|---|---|---|---:|---:|---:|
| 01 A | Ensemble Codex | PM schema HTTP 400, before worker | 10.454 s | 1 | Not reached |
| 02 A | Direct Codex | Role/task conflict; unchanged starter; cleanup error | 86.530 s | 1 | 3/10 |
| 03 A | Direct Claude | Passed recorded acceptance | 231.847 s | 1 | 10/10 |
| 04 A | Ensemble Claude | Passed recorded acceptance | 416.862 s | 4 | 10/10 |
| 05 B | Ensemble Claude | Interrupted; no complete report | Unknown | At least the cell began; exact count unavailable | Not reached |
| 06-08 B | Remaining conditions | Unrun | N/A | 0 | N/A |

These are `prototype-role-v1` observations. **They do not establish the intended causal comparison.** The direct baseline inherited the prototype-agent system role from the Ensemble connector, including single-HTML/inline-code/mock constraints, and Ensemble reporting obligations. Codex explicitly stopped over that conflict with the React/API brief. The passing Claude acceptance checks remain observed facts, but cannot repair the comparison design. Task B has no completed observation. There were no discretionary human answers inside completed cells; initial/change prompts are controlled inputs. Operator interruption of the batch is separately documented and must not be interpreted as zero human involvement overall.

## Why preflight missed this

The earlier preflight checked matching configuration, model/effort, permissions, source and evaluator hashes, plus fixture builds/browser checks. It did not inspect the final composed higher-priority instructions. The handwritten fixture bypassed provider prompts entirely. Equality of the two configurations did not make either task role appropriate.

- `packages/agents/src/roles.ts` defines the prototype constraints.
- Codex and Claude connectors inject that role by default and add `taskInstructions` reporting obligations.
- The revised benchmark supplies the same neutral development system to both workers. Direct uses the low-level transport with the exact plain brief/change; Ensemble retains its real PM/worker/judge coordination protocol. Offline tests capture actual composed wire messages and CLI arguments from both paths.
- This is a separate `development-brief-v2` protocol. Resume refuses mixed revisions; no old observation is relabeled valid.

## Independent Codex blocker

`packages/orchestrator/src/coordination.ts` emits discriminator `const` and several `enum` schemas without explicit `type`. `packages/llm/src/cli.ts::strictSchema` preserves them. The actual first failure identified `properties.ops.items.anyOf[0].properties.type`. The offline benchmark preflight reproduces the original untyped schema and checks the real transformation. The separately authorized nonlive production fix infers explicit types from const/enum values, retains those exact constraints, and correctly wraps nullable literals. Negative/positive regressions verify the former rejection and repaired output without model calls. Historical observations retain their original baseline. The repaired checkout fails the old production-source guard by design; a new reviewed baseline and explicit run direction are required. This targeted check is not proof of provider acceptance or a complete schema validator.

## Accounting and evidence boundaries

- [results.json](results.json): curated, path-sanitized metrics/checks, role counts, known usage fields and raw report SHA-256. Missing usage/API counts/dollar costs stay unknown. Worker response counts are not API request counts.
- [interruption.json](interruption.json): operator stop, conservative five-slot accounting and three unrun cells. Cell 05 has a partial native-config trace but no final report/response. Do not fabricate a duration or replay it as unattempted.
- [attempt-accounting.json](attempt-accounting.json): raw-file inventory and SHA-256 prove four finalized cells, one additional started cell and three unrun cells. Seven top-level attempts are recorded in the four complete reports; the fifth cell's actual provider invocation is unproven.
- [schema-repro.json](schema-repro.json): exact historical transformer retrieved from the baseline commit and repaired transformer applied to the same populated PM schema. All 22 untyped literal paths reproduce before the fix and disappear after it, with zero model calls. Run `npm run benchmark:schema-repro` to regenerate locally.
- [validation.json](validation.json): final offline validation, separate from the legacy live observations.
- [preflight.json](preflight.json) and [amendment.json](amendment.json): historical controls and cleanup-only amendment. They are historical evidence, not current authorization to run v2.
- `artifacts/`: postmortem source snapshots after owned processes stopped. Cell 02's original unstable-artifact flag is retained. Shared build/server fixtures were checked immutable during acceptance. These sources are observations, not benchmark reference fixtures.
- `screenshots/`: actual final acceptance screenshots for cells 03/04 at 390 and 1440 px. This is not a blinded design-quality review.
- Raw private runtime logs and authorization files remain ignored under `.local/`; credentials, account metadata and complete private conversations are not published.

The first two cells completed before notice of separate issue #47 activity at 21:53:23 UTC; no claim is made that the host was otherwise idle. The resumed segment may overlap that work. Exact external load/timing is unknown, so elapsed values are descriptive only. No isolated speed or quality superiority is inferred.

## Next experiment decision

Live remains paused. A complete new four-condition by two-task batch requires eight new attempts: five more slots than the three unused original slots, for thirteen cumulative attempts. A four-condition single-task batch would need one additional slot; a single-provider/single-task pair needs two but would answer a narrower question. None is started or authorized by this document. Review the offline schema fix, freeze a new baseline, review composed prompts/tools, then obtain explicit direction for one separate paired batch.
