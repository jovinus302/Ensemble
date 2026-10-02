# Paired validation v4: new eight-cell batch

This batch is separate from the invalid legacy pilot, the corrected Codex A pair, and the single v3 validation observation. Those eight earlier slots remain consumed and their data/verdicts remain unchanged. The user explicitly approved eight new slots after being told that history (Sentinel_44444b08f3fc8191bf1bf2dc740c6247). Each cell is attempted once; no automatic rerun or model substitution.

Production baseline: `main@7cd8de808caf046e0bcc3894a27054dca133d987` (merged PR #52). Benchmark-only preflight corrections and final adapter/evaluator hashes are frozen before launch. No production dependency changes are planned.

| Order | Task | Condition | Model | Effort |
|---|---|---|---|---|
| 1 | A | Ensemble + Codex | gpt-6-astra | low |
| 2 | A | Direct Codex | gpt-6-astra | low |
| 3 | A | Direct Claude | claude-opus-4-8 | xhigh |
| 4 | A | Ensemble + Claude | claude-opus-4-8 | xhigh |
| 5 | B | Ensemble + Claude | claude-opus-4-8 | xhigh |
| 6 | B | Direct Claude | claude-opus-4-8 | xhigh |
| 7 | B | Direct Codex | gpt-6-astra | low |
| 8 | B | Ensemble + Codex | gpt-6-astra | low |

Within each provider pair, model, effort, source starter, task requirements and native worker tools/settings match. Ensemble includes PM/worker/judge orchestration, current-revision trusted build/browser validation and limitations preservation. The direct arm uses the neutral development instructions without Ensemble reporting protocol. Task B uses the same incomplete starter, independently validated actual-controls/build checkpoint, then the same maximum-8/after-18:00/invalidation-reason/edit-after-confirmation change. Initial/checkpoint/change/post-change and total elapsed times are retained separately.

Each cell has a 20-minute total deadline and 24 top-level CLI request/turn attempts including PM/worker/judge. Hidden API requests and dollar cost remain unknown. Existing ChatGPT and Claude Max authentication are reused; no API keys, new billing, permission or authentication changes. Codex CLI 0.159.2, Claude Code 2.1.287. Codex multi-agent/web-search/node-repl are disabled; Claude Agent/Task/WebSearch/WebFetch are disallowed with existing acceptEdits settings. Both providers receive the same restrictions in direct and Ensemble workers. The trusted browser blocks external HTTP/WebSocket and service workers.

Acceptance remains semantic date/time/party functionality, fixed error fixtures, confirmation/persistence, 390/1440px layout and console; B adds maximum/early-time invalidation with explanation and edit/save/reload. A does not require functional edit. Fixture positives and negative controls are provider-free and never performance observations. Any identified harness/orchestration design defect stops the remaining batch; corrections require a distinct version rather than pooling mixed criteria.

Results are n=1 exploratory within-provider comparisons, not statistical superiority evidence. Failures, timeouts, unavailable models and interruptions remain observations. No extra slots beyond these eight are authorized. The result PR will remain a draft; PR #51 is outside this scope.
