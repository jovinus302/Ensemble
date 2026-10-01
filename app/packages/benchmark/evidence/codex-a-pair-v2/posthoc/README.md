# Posthoc artifact diagnosis — not primary benchmark results

No model calls were made. The script copies the frozen artifacts to `.local/posthoc/<timestamp>`, builds those copies, runs the original unchanged Task A browser evaluator, and then runs a separately defined semantic persistence probe. Original artifacts, evaluator, prompts and primary reports are unchanged.

| Artifact | Original evaluator rerun | Separate persistence probe |
|---|---|---|
| pilot-01 / Ensemble + Codex | 10/10 | Pass |
| pilot-02 / Direct Codex | 9/10; literal date confirmation check fails | Pass |

For both artifacts the visible confirmation remains identical after reload and editing restores date `2030-06-17`, time `19:00`, and guests `6`. Direct displays `Monday, June 17, 2030`, but not the literal ISO date required by the original evaluator. Its original `confirmation.persistence` failure is therefore format-sensitive; this probe demonstrates persistence for the tested selection. The frozen task prompt did not explicitly require literal ISO date display. This is an evaluator limitation, not evidence that reservation data was lost.

These are posthoc findings. They do not retroactively change direct's primary 9/10 record, make Ensemble's original failed handoff a successful completed run, or establish superiority. In particular, Ensemble's original run never reached official browser acceptance; its 10/10 here describes only the copied final artifact inspected afterward.

`diagnostic.json` records the source/evaluator SHA-256 hashes, all original checks, visible text before/after reload, and restored control values. Each condition folder contains screenshots at 390/1440px, confirmation before/after reload, and restored edit controls.

Reproduce from `app/` with existing dependencies and Chromium:

```powershell
$env:BENCH_PLAYWRIGHT = 'C:/absolute/path/to/playwright/index.mjs'
node packages/benchmark/scripts/diagnose-artifact.mjs
```
