# PM team handoff demo — local implementation and QA

## Checkout and source of truth

- Worktree: `C:\Users\siheon.ryu\Documents\Codex\2026-10-05\task\ensemble-pm-handoff`
- Branch: `demo/pm-team-handoff-20261005`
- Base: `7256395f47ce913b3be032df30a47b2c039105db` (latest main fetched on 2026-10-05).
- PR64: merged at `2026-10-05T04:27:23Z`, head `8759c155ac4868c896611710a6d807c5d9b1e9cb`; verified with `git ls-remote` and `gh pr view`. The first connector response returned the earlier draft state, so direct remote Git/CLI results were used.
- A separate bare clone with `--no-hardlinks` owns the new worktree. Existing trees, branches, and processes were not changed. The restricted document commit `9ea0d5e` was not cherry-picked or published.
- No checkout or ancestor `AGENTS.md`, or checkout `.agents` instructions were found. README and `docs/qa/essential-regressions.md` supplied execution instructions.

## Experience and scope

Open `http://127.0.0.1:3497/handoff`. The existing Jin-based fixed demo's shell, colors, messenger bubbles, alignment, and responsive layout are reused through `fixed-demo.css`; the new route has isolated state and scoped CSS overrides. `/demo` and `/s27` remain intact. Current code is a Next.js app, not the unverified `server.js/index` implementation.

1. PM assigns T-1 to Kim Sangseong with expired-link recovery and keyboard-focus criteria.
2. Sangseong works directly with his Coding Agent in the private-work preview.
3. Generating output does not publish it. Explicit sharing adds only output and evidence to team state.
4. PM checks the shared output and dependency, then requests Jiyoon's review.
5. Approval records T-1 completion and passes the goal, accepted version, review decision, and retained behavior to UX Agent's T-2. T-2 output remains pending.
6. Rejection keeps T-2 blocked; a revised version must be shared and reviewed again.

Use **내 Coding Agent와 작업하기 → T-1에 결과와 근거 공유 → 검토 승인 · 다음 담당에게** for the normal path. At review, use **수정 요청 · 포커스 복귀** for the revision path. The previous-version disclosure exposes rejected stale-event attempts. Review is explicitly role-played as Jiyoon; it is not a production authorization model.

All dialogue, output, test evidence, checks, and receipts are scripted examples. No model, real agent, IDE, Slack, Knox, or MCP integration is invoked. Private conversations are not collected. State lives in memory; reload or leaving and returning starts the demo again. The simplified graph reflects current shared evidence, review, and handoff.

## Verification

- `npm test`: 17/17 passed, including 3 risk-based handoff tests.
- `npm run typecheck`: passed.
- `npm run build`: passed; `/handoff` generated statically. Three existing dynamic-filesystem tracing warnings in the Claude/Codex connector/settings sources remain.
- Actual local Chromium `153.0.8010.12` clicking, not reducer-only verification: normal handoff; generation without sharing; review wait; rejection/revision; duplicate share/approval; old result/old approval; cancel/reset during both asynchronous phases; cancel then reshare; browser Back/Forward during a pending callback; reload; desktop 1440x1000 and mobile 390/320 widths.
- No browser page errors, application API requests, or external requests. Mobile horizontal overflow: zero.
- Preview dialog: Tab stays on its only interactive control, Escape closes it, and focus returns to the opener.

QA caught a real UI defect: the second click of a share double-click could hit the newly rendered Cancel button. Cancel now ignores the second click of the same gesture. Reducer guards separately prevent duplicate state transitions. Browser navigation waits were also corrected to wait for completed navigation before immediately moving Forward/Back.

To reproduce browser QA, use an existing Playwright installation (no dependency added):

```powershell
cd app
$env:ENSEMBLE_PLAYWRIGHT_PATH = '<absolute path to installed playwright or playwright-core>'
node scripts/handoff-browser.cjs
```

The server was started with both `ENSEMBLE_PM_RUNTIME=fake` and `ENSEMBLE_AGENT_RUNTIME=fake`, bound to `127.0.0.1:3497`. Launch command from `app`: `node node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3497`. Only this task's server was created; existing processes were untouched.

## Local evidence and Library blocker

Evidence directory: `docs/qa/pm-handoff-2026-10-05/` (local QA files intentionally follow the repository's ignored-evidence convention).

- `desktop-assignment.png`, `desktop-artifact.png`, `desktop-review.png`, `desktop-handoff.png`, `desktop-revision.png`
- `mobile-390-review.png`, `mobile-390-handoff.png`, `mobile-320-review.png`, `mobile-320-handoff.png`
- `result.json`: browser version, checked flows, and empty error/API/external-request arrays.

The current Library skill's prepared-upload helper was fetched with its companion files and invoked once for desktop review, handoff, revision, and mobile handoff screenshots. It failed with the exact error: `library upload failed: Library prepare_uploads is not available`. No direct upload fallback or alternate transfer was attempted. No confirmed `library_file_id` exists. Local screenshots remain available.

Local implementation and validation only: no push, PR, or merge was performed.
