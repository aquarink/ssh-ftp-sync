# Connection Resilience & Runtime Topology Analysis

Date: 2026-11-01
Scope: Phase 2 research input for Ant Tech Async (deployed at `https://ata.uinjakarta.id`)

This document analyses two gaps reported from production use and proposes a design
for each. It is written as a research note: findings are tied to the current code,
and each proposal states its security trade-off so it can be evaluated against the
Phase 1 principles (identity scoping, secret isolation, deterministic cleanup,
zero-trust connect authorization).

Gaps analysed:

1. A dropped client connection ends the SSH session immediately. There is no
   reconnect attempt and no way to resume the shell.
2. The desktop (Electron) runtime cannot be used against the hosted deployment,
   and hosts that live behind a VPN (Proxmox guests on WireGuard `10.88.0.0/24`
   or campus LAN `172.20.32.0/24`) are confusing to reach because the app does not
   make the *network origin* of a connection explicit. There is also no
   offline / localhost mode.

---

## 1. Production topology (as deployed)

```
Browser ──HTTPS/WSS──▶ VPS gateway (38.47.180.2, Caddy)
                          │  reverse_proxy 10.88.0.12:80
                          ▼  (WireGuard tunnel)
                      VM 105 "wazuh-grafana" (10.88.0.12 / 172.20.32.25)
                          Caddy :80 ── static dist/ + /api/* ──▶ Node API 127.0.0.1:8790
                                                                    │ ssh2 (relay)
                                                                    ▼
                                                     target hosts reachable FROM VM 105
                                                     (10.88.0.x via WireGuard, 172.20.32.x via LAN)
```

Observations:

- The WebSocket relay path has **three hops** (browser → VPS Caddy → WireGuard → VM Caddy → Node).
  A WireGuard flap between the VPS and VM 105 kills every active browser terminal, even though
  neither the browser nor the SSH target changed state.
- The relay process itself runs *inside* the private networks. In browser mode the SSH TCP
  connection originates from VM 105, so **the browser user does not need a VPN** to reach
  `10.88.0.x` or `172.20.32.x` targets. This is the bastion / jump-host pattern, but the UI never
  says so, which is the root of the "do I need VPN?" confusion.
- `PROJECT_STATE.md` and `src/lib/api.ts` still describe the old Nginx + ModSecurity deployment
  at `ant-tech-async.mobwn.my.id`. The Caddy deployment at `ata.uinjakarta.id` is undocumented
  and the packaged-desktop API fallback URL in `api.ts` points at the old domain.

Things to verify on VM 105 (not verified from this workstation, which was outside the VPN):

- `wg show` latest handshake and whether `PersistentKeepalive = 25` is set on the VM 105 peer.
  Without it a NAT mapping can expire during idle periods and the first packets after idle are
  dropped, which presents as "random" terminal disconnects.
- Caddy `reverse_proxy` on the VPS: default stream timeouts are unlimited, but confirm no
  `stream_timeout` / `stream_close_delay` was added.

---

## 2. Gap 1 — No reconnect, no resume

### 2.1 Current behaviour (code)

Browser relay (`server/sshWebSocket.js`, `src/components/TerminalView.tsx`):

| Event | Server | Client |
|---|---|---|
| WebSocket closes for any reason | `ws.once('close') → cleanupSession('ws_close')` ends the ssh2 client and shell | `socket.onclose → onClosed()` sets tab to `closed` with "Reconnect from the host list" |
| SSH stream closes | sends `closed`, closes ws, cleanup | tab `closed` |
| SSH error | sends generic error, closes ws, cleanup | tab `error` |

- The shell is torn down the moment the transport drops. A laptop sleeping for 5 seconds, a
  Wi‑Fi roam, or a WireGuard rekey hiccup destroys the session and the scrollback is lost on
  the next connect.
- `sessionLifecycle.js` already defines `SESSION_STATE.RECONNECTING` and `markReconnectAttempt()`,
  but the browser relay never uses them. Only the Electron session manager calls it, and only to
  replace an existing session id.
- The server pings the WebSocket every 25 s but never tracks `pong`, so a half-open socket is only
  detected by TCP timeout. ssh2 keepalive is 25 s × 3 (≈75 s) before a dead SSH peer is noticed.
- Connect authorization is **one-time** and short-lived (`CONNECT_TOKEN_TTL_MS` 60 s) and rate
  limited (8 token issues per host per minute, 12 connect attempts per host per minute in
  `server/accessPolicy.js`). Any automatic retry loop must request a fresh token per attempt and
  back off, or it will trip the 429 limit it was designed to enforce.

Electron (`electron/terminalSessionManager.js`):

- SSH runs in the main process; the IPC "transport" never drops, so only SSH-level failures matter.
  On `error` / `close` the session is cleaned up and the renderer shows the tab as closed.
  No retry.

### 2.2 Two different problems hiding in "reconnect"

| Case | What died | What the user wants | Mechanism |
|---|---|---|---|
| A. Transport drop | WebSocket / WireGuard / Wi‑Fi | Same shell, same scrollback, same running `vim` | **Detach + resume** (keep ssh2 session alive server-side for a grace period) |
| B. SSH drop | ssh2 connection (host reboot, VPN down, idle kill) | A new shell in the same tab without clicking through the host list | **Auto re-establish** with backoff and a fresh connect token |

Case A only exists in the browser relay (Electron has no network transport between UI and
SSH). Case B exists in both runtimes.

### 2.3 Design — Case B: auto re-establish (both runtimes)

Client-side policy, no server changes required:

- Keep the `xterm` instance when the socket closes. Do not dispose it on `onclose`; only on tab
  close / unmount. Print a dim status line into the terminal ("connection lost, retrying in 2 s").
- Backoff schedule: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s (cap), max 6 automatic attempts, then a
  manual **Reconnect** button. Jitter ±20 %.
- Each attempt calls `api.requestConnectToken()` then opens a new WebSocket (browser) or re-sends
  `ssh-connect` with the **same tab id** (Electron; `TerminalSessionManager.connect` already treats
  an existing id as a reconnect and records `markReconnectAttempt`).
- Trigger an immediate attempt (resetting backoff) on `window` `online` and on `visibilitychange`
  to visible; pause attempts while `navigator.onLine === false`.
- Do not auto-retry on `explicit_disconnect`, on auth/policy errors (401/403 from token issue), or
  when the server sent `closed` after a clean shell exit (user typed `exit`). Only retry on
  abnormal close (ws close code ≠ 1000, `client_error`, `client_end` without prior `closed`).
- Budget: 6 attempts × 1 token each stays under the 8 issue / 12 connect per-host limits.

New tab states: `connecting | connected | reconnecting | error | closed`, with `attempt` and
`nextRetryAt` for the UI.

Security trade-off: none new. Every attempt goes through the full zero-trust path
(token → policy → identity resolve → ephemeral credential → clear). No secret is cached on the
client.

### 2.4 Design — Case A: detach + resume (browser relay)

Server (`server/sshWebSocket.js`, `server/sessionLifecycle.js`):

1. On `ws close` where the close was not an explicit `disconnect` message and the session is
   `connected`, do **not** cleanup. Transition to a new state `DETACHED`:
   - keep `conn` and `stream` open,
   - start a grace timer `DETACHED_SESSION_GRACE_MS` (default 90 s, env-configurable),
   - start buffering shell output into a bounded ring buffer (default 256 KiB) instead of sending,
   - send nothing to the SSH side (the remote shell keeps running).
2. On grace expiry: `cleanupSession('detached_expired')`. The sweeper treats `DETACHED` as a
   pending state with its own timeout.
3. A new upgrade `GET /api/ssh?resume=<sessionId>&resumeToken=<token>`:
   - authenticates the cookie session as today,
   - requires `session.userId === user.id` and `state === DETACHED`,
   - validates a **resume token** (see below),
   - attaches the new `ws`, replays the ring buffer, sends `resumed`, re-sends current window size,
     and returns the session to `CONNECTED`.
4. Logout, host deletion and identity deletion already call cleanup by user; `DETACHED` sessions
   must be included so a detached shell never outlives the account session that created it.

Resume token (zero-trust layer, `server/connectToken.js` / `accessPolicy.js`):

- Issued by the relay at the moment the shell becomes ready and delivered in the `connected`
  message: `{ type: 'connected', sessionId, resumeToken, resumeTtlSeconds }`.
- Scoped to `userId + sessionId + purpose:'resume'`, HMAC-signed with the same secret, one-time:
  every successful resume issues a fresh token for the next drop.
- Its lifetime equals the grace period; it is invalidated by cleanup.
- Add `'resume'` to `allowedPurposes` and give it its own rate limit (e.g. 10 per session per
  minute) so a client cannot hammer the relay.

Client (`TerminalView.tsx`):

- On abnormal close: if a `resumeToken` is held and the grace window has not elapsed, attempt
  resume first with the same backoff; on `resume_unavailable` (session expired or server
  restarted) fall through to Case B.
- On successful resume: clear the status line and let the replayed buffer catch the terminal up.

Dead-peer detection (both sides, cheap and worth doing first):

- Server: track `isAlive` per ws; set false on ping, true on `pong`; terminate after 2 missed
  pongs (≈50 s). This moves a half-open socket into `DETACHED` quickly instead of waiting for TCP.
- Client: if no message (data or server `ping` frame visibility is not exposed in browsers) for
  `2 × keepalive`, send `{type:'activity'}` and treat lack of any frame for 60 s as dropped.

Security trade-off (must be stated in the thesis): a `DETACHED` session is an authenticated
remote shell held by the relay with no client attached. Phase 1.4 argued for *deterministic
teardown*; detach relaxes that by a bounded, logged, user-scoped grace window. Mitigations are the
bound itself, the resume token, user-scoped cleanup, output buffer cap, and security-log events
`sessionDetached`, `sessionResumed`, `sessionDetachExpired`. This maps directly onto the
secondary research question "how should a hybrid client preserve session continuity without
weakening authentication or secret isolation?"

### 2.5 Verification plan

- Extend `scripts/integration/mock-ssh-test.js` with: (a) abrupt ws close → session enters
  `DETACHED`, shell still open, output buffered; (b) resume within grace → buffer replayed,
  state `CONNECTED`; (c) resume after grace → `resume_unavailable`, session cleaned;
  (d) resume with another user's cookie → 403, no state change.
- Manual: in the browser, toggle Wi‑Fi off for 10 s while `top` runs; expect the same tab to
  show "reconnecting…" then continue with `top` still running. Repeat with 2 minutes off; expect
  automatic fallback to a fresh shell.
- Record `reconnectAttempts`, new metrics `sessionsDetached`, `sessionsResumed`,
  `detachExpired` in `/api/security/session-metrics` as evaluation evidence.

---

## 3. Gap 2 — Runtime topology, VPN, and offline mode

### 3.1 The three runtimes that actually exist

| Runtime | Where the UI runs | Where SSH TCP originates | Who holds the secret during connect | Needs VPN on laptop for `10.88.0.x`? |
|---|---|---|---|---|
| Cloud relay (today, browser) | browser | **VM 105** | relay (server vault, ephemeral) | **No** — relay is inside WireGuard/LAN |
| Desktop direct (Electron, intended) | Electron | **laptop** | Electron `safeStorage`, ephemeral | **Yes** |
| Desktop local / offline (does not exist) | Electron | laptop | Electron | Yes |

The first row is the answer to the VPN question: for Proxmox guests the browser runtime is the
*easier* path, because the relay already has the VPN. The product gap is that the app never
tells the user which origin a connection uses, and never checks reachability before connecting.

### 3.2 Why the desktop runtime does not work against the hosted deployment

Found in code, not yet tested live:

- `electron/sshHandler.js` consumes the connect token and verifies the renderer's session cookie
  against `http://127.0.0.1:8790`. The renderer (`src/lib/api.ts`) talks to the remote origin
  when loaded from `file:`. The cookie `ats_session` therefore exists for `ata.uinjakarta.id`,
  not for `127.0.0.1`, and every `ssh-connect` fails with "No active session cookie found".
  In other words the desktop runtime *implicitly requires a local backend* — which is exactly the
  localhost mode the project does not support.
- Even if the main process targeted the remote origin, a `file://` renderer calling
  `https://ata.uinjakarta.id/api` is cross-origin: the API sets no CORS headers and the cookie is
  `SameSite=Lax`, so `credentials: 'include'` would not carry it.
- The `file:` fallback URL in `api.ts` is the retired domain.
- `electron/main.js` runs with `nodeIntegration: true, contextIsolation: false`. That is already
  flagged as debt; it becomes a hard blocker if the shell ever loads remote content.

### 3.3 Why offline / localhost does not work

The backend hard-depends on: MySQL (`server/db.js`), Cloudflare Turnstile on login/register
(503 "Human verification is not configured" without a key, and outbound internet to Siteverify),
QuickEmailVerification on register, and admin approval. None of these can run on an offline
laptop.

### 3.4 Proposal — explicit runtime profiles

Define the runtime as a first-class, user-visible concept instead of `window.ipcRenderer ? 'electron' : 'browser'`:

```
profile = cloud-relay    | desktop-cloud          | desktop-local
auth    = cloud account  | cloud account          | local account (no Turnstile/email)
api     = same origin    | https://ata…           | http://127.0.0.1:<port> (embedded)
ssh from= relay (VM 105) | laptop                 | laptop
vault   = server vault   | safeStorage            | safeStorage
```

Steps, in dependency order:

1. **Unify the API origin.** One `apiBaseUrl` resolved at startup (env `VITE_API_BASE_URL` for
   the renderer, the same value handed to main via `process.env` or an IPC `runtime-config`
   call). Main reads the cookie with `cookies.get({ url: apiBaseUrl })` and consumes tokens at
   `${apiBaseUrl}/api/security/connect-token/consume`. Remove the hardcoded `127.0.0.1` and the
   retired domain.
2. **Make the desktop shell same-origin.** Preferred: `win.loadURL(apiBaseUrl)` so the hosted
   `dist/` is the UI (single build, cookies first-party, no CORS). This *requires* finishing the
   renderer hardening: `contextIsolation: true`, `nodeIntegration: false`, a `contextBridge`
   preload exposing only the `ssh-*`, `sftp-*`, `identity-*`, `session-*` channels, and a
   `will-navigate` / `setWindowOpenHandler` allowlist pinned to the API origin. Alternative if
   remote UI loading is undesirable: keep `file://` and add an explicit CORS allowlist for the
   app's custom origin plus `SameSite=None; Secure` cookies — more moving parts, less safe.
3. **Store the network origin on the host record.** Add `connectionPath: 'relay' | 'direct' | 'auto'`
   and an optional `networkZone` label ("WireGuard 10.88", "Campus LAN"). The host card shows
   "via relay" / "direct from this device".
4. **Reachability preflight.** `POST /api/hosts/:id/reachability` performs a TCP connect with a
   3 s timeout *from the relay*; Electron performs the same check locally. The connect dialog
   shows both results ("Relay: reachable · This device: unreachable, VPN required"). With
   `connectionPath: 'auto'` the desktop picks direct if reachable, otherwise falls back to the
   relay path — which is just the existing browser WebSocket flow, already available inside
   Electron.
5. **Relay egress policy (security, required once the relay is advertised as a bastion).** Today
   any approved account can add a host with any IP and the relay will open a TCP connection to it
   from inside the campus LAN. Add `RELAY_ALLOWED_CIDRS` (admin-managed allowlist, default
   deny for RFC1918 unless listed), log the resolved destination in access events, and reject
   DNS names that resolve into disallowed ranges. This is the same class of risk as SSRF and is
   a good Phase 2 security contribution.
6. **Desktop-local profile.** Embed the API in the Electron main process
   (`require('../server/index.js')` behind a `startEmbeddedApi()` export) bound to `127.0.0.1`,
   with `AUTH_MODE=local` that disables Turnstile and email verification and auto-approves the
   first local admin, and a SQLite adapter for `db.js` (`better-sqlite3` exposing the same
   `execute(sql, params)` shape; MySQL-specific SQL such as `UTC_TIMESTAMP()` and
   `ON DUPLICATE KEY` needs a small dialect shim). Host records stay local; cloud sync becomes a
   later, optional layer.

### 3.5 Optional research angle — end-to-end SSH through the relay without VPN

For desktop users who are outside the VPN but want the *desktop* trust model (keys never leave
the laptop), the relay can offer an authenticated raw TCP tunnel instead of a terminal relay:

```
Electron ssh2 Client ──connect({ sock })──▶ WebSocket /api/tunnel?hostId=…&connectToken=…
                                               (relay just pipes bytes to host:22 inside WireGuard)
```

- ssh2 accepts any Duplex stream as `sock`, so the SSH handshake and encryption are end-to-end
  between the laptop and the target. The relay sees ciphertext only; the server vault is not
  involved; the existing connect-token scope (`purpose: 'tunnel'`) and the CIDR egress policy
  still gate it.
- This gives a clean comparison table for the thesis: relay-terminal (server holds secret, works
  in a browser) vs tunnel (secret stays on device, needs desktop) vs direct (needs VPN).
- It also removes the need to ship a VPN client inside the app, which is out of scope.

---

## 4. Recommended order of work

| # | Item | Runtime | Effort | Depends on |
|---|---|---|---|---|
| 1 | Pong tracking + dead-peer detection — **done 2026-11-01** (`server/wsKeepalive.js`) | relay | ½ day | — |
| 2 | Auto re-establish with backoff, Reconnect button, keep xterm buffer (Case B) — **done 2026-11-01** (`src/lib/reconnectPolicy.ts`, `TerminalView.tsx`) | both | 1 day | — |
| 3 | Detach + resume with resume token and metrics (Case A) — **done 2026-11-01** (`server/resumeToken.js`, `sshWebSocket.js`) | relay | 2–3 days | 1 |
| 4 | Unified API origin + Electron same-origin shell + contextBridge hardening | desktop | 2 days | — |
| 5 | Host `connectionPath` + reachability preflight + relay CIDR allowlist | both | 2 days | 4 |
| 6 | Docs: replace Nginx/mobwn deployment notes with the Caddy/`ata.uinjakarta.id` topology | — | ½ day | — |
| 7 | WebSocket TCP tunnel for desktop (end-to-end SSH through relay) | desktop | 2 days | 4, 5 |
| 8 | Desktop-local profile (embedded API, SQLite, local auth) | desktop | 1 week | 4 |

Items 1–3 close Gap 1 completely. Items 4–5 make the desktop runtime usable and make the VPN
question disappear from the UI. Items 7–8 are research extensions.

## 5. Mapping to the research questions

- "How should a hybrid client preserve session continuity without weakening authentication or
  secret isolation?" → §2.4 detach/resume with bounded grace and resume tokens; evaluation via
  the new session metrics.
- "What failure modes appear when a browser tab, window, or desktop window closes unexpectedly?"
  → §2.1 table, extended with transport-vs-SSH failure classification.
- "What architecture is appropriate for a cloud SSH client that supports both browser relay and
  native desktop use?" → §3.4 runtime profiles with explicit network origin, §3.5 tunnel mode.
- Novelty angle to add: *relay-as-bastion with egress policy* and *origin-explicit connection
  paths*, which existing tools (Termius, Tabby, web gateways) treat implicitly.

## Addendum (2026-11-01): resume must replace a stale socket behind an edge proxy

Production finding while preparing the resume test on `ata.uinjakarta.id`. The WebSocket
path is browser → edge Caddy (38.47.180.2) → WireGuard → VM Caddy → relay. When the
laptop loses Wi‑Fi only the first leg dies, and it dies silently: the edge proxy keeps
its upstream connection to the relay open, so the relay sees no `close` event. It only
learns about the drop through the dead-peer monitor (2 missed pongs ≈ 50 s).

The first release gated `resumeSession` on `state === DETACHED`. A client coming back
within those ~50 s therefore got `409 Session is not resumable` and fell back to a fresh
shell — the short drops the feature exists for were the one case it did not cover.

Fix: a session is resumable when DETACHED **or** CONNECTED with a live shell.
`ctrl.resume()` then detaches the stale socket (`detached`, reason `socket_replaced`),
terminates it and attaches the new one; the stale socket's later `close` is ignored by
the existing `ctrl.ws !== closingWs` guard. The trust boundary is unchanged: the resume
token is one-time and bound to user + session, and the request must also carry the
user's own authenticated cookie, which already allows opening new sessions. Covered by
the `stale:` checks in `scripts/integration/relay-resume-test.js` (19/19).

Timing consequence: the 90 s grace runs from the moment the relay *detects* the drop, so
the effective resume window after a silent drop is ≈ 50 s (detection) + 90 s (grace).
A future tuning knob is `WS_KEEPALIVE_INTERVAL_MS` (25 s) × `WS_MAX_MISSED_PONGS` (2).

## Addendum (2026-11-01): runtime VPN awareness (Electron)

The research question "can the app recognise the computer's VPN, or carry its own?"
splits into two different things.

**Awareness** — observing VPN state and reachability.
- Browser runtime: not possible in any reliable way. Browsers deliberately hide
  interfaces, routes and VPN state; WebRTC local-IP leaks are closed and Chrome is
  gating local-network probing behind the Local Network Access permission. The only
  signal is server-side (the client's source IP), and through `ata.uinjakarta.id`
  the browser always arrives from the public internet.
- Electron runtime: straightforward. The Node main process can read
  `os.networkInterfaces()` and open a TCP probe. Implemented in
  `electron/networkAwareness.js` (read-only, no privileges) and exposed over the
  `network-assess` IPC channel. It reports the VPN-style interfaces that are up
  (`utun*`, `wg*`, `tun*`, "WireGuard Tunnel", …), whether the target accepts a TCP
  connection, and a hint: `reachable`, `unreachable`, `vpn_required` (private target,
  no VPN interface), `vpn_route_missing` (VPN up but its subnet does not cover the
  target — the exact failure seen on 2026-11-01, where the laptop's tunnel was up
  but `10.88.0.0/24` was not routed) or `dns_failed`. The UI shows the one-line
  summary while connecting and the hint-specific advice on a failed connect.
  Known limit: tunnels that report a `/32` (common on Windows WireGuard) cannot be
  matched to the target's subnet, so an unreachable target there reads as
  `vpn_route_missing`; wording keeps it a hint, not a verdict.

**Embedding** — making the runtime a VPN peer.
- Browser: impossible (no raw UDP, no TUN). The relay already acts as a bastion
  inside the VPN, which is why the browser runtime reaches `10.88.0.x` without the
  laptop being on VPN. WireGuard-in-WASM over WebSocket (as in Tailscale's
  `tsconnect`) exists but is a large project with no gain here.
- Electron: possible but expensive. Creating a TUN device needs privileges (root or
  a signed Network Extension on macOS, an admin-installed driver on Windows,
  `CAP_NET_ADMIN` on Linux), i.e. shipping a full VPN client with its security and
  distribution burden.

Recommended tiers: (1) awareness — done; (2) Electron through the hosted relay when
the target is unreachable directly (needs the cookie/origin mismatch fixed);
(3) a launcher that activates the OS's existing WireGuard tunnel; (4) embedded
WireGuard only as a chapter on limits, not as a feature. The thesis framing is
"VPN awareness + bastion" versus "VPN embedding".

## Addendum (2026-11-01): the desktop runtime against the hosted deployment (tier 2)

Why the Electron build never worked against `ata.uinjakarta.id`: three halves of
the app disagreed about the backend, and the browser platform blocked the rest.

- The renderer hard-coded a retired hostname for `file://` builds, while the main
  process consumed connect tokens and verified sessions on `127.0.0.1:8790`.
- A `file://` page fetching an `https://` API is a cross-site request. The API has
  no CORS, and its `SameSite=Lax` session cookie is withheld on cross-site requests
  and WebSocket handshakes. So the desktop renderer could not even log in.
- The relay consumed every token with `runtime: 'browser'`, so a token issued to
  the Electron runtime was refused on the relay by the scope check.

What changed (nothing on the server was loosened):

- `electron/appConfig.js`: one API origin for the desktop runtime
  (`ATA_API_ORIGIN` → local API in development → `https://ata.uinjakarta.id`),
  published to the renderer synchronously from preload as `window.__ATA_CONFIG__`.
  `sshHandler.js` reads cookies, verifies the session and consumes tokens against it.
- `electron/apiProxy.js`: the renderer's `request()` goes over IPC (`api-request`)
  and the main process fetches with the Electron session's cookie jar
  (`session.defaultSession.fetch`). Path is restricted to same-origin `/api/...`;
  only `Content-Type`/`Accept` are forwarded. The relay WebSocket is still opened by
  the renderer (same code as the browser), and the main process injects the session
  cookie into that one handshake via `webRequest.onBeforeSendHeaders`.
- Relay (`server/sshWebSocket.js`): `runtime=electron` in the query is consumed
  with that runtime, so the scope check still binds the token to the runtime it was
  issued for. The session record keeps `runtime: 'electron'`, which is how an
  "Electron via relay" session is distinguishable from a browser one in metrics.
- Transport selection (`src/lib/networkAwareness.ts`, `App.tsx`, `TerminalView`):
  on connect and reconnect the desktop runs the tier‑1 check first, then uses
  `direct` (ssh2 in the main process) when the target answers, or `relay`
  otherwise. The browser has only `relay`. Detach/resume applies to relay sessions
  only; direct sessions live in the main process and keep the reconnect policy.

Remaining gap, deliberately left: login still needs a Turnstile token, and the
widget is bound to the site's hostname, so it may not render inside a `file://`
page. Either register a desktop-specific widget/hostname or give the desktop
runtime its own first-party auth path (device token). That is an admin decision,
not a client change.
