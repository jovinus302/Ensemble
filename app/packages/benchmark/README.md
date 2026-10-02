# Paired restaurant-booking pilot

Historical generated reports, artifacts and screenshots are archived at fixed commit `cb84ecc2849f8194e0d5d44d22642a5174ef4c4f`. The [evidence index](evidence/README.md) links retained batch pages and original artifact trees. Ordinary offline tests retain their fixtures and starters; historical replay requires restoring the relevant fixed archive. This cleanup does not alter live guards or authorize new calls.

Tracking: https://github.com/jovinus302/Ensemble/issues/35

## Current batch: paired-validation-v4

The user approved **eight new slots** after the previous eight were exhausted. [V4 protocol and evidence](evidence/paired-validation-v4/README.md) define the new fixed-main experiment. Old v3 authorization stays closed; each new cell is claimed once in sequence, with review between cells and no automatic retry/model substitution. The original observations are not pooled with this batch. **All eight new cells completed and passed** (A: 10/10 browser checks; B: 13/13). All four within-provider/task pairs observed longer total elapsed time for Ensemble in this n=1 batch; see the evidence report for full times, calls, partial usage and limitations. All eight new slots are consumed; zero remain, and no rerun is authorized.

## Prior revision: trusted validation before handoff

`revision-bound-validation-v3` fixes the validation lifecycle and date oracle. It is not a new paired performance study. The five legacy attempts remain invalid for comparing orchestration because direct runs inherited a conflicting prototype role. The separate corrected Codex Task A pair consumed two more slots: Ensemble failed handoff despite a later 10/10 browser result; direct recorded 9/10 because the original oracle required an ISO display string. Original observations and diagnoses are preserved in [draft PR #51](https://github.com/jovinus302/Ensemble/pull/51), not overwritten here.

All eight original slots are now conservatively consumed. The preregistered final Ensemble + Codex Task A validation-flow observation passed: 416.659 seconds, PM 2 + worker 1 + judge 1 top-level attempts, browser 10/10 and all five flow criteria. Worker limitations were retained; host validation sequence 22 preceded sufficient review 23 and checked handoff 24. There were no human interventions or cleanup errors. See [v3 evidence](evidence/revision-bound-validation-v3/README.md). It cannot establish a performance difference. The historical v3 CLI rejected every further live run because no original slots remained; the historical one-cell guard rejected prior eight-run/pair approvals and all resume requests, and never overwrites an attempt directory. An atomic local slot claim prevents reusing the approval with another output path. No retry is authorized. PR #51 remains a separate draft. The v3 feature was merged as PR #52 by explicit approval; the v4 results were merged as [PR #53](https://github.com/jovinus302/Ensemble/pull/53). PR #51 remains draft; merging v4 does not merge or revise that historical evidence.

### Production contract

The worker submits immutable artifact bytes, relative paths and its verification limitations. The host validator runs before the final judge. Each event binds the project, task, result, plan/spec version, goal/decision context, artifact digest and validator policy fingerprint. Changes invalidate evidence; cancelled or stale asynchronous results cannot approve another revision. Final judge completion rechecks the binding. Worker self-report is kept separate from host measurements.

A host supplies `TrustedValidator` and opts into `requireValidation`. A measured pass requires nonempty valid checks, all passing. Actual failed checks request a revision and cannot be overridden by the judge. Missing validators, unavailable environments and checks not run remain distinguishable from implementation defects and await validation/retry. Existing source-only workflows keep their review semantics with explicit `not_run` evidence rather than claiming a measured pass. This change does not expand shell permissions, authentication, billing or tools.

The benchmark adapter copies submitted source into an owned immutable snapshot with the trusted starter/build/server. It never executes a worker-supplied build script. The checked handoff and final artifact use the same accepted snapshot, and reuse its build/browser results instead of validating mutable workspace contents a second time. Task B invalidates the checkpoint acceptance before the changed requirement.

### Semantic browser oracle

Confirmation, reload and edit checks compare the selected date/time/party semantically. ISO and unambiguous English named-month dates (US/GB ordering and abbreviations), plus 24-hour/AM-PM times, are supported; arbitrary or ambiguous dates are not accepted. A matching POST request, visible confirmation and same-context reload establish persistence; Task B additionally checks restored edit controls without requiring a particular storage backend or JSON shape. Fresh scenarios use isolated browser contexts. Wrong dates, times, party sizes, missing persistence and wrong restored controls remain negative controls. Browser access is restricted to the fixture origin; service workers and external HTTP/WebSocket access are blocked.

Fixture evidence is provider-free and must never be presented as model performance. Existing artifacts are re-evaluated offline under the new evaluator and labeled separately; their original verdicts stay unchanged. The scope remains coding orchestration, not proof of mixed human-agent product value or statistical superiority.

## Historical paired design (plan/fixture only)

Historical base: `main@a6bfc345bde634422421c500fad264419bc04ec9`. The current validation-only baseline is pinned by `BASE_SHA` in `src/protocol.ts` after offline verification. Each run receives a fresh copy of `starter/`, with the same source SHA-256. It deliberately has an unfinished, disabled time control. No generated output is carried to another condition or from task A to B.

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
npm run benchmark:plan -- --validation-run
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
npm run benchmark:fixture -- --validation-run
# Exercise immutable snapshot validation itself with A/B and a bad-JSX negative:
npx tsx packages/benchmark/scripts/validate-snapshot.ts
```

`benchmark:browser` checks A/B references, equivalent localized dates and alternate storage, plus negative controls for missing controls, invalidation, wrong date/time/party, persistence/edit restoration and blocked external access. `benchmark:fixture` runs all eight harness cells using the handwritten reference component. Every output says `mode: fixture`, has zero model invocations and contains no provider execution. It does not simulate native PM decisions or usage. Native driver unit tests use fake connectors/providers and never fall through to a model.

The fixture server has fixed POST `/api/reservations` responses: `2030-06-15T19:00` → 409, `2030-06-16T18:00` → 503, otherwise deterministic success. It accepts `{date,time,guests}`. Tests depend on `data-testid` controls `date,time,guests,submit,confirmation,edit,message`; confirmation visibly identifies the selected date, time and count semantically. Build and fixture server files are immutable and checked before acceptance. The same contract is visible in every task prompt.

Outputs default to `.local/<mode>-<timestamp>/`: manifest, per-cell reports, summary, original workspaces, screenshots, and blind source packages. `report.schema.json` specifies machine-readable fields. Keep failed workspaces/evidence. Never publish logs containing private runtime data without review.

## Historical single validation-flow execution (now closed)

All authorized slots are consumed and the final CLI rejects live execution unconditionally through `assertLiveCapacity`. The following records the preregistered path used once; it is not permission or a runnable instruction for another attempt.

Before the final slot was consumed, the CLI refused live execution without `--validation-run`, a new explicit output directory, exact approval provenance and hashes, a pinned Codex model/effort, unchanged production dependencies from the frozen baseline, and schema preflight. Prior `liveEightRuns` and `livePairedRuns` authorizations are rejected.

After the offline checks pass, the approval file must contain `liveValidationRuns: 1`, `previousConservativeAttempts: 7`, `totalAuthorizedSlots: 8`, `reruns: false`, `provider: "codex"`, `task: "A"`, `ensemble: true`, `model: "gpt-6-astra"`, `effort: "low"`, actual `approvedBy`/`source`, `toolsMatched: true`, and the plan's base/rubric/starter/evaluator/implementation hashes plus `criteriaHash`. Never invent authorization. The selected model/effort must match the preregistration.

```powershell
npm run benchmark:plan -- --validation-run
npm run benchmark:live -- --validation-run --approval-file C:/approved/authorization.json --config C:/approved/models.json --output C:/new/validation-attempt
```

Success criteria are current-revision trusted pass, preserved worker limitations, judge after validation, checked handoff tied to that artifact, and semantic browser pass. A failed/blocked/interrupted/timeout attempt consumes the remaining slot conservatively; no rerun follows. Removing `PAUSE` does not authorize another run. SIGINT/SIGTERM preserve partial evidence and trigger bounded cleanup.

Codex inherits existing local capabilities. No new MCP, shell, authentication, subscription or permission changes are authorized. Hidden underlying API counts and dollar costs remain unknown; top-level call counts include PM/worker/judge. The single validation observation is not a paired comparison. Keep source-only, mock, offline re-evaluation and live evidence clearly labeled.
