# Essential regressions only

Run `npm test` from `app/` on Node 24+. The command uses Node's built-in test runner with a 10-second timeout and the existing `tsx` dependency. No test framework, browser driver, snapshots, paid model, provider login, or benchmark runner is added. Run `npm run typecheck` and `npm run build` separately; the test files are included in type checking.

The suite has **eight scenarios in two files**. Keep this a risk-based list; do not grow it into a helper-by-helper or visual snapshot suite.

| Scenario | Why it is essential |
|---|---|
| Required human decision remains paused; wrong person is refused; rejection does not hand off | An agent must not proceed without the responsible person's judgment. |
| Concurrent repeated approval applies acceptance and starts a dependent agent once | Retried requests must not duplicate work. |
| Retry respects authority, original assignee, state and the human's revision note | Recovery must not assign work to the wrong person or lose the requested scope. |
| Duplicate execution cannot create a second active turn | Double submission must not start two executions. |
| Runtime stop detaches late transport results | A stopped runtime must not accept a late completion. |
| Identical task/decision IDs in shared storage remain project-local | One project's decisions must not affect another project. |
| Scripted demo waits at both human gates and ignores duplicate/stale input | The fixed presentation must keep its human decision points. |
| Scripted demo handoff, scoped revision and interrupted callback handling | Replay/reset must not let old timers finish a new presentation or widen the fixed change request. |

`app/test/essential-runtime.test.ts` exercises real `ProjectManager` decision/recovery entrypoints and `SessionRunner`, backed by the real in-memory ledger/projection. Only the external connector is a tiny in-process fake; the model provider throws if called. Requests and the initial plan are seeded, so this does not validate model reasoning or question generation. Shutdown coverage concerns late transport events after stopping, not cancellation of an already-running validator.

`app/test/essential-demo.test.ts` exercises the scripted reducer only. It does not prove real execution, rendered phone/template changes, browser layout, or external integrations. The previous broad suites and QA/benchmark execution infrastructure remain removed; historical results do not describe this suite's coverage.

Production sources are unchanged. Temporary guard-removal checks may be used during review, with original bytes restored before final validation; no mutation tooling is retained.

Review probes confirmed two tests fail when their safeguard is removed: deleting the runtime duplicate-start state guard caused “Missing expected rejection”, and deleting the demo run-generation check allowed an old completion to finish replayed work. Both production files were restored byte-for-byte, then the complete suite/typecheck/build were rerun. No production fix was needed.
