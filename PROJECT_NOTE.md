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

## Verification Checklist - Pending

- [ ] Create a real private key identity and verify metadata-only listing.
- [ ] Assign the identity to a host and confirm only that identity is offered.
- [ ] Connect in browser mode and confirm local agent access is blocked.
- [ ] Connect in Electron mode and confirm the scoped identity resolves correctly.
- [ ] Attempt cross-user `credentialId` and `hostId` access and confirm rejection.
- [ ] Verify no secret material appears in console output, API responses, localStorage, or plaintext DB fields.
- [ ] Verify legacy password-host records migrate to scoped identities where still required.

## Security TODO

- Electron renderer `userId` must remain advisory only. Prefer authenticated/session-derived context in the main process whenever available, and reject mismatches instead of trusting renderer payloads.

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
