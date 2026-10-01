# Paired restaurant-booking pilot

Tracking: https://github.com/jovinus302/Ensemble/issues/35

## Current status: live paused; legacy comparison invalid

The original `prototype-role-v1` pilot consumed **five of eight approved execution slots**: cells 01–04 completed and cell 05 was interrupted during stopping. Cells 06–08 remain unrun; **three original slots are unused**. No further live execution is authorized now. Existing authorization for commit, push and draft PR continues separately and does not authorize another model run.

| Legacy cell | Condition | Recorded outcome | Total elapsed | Acceptance |
|---|---|---|---|---|
| 01 / A | Ensemble + Codex | Failed: schema HTTP 400 | 10.454 s | Not reached |
| 02 / A | Direct Codex | Failed: inherited role conflict | 86.530 s | 3/10 |
| 03 / A | Direct Claude | Passed recorded checks | 231.847 s | 10/10 |
| 04 / A | Ensemble + Claude | Passed recorded checks | 416.862 s | 10/10 |
| 05 / B | Ensemble + Claude | Interrupted; partial attempt retained | Incomplete | No final acceptance |
| 06–08 / B | Remaining conditions | Unrun | — | — |

**All legacy comparison results are invalid for the intended Ensemble effect.** The direct native connector inherited a prototype role asking for single HTML, inline code and mock behavior, conflicting with the repository development task. Earlier preflight checked configuration and fixtures but missed the final composed prompts. Keep failures and partial observations as diagnostic evidence; never pool them with the corrected design or reinterpret the passing checks as a valid paired comparison. Potential shared machine load from [#47](https://github.com/jovinus302/Ensemble/issues/47), noticed at **21:53:23 UTC**, is another timing confound; no timing superiority follows from these observations.

The corrected **`development-brief-v2` is a nonlive plan**. Direct runs use a plain transport with the same neutral development system instructions and tools; Ensemble's coordination protocol is the treatment. Resume rejects a different `protocolRevision`, including legacy manifests with no revision. A new valid eight-cell batch must be separate: with five slots already consumed, it requires **five additional slots beyond the original eight (13 total)** and renewed explicit authorization. The three remaining slots do not authorize eight more runs.

The original Codex PM schema failure is repaired offline in `strictSchema`: explicit types are inferred for literal constraints without changing their values, and nullable literals preserve their meaning. The preflight reproduces the original negative case and verifies the transformed positive case without a provider. No live validation has occurred. The historical baseline stays fixed in existing evidence; the repaired production code differs from it, so the live baseline guard intentionally rejects this checkout until a new reviewed baseline and authorization are recorded.

Both designs are **n=1 exploratory**, not evidence of statistical superiority. Fixture results verify the harness, not Ensemble, Codex or Claude quality. Historical 623-test coverage and the earlier 63.94-to-29.69-second observation are background only, not measurements from this pilot.

Product-scope limitation (issues [#3](https://github.com/jovinus302/Ensemble/issues/3), [#10](https://github.com/jovinus302/Ensemble/issues/10), [#26](https://github.com/jovinus302/Ensemble/issues/26)): this is a coding orchestration cost/quality comparison. It does **not** establish the product value of approving a person's deliverable and automatically handing work to the next person or agent in a mixed human–agent team. That requires a separate evaluation outside this pilot's scope. Passing prepared fixtures remains harness evidence only, separate from actual provider results.

## Corrected development-brief-v2 design (nonlive)

Base: `main@a6bfc345bde634422421c500fad264419bc04ec9`. Each run receives a fresh copy of `starter/`, with the same source SHA-256. It deliberately has an unfinished, disabled time control. No generated output is carried to another condition or from task A to B.

| Order | Task | Condition |
|---|---|---|
| 1 | A | Ensemble + Codex |
| 2 | A | Direct Codex |
| 3 | A | Direct Claude |
| 4 | A | Ensemble + Claude |
| 5 | B | Ensemble + Claude |
| 6 | B | Direct Claude |
| 7 | B | Direct Codex |
| 8 | B | Ensemble + Codex |

Compare only paired conditions **within the same provider**. A provider/model difference is not an Ensemble effect. This small crossover mitigates simple order bias but cannot establish superiority or statistical significance. Do not discard failures/timeouts or selectively rerun them as successful original attempts. A rerun needs a new output directory and must remain a separate observation.

Explicit per-provider model and effort are shared by direct and Ensemble workers, and by Ensemble PM/judge. Both arms receive the same neutral development system instructions, tools, initial task context, starter, fixtures and browser acceptance. Direct uses a plain transport without the inherited prototype or Ensemble coordination role. Ensemble uses the actual `ProjectManager` with a preregistered single worker task, PM coordination, handoff review and revision flow; this coordination protocol is the experimental treatment. This evaluates this fixed single-task configuration, not autonomous free-project planning or multiple-worker scaling. The legacy composed prompts do not satisfy this design.

Task A: date/time, parties 1–6, deterministic sold-out/error states, confirmation and reload persistence at 390/1440px. Task B begins from the same incomplete starter and asks the worker to stop after real selectable controls and a build. The harness independently rebuilds and selects date/time/6 guests in Chromium. Only after both pass does it inject max 8, 7–8 at/after 18:00, clear invalid time with explanation, and edit-after-confirmation. No checkpoint means `checkpoint_failed` (or timeout if the worker never settles); it is never skipped. The checkpoint is a standardized turn boundary in both arms, so this pilot does not compare interruption during an active model turn.

The manifest is written before any run. It fixes the plan, source/evaluator hashes, rubric and limits. No rubric tuning from live results. Browser tests cover blank inputs, parties 1–6, sold-out/error with no false confirmation, saved/reloaded values, invalid maximum, 6→7 invalidation with explanation, both 7/8 blocked before 18:00, 8 at 18:00, edit/save/reload consistency, console exceptions/errors and horizontal/control clipping. Review visual quality separately from functional pass. `blind/<random UUID>` holds source artifacts with neutral IDs; the condition mapping remains in private reports. Blind review is possible, not a claim that it already happened.

## Limits and metrics

- **20 minutes total per run**, including preparation, native PM/worker/judge work, checkpoint/build and browser evaluation. Work cancellation starts at 19m55s to reserve up to five seconds for teardown. Evidence serialization/copy after termination is excluded. Scheduling jitter and failed cleanup are recorded, not silently omitted.
- **24 top-level requests/turn attempts total**, shared across PM, worker and judge, including failed attempts and Codex steer requests. The cap is reserved before asynchronous work. CLI-internal inference requests, tool loops and retries are not visible: `underlyingApiCalls` and live `actualModelInvocations` remain null. This is a finite CLI/turn cap, **not** a proven cap on hidden API requests. If an approval requires a strict underlying API-call cap, do not run until connector metering/cancellation exposes it.
- `preparationMs`, `taskMs`, `totalMs`, `checkpointMs`, `changeMs`, `afterChangeMs` are separate. Total elapsed includes orchestration, not just the final worker. PM and judge call rows measure full requests; worker call rows measure submission latency, with full worker durations in `native_worker_duration` / `direct_worker_duration` events. Never sum overlapping durations as total wall time.
- Cache state defaults to **unknown**: fresh source/workspace does not prove a cold provider/prompt cache. Report actual cold/warm evidence rather than inferring it from run order. Dependency installation is a one-time prerequisite outside individual runs; per-run source preparation is timed.
- All checks are explicit pass/fail, preserving failures and diagnostic details. Requirement fidelity is assessed against those frozen checks and optional blinded human inspection; no generated subjective score pretends to be a human review. Cleanup failure stops the entire batch and leaves remaining cells explicitly unrun; an unstable workspace is not copied as a finished artifact.
- Partial PM/judge usage is preserved in `native_usage` events. Complete usage and cost remain null because worker usage/hidden retries are unavailable. Do not infer dollar cost. `humanRequests` records requests for help separately from `humanInterventions` (actual additional help); standardized initial/change prompts are experimental inputs. The automated pilot never answers ad-hoc human requests and records that blockage as failure.

## Reproduce without providers

From `app/`, use the lockfile and an already available Node 24+, dependencies and Chromium. No login, billing or permission changes are part of this workflow.

```powershell
npm ci --ignore-scripts
npm run benchmark:plan
# Offline negative/positive schema diagnostic; no provider calls.
npm run benchmark:preflight
# Exact old-transformer negative control and fixed-transformer positive control:
npm run benchmark:schema-repro
npm test
npm run typecheck
npm run build
$env:BENCH_APP_ROOT = (Get-Location).Path
# Use an existing Playwright installation if it is not resolvable by this project:
$env:BENCH_PLAYWRIGHT = 'C:/absolute/path/to/playwright/index.mjs'
npm run benchmark:browser
npm run benchmark:fixture
```

`benchmark:browser` checks A/B reference implementations and two negative controls: original starter checkpoint fails; reference without time invalidation fails. `benchmark:fixture` runs all eight harness cells using the handwritten reference component. Every output says `mode: fixture`, has zero model invocations and contains no provider execution. It does not simulate native PM decisions or usage. Native driver unit tests use fake connectors/providers and never fall through to a model.

The fixture server has fixed POST `/api/reservations` responses: `2030-06-15T19:00` → 409, `2030-06-16T18:00` → 503, otherwise deterministic success. It accepts `{date,time,guests}`. Tests depend on `data-testid` controls `date,time,guests,submit,confirmation,edit,message`; confirmation text includes the selected ISO date, time and count. Build and fixture server files are immutable and checked before acceptance. The same contract is visible in every task prompt.

Outputs default to `.local/<mode>-<timestamp>/`: manifest, per-cell reports, summary, original workspaces, screenshots, and blind source packages. `report.schema.json` specifies machine-readable fields. Keep failed workspaces/evidence. Never publish logs containing private runtime data without review.

## Future live execution: paused, renewed approval required

**The earlier live authorization does not authorize the corrected eight-run batch.** Live is paused. The CLI refuses `--live` without explicit provenance, matching base and rubric hash, and pinned provider config, and checks the Codex schema before provider launch. Commit, push and draft PR are outside these scripts and retain their existing separate authorization.

After explicit parent/user approval, a reviewer supplies an external JSON approval file with `liveEightRuns: true`, `approvedBy`, `source` (the actual authorization), `baseSha`, `rubricHash`, `starterHash`, `evaluatorHash`, and `implementationHash` from `benchmark:plan`, plus `toolsMatched: true` after the preflight below. Never synthesize authorization. The CLI also checks pinned-main ancestry and rejects production dependency source changes. Provider config shape:

```json
{"codex":{"model":"EXACT_APPROVED_CODEX_MODEL","effort":"medium"},"claude":{"model":"EXACT_APPROVED_CLAUDE_MODEL","effort":"medium"}}
```

Only after renewed authorization explicitly covers the separate v2 batch, the repaired schema is included in a newly frozen reviewed baseline, and the complete composed prompts/tools have been reviewed:

```powershell
npm run benchmark:live -- --approval-file C:/approved/authorization.json --config C:/approved/models.json
```

Preflight must inspect the **complete composed prompts**, confirm equal tools/settings within each provider pair, validate the Codex PM schema, and record CLI versions. Configuration and reference fixture success alone are insufficient. Codex's native app-server inherits local configuration; additional configured tools/MCPs are not fully enumerated by this harness. Claude uses isolated settings, existing `acceptEdits`, no extra auto-approved tools, and denies Agent/Task/WebSearch/WebFetch. A denied build command is a failure, not permission to expand access. Do not perform live runs if those existing capabilities differ within a pair or if provenance/settings cannot be confirmed. This local implementation deliberately does not change authentication, subscriptions, global CLI configuration or permissions.

To soft-pause a batch, create `<outputRoot>/PAUSE`: the CLI checks it immediately before every next cell. SIGINT/SIGTERM and the harness's external `AbortSignal` interrupt the current cell, retain an `interrupted` report and stop the batch. Each top-level attempt is journaled before provider work; bounded cleanup records failures. Forced process termination cannot guarantee a final JSON report, so retain partial journals and never replay ambiguous attempts. Removing `PAUSE` is not renewed authorization. Cross-revision resume is rejected regardless of matching hashes or an infrastructure amendment.

Known practical limits: legacy live adapter behavior exposed the failures above; corrected v2 live behavior remains unvalidated. Hidden API count and complete worker cost are unavailable; n=1 supplies no statistical confidence; shared load limits timing interpretation; multi-worker plans are rejected because the artifact contract is one workspace. An Ensemble change that fails to reopen completed work is recorded as failure rather than silently running a direct fallback. Do not estimate dollar costs from missing usage data.
