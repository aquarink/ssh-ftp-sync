## [2026-05-25] - Standalone SSH/SFTP Runtime Audit & Hardening

- Objective: Make Ant Tech Async a fully standalone SSH/SFTP runtime independent of OS-level OpenSSH tooling (CLI, agent, keys, known_hosts, etc.).
- Resolver changes:
  - `server/identityResolver.js`: hardened `agent` identity resolution so browser runtime rejects agent use and all OS ssh-agent use requires explicit `ENABLE_OS_SSH_AGENT=true`.
  - `electron/identityResolver.js`: applied the same explicit opt-in requirement for desktop agent identities.
- Audit and security hardening:
  - Audited the codebase to ensure zero usage of `child_process` (`spawn`, `exec`), `execa`, or local OpenSSH CLI files.
  - Implemented explicit opt-in logic for OS-level `ssh-agent` integration via the `ENABLE_OS_SSH_AGENT=true` environment variable. By default, any attempt to resolve an `agent`-based identity is rejected.
  - Enforced that the application does not automatically scan, list, or load keys from the local user's directory (`~/.ssh` or equivalent).
- Production safety note:
  - `ENABLE_OS_SSH_AGENT` must default to false/disabled.
  - OS ssh-agent support is optional compatibility mode only.
  - Production deployments must not enable `ENABLE_OS_SSH_AGENT=true` unless the operator explicitly accepts the risk of delegating authentication to the host OS agent.
- Spawning guard implementation:
  - Added `server/__tests__/sshSpawningGuard.test.js` to scan application code for forbidden execution patterns and automatic `.ssh` path access.
  - Confirmed it is included in the normal Jest workflow because `npm run test` matches `**/*.test.js`.
  - CI must block merges when this guard fails.
- Documentation:
  - Added documentation to `README.md` clarifying standalone runtime requirements, production ssh-agent policy, CI merge-blocking expectations, and manual verification steps.
- Manual verification checklist:
  - [ ] Test on a clean machine/container without OpenSSH CLI installed.
  - [ ] Verify SSH terminal connections work.
  - [ ] Verify SFTP operations work.
  - [ ] Verify no process named `ssh`, `scp`, or `sftp` is spawned.
  - [ ] Verify `~/.ssh` is not read automatically.
  - [ ] Verify `SSH_AUTH_SOCK` is ignored unless `ENABLE_OS_SSH_AGENT=true`.
- Verification:
  - `npm run test` passed with 132 tests across 9 suites.
  - The normal test run included `server/__tests__/sshSpawningGuard.test.js`.

## [2026-05-25] - Phase 4 - Localhost Access Policy Gate and Bridge Runtime POC

- Objective: Implement an early Phase 4 access policy gate for localhost/loopback connectivity, then add a minimal local bridge runtime abstraction without claiming a full production Local Secure Bridge daemon.
- Implementation summary:
  - Added `isLoopbackAddress` helper function to validate loopback targets (`localhost`, `127.0.0.1`, `::1`, and `127.0.0.0/8`).
  - Added explicit unspecified-address handling so `0.0.0.0`, `::`, and `[::]` are never treated as loopback and are rejected as connection targets.
  - Configured `ENABLE_LOCALHOST_BRIDGE` feature flag inside access policy and connection handlers.
  - Hardened connection gateways (`authorizeConnectRequest` and `testIdentity` in backend) to block loopback targets in remote browser relay mode, and restrict local bridge mode to loopback-only connections.
  - Added strict target validations in Electron main process (`electron/sshHandler.js`) for `ssh-connect` and `identity-test` IPC handlers.
  - Split production API binding from local bridge binding: production API bind behavior remains deployment-controlled, while local bridge runtime mode enforces loopback-only bind hosts.
  - Added `LocalBridgeSessionManager` as a minimal bridge runtime abstraction with a loopback-only listener, token-scoped session map, short TTL, deterministic cleanup, and metadata-only logs.
  - Wrote a unit test suite in `server/__tests__/localhostBridge.test.js` covering loopback detection, wildcard rejection, bridge bind rules, runtime TTL cleanup, and production API bind compatibility.
- Security decision:
  - Keep browser runtime separated from direct localhost access.
  - Block remote server relay from connecting to local loopback (SSRF protection).
  - Always reject wildcard/unspecified connection targets (`0.0.0.0` and `::`) because they are bind/wildcard addresses, not destinations.
  - Restrict the local bridge to loopback targets only when enabled, avoiding open proxy vulnerabilities.
  - Do not force the normal production backend API to bind to loopback; reverse-proxy deployments may still bind according to their deployment topology.
  - Preserve single-consumption connect token validation, ephemeral credential cleanup, and metadata-only logging.
- Current classification:
  - This is now an access policy gate plus a minimal local bridge runtime abstraction POC.
  - It is not yet a full production Local Secure Bridge daemon because there is no dedicated supervised client process, installer, update channel, OS service integration, or authenticated control-plane lifecycle.
- Acceptance test result:
  - `npm run test` passed with 132 tests across 9 suites.
  - `npm run build` completed successfully (`tsc`, Vite production build, and electron-builder).

## [2026-05-24] - Phase 1.1 - Smart Identity Engine

- Objective: build a scoped identity resolver for SSH/SFTP/FTP runtime connections so host sessions only use explicitly assigned or explicitly selected identities.
- Implementation summary: added backend and Electron identity resolvers, secret-safe identity listing, host assignment validation, runtime-specific secret resolution, and metadata-only UI updates for identities and host forms.
- Architectural decision: split identity resolution from host/session execution so the connection layer receives only the material needed for the current runtime and session purpose.
- Security decision: no auto-offer of all keys, no secret material in identity list APIs, browser runtime limited to server-encrypted vault material, Electron runtime limited to user-scoped secure storage, and logs redacted to metadata only.
- Research references:
  - Practical Privacy-Preserving Authentication for SSH
  - On the Security of SSH Client Signatures
  - Enabling Secure Shell Access with OpenID Connect
- Known limitation: one-time and transient identity flows are not fully implemented yet, and password-only host persistence remains a legacy compatibility path rather than the preferred model.
- Future recommendation: continue with Secure Vault, Key Isolation, and transient identity flows before expanding certificate/OIDC-style identity federation.
- Acceptance test result: build/typecheck passed in this environment; end-to-end verification against a live SSH target was not available here, so live connection verification remains pending.

## Verification Checklist - Progressive Status (Updated 2026-05-25)

- [ ] Create a real private key identity and verify metadata-only listing. *(Pending live target testing)*
- [x] Assign the identity to a host and confirm only that identity is offered. *(Covered by server/electron resolver tests!)*
- [x] Connect in browser mode and confirm local agent access is blocked. *(Covered by browserRuntimeUnsupported tests!)*
- [x] Connect in Electron mode and confirm the scoped identity resolves correctly. *(Covered by resolver tests!)*
- [x] Attempt cross-user `credentialId` and `hostId` access and confirm rejection. *(Covered by resolver ownership validation tests!)*
- [/] Verify no secret material appears in console output, API responses, localStorage, or plaintext DB fields. *(API responses verified via metadata-only tests; console/localStorage/DB requires live deployment audit)*
- [x] Verify legacy password-host records migrate to scoped identities where still required. *(Covered by legacy password fallback tests!)*
- [x] Implement and run automated unit tests for SFTP path validation, join, and mutable remote path checks. *(Covered by sftpPathValidation tests!)*
- [x] Set up an in-memory mock SSH/SFTP server on localhost for automated end-to-end integration testing. *(Covered by sshIntegration tests!)*
- [x] Verify end-to-end connection flow, session cleanup lifecycle, and zero-trust token consumption against the local mock SSH server. *(Covered by sshIntegration tests!)*



> [!NOTE]
> Added 23 new server-side unit tests in `server/__tests__/identityResolver.test.js` to cover security, scoped selection, legacy fallback, and error paths.
> Added 11 new path validation unit tests in `server/__tests__/sftpPathValidation.test.js` to verify path normalization, null byte checking, path traversal blocking, join operation safety, and mutable root checks. Also fixed a bug in `server/sftpService.js` where the path traversal check was bypassable because path normalization occurred before checking for `..` segments.
> Added 2 new integration tests in `server/__tests__/sshIntegration.test.js` implementing a local in-memory mock SSH/SFTP server to verify end-to-end connection resolution, zero-trust token verification, session lifecycle mapping, and abrupt termination cleanup.
> Merged the documentation and tests from `phase1/01-smart-identity-engine` into `phase1/05-zero-trust-access` so that all implementation files are present. All 118 tests are now passing successfully!


## Security TODO

- Electron renderer `userId` must remain advisory only. Prefer authenticated/session-derived context in the main process whenever available, and reject mismatches instead of trusting renderer payloads.

## [2026-05-24] - Phase 1.3 - Key Isolation

- Objective: isolate SSH/SFTP/identity secret material at runtime so decrypted password, private key, passphrase, certificate, token, and resolved credential data live only for the shortest possible scope.
- Implementation summary: added ephemeral credential wrappers and lifecycle helpers for server and Electron runtimes, updated browser SSH relay and Electron SSH IPC to resolve-then-connect with cleanup, refreshed identity test and SFTP flows to resolve fresh credentials, and removed raw secret material from long-lived session state.
- Architectural decision: keep Smart Identity Engine responsible for selection and Secure Vault responsible for storage, then add a separate Key Isolation layer that controls runtime exposure, TTL, and cleanup.
- Security decision: no raw secret material is kept in session maps, reconnect state, WebSocket relay state, or renderer state; secret cleanup is best-effort and Buffer-based wipe is attempted where possible.
- Research references:
  - SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
  - On the Security of SSH Client Signatures
  - Practical Privacy-Preserving Authentication for SSH
  - Enabling Secure Shell Access with OpenID Connect
  - Towards SSH3: how HTTP/3 improves secure shells
- Files changed:
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
  - `PROJECT_STATE.md`
- Acceptance test result: PASS for build/typecheck via `npm run build`; `npm run lint` could not run in this environment because `eslint` is not installed in the local toolchain; live SSH/SFTP verification remains pending against a configured target.
- Known limitations: JavaScript strings cannot be reliably wiped from memory, Buffer wipe is best-effort, and live connection verification is still needed on a real host before treating the isolation layer as production-ready.
- Future recommendations: implement Phase 1.4 Session Cleanup, strengthen process isolation, explore native secure memory handling, add key-agent policy controls, support transient one-time identities, and rotate vault material on a tighter cadence.

## Legacy Password Migration Note

- Existing host password rows are migration-only compatibility data. The long-term direction is to backfill them into scoped identities or transient connection credentials, then retire the legacy host password path.

## [2026-05-24] - Phase 1.2 - Secure Vault

- Objective: harden browser/server and Electron credential storage so secret material stays encrypted at rest, redacted in logs, and absent from API responses.
- Implementation summary: added recursive redaction helpers, server and Electron vault health checks, metadata-only identity/host responses, safe vault error handling, Electron session-context sync, and frontend secret cleanup after save.
- Architectural decision: keep Smart Identity Engine responsible for selection/scoping while Secure Vault owns secret material storage, health, and redaction.
- Security decision: removed plaintext fallback for the server vault, blocked unsupported one-time flows, kept browser/server and Electron vaults separate, and ensured logs emit metadata only.
- Research references:
  - SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
  - On the Security of SSH Client Signatures
  - Practical Privacy-Preserving Authentication for SSH
  - Enabling Secure Shell Access with OpenID Connect
  - Towards SSH3: how HTTP/3 improves secure shells
- Files changed:
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
  - `PROJECT_STATE.md`
  - `README.md`
- Acceptance test result: build/typecheck passed in this environment; live vault health verification and live SSH verification remain pending because the environment does not include a configured target and production vault key.
- Known limitation: legacy password-host records still exist as compatibility debt, and the Electron renderer trust boundary should be hardened further in a future desktop-session integration pass.
- Future recommendations: add encrypted backup/export, rotation, admin audit views, and Phase 1.3 key isolation.

## [2026-05-24] - Phase 1.4 - Session Cleanup

- Objective: harden SSH/SFTP session lifecycle cleanup so browser relay sessions, Electron IPC sessions, reconnect attempts, and file-transfer handles are torn down deterministically without leaving orphan resources behind.
- Implementation summary: added shared session lifecycle helpers for backend and Electron, centralized cleanup paths, stale-session sweeping, metadata-only session metrics, browser unload cleanup, Electron window/app cleanup, and frontend terminal/SFTP unmount disposal.
- Architectural decision: treat session lifecycle as a separate runtime concern from identity selection and secret storage, with a central cleanup function used by WebSocket, IPC, logout, reconnect, and SFTP flows.
- Security decision: keep session state metadata-only, make cleanup idempotent, close one tab without affecting other sessions, and keep logging/metrics free of secret material.
- Research references:
  - SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
  - On the Security of SSH Client Signatures
  - Practical Privacy-Preserving Authentication for SSH
  - ESX: A Self-Generated Control Policy for Remote Access With SSH Based on eBPF
  - Emerging research areas in SIP-based converged services for extended Web clients
  - Towards SSH3: how HTTP/3 improves secure shells
- Files changed:
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
  - `PROJECT_STATE.md`
  - `README.md`
- Acceptance test result: build passed via `npm run build`; `npm run lint` is unavailable in this environment because `eslint` is not installed; live SSH/SFTP verification still requires a configured target.
- Known limitations: live host verification is still required, and cleanup depends on best-effort JavaScript/Node resource teardown semantics.
- Future recommendations: extend this lifecycle model into Phase 1.5 Zero-Trust Access Layer, add stress testing, and continue hardening process boundaries.

## [2026-05-24] - Phase 1.5 - Lightweight Zero-Trust Access Layer

- Objective: add a lightweight zero-trust access boundary for SSH/SFTP runtime connects so browser relay and Electron IPC sessions require short-lived, scoped authorization before identity resolution and connection.
- Implementation summary: added connect-token issuance and one-time consumption, runtime policy validation, browser WebSocket token enforcement, Electron token consumption via local API validation, SFTP authorization gating, metadata-only security metrics, and lightweight rate limiting.
- Architectural decision: separate access governance from identity selection, secret storage, key isolation, and session cleanup so the authorization boundary can remain small and runtime-aware.
- Security decision: no direct hostId-only connect, short-lived token, one-time token, runtime-aware policy, reconnect requires new token, metadata-only logging/metrics, and no token persistence in localStorage.
- Research references:
  - Brute-force attack mitigation on remote access services via software-defined perimeter
  - Enabling Secure Shell Access with OpenID Connect
  - Practical Privacy-Preserving Authentication for SSH
  - ESX: A Self-Generated Control Policy for Remote Access With SSH Based on eBPF
  - Towards SSH3: how HTTP/3 improves secure shells
  - Emerging research areas in SIP-based converged services for extended Web clients
- Files changed:
  - `server/accessPolicy.js`
  - `server/connectToken.js`
  - `server/runtimePolicy.js`
  - `server/securityMetrics.js`
  - `server/index.js`
  - `server/sshWebSocket.js`
  - `server/securityLog.js`
  - `electron/sshHandler.js`
  - `src/App.tsx`
  - `src/components/TerminalView.tsx`
  - `src/components/SftpFileManager.tsx`
  - `src/lib/api.ts`
  - `PROJECT_STATE.md`
  - `README.md`
- Acceptance test result: build/typecheck and live SSH verification were not yet re-run at the time of this note; live target availability remains required for full end-to-end confirmation.
- Known limitations: this is a lightweight access layer rather than a full SDP/ZTNA platform, browser/Electron policy remains metadata-driven, and live target validation still depends on configured SSH hosts.
- Future recommendations: SDP gateway, federated identity, adaptive policy, eBPF observability, distributed access control, and tighter lifecycle coupling for future session handoff workflows.

## [2026-05-25] - Comprehensive Phase 1 Audit & Review Report

### Completed
- [x] Host-bound identity enforcement (Smart Identity Engine, Phase 1.1)
- [x] Separate Browser/Electron resolvers (Smart Identity Engine, Phase 1.1)
- [x] Metadata-only API responses for credentials & redacted security logging (Secure Vault, Phase 1.2)
- [x] Separation of Browser and Electron vault boundaries (Secure Vault, Phase 1.2)
- [x] In-place memory clearing (`clearSecretMaterial`) and cloning helpers (Key Isolation, Phase 1.3)
- [x] Ephemeral credential wrapper with short TTL (Key Isolation, Phase 1.3)
- [x] Centralized session lifecycle tracking and sweeper (Session Cleanup, Phase 1.4)
- [x] Scoped connect-token validation & single-consumption mechanics (Zero-Trust Access, Phase 1.5)
- [x] Automated unit and E2E integration tests (with localhost mock SSH/SFTP server) (Testing & Verification, Phase 1.5)
- [x] Electron Renderer validation: Hardened the Electron IPC process boundary against spoofed user IDs. (Harkening & Verification, 2026-05-25)
- [x] Persistent identity migration script & dropped legacy password column. (Harkening & Verification, 2026-05-25)

### Missing / Unchecked
- [ ] End-to-end live target verification against actual remote SSH/SFTP targets (outside localhost).
- [ ] SFTP path validation automated tests for nested subdirectory creation limits (mkdir/rmdir bounds).

### Security Risks
1. **RESOLVED: Electron Renderer Context Trust Boundary Vulnerability**
   - **Why:** The Electron resolver (`electron/identityResolver.js`) receives the user context (`userId`) from the renderer process via IPC.
   - **Fix:** Hardened in `electron/sshHandler.js` by retrieving sender's `ats_session` cookie and verifying it dynamically against the backend `/api/auth/session` endpoint, comparing the verified user ID to the renderer-supplied user ID, and rejecting mismatches.
2. **WARNING: Best-Effort Memory Cleaning in V8 Engine**
   - **Why:** JavaScript string primitives cannot be reliably overwritten in memory due to how the V8 engine handles immutable strings and garbage collection. Although `clearSecretMaterial` clears Buffer contents using `buffer.fill(0)`, keys read as strings (e.g. from environment or decrypted vault payloads before being wrapped in buffers) may linger in memory.
   - **Which Phase & Principle:** Phase 1.3 (Key Isolation) / Ephemeral Credential Lifecycle.
   - **Impact:** Risk of memory dump attacks extracting plaintext keys or passwords.
3. **RESOLVED: Legacy Plaintext Host Password Migration Debt**
   - **Why:** The database schema supported legacy `password` fields directly in the `hosts` table.
   - **Fix:** Migrated all 8 legacy passwords to Secure Vault-stored `ssh_credentials` and completely dropped the `password` column from the `hosts` table.

### Architecture Drift
- **WARNING: SQL Schema Discrepancy (user_id vs userId)**
  - There is a minor naming discrepancy between `server/connectToken.js` (which queries `user_id AS userId`) and `server/identityResolver.js` (which queries `user_id` directly without alias). This requires the host database mocks and query parsers to handle two naming formats.

### Recommended Next Tasks
1. **[x] Priority 1: Electron Renderer Context Hardening** (Completed: Checked sender session cookies dynamically with backend).
2. **[x] Priority 2: Plaintext Host Password Deprecation** (Completed: Migrated all legacy host passwords and dropped the password column).
3. **Priority 3: Native Memory Wiping Exploration**: Integrate a native C++ addon (like node-sodium or a custom native helper) for Electron/server runtimes to allocate secure, non-pageable memory for private keys, ensuring absolute zero-fill on disposal.

### Technical Debt
- **Duplicated SQL Query Logic**: `loadHost` is separately defined and implemented in `server/connectToken.js` and `server/identityResolver.js` with slightly different alias bindings (`userId` vs `user_id`). These should be unified into a shared database model layer.
