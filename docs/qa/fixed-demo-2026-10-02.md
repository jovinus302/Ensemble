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

Historical browser harness: `scripts/fixed-demo-browser.cjs` was used for the checks below and has since been removed with the automated test tools. Its source remains available at the [pre-removal snapshot](https://github.com/jovinus302/Ensemble/tree/64373b8f9dbf2cbc27c77c220ed46f809822b3e2/app/scripts/fixed-demo-browser.cjs). The recorded checks and screenshots are historical evidence, not claims of a fresh run after removal.

## Verification

- `npm test`: 90 files / 818 tests passed, including five state-machine regressions.
- `npm run typecheck`: passed.
- `npm run build`: passed; three existing dynamic-filesystem tracing warnings in Claude connector, Codex RPC, Codex settings.
- Real Chromium clicks against the production build: full flow; required human answers; empty input disabled; disagreement remains pending; double submission; automatic resume; scoped changes; D1 retained; back/reset interrupt pending transitions; reload/replay; browser back; 390px and 320px layouts without horizontal overflow.
- Browser page errors: none. `/demo` API calls: zero. The harness's separate real-app navigation generates its normal state/SSE GETs only, with fake providers.
- Read-only review caught premature future answers poisoning later duplicate detection; fixed and covered by regression.

Screenshots and machine-readable browser results are in `fixed-demo-2026-10-02/`. Desktop human gate and v1.1, and mobile v1.1 were visually inspected.

Not tested: real model/provider execution, external Figma/repository integration, physical mobile devices, non-Chromium browsers, screen-reader behavior, or measured three-minute performance. None is claimed. No paid benchmarks, reauthentication, PR publication, deployment, or merge occurred.

## Audience clarity follow-up

User review emphasized PM coordinating humans as team members alongside agents. Removed two redundant waiting-agent chat messages so the humans' conflicting views remain visible. Added a persistent agreement → PM coordination → artifact path and human-owned task cards: Seoyeon owns planning/scope, Doyun owns negotiation and output review. PM explicitly hands the finished screen to Doyun; Doyun proposes two changes to Seoyeon, whose explicit chat answer authorizes the revision. Agent cards retain their individual changed outputs. Added a compact mobile team/role line. Added/removed/retained changes now appear before the phone on narrow layouts and beside it on wide presentation layouts. These remain labeled scripted handoffs, not actual human or model sessions. Existing review screenshots were refreshed, with no original attachment or fonts added.

Independent viewer follow-up also added the visible Story template (pseudonymization rules, three fiction levels, allowed formats); the D2 revision removes only the song format there. At 1440×1000, the human/agent task cards, Story output, added/removed/retained summary and changed phone controls are visible together. Browser assertions verify the Story format change as well as the phone change.
