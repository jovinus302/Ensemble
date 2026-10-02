# Human + agent fixed demo

Implemented against verified remote main `7adee84679809da63777b7a7a1b367150ccad820` in branch `demo/jin-human-agent-fixed`. This is an isolated presentation route, `/demo`, linked from the existing application's header. The real runtime, ledger, providers, SSE, cancel/retry, and validation paths are unchanged.

## Reference and scope

Jin Jeon's **Ensemble-Pages-scenario.html**, from “Ensemble-Pages-scenario 전달 건”, 2026-10-02 19:32 KST. Downloaded directly from the authorized Gmail attachment onto the Windows consumer workspace; 10,971,873 bytes, SHA256 `30a59d74961fac0583f36a65a175e4148ac173c85d01af4b62ce7e5b1c22ba38`. Source and actual Chromium-rendered pixels were inspected. This is not Deokjin's Project E v0.4.

Retained: dark navy three-pane composition; left project/channels/members, center chat, right work context and phone artifact; lime PM, cyan agents, amber humans; Connect / Align / Deliver / Tuning & Loop sequence; privacy-fiction decision and dependent work; fiction disclosure addition and song removal.

Adapted for the approved compact story: two humans, two execution agents and PM; explicit decision/owner/wait-reason cards instead of the large graph; collapsed PM log; responsive stacked chat and artifact below 760px. System Korean font fallback is used rather than redistributing the reference's embedded fonts. No external Figma/repository handoff claims or buttons. The reference's passive presentation is now an interactive local state machine; it does not model live provider execution.

## Presenting (roughly three minutes, not a performance claim)

1. 0–20s: open `/demo`, introduce the goal and five team members; click **팀 대화 시작**.
2. 20–70s: read the two humans' conflicting views and PM's options. As Doyun, click **예시 문장 넣기**, then **전송** to propose the compromise. As Seoyeon, do the same to explicitly confirm B. Both gates wait indefinitely. Free disagreement is recorded and cannot authorize work. Exact scripted phrases are intentional and explained beside the composer.
3. 70–120s: the D1 decision resumes Story/UI automatically. After the 2.2-second scripted transition, inspect v1.0, including its song option and three fiction levels. The transition delay is presentation behavior, not model latency.
4. 120–160s: as Seoyeon, insert/send the change request. Only the disclosure and song-related portions change. Observe v1.1; D1 stays intact.
5. Last 20s: recap people agreeing, PM coordinating dependencies, and the changed artifact. Expand PM log if useful.

**이전 단계** restores the last transition snapshot. **처음부터** resets all demo state. Both invalidate pending callbacks. Reload/navigation resets the demo; no project data is saved. No integration calls are made by `/demo`.

## Run and reproduce

From `app/`, install with `npm ci`, then `npm run build`. Run with fake providers so visiting the separate real application cannot call a paid provider:

```powershell
$env:ENSEMBLE_PM_RUNTIME='fake'
$env:ENSEMBLE_AGENT_RUNTIME='fake'
$env:ENSEMBLE_DIGEST='off'
$env:ENSEMBLE_DATA_DIR='<isolated absolute data directory>'
npm run start -w @ensemble/web -- --hostname 127.0.0.1 --port 3489
```

Browser harness: `node scripts/fixed-demo-browser.cjs` from `app/`. It requires an installed Playwright Chromium; set `ENSEMBLE_PLAYWRIGHT_PATH` to an existing Playwright module directory if outside this workspace. Optional `ENSEMBLE_DEMO_ORIGIN` changes the default `http://127.0.0.1:3489`. Screenshots and `result.json` go into `demo-evidence/` relative to the invocation directory. The harness only creates its own browser, never attaches to another task's browser/profile.

## Verification

- `npm test`: 90 files / 818 tests passed, including five state-machine regressions.
- `npm run typecheck`: passed.
- `npm run build`: passed; three existing dynamic-filesystem tracing warnings in Claude connector, Codex RPC, Codex settings.
- Real Chromium clicks against the production build: full flow; required human answers; empty input disabled; disagreement remains pending; double submission; automatic resume; scoped changes; D1 retained; back/reset interrupt pending transitions; reload/replay; browser back; 390px and 320px layouts without horizontal overflow.
- Browser page errors: none. `/demo` API calls: zero. The harness's separate real-app navigation generates its normal state/SSE GETs only, with fake providers.
- Read-only review caught premature future answers poisoning later duplicate detection; fixed and covered by regression.

Screenshots and machine-readable browser results are in `fixed-demo-2026-10-02/`. Desktop human gate and v1.1, and mobile v1.1 were visually inspected.

Not tested: real model/provider execution, external Figma/repository integration, physical mobile devices, non-Chromium browsers, screen-reader behavior, or measured three-minute performance. None is claimed. No paid benchmarks, reauthentication, PR publication, deployment, or merge occurred.
