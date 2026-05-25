# Changelog

All notable changes to this project will be documented in this file.

## Unreleased
- CI workflow: TypeScript check, ESLint, mock SSH integration test
- CI guard: `npm run test` includes `server/__tests__/sshSpawningGuard.test.js`; merges must be blocked if the standalone runtime guard fails.
- Security note: OS ssh-agent compatibility remains disabled by default and requires explicit `ENABLE_OS_SSH_AGENT=true`.
- Bugfix: await resolveIdentity in electron/sshHandler
- Integration: mock SSH test and report
