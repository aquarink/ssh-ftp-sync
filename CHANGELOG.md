# Changelog

All notable changes to this project will be documented in this file.

## Unreleased
- CI workflow: TypeScript check, ESLint, mock SSH integration test
- CI guard: `npm run test` includes `server/__tests__/sshSpawningGuard.test.js`; merges must be blocked if the standalone runtime guard fails.
- Security note: OS ssh-agent compatibility remains disabled by default and requires explicit `ENABLE_OS_SSH_AGENT=true`.
- Phase 4 update: local connectivity now uses client-local network model (`browser` blocks loopback/private LAN; `electron` allows client-reachable local/private/public; wildcard invalid always rejected).
- Local bridge update: explicit per-target approval for local/private bridge sessions, token-scoped short TTL session lifecycle, deterministic cleanup, metadata-only logs.
- Legal pages update: public `/terms` and `/privacy` flow, legal-consent registration enforcement, and idempotent legal-consent migration.
- Bugfix: await resolveIdentity in electron/sshHandler
- Integration: mock SSH test and report
