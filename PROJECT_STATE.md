# Project State

## Project Vision

This project is a modern SSH/SFTP/FTP client for self-hosted infrastructure management. It is designed as a hybrid web + desktop application with a shared React interface, an Electron desktop shell, and a Node.js backend for browser preview and synchronized host data.

The project is moving toward an open source, experimental research direction. The long-term goal is to provide a cross-platform Linux, Windows, and macOS server operations client inspired by tools such as Termius, MobaXterm, Tabby, and VSCode Remote while remaining an original, self-hosted-friendly architecture.

Primary goals:

- Modern SSH terminal and file management experience.
- Web + Electron desktop hybrid runtime.
- Open source research project with modular architecture.
- Self-hosted account, host, and session management.
- Cross-platform support for Linux, Windows, and macOS.
- Secure identity and credential handling without plaintext secret exposure.

## Current Development Stage

The project is currently in a research and architecture refactor stage. It is also in the multi-session implementation stage, where the SSH runtime is being moved away from single global connections toward independent session managers.

Several features are implemented but still considered experimental:

- Multiple SSH tabs and independent terminal sessions.
- Browser SSH relay through WebSocket.
- Electron SSH IPC session management.
- SFTP file manager.
- SSH identities/keychain flows.
- Encrypted credential vault and Electron secure storage.
- Landing page and authenticated dashboard routing.
- Host edit, duplicate, delete, and identity assignment.

The API and storage model may still change while the project evolves into a stable open source architecture.

## Phase 1.1 — Smart Identity Engine

What was built:

- A scoped Smart Identity Engine that resolves credential material only at connection time.
- Browser and Electron runtime-specific identity resolution paths.
- Host-to-identity enforcement so a host only offers its assigned identity or an explicitly selected identity.
- Secret-safe identity listing that returns metadata, fingerprints, and host assignment counts only.
- Browser SSH relay and SFTP paths that now resolve through the identity engine instead of directly reusing arbitrary key material.
- Electron desktop SSH paths that resolve through local secure storage with user-scoped vault keys.

Main files changed:

- `server/identityResolver.js`
- `server/securityLog.js`
- `server/index.js`
- `server/sshWebSocket.js`
- `server/credentialStore.js`
- `electron/identityResolver.js`
- `electron/credentialVault.js`
- `electron/sshHandler.js`
- `electron/terminalSessionManager.js`
- `src/components/KeychainPanel.tsx`
- `src/components/TerminalView.tsx`
- `src/App.tsx`
- `src/lib/api.ts`

Security decision:

- No auto-offer of all keys or identities.
- No secret material is returned by identity list endpoints.
- Browser runtime is limited to server-encrypted vault material.
- Electron runtime is limited to local secure storage and scoped host resolution.
- Logging is metadata-only and redacted.

Limitation:

- One-time identity flows are only partially modeled and still require a future transient-credential workflow.
- Password-only host persistence remains a legacy compatibility path and is not the preferred secure flow.
- Electron host ownership validation depends on user-scoped state passed from the renderer.
- Legacy password host rows are still present in the schema as migration-only compatibility data and should be phased out through identity backfill.

Next work:

- Secure Vault hardening.
- Key Isolation.
- Session cleanup lifecycle review.
- One-time identity / transient connect flow.
- SSH certificate identity expansion.

Research basis:

- Practical Privacy-Preserving Authentication for SSH
- On the Security of SSH Client Signatures
- Enabling Secure Shell Access with OpenID Connect

## Phase 1.2 — Secure Vault

What was built:

- A hardened secure vault layer for browser/server and Electron credential storage.
- Metadata-only identity responses with secret fields excluded from API payloads.
- Recursive redaction helpers for logs and error payloads.
- A server vault health check endpoint for admin-only verification.
- Electron vault health logic for local secure-storage validation.
- Frontend secret cleanup and success messaging after save.
- Documentation for the legacy password-host migration path.

Main files changed:

- `server/secretRedaction.js`
- `server/securityLog.js`
- `server/vaultHealth.js`
- `server/credentialStore.js`
- `server/index.js`
- `server/identityResolver.js`
- `electron/secretRedaction.js`
- `electron/securityLog.js`
- `electron/vaultHealth.js`
- `electron/credentialVault.js`
- `electron/sshHandler.js`
- `src/components/KeychainPanel.tsx`
- `src/lib/api.ts`
- `PROJECT_NOTE.md`
- `README.md`

Vault model:

- Browser/server vault:
  - secrets are encrypted at rest in `.credential-vault/`
  - encryption requires `CREDENTIAL_VAULT_KEY` or `SESSION_SECRET`
  - vault health checks validate storage readiness and crypto roundtrip
- Electron vault:
  - secrets are encrypted via `safeStorage` in `app.getPath('userData')`
  - user-scoped vault keys prevent cross-user reuse inside the same desktop app
  - vault health checks validate local secure-storage readiness and crypto roundtrip

Security decision:

- No plaintext secret fallback.
- Secret material is removed from API responses.
- Logs are redacted before emission.
- Vault health responses expose only status metadata.
- Browser and Electron vault boundaries remain separate.
- Legacy host password storage remains compatibility-only.

Limitation:

- Legacy password-host rows still exist and may be used by old records until migration/backfill is completed.
- Electron renderer trust boundary still needs future hardening beyond the current session-context sync.
- One-time/transient credential flow is still pending.

Pending work:

- Legacy password migration/backfill.
- Vault rotation and export/import hardening.
- Admin-only audit view for vault health and identity inventory.
- Phase 1.3 Key Isolation.

Relationship with Smart Identity Engine:

- Smart Identity Engine decides which identity may be used.
- Secure Vault decides how the selected secret is stored, redacted, and health-checked.
- Together they reduce both selection exposure and secret exposure.

Research basis:

- SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
- On the Security of SSH Client Signatures
- Practical Privacy-Preserving Authentication for SSH
- Enabling Secure Shell Access with OpenID Connect
- Towards SSH3: how HTTP/3 improves secure shells

## Phase 1.3 — Key Isolation

What was built:

- Ephemeral credential wrappers for browser/server and Electron runtime secret material.
- Best-effort `clearSecretMaterial()` helpers with nested object cleanup and Buffer overwrite support.
- Resolve-then-connect lifecycle so decrypted secret material is only present for the shortest possible lexical scope.
- Browser SSH relay, Electron SSH IPC, identity test, and SFTP paths now clear credential material after use instead of storing it in session state.
- Metadata-only session tracking so long-lived session objects keep host, user, runtime, purpose, and timestamps only.

Main files changed:

- `server/secretLifecycle.js`
- `server/ephemeralCredential.js`
- `server/identityResolver.js`
- `server/sshWebSocket.js`
- `server/sftpService.js`
- `server/index.js`
- `server/credentialStore.js`
- `electron/secretLifecycle.js`
- `electron/ephemeralCredential.js`
- `electron/identityResolver.js`
- `electron/terminalSessionManager.js`
- `electron/sshHandler.js`
- `electron/credentialVault.js`
- `src/components/TerminalView.tsx`
- `src/components/KeychainPanel.tsx`
- `src/lib/api.ts`
- `README.md`
- `PROJECT_NOTE.md`

Credential lifecycle model:

- Resolve selected identity metadata through Smart Identity Engine.
- Wrap resolved secret material in an ephemeral credential object with TTL metadata.
- Build `ssh2` connect config in lexical scope only.
- Call `connect()`, test, or SFTP operation.
- Clear secret material in `finally` or on failure/expiry.

Browser/Electron isolation model:

- Browser runtime resolves credentials server-side and never stores raw secret material in WebSocket session state.
- Electron runtime resolves credentials in the main process and stores only session metadata in the terminal session map.
- Renderer code receives status and metadata only.
- Reconnect and SFTP flows resolve credentials again instead of reusing cached secret material.

Limitations:

- JavaScript strings cannot be reliably memory-wiped.
- Buffer overwrite and nested cleanup are best-effort only.
- Live SSH/SFTP verification against a real target is still required if this environment does not have a configured host.

Next work:

- Phase 1.4 Session Cleanup
- Phase 1.5 Zero-Trust Access Layer
- stronger process isolation
- native secure memory exploration

Research basis:

- SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
- On the Security of SSH Client Signatures
- Practical Privacy-Preserving Authentication for SSH
- Enabling Secure Shell Access with OpenID Connect
- Towards SSH3: how HTTP/3 improves secure shells

## Current Architecture

- React, TypeScript, Vite, TailwindCSS, and Electron provide the UI shell.
- `src/components/TerminalView.tsx` uses `xterm.js` for SSH terminal rendering.
- `electron/terminalSessionManager.js` manages multiple Electron desktop SSH shell sessions.
- `electron/sshHandler.js` exposes SSH/SFTP/identity IPC handlers.
- Browser preview SSH shells use authenticated `/api/ssh` WebSocket relay in `server/sshWebSocket.js`.
- SFTP operations are implemented through `ssh2.sftp()` in `server/sftpService.js`.
- Host sync, account auth, admin approval, and identities are self-hosted:
  - Node HTTP API: `server/index.js`
  - MySQL pool and auth helpers: `server/db.js`, `server/auth.js`
  - Browser/Electron client wrapper: `src/lib/api.ts`
  - MySQL schema: `db/migrations/*.sql`, applied by `npm run migrate`
- SSH identity secrets are separated from host metadata:
  - Browser/server mode uses encrypted vault files through `server/credentialStore.js`.
  - Electron desktop uses `safeStorage` through `electron/credentialVault.js`.
  - Metadata-only API responses and redacted logs are enforced through the secure vault layer.

## Deployment State

- Preview domain: `https://ant-tech-async.mobwn.my.id`
- Nginx serves the Vite `dist` directory and proxies `/api/` to the Node API on `127.0.0.1:8790`.
- Because the preview origin is HTTPS, the browser terminal relay uses `wss:` from `window.location.protocol`; `ws:` is only used in non-HTTPS local/dev contexts.
- The API uses MySQL database values from the ignored `.env` file.
- User passwords are hashed with Node `scrypt`.
- Sessions are stored in MySQL and issued as HttpOnly cookies.
- New registrations call QuickEmailVerification from the backend, then wait in `pending` state.
- Login and registration submit only after a Cloudflare Turnstile token is issued, and the API validates that token with Siteverify.
- Administrators can approve or reject users from the Account -> Users panel.
- Rejected users are blocked at login with a rejection message.
- Authenticated users can change their own password from the Account panel.
- The preview Nginx vhost has auth rate limiting, security headers, sensitive path/file blocks, and ModSecurity with OWASP CRS enabled only for the Ant Tech Async vhost.
- The Nginx ModSecurity connector was compiled as a dynamic module against the installed nginx.org `1.30.0` source and loaded from `/usr/lib/nginx/modules/ngx_http_modsecurity_module.so`.

## Planned Features

- Multiple SSH tabs.
- Multi-window session support.
- SFTP/FTP file manager.
- Keychain / SSH identities.
- SSH certificates.
- Secure credential storage.
- Browser + Electron support.
- Host grouping/tagging.
- Session persistence.
- File editor.
- Archive/extract support.
- Remote monitoring.
- Plugin system (future research).
- AI-assisted terminal workflow (future research).
- Team collaboration (future research).

## Security Notes

Security work is an active research area in this project.

- Credential encryption plan:
  - Keep secret material outside host rows.
  - Store only metadata and fingerprints in MySQL.
  - Encrypt browser/server vault secrets using application-managed encryption keys.
  - Use OS-backed secure storage in Electron where available.
- Secure storage strategy:
  - Server/browser mode uses encrypted vault files and metadata references.
  - Electron mode uses `safeStorage`; a future abstraction may support `keytar` or platform-specific providers.
  - SSH agent support should use `SSH_AUTH_SOCK` on Linux/macOS and Pageant/OpenSSH-compatible flows on Windows.
- No plaintext secret policy:
  - Private keys, passphrases, passwords, and certificate private material should not be logged, returned from APIs, stored in `localStorage`, or stored as plaintext in MySQL.
  - Existing legacy host password behavior is being migrated toward identity/vault-backed storage.
- Auth/session protections:
  - HttpOnly session cookies.
  - MySQL-backed session records.
  - Admin approval before normal users can sign in.
  - Turnstile protection for login/register.
  - Nginx security headers and WAF rules in the preview deployment.
- Research disclaimer:
  - Experimental features require additional security review before production use.
  - Vault key management and desktop keychain behavior need more cross-platform validation.

## Open Source Direction

This project is being prepared for open source development.

- Community contributions are welcome once contribution guidelines and issue templates are added.
- The architecture is still evolving quickly.
- API and database schemas may change during the research phase.
- Plugin and extension systems are active research topics.
- The project direction favors modular service layers:
  - terminal session manager
  - SFTP/FTP abstraction layer
  - secure identity vault
  - frontend session/tab state
  - browser/Electron compatibility adapters

## Technical Debt / Research Items

- SSH session manager refactor.
- Multi-session IPC cleanup and lifecycle testing.
- Browser WebSocket relay load testing.
- SFTP abstraction layer for browser and Electron modes.
- FTP support layer.
- Secure vault/keychain abstraction across server, Electron, and OS stores.
- Credential migration away from legacy host password fields.
- Electron/browser compatibility matrix.
- Windows/Linux/macOS testing.
- SSH certificate compatibility with `ssh2`.
- Agent compatibility for Linux/macOS `SSH_AUTH_SOCK`, Windows OpenSSH agent, and Pageant.
- Performance optimization for many terminal sessions.
- Terminal memory and cleanup audits.
- [x] Automated tests for auth, host ownership, and identity ownership (implemented and passing!).
- [x] SFTP path validation automated tests (implemented and passing!).
- [x] End-to-end integration tests using an in-memory mock SSH server (localhost) to verify connection resolution, session cleanup lifecycle, and zero-trust token enforcement (implemented and passing!).

## Research Scope

This project is also being shaped as a research prototype for cloud-oriented SSH management.

Working research focus:

- SSH/SFTP/FTP access over cloud-hosted web and desktop clients.
- Secure remote terminal orchestration in browser and Electron runtimes.
- Stronger secret protection for host metadata and credentials.
- Encryption of host data at rest, especially fields that are still effectively plaintext or easy to inspect.
- Practical enhancements to SSH workflows rather than a full reinvention of SSH itself.

## Problem Statement

The practical problem is that modern SSH client stacks are still often split across separate desktop tools, browser gateways, and ad hoc secret storage patterns. That fragmentation makes it hard to provide:

- one consistent cloud-hosted workflow for SSH, SFTP, and FTP access,
- secure storage for host metadata and credentials,
- a safe browser relay model,
- and a usable hybrid browser/Electron experience.

In this project, the immediate gap is not the SSH protocol itself. The gap is the application-layer architecture around remote access: host records, secret handling, session cleanup, browser relay security, and the usability/security tradeoff of a cloud-hosted terminal management layer.

## Research Questions

Primary research questions:

- How can SSH session management be made safer when the client is browser-based and cloud-hosted?
- What architecture is appropriate for a cloud SSH client that supports both browser relay and native desktop use?
- How should host metadata, credentials, and identity secrets be separated and encrypted to reduce leakage risk?
- What design patterns improve usability without weakening SSH security guarantees?
- Which parts of the cloud SSH stack can be improved through a novel client-side or application-layer security model?

Secondary research questions:

- How much can plaintext exposure be reduced by moving host data into an encrypted application-layer vault?
- What failure modes appear when a browser tab, browser window, or desktop window closes unexpectedly?
- How should a hybrid client preserve session continuity without weakening authentication or secret isolation?
- Which storage backend patterns are most practical across browser, Electron, and server runtimes?

## Proposed Contribution

The likely contribution of the project can be framed as an architecture and prototype study for secure cloud SSH management, with these elements:

- a browser relay for SSH sessions over authenticated WebSocket transport,
- a desktop session path through Electron and IPC,
- encrypted secret storage and host-data minimization,
- a shared UI that can operate across browser and desktop contexts,
- and operational safeguards around session cleanup, credential handling, and multi-session management.

Possible contribution statement:

- "This work proposes and prototypes a hybrid cloud SSH management architecture that combines browser and desktop execution while reducing plaintext exposure of host data and improving session-security handling."

## Scope Boundaries

Working assumptions:

- "SSH/SFTP/FTP on cloud" is treated here as a cloud-hosted management layer for remote access, not as a replacement for the SSH protocol itself.
- The current product already covers a basic browser relay and desktop session model, but the research direction is about hardening, encryption, and better operational UX.
- FTP support is still a planned/secondary area; the stronger novelty is likely in SSH session security, credential handling, and encrypted host data.

Out of scope for the initial research framing:

- redesigning SSH protocol internals,
- replacing SSH cryptography,
- building a generic public cloud bastion service,
- or claiming production-grade security without validation.

## Novelty Angles

- End-to-end encryption for host metadata and credentials inside the application layer.
- Safer browser relay lifecycle with strict session cleanup and access control.
- Hybrid browser/Electron architecture with shared session semantics but different secret storage backends.
- Optional SSH identity abstraction that avoids plaintext secrets in normal application state.
- Host record encryption and metadata minimization as a first-class design decision.

## Evaluation Dimensions

- Session cleanup reliability when tabs, browser windows, or desktop windows close unexpectedly.
- Reduction of plaintext exposure in host records and identity materials.
- Compatibility across browser, Electron, Linux, Windows, and macOS.
- Performance impact of the WebSocket relay and terminal rendering.
- Usability impact of encrypted secret storage and pin/hide workflow changes.

## Draft Methodology

The research can be evaluated with a mixed implementation-and-analysis approach:

- prototype the cloud SSH client architecture,
- compare browser relay and desktop session behavior,
- measure disconnect and cleanup reliability,
- inspect where host data is still exposed in plaintext or recoverable form,
- and validate compatibility and responsiveness across target platforms.

This supports a literature review plus system-design paper style structure rather than a purely protocol-level SSH paper.

## Scopus Search Strings

Candidate Scopus search query ideas:

### Cloud SSH and Browser Relay

- `("SSH" OR "secure shell") AND (cloud OR "cloud-based" OR browser OR web) AND (client OR terminal OR gateway)`
- `("remote terminal" OR "web terminal") AND (security OR secure OR encryption) AND cloud`
- `("SSH client" AND browser AND security) OR ("browser-based SSH" AND encryption)`
- `("secure remote access" AND "cloud" AND SSH)`
- `("web-based SSH" AND "session management" AND security)`
- `("terminal emulator" AND web AND secure AND remote access)`
- `("privileged access" AND SSH AND browser) AND cloud`

### Secret Storage and Encryption

- `("credential encryption" OR "encrypted metadata") AND (host management OR remote access)`
- `("end-to-end encryption" AND metadata AND remote access)`
- `("encrypted vault" AND SSH) AND (browser OR cloud OR desktop)`
- `("secret storage" AND "remote access" AND encryption)`

### SFTP / FTP Management

- `("SFTP" OR "FTP") AND cloud AND (client OR management OR browser)`
- `("file transfer" AND cloud AND SSH AND browser)`
- `("remote file manager" AND secure AND cloud)`

### Hybrid Browser / Desktop Architecture

- `("browser" AND Electron AND SSH) AND security`
- `("hybrid application" AND "remote access" AND SSH)`
- `("cross-platform" AND "SSH client" AND browser AND desktop)`

## Suggested Research Angle Framing

- The baseline problem is not SSH itself, but how a cloud-hosted application can safely orchestrate SSH sessions, preserve usability, and avoid plaintext host/credential exposure.
- The main contribution can be positioned as an architecture and implementation study for secure cloud SSH management with encrypted host data and hybrid browser/desktop execution.
- FTP can be treated as an extension of the same management layer, but the novelty focus should remain on secure SSH orchestration and secret isolation.

## Remaining Product Work

1. Complete real user flow testing:
   - register
   - admin approval/rejection
   - login/logout
   - host create/edit/duplicate/delete
   - SSH browser/desktop connection
   - identity save/load/delete/assign
2. Stabilize multiple SSH tabs and session cleanup.
3. Expand SFTP/FTP file manager polish:
   - progress reporting
   - large file handling
   - safer text/binary detection
   - drag-and-drop upload
4. Harden SSH identities:
   - key migration
   - passphrase UX
   - SSH certificate validation
   - agent compatibility
5. Add session persistence and reconnect behavior.
6. Add host grouping, tags, and filters.
7. Add remote monitoring panels.
8. Add automated test coverage for API ownership checks and secure secret handling.
9. Prepare open source assets:
   - license
   - contribution guide
   - issue templates
   - security policy
   - architecture documentation
10. Convert research notes into a formal literature-review and methodology outline for the cloud SSH study.

## Phase 1.4 — Session Cleanup

Phase 1.4 strengthens the runtime lifecycle for SSH/SFTP sessions so session teardown is deterministic and does not leave orphan WebSocket relays, dangling listeners, stale timers, reconnect state, or lingering file-transfer handles.

Relationship to earlier Phase 1 work:

- Smart Identity Engine still decides which identity is eligible for a host/session.
- Secure Vault still owns secret storage and redaction.
- Key Isolation still ensures secret material only lives briefly during resolve-then-connect.
- Session Cleanup adds a separate runtime lifecycle boundary so active sessions are created, tracked, and torn down in a controlled way.

Main files changed in this phase:

- `server/sessionLifecycle.js`
- `server/sshWebSocket.js`
- `server/sftpService.js`
- `server/index.js`
- `electron/sessionLifecycle.js`
- `electron/terminalSessionManager.js`
- `electron/sshHandler.js`
- `electron/main.js`
- `src/components/TerminalView.tsx`
- `src/components/SftpFileManager.tsx`
- `src/App.tsx`
- `src/lib/api.ts`

Credential/session lifecycle model:

- Session state moves through creating, resolving_identity, connecting, connected, reconnecting, closing, closed, and failed.
- Session metadata is kept separate from secret material.
- Cleanup is idempotent so repeated close triggers do not crash the runtime.
- A stale-session sweeper removes abandoned pending sessions.

Browser/Electron isolation model:

- Browser relay cleanup is tied to WebSocket lifecycle, shell stream events, and explicit disconnect messages.
- Electron cleanup is tied to IPC events, terminal tab close, window close, logout, and app quit.
- Frontend cleanup removes listeners, observers, timers, and terminal instances on unmount.

Limitations:

- JavaScript strings cannot be reliably memory-wiped.
- Buffer wipe is best-effort only.
- Live SSH/SFTP verification against a real host is still required.

Next work:

- Phase 1.5 Zero-Trust Access Layer
- live stress test
- session persistence and handoff research
- stronger process isolation
- native secure memory exploration

Research basis by title:

- SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
- On the Security of SSH Client Signatures
- Practical Privacy-Preserving Authentication for SSH
- ESX: A Self-Generated Control Policy for Remote Access With SSH Based on eBPF
- Emerging research areas in SIP-based converged services for extended Web clients
- Towards SSH3: how HTTP/3 improves secure shells

## Phase 1.5 — Lightweight Zero-Trust Access Layer

What was built:

- A lightweight zero-trust access layer for SSH and SFTP runtime connects.
- Short-lived connect authorization with one-time tokens scoped to user, host, runtime, purpose, and optional authType/identity.
- Browser relay authorization that validates token scope before identity resolution.
- Electron runtime authorization that validates session/user context and consumes a short-lived connect token before connect.
- Metadata-only security logging and metrics for token issuance, validation, rejection, expiration, reuse, and runtime-policy denial.
- Lightweight rate limits for token issuance and connect attempts per user and host.

Relationship with prior phases:

- Smart Identity Engine still performs scoped identity selection.
- Secure Vault still owns encrypted secret storage and metadata-only identity APIs.
- Key Isolation still limits secret exposure to ephemeral runtime windows.
- Session Cleanup still handles deterministic teardown after connect.
- Phase 1.5 adds the access governance boundary that decides whether a connect request should be authorized at all.

Connect authorization flow:

auth session
→ request connect token
→ access policy validation
→ token issued
→ SSH/SFTP connect
→ token validation
→ identity resolve
→ ephemeral credential
→ session lifecycle
→ cleanup
→ token invalidated

Token lifecycle:

- Issued only after authenticated access-policy checks.
- Scoped to userId, hostId, runtime, purpose, and optional authType/identity.
- Short-lived by default.
- Consumed once.
- Invalidated on logout, host deletion, identity deletion, reconnect failure, and validation failure.

Runtime policy model:

- Browser:
  - relay-only access
  - no local agent
  - no local filesystem identity capability
  - metadata-only authorization surface
- Electron:
  - higher-trust local runtime
  - local IPC capability
  - still scoped per user/session/host
  - connect token consumption required before local SSH/SFTP connect

Limitations:

- This is not a full SDP or ZTNA platform.
- Policy remains lightweight and mostly metadata-driven.
- Adaptive risk scoring and distributed policy orchestration are not implemented.
- Live SSH/SFTP validation depends on configured targets outside this environment.

Future work:

- SDP gateway
- federated identity
- adaptive policy
- eBPF observability
- distributed access control

Research basis by title:

- Brute-force attack mitigation on remote access services via software-defined perimeter
- Enabling Secure Shell Access with OpenID Connect
- Practical Privacy-Preserving Authentication for SSH
- ESX: A Self-Generated Control Policy for Remote Access With SSH Based on eBPF
- Towards SSH3: how HTTP/3 improves secure shells
- Emerging research areas in SIP-based converged services for extended Web clients

## Phase 1 Security Audit & Remaining Tasks (2026-05-25)

As part of the completion of Phase 1, a comprehensive security review and implementation audit was conducted. Below are the key findings, security risks, technical debt, and remaining next steps.

### Missing / Unchecked
- [ ] End-to-end live target verification against actual remote SSH/SFTP targets (outside localhost).
- [ ] Persistent identity migration CLI/script to backfill legacy password-based hosts into the secure identity model.
- [ ] Electron Renderer validation: Hardening the Electron renderer process boundary (renderer-supplied `userId` remains advisory and needs main-process side validations).
- [ ] SFTP path validation automated tests for nested subdirectory creation limits (mkdir/rmdir bounds).

### Security Risks
1. **CRITICAL: Electron Renderer Context Trust Boundary Vulnerability**
   - **Why:** The Electron resolver (`electron/identityResolver.js`) receives the user context (`userId`) from the renderer process via IPC. If the renderer process is compromised (e.g., via XSS or a malicious dependency), an attacker could forge the `userId` to resolve credentials belonging to another user.
   - **Which Phase & Principle:** Phase 1.1 (Smart Identity Engine) / Trust-Boundary Preservation.
   - **Impact:** Allows cross-user credential access on compromised desktop environments.
2. **WARNING: Best-Effort Memory Cleaning in V8 Engine**
   - **Why:** JavaScript string primitives cannot be reliably overwritten in memory due to how the V8 engine handles immutable strings and garbage collection. Although `clearSecretMaterial` clears Buffer contents using `buffer.fill(0)`, keys read as strings (e.g. from environment or decrypted vault payloads before being wrapped in buffers) may linger in memory.
   - **Which Phase & Principle:** Phase 1.3 (Key Isolation) / Ephemeral Credential Lifecycle.
   - **Impact:** Risk of memory dump attacks extracting plaintext keys or passwords.
3. **WARNING: Legacy Plaintext Host Password Migration Debt**
   - **Why:** The database schema still supports legacy `password` fields directly in the `hosts` table. Although new hosts are pushed to use the scoped identities model, existing records or old code paths might fall back to reading host passwords, exposing plaintext credentials in the SQL database.
   - **Which Phase & Principle:** Phase 1.2 (Secure Vault) / No Plaintext Secret Policy.
   - **Impact:** Risk of sql-injection attacks leaking remote credentials directly.

### Architecture Drift
- **WARNING: SQL Schema Discrepancy (user_id vs userId)**
  - There is a minor naming discrepancy between `server/connectToken.js` (which queries `user_id AS userId`) and `server/identityResolver.js` (which queries `user_id` directly without alias). This requires the host database mocks and query parsers to handle two naming formats.

### Recommended Next Tasks
1. **Priority 1: Electron Renderer Context Hardening**: Modify `electron/sshHandler.js` and `electron/main.js` to derive user authentication context strictly from main-process session stores, rather than trusting the renderer's `userId` argument.
2. **Priority 2: Plaintext Host Password Deprecation**: Write and run a migration script that moves all legacy `hosts.password` records into vault-secured `ssh_credentials` rows, then drop the legacy password column from the schema.
3. **Priority 3: Native Memory Wiping Exploration**: Integrate a native C++ addon (like node-sodium or a custom native helper) for Electron/server runtimes to allocate secure, non-pageable memory for private keys, ensuring absolute zero-fill on disposal.

