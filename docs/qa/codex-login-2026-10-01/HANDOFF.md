# Local worktree handoff

> Historical QA snapshot (2026-10-01). The results, failure counts, environment blockers and pending work below describe that run, not the current main merge status. For the later, separately scoped eight-cell benchmark merged in [PR #53](https://github.com/jovinus302/Ensemble/pull/53), see the [v4 results](../../../app/packages/benchmark/evidence/paired-validation-v4/README.md). Those results do not retroactively pass this snapshot's blocked checks or replace its evidence. Current documentation was reconciled against `main@c91234a` on 2026-10-02.

Cloud work stopped at the user's request on 2026-10-01 13:12 UTC. No further cloud feature work, QA expansion or merge is authorized by this handoff. Continue in a separate local worktree so the user's concurrent Orca work is untouched.

- Remote branch: `codex/pm-login-browser-qa`
- Draft PR: https://github.com/jovinus302/Ensemble/pull/28
- Implementation head before evidence-only handoff: `840a9fac5e06af606a74631dec8d2f0099770af8`
- Upstream main integrated: `c3e053b` (including PRs #24 and #25). Merge conflict in web runtime was resolved, preserving `api|codex|claude` selection. No unresolved conflicts or force push.
- Final implementation checks: **508 tests / 56 files passed**, **typecheck passed**, **production build passed**. Logs are in `evidence/`. Build prints existing Next.js dynamic environment access warnings but exits 0.
- GitHub reports draft PR merge state CLEAN and no status checks. Branch-protection API returned 403 (`Resource not accessible by integration`), so protection requirements could not be independently enumerated. This is not proof that protections are absent.

## Safe local continuation

From the local Ensemble repository, fetch and add a new worktree/branch, using a new unique path/name if either already exists:

```sh
git fetch origin
git worktree add -b codex/local-login-qa-20261001 ../Ensemble-login-qa origin/codex/pm-login-browser-qa
```

Do not reset, switch, clean or overwrite the Orca worktree. Run `npm ci` in the new worktree's `app/`. Use local CLI status and official login/account APIs to confirm accounts; **do not transfer any cloud credential file, token, cookie, CODEX_HOME or Claude config**. Cloud credentials and binaries are intentionally absent from this branch.

The original task now requires **both Codex and Claude** testing locally. Cloud Claude CLI installation alone is not authentication or a passed test. A Claude account/durable-access approval may still be needed; verify with the user through the official flow.

## What passed in a real browser

See README and evidence JSON for exact results. Actual Codex PM smoke and complex schema calls succeeded. Chromium exercised scripted/free plan generation, approval and worker start; Escape replacement cancellation; A/B/C input preservation; duplicate-Enter fix; offline/reconnect banner fix; rapid user switching. Screenshots and reusable browser scripts are included. Scripts point to localhost and absolute `/workspace/ensemble-qa` output paths: adjust these to the new worktree's evidence folder before reuse. No screenshot or fixture is proof of final artifact completion.

## Blockers and pending regression

1. **High: actual worker artifact production blocked in this cloud.** Codex's nested sandbox initializer requires the fixed `/tmp/codex-daemon-1000` directory to be owned/private; the managed outer sandbox masks it mode 000. Both normal and private-TMPDIR worker smoke runs generated real model responses/acknowledgments but no result report/files. Do not bypass or chmod the protected mount. Retest on the supported local environment.
2. New sandbox-failure classification is covered by a fixture test but was **not re-run live** after the final patch, because the user requested migration.
3. Duplicate approval was reproduced (two requests, one ledger transition); guard added, but **final browser regression of this guard remains pending**. Repeated confirmation/Next guards and final-head project replacement need the same regression.
4. New stale-message handling is unit tested (queued and in-flight old requests); **final-head live latest-B semantic verification is still pending**. Last earlier live A/B run used the previous runtime instance. Do not count a successful POST as semantic correctness.
5. Full scripted scene 3 (drop payment while keeping signup/time selection/confirmation), full free scenario and actual final HTML interaction are **not passed**. Include stop, retry, failure, archive isolation and no lost drafts. No fake artifacts were substituted.
6. Whole-task before/after timing is unavailable because workers could not produce artifacts. Receipt, model, PM queue and completion must remain separate. The measured 45.5s scripted plan and 34.7s free plan have different goals and are not a controlled speedup claim.
7. The web Codex PM uses a new app-server adapter, while exported CLI providers from upstream #25 remain. Claude/API paths have unit regression coverage but no cloud live authentication/QA. Review cross-runtime cancellation and schema behavior during local dual-provider QA.
8. Keep PR #28 draft and merge deferred until local final QA/review/required checks complete. Do not force-push or bypass branch protection. No deployment approval exists.

Generated Next.js `app/apps/web/AGENTS.md` and `CLAUDE.md` remained untracked in the cloud; they contain Next.js guidance and no implementation changes. Runtime state, auth, node_modules and temporary Codex sessions were not committed.
