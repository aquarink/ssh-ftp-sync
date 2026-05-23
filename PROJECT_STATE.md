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

## Deployment State

- Preview domain: `https://ant-tech-async.mobwn.my.id`
- Nginx serves the Vite `dist` directory and proxies `/api/` to the Node API on `127.0.0.1:8790`.
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
- Automated tests for auth, host ownership, identity ownership, and SFTP path validation.

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
