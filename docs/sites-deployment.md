# Sites deployment

## Proposition

Confirmed intent: publish the existing Ensemble screen to a public ChatGPT Site and keep PM, Codex, SQLite and attachments on the user's Windows PC. The user explicitly selected anyone-with-link access after being informed that visitors share project controls, including agent execution. Use a separate branch. PR #21 is included. Scenario playback changes were cancelled before implementation.

Implementation: bundle the existing React screen as a Worker-served client. Same-origin API requests pass through a Sites Worker to an authenticated, loopback-only PC gateway. The gateway exposes only Ensemble API routes, never the Next development server. A Cloudflare Quick Tunnel is the proposed HTTPS transport without opening router ports. Secrets remain on the PC and in Sites runtime secrets.

Transport qualification: Quick Tunnels do not support SSE. The Sites client polls every three seconds; the existing local client retains SSE. A stopped PC/server/tunnel makes the backend unavailable. The temporary tunnel hostname changes on restart and requires updating the Site's backend URL and redeploying. This is a personal PC-backed deployment, not an always-on service.

Hypothesis review: SOUND / COMMITTED CHANGE. Existing components, APIs, data and agent behavior are reused. No scenario or role changes. Verify public access, token rejection, method/path and origin restrictions, JSON/upload/download forwarding, offline error handling, build and existing regression tests. Publish only after these checks and push the task branch.

## Operation

Run `app/sites/start-pc.ps1 -EnvFile <absolute-existing-env-path>` from PowerShell on a network that permits the connection. It uses the existing server on port 3410 or starts one using the configured environment file, then starts the authenticated gateway and tunnel. Logs and gateway credentials live in ignored `app/data/sites/`. Keep the PC awake and these processes running. Startup is manual; no Windows login task is installed. Download the official `cloudflare/cloudflared` Windows release to `app/data/sites/bin/cloudflared-windows-amd64.exe` first.

The printed tunnel URL must be saved as `ENSEMBLE_BACKEND_URL` in Sites. Save `gateway.json`'s token as the secret `ENSEMBLE_BACKEND_TOKEN`; never paste it into chat or commit it. Redeploy after changing runtime values. The local data directory is `app/data/local-test`, matching the local session used before deployment. Back it up before relocating the server.

## Evidence and remaining deployment gate

2026-10-01: Type checking and all 465 existing tests passed on PR #21 plus the polling change. Three transport tests passed: origin/path rejection, public Worker access with secret injection and byte-preserving downloads, and a live local gateway rejecting missing tokens while forwarding JSON without leaking authorization. The Sites Worker build succeeded using existing components.

The PC's Cloudflare tunnel registration failed with a connection reset. A separate SSH tunnel could register, but access to its HTTPS endpoint returned an explicit corporate `Access Denied (policy_denied)` page. Stop at this policy boundary; do not bypass it with proxy exclusions or a hosted relay. No Site has been registered or published. End-to-end remote connectivity is unverified and requires an approved network/endpoint before completing deployment. The temporary SSH tunnel is stopped; the original loopback app remains available.

Implementation verdict: INTENT GAP / COMMITTED CHANGE. Local transport preparation is verified; the requested hosted, remotely usable application has not been established.
