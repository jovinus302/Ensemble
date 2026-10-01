# Revision-bound validation evidence

This is one validation-flow observation, **not a paired performance comparison**. The original pair and its original verdicts remain in [draft PR #51](https://github.com/jovinus302/Ensemble/pull/51).

## Frozen inputs and outcome

- Production baseline: `d6f1660dd7460e631445e25db141bcff99f956ec`; preregistration/runtime commit: `42a0075`.
- Task A, Ensemble + Codex, `gpt-6-astra` / `low`, existing CLI 0.159.2 and authentication/tools.
- 20-minute total deadline; 24 top-level attempts maximum. **Passed in 416.659 seconds** with **4 attempts: PM 2, worker 1, judge 1**.
- Browser **10/10**. Host build also passed. All **5 preregistered flow criteria passed**. No human intervention, timeout or cleanup error.
- The worker's two limitations survived submission. It reported that its own build attempt was blocked and external build/browser checks had not run. The host then measured the immutable submission, and the judge used that evidence.
- Ledger sequence: trusted validation passed **22**, sufficient handoff review **23**, task checked **24**. The accepted result/digests/policy/attempt match.
- All **8 original slots consumed conservatively**, no rerun authorized. After this observation the final CLI was locked with `assertLiveCapacity`; that final safety guard was not part of the measured runtime.

## Files

- [Preregistration](preregistration.json): written before launch; frozen source/evaluator/criteria hashes and approval provenance.
- [Live result](live-result.json): checks, timing, role calls, binding/sequence and limitation evidence, artifact hashes.
- [Supplemental usage](supplemental-usage.json): own thread only, actual model/effort and observed cumulative tokens. Worker 264,368; PM/judge 110,270; observed combined 374,638. Cached input/reasoning output are subsets, not extra tokens. Hidden API calls and dollar cost remain unknown.
- [Accepted source](live-artifact/src/App.jsx), [styles](live-artifact/src/styles.js), [390px screenshot](live-screenshots/viewport-390.png), [1440px screenshot](live-screenshots/viewport-1440.png).
- [Offline checks](offline-checks.json), [16 browser controls](browser-fixtures.json), [snapshot controls](snapshot-fixtures.json).
- [Offline re-evaluation of old artifacts](offline-artifact-retest.json): Ensemble **10/10 -> 10/10**, direct **9/10 -> 10/10**, zero model calls. The original direct failure was the ISO-only date display oracle. No historical verdict was overwritten.

Offline implementation verification before launch: **788 tests / 88 files**, typecheck and production build passed. Final consumed-slot guard verification: **789/789 tests / 88 files** and typecheck passed. Build retains three existing dynamic filesystem tracing warnings. Snapshot A/B positives and invalid-JSX/outside-snapshot negatives behaved as expected; the 16 browser variants include backend-neutral persistence, A without edit, wrong values, B edit restoration and blocked external HTTP/WebSocket.

Raw execution report and trace remain in the local `.local/validation-flow-v3` directory. Their digest and curated evidence are recorded here; unrelated runtime/authentication records are not published. To reproduce provider-free checks, follow the package README. No live slots remain.
