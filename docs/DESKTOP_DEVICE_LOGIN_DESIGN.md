# Desktop device login — design

Status: **design only, not implemented** (Phase 2.6 in `PROJECT_STATE.md`).
Companion to the tier-2 addendum in `CONNECTION_RESILIENCE_AND_RUNTIME_ANALYSIS.md`.

## 1. Problem

Phase 2.5 made the Electron runtime talk to the hosted deployment
(`https://ata.uinjakarta.id`) through a main-process API proxy. One step is still
blocked: **login**. `POST /api/auth/login` requires a Cloudflare Turnstile token,
and the Turnstile widget only renders on hostnames registered for the site key.
The packaged desktop renderer is a `file://` page, which has no hostname, so the
widget never produces a token and the Sign In button stays disabled.

The requirement is therefore: a way for the desktop runtime to obtain the
ordinary `ats_session` cookie for the hosted API **without** weakening the
human check that protects password login.

## 2. Options considered

| | Option | Verdict |
|---|---|---|
| A | Register a second Turnstile widget for the desktop | Turnstile has no notion of a `file://` origin. It would need a loopback HTTP server inside Electron serving the renderer on a registered hostname, and the challenge iframe inside an Electron window is brittle. Rejected. |
| B | Load the hosted site itself in the `BrowserWindow` (remote renderer) | Solves Turnstile, CORS and cookies at once, but the window runs with `nodeIntegration: true, contextIsolation: false`. Remote content with Node access is a remote-code-execution hole; fixing that means a `contextBridge` refactor of every IPC channel. Rejected for now; noted as the long-term renderer architecture. |
| C | Skip Turnstile when the request says `runtime: electron` | Any HTTP client can say that. Turnstile exists to throttle bots and password guessing on `/api/auth/login`; this would switch it off for everyone. Rejected. |
| D | **Device authorization** (OAuth 2.0 Device Authorization Grant, RFC 8628, adapted) | The desktop never sees the password or a Turnstile token. The human proves themself on the real site, in the system browser, with the existing Turnstile-protected login, then approves the device. **Chosen.** |

Option D also removes the password form from the desktop entirely, which is a
smaller attack surface than option A even if A were feasible.

## 3. Flow

```
Desktop (Electron main)              API (VM 105)                 System browser
──────────────────────               ────────────                 ──────────────
POST /api/auth/device/start ───────▶ create pending row
  {runtime, deviceLabel, appVersion}  deviceCode (secret, hashed)
◀── {deviceCode, userCode,            userCode  (short, shown)
     verificationUrl, expiresIn,
     interval}
show userCode "XXXX-XXXX"
shell.openExternal(verificationUrlComplete) ─────────────────────▶ /device?code=XXXX-XXXX
                                                                   (login w/ Turnstile if needed)
                                                                   shows code + device label
                                     ◀── POST /api/auth/device/approve {userCode}
                                     bind user_id, status=approved
POST /api/auth/device/poll ────────▶
  {deviceCode}   every `interval`s    pending → 428
                                      approved → create session (client=desktop)
◀── 200 {user} + Set-Cookie ats_session   status=consumed (single use)
cookie lands in defaultSession jar
renderer: api.getSession() → signed in; everything after this is unchanged
```

Steps in words:

1. The desktop calls `POST /api/auth/device/start` (no auth, rate limited per
   IP) and receives a secret `deviceCode`, a human-readable `userCode`
   (`XXXX-XXXX`), the `verificationUrl` (`/device`), `verificationUrlComplete`
   (`/device?code=XXXX-XXXX`), `expiresIn` (600 s) and `interval` (5 s).
2. The renderer shows the code. The main process opens the system browser at
   `verificationUrlComplete`, only if its origin equals the configured
   `apiOrigin`.
3. In the browser the SPA route `/device` requires a session: without one it
   redirects to `/login?next=/device?code=…`, where login works as today
   (Turnstile included). The page shows the code (pre-filled but editable), the
   device label, app version, requester IP and request time, and asks the user
   to approve only if the same code is on their desktop screen right now.
   Approve → `POST /api/auth/device/approve`; Deny → `POST /api/auth/device/deny`.
4. The main process polls `POST /api/auth/device/poll` with the `deviceCode`.
   Replies: `428 authorization_pending`, `429 slow_down`, `410 expired`,
   `403 denied`, or `200` with `{ user }` and `Set-Cookie: ats_session=…`. The
   session row is created with `client = 'desktop'` and the device label. The
   cookie is stored in Electron's `defaultSession` cookie jar, the same jar the
   API proxy, the relay cookie injector and `sshHandler` already read.
5. The main process notifies the renderer (`device-login-status`), which calls
   `api.getSession()` through the existing proxy and enters the app.

Nothing downstream changes: connect tokens, relay `runtime=electron`, direct vs
relay transport, detach/resume all keep working on the same cookie.

## 4. Server design

New module `server/deviceAuth.js`, routes wired in `server/index.js`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/device/start` | none | create a pending authorization |
| POST | `/api/auth/device/poll` | `deviceCode` | desktop polls for the verdict |
| POST | `/api/auth/device/approve` | session | browser approves by `userCode` |
| POST | `/api/auth/device/deny` | session | browser denies by `userCode` |
| GET | `/api/auth/sessions` | session | list the user's own sessions (web + desktop) |
| DELETE | `/api/auth/sessions/:id` | session | revoke one session (e.g. a lost laptop) |

### Storage (migration `010_device_authorizations.sql`)

Persisted in MySQL, not in memory: approval and poll arrive from two different
clients and must survive an API restart in the middle of a login.

```sql
CREATE TABLE IF NOT EXISTS device_authorizations (
  id               CHAR(36)     PRIMARY KEY,
  device_code_hash CHAR(64)     NOT NULL,
  user_code        CHAR(8)      NOT NULL,             -- normalized, no dash
  status           ENUM('pending','approved','denied','consumed','expired') NOT NULL DEFAULT 'pending',
  user_id          CHAR(36)     NULL,
  runtime          VARCHAR(16)  NOT NULL DEFAULT 'electron',
  device_label     VARCHAR(120) NULL,
  app_version      VARCHAR(40)  NULL,
  requester_ip     VARCHAR(64)  NULL,
  approver_ip      VARCHAR(64)  NULL,
  poll_count       INT          NOT NULL DEFAULT 0,
  last_polled_at   DATETIME(3)  NULL,
  approved_at      DATETIME(3)  NULL,
  consumed_at      DATETIME(3)  NULL,
  expires_at       DATETIME(3)  NOT NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY device_authorizations_device_code_hash_unique (device_code_hash),
  UNIQUE KEY device_authorizations_user_code_unique (user_code),
  KEY device_authorizations_expires_at_index (expires_at),
  CONSTRAINT device_authorizations_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS client       VARCHAR(16)  NOT NULL DEFAULT 'web' AFTER user_id,
  ADD COLUMN IF NOT EXISTS device_label VARCHAR(120) NULL AFTER client,
  ADD COLUMN IF NOT EXISTS last_seen_at DATETIME(3)  NULL AFTER expires_at;
```

Rows whose `expires_at` has passed are swept by a `setInterval` like the
connect-token store, and also lazily on every lookup.

### Codes

- `deviceCode`: 32 random bytes, base64url. Stored only as SHA-256. Travels once
  (start response) and then only in poll bodies over TLS. Never logged.
- `userCode`: 8 characters from `BCDFGHJKMNPQRSTVWXZ23456789` (no vowels, so no
  accidental words; no `0/O`, `1/I/L`). Displayed as `XXXX-XXXX`; input is
  uppercased and stripped of dashes and spaces. 27^8 ≈ 2.8 × 10^11 values,
  unique among live rows, valid 10 minutes, and approval attempts are throttled
  (below), so guessing is infeasible.

### Limits and state rules

- `start`: 10 per IP per 10 minutes, at most 3 pending rows per IP (older
  pending rows from the same IP are expired first). `deviceLabel` ≤ 120 chars,
  `appVersion` ≤ 40, `runtime` must be `electron`.
- `poll`: the server enforces `interval`; a poll sooner than that returns
  `429 slow_down` and the client adds 5 s. `poll_count`/`last_polled_at` are
  updated for the security log.
- `approve` / `deny`: 5 wrong codes per user per 10 minutes → `429` and
  `[access] deviceAuthRejected reason=rate_limited`. Only `pending` rows can be
  approved; approval records `user_id`, `approver_ip`, `approved_at`.
- `poll` on an `approved` row creates the session, sets `consumed_at` and
  `status = consumed`. A second poll with the same code gets `410`. Single use.
- The approving session's user must be `approval_status = approved` (the
  existing login rule), so a pending/rejected account cannot mint a desktop
  session through this path either.
- `verificationUrl` is built from `APP_PUBLIC_ORIGIN` when set, else from the
  request's `x-forwarded-proto`/`host`. In production the SPA and the API share
  the origin; in development the SPA is on `:5173` and the API on `:8790`, so
  `APP_PUBLIC_ORIGIN=http://localhost:5173` goes in the dev `.env`.

### Session issuance

`createSession(userId, { client: 'desktop', deviceLabel })` in `server/auth.js`
gains that second argument (default `{ client: 'web' }`). Lifetime
`DESKTOP_SESSION_DAYS`, default = `SESSION_DAYS` (30). The cookie header is the
existing `sessionCookieHeader(token, req)`; `Secure` is set because the edge
proxy forwards `x-forwarded-proto: https` (the web login already relies on
this). `last_seen_at` is touched by `getSessionUser` at most once per minute.

Logout from the desktop uses the existing `POST /api/auth/logout`, which
deletes the row. Admin rejection already deletes all sessions of a user.

### Logging and metrics

`[access]` events: `deviceAuthStarted`, `deviceAuthApproved`, `deviceAuthDenied`,
`deviceAuthConsumed`, `deviceAuthExpired`, `deviceAuthRejected` (with `reason`:
`unknown_code`, `not_pending`, `rate_limited`, `slow_down`). Payloads carry the
row `id`, `userId`, `deviceLabel`, IPs and `pollCount`; never either code.
Counters in `securityMetrics.js`: `deviceAuthStarted`, `deviceAuthApproved`,
`deviceAuthRejected`, exposed on `/api/security/access-metrics`.

Turnstile stays exactly where it is (`register`, `login`). The device endpoints
need none: `start` and `poll` cannot authenticate anyone on their own, and the
only way a row becomes `approved` is through a session that was itself created
by the Turnstile-protected login.

## 5. Electron design

New module `electron/deviceLogin.js` (pure Node, injectable `fetchImpl`,
`openExternal`, timers so it is unit-testable without an Electron binary):

```
idle → requesting → awaiting_approval(userCode, verificationUrl, expiresAt)
                      ├─ approved(user)      → renderer refetches session
                      ├─ denied
                      ├─ expired
                      ├─ cancelled           (user or window close)
                      └─ error(message)
```

- `startDeviceLogin({ apiOrigin, fetchImpl, openExternal, deviceLabel, appVersion })`
  returns `{ userCode, verificationUrl, expiresAt, cancel() }` and drives the
  poll loop with the server's `interval`, honouring `slow_down`, stopping at
  `expiresAt`, with an `AbortController` for cancel. One flow per window.
- `deviceLabel = `${os.hostname()} (${process.platform})``,
  `appVersion = app.getVersion()`.
- `openExternal` is guarded: `new URL(url).origin === apiOrigin`, otherwise the
  flow fails closed. Nothing from the server response is opened blindly.
- Polling uses `session.defaultSession.fetch(url, { credentials: 'include' })`
  so the `Set-Cookie` on the final poll lands in the same jar the rest of the
  runtime reads. This is the same assumption Phase 2.5 made for login and is
  verified in the first end-to-end run. Plan B if Chromium does not persist it:
  the poll response additionally returns `sessionToken` and the main process
  calls `session.defaultSession.cookies.set(...)`; only to be enabled if the
  first run proves it necessary, because then the token transits JSON.
- IPC: `device-login-start` (invoke → `{ userCode, verificationUrl, expiresAt }`),
  `device-login-cancel`, `device-login-open` (re-open the browser), and the
  event `device-login-status` (`webContents.send`) for state changes.
- Renderer: `src/lib/deviceLogin.ts` wraps the IPC. In Electron
  (`window.ipcRenderer` present) the `/login` route renders a **"Sign in with
  your browser"** panel instead of the password form: the code in large
  monospace, "Open browser" (re-open), a countdown, the status line, Cancel.
  On `approved` the app calls `api.getSession()` and proceeds as if the form
  had been submitted. The password form is not shown in the desktop build at
  all; in development (`localhost:5173`, local API) both paths work and the
  panel offers "use password instead" for local testing.
- Settings → **Devices**: lists `GET /api/auth/sessions` (client, label,
  created, last seen, "this device") with a Revoke button. Same component in the
  web app.

## 6. Threat model

| Threat | Mitigation |
|---|---|
| Phishing: attacker sends a victim `…/device?code=<attacker's code>` so the victim approves the attacker's desktop | The page shows the device label, requester IP and time, with the warning to approve only if the same code is on the user's own desktop screen now; the code is displayed on both ends; 10-minute expiry; Deny button; `deviceAuthApproved` is logged with both IPs. This residual risk is inherent to the device-code pattern (RFC 8628 §5.4) and is accepted for an admin-approved user base. Step-up (re-enter password on approve) can be added later for admin accounts. |
| Guessing a `userCode` | 2.8 × 10^11 space, 5 wrong attempts per user per 10 min, 10-minute lifetime, unique among live rows. |
| `deviceCode` leak | Hashed at rest, TLS in transit, single use, 10-minute lifetime. |
| Flooding `start` | Per-IP limit and pending cap; rows are small and swept. |
| CSRF on `approve` | JSON `POST` from the same-origin SPA; `SameSite=Lax` keeps the cookie out of cross-site POSTs; the route also rejects a mismatching `Origin` header. |
| Desktop cookie theft | Chromium encrypts its cookie store with the OS keychain on macOS/Windows; the Devices list revokes a stolen session; same risk class as the existing `safeStorage` credential vault. |
| Approval from a pending/rejected account | `approve` checks `approval_status = approved` like login does. |

## 7. Rollout

1. Server: migration 010, `server/deviceAuth.js`, routes, `createSession` client
   argument, sessions list/revoke; Jest tests for code format, state
   transitions, single use, rate limits and the `Origin` check.
2. SPA: `/device` route, Devices panel; `next=` handling on `/login`.
3. Electron: `electron/deviceLogin.js` + IPC + login panel; Jest tests with
   injected fetch/timers.
4. Deploy VM 105 (**`npm run migrate` is required this time**), then the first
   desktop run with `ATA_API_ORIGIN=https://ata.uinjakarta.id` verifies the
   cookie-jar assumption end to end.

Rough size: ~600 lines of code plus tests, three commits (server, web, desktop).

## 8. Decisions left open

- Desktop session lifetime: 30 days (same as web) or longer, e.g. 90 days with
  `last_seen_at`-based idle expiry.
- Step-up on approval (re-enter password): recommended **off** for now, on for
  admin accounts later.
- Email notification on a new device approval: skipped, the project has no
  outbound mail.
