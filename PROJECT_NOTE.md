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
