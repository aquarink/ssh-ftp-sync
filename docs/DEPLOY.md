# Deploy runbook — VM 105 (ata.uinjakarta.id)

Production topology (see `docs/CONNECTION_RESILIENCE_AND_RUNTIME_ANALYSIS.md`):

```
Browser ──HTTPS/WSS──▶ VPS gateway (38.47.180.2, Caddy, reverse_proxy 10.88.0.12:80)
                          └─ WireGuard ─▶ VM 105 (10.88.0.12 / 172.20.32.25)
                                            Caddy :80  → static dist/ + /api/* → Node API 127.0.0.1:8790
```

App directory on VM 105: `/var/nginx/ssh-ftp-sync/`. The API is a plain Node process
(`npm run api`, i.e. `node server/index.js`), started by whatever service manager the
host uses (systemd / nohup). Caddy serves `dist/` and proxies `/api/*`.

## Steps

Run these on VM 105 (reachable over WireGuard `10.88.0.12` or campus LAN `172.20.32.25`).

```bash
cd /var/nginx/ssh-ftp-sync
git pull origin main                 # fast-forward to the merged main (947f32b or later)
npm install                          # lockfile changed (eslint/test deps)
npm run migrate                      # applies 009_user_legal_consent.sql (from Phase 4)
npx vite build                       # regenerate dist/ for Caddy
```

Do NOT run `npm run build`: that also runs `electron-builder`, which is for packaging the
desktop app, not for the server. Only `npx vite build` (frontend) is needed here.

Then restart the Node API so the new relay code (reconnect + detach/resume) takes effect.
Use whichever matches your setup:

```bash
# systemd (if a unit exists; replace the unit name with the real one)
sudo systemctl restart ant-tech-async-api

# or, if started with nohup
pkill -f 'node server/index.js'
nohup npm run api >/tmp/ant-tech-async-api.log 2>&1 &
```

Caddy needs no change: it keeps serving the rebuilt `dist/` and proxying `/api/*`.

## New / relevant environment variables

All have safe defaults in code; set them in `.env` on the VM only to override.

| Variable | Default | Purpose |
|---|---|---|
| `DETACHED_SESSION_GRACE_MS` | `90000` | How long a detached browser shell is held for resume |
| `DETACHED_OUTPUT_BUFFER_BYTES` | `262144` | Max output buffered while detached |
| `RESUME_TOKEN_TTL_MS` | `3600000` | Resume token lifetime (grace timer is the real bound) |
| `WS_KEEPALIVE_INTERVAL_MS` | `25000` | Relay ping interval |
| `WS_MAX_MISSED_PONGS` | `2` | Missed pongs before a dead peer is dropped |
| `CONNECT_*_LIMIT_*` | raised in Phase 4 | Connect-token / attempt rate limits (comfortably fit the 6-attempt reconnect budget) |

## Verify after deploy

1. Open `https://ata.uinjakarta.id`, connect a terminal to a host.
2. Kill the network (toggle Wi-Fi off ~10s) while something like `top` runs.
   Expected: the tab shows "Connection lost. Reconnecting…", then the SAME shell
   continues with `top` still running (resume within the 90s grace window).
3. Leave it off past 90s: expected automatic fallback to a fresh shell in the same tab.
4. Check the API logs for `[session] detached` / `resumed` events and
   `/api/security/session-metrics` for `sessionsDetached` / `sessionsResumed`.

## Security follow-up (do this)

The repo's `origin` remote URL has a GitHub Personal Access Token embedded in plaintext
in `.git/config`. It was exposed during this session and also lacks the `workflow` scope
(so it cannot push `.github/workflows/*`). Rotate it:

1. Revoke the token at GitHub → Settings → Developer settings → Personal access tokens.
2. Issue a new token (add the `workflow` scope if CI workflow files are edited from git).
3. Update the remote without embedding the token in the URL, e.g. use a credential helper
   or SSH remote instead of `https://user:token@github.com/...`.

The CI workflow steps for the Jest suite and the relay resume integration test were left
out of `.github/workflows/ci.yml` on this push because the current token cannot update
workflow files. Add them from the GitHub UI, or push with a `workflow`-scoped token:

```yaml
      - name: Unit tests (Jest)
        run: npx jest server
      - name: Relay detach/resume integration test
        run: node scripts/integration/relay-resume-test.js
```
