# Essential regressions only

Run `npm test` from `app/` on Node 24+. The command uses Node's built-in test runner with a 10-second timeout and the existing `tsx` dependency. No test framework, browser driver, snapshots, paid model, provider login, or benchmark runner is added. Run `npm run typecheck` and `npm run build` separately; the test files are included in type checking.

Inventory checked on **2026-10-05, main `605521b`**: **18 scenarios in four files**. Keep this a risk-based list; do not grow it into a helper-by-helper or visual snapshot suite.

| File | Cases | Scope |
|---|---|---|
| [essential-runtime.test.ts](../../app/test/essential-runtime.test.ts) | 6 | Real runtime entrypoints and in-memory ledger; fake external connector |
| [essential-demo.test.ts](../../app/test/essential-demo.test.ts) | 2 | Fixed demo discussion, scope/schedule gates and limited revisions |
| [essential-s27.test.ts](../../app/test/essential-s27.test.ts) | 6 | Scenario references, five-stage story, copy density, navigation, selection and upstream trace |
| [essential-handoff.test.ts](../../app/test/essential-handoff.test.ts) | 4 | Two-person consent, sharing, QA repair, human review, stale results and interrupted callbacks |

| Scenario | Why it is essential |
|---|---|
| Required human decision remains paused; wrong person is refused; rejection does not hand off | An agent must not proceed without the responsible person's judgment. |
| Concurrent repeated approval applies acceptance and starts a dependent agent once | Retried requests must not duplicate work. |
| Retry respects authority, original assignee, state and the human's revision note | Recovery must not assign work to the wrong person or lose the requested scope. |
| Duplicate execution cannot create a second active turn | Double submission must not start two executions. |
| Runtime stop detaches late transport results | A stopped runtime must not accept a late completion. |
| Identical task/decision IDs in shared storage remain project-local | One project's decisions must not affect another project. |
| Scripted demo compares examples before human judgment and coordinates scope/schedule before execution | Preference, conditional requests and deferred timing must not silently authorize work. |
| Scripted demo handoff, scoped revision and interrupted callback handling | Replay/reset must not let old timers finish a new presentation or widen the fixed change request. |

`app/test/essential-runtime.test.ts` exercises real `ProjectManager` decision/recovery entrypoints and `SessionRunner`, backed by the real in-memory ledger/projection. Only the external connector is a tiny in-process fake; the model provider throws if called. Requests and the initial plan are seeded, so this does not validate model reasoning or question generation. Shutdown coverage concerns late transport events after stopping, not cancellation of an already-running validator.

`app/test/essential-demo.test.ts` exercises the scripted reducer only. The S27 tests check data references, bounded/cumulative reveals, version selection and provenance traversal. The handoff tests check that both humans agree, private drafts stay private until shared, shared outputs unlock dependent work, failed QA requests scoped repair, and human approval gates handoff. They also cover duplicate/stale actions and cancel/reset/history invalidation.

These tests do not prove real model reasoning, generated artifacts, rendered browser layout, external integrations or measured product quality. The previous broad suites and standalone benchmark runner remain removed. See the [QA guide](README.md) for the current optional browser check and local output location.
