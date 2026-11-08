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
npm run migrate                      # applies 009 (legal consent) and 010 (device authorizations, sessions.client)
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
| `DESKTOP_SESSION_DAYS` | `SESSION_DAYS` (30) | Lifetime of a session minted through the desktop device login |
| `APP_PUBLIC_ORIGIN` | request origin | Where `/device` lives; only needed when the SPA and API are on different origins (dev: `http://localhost:5173`) |

## Verify after deploy

1. Open `https://ata.uinjakarta.id`, connect a terminal to a host.
2. Kill the network (toggle Wi-Fi off ~10s) while something like `top` runs.
   Expected: the tab shows "Connection lost. Reconnecting…", then the SAME shell
   continues with `top` still running. Behind the edge proxy the relay usually has
   not noticed the drop yet (it needs ~50s of missed pongs), so the log shows
   `[session] detached` with reason `socket_replaced` immediately followed by
   `[session] resumed`: the returning client replaced its stale socket.
3. Leave the network off for ~3 minutes. The relay detects the drop after ~50s
   (`detached`, reason `ws_close`), holds the shell for the 90s grace, then logs
   `detach-expired`. When the network returns the tab falls back to a fresh shell.
   The effective resume window after a silent drop is therefore ≈ 50s + 90s.
4. Check the API logs for `[session] detached` / `resumed` / `detach-expired` and
   `/api/security/session-metrics` (admin login required) for `sessionsDetached`,
   `sessionsResumed` and `detachExpired`.

Watch the relay log live from the laptop while testing:

```bash
ssh -t wazuh@10.88.0.12 "sudo journalctl -u ant-tech-async-api -f -o cat | grep --line-buffered -A9 -E '\[session\] (detached|resumed|detach-expired|reconnect-attempt)'"
```

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

## Desktop runtime against this deployment

The Electron build now targets this deployment by default (`https://ata.uinjakarta.id`).
Override with `ATA_API_ORIGIN=https://…` in the desktop app's environment; in
`NODE_ENV=development` it uses the local API on `API_PORT`. The relay change that
lets the desktop runtime fall back to the relay (`runtime=electron`) lives in
`server/sshWebSocket.js`, so a server restart is part of this release too.

## Desktop device login (server side, Phase 2.6)

Migration `010_device_authorizations.sql` adds the `device_authorizations` table and
`sessions.client / device_label / last_seen_at`. **`npm run migrate` is required** for
this release; the API fails on `/api/auth/device/*` and on every login until it runs
(`createSession` now writes `sessions.client`). Routes: `POST /api/auth/device/start`,
`/poll`, `/approve`, `/deny`, `GET /api/auth/device?code=`, `GET /api/auth/sessions`,
`DELETE /api/auth/sessions/:id`. Design: `docs/DESKTOP_DEVICE_LOGIN_DESIGN.md`.

## Signup email verification (migration 011)

`npm run migrate` applies `011_email_verification.sql`. Existing accounts are
backfilled as verified, so nobody is locked out. New registrations must click a
link before they can sign in, so **mail has to be configured before opening
registration**. Copy the **Email** block from `.env.example` into the VM's `.env` and fill the
values there (never commit real values). Do not wrap values in quotes: they are
read as-is. Check the server's MySQL version first with `SELECT VERSION();`.
Migrations 010 and 011 use plain `ADD COLUMN`, which works on MySQL 8 and MariaDB.

| Variable | Purpose |
|---|---|
| `MAIL_FROM` | sender address, e.g. the university mailbox |
| `SMTP_PRIMARY_HOST`, `SMTP_PRIMARY_PORT` (465), `SMTP_PRIMARY_USER`, `SMTP_PRIMARY_PASS` | primary account (cPanel mailbox) |
| `SMTP_FALLBACK_HOST`, `SMTP_FALLBACK_PORT`, `SMTP_FALLBACK_USER`, `SMTP_FALLBACK_PASS` | optional transactional fallback (used only on transient failure) |
| `APP_PUBLIC_ORIGIN` | origin in the link when the API is not behind the same host |

Migration `012_login_alerts.sql` adds the sign-in alert setting, the known-IP
table and the `email_outbox` table. Every outgoing mail is recorded there and
stops at `EMAIL_DAILY_CAP` (default 150) per UTC day, so the SMTP2GO quota is not
used up silently. Check today's sends with
`SELECT status, COUNT(*) FROM email_outbox WHERE created_at >= UTC_DATE() GROUP BY status;`.
A `mail-fallback-used` line in the API log means the cPanel account failed that
send; the line names the error code, which tells us why.

Without any SMTP setting, registration still succeeds but tells the user the mail
could not be sent; they can request a link later from the sign-in page.
