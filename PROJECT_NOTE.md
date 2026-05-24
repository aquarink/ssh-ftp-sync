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
