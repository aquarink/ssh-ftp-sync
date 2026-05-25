# Ant Tech Async SSH Client

> Working name. Final open source project name may change.

[![Status](https://img.shields.io/badge/status-research-orange)](#)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Electron%20%2B%20Node-blue)](#)
[![License](https://img.shields.io/badge/license-TBD-lightgrey)](#license)

Ant Tech Async SSH Client is an experimental open source SSH/SFTP/FTP client for self-hosted infrastructure management and research-guided secure remote operations. It combines a modern web dashboard, an Electron desktop runtime, a multi-session terminal manager, and a Node.js backend for authenticated browser preview.

The project is inspired by the operational workflows of tools such as Termius, MobaXterm, Tabby, and VSCode Remote, while remaining an original implementation focused on self-hosted control, modular architecture, and research-friendly extensibility.

## Name Note

Ant Tech Async is a playful working name for async remote operations. It is not intended as a political statement or a reference to any foreign affiliation. The goal is a short, memorable name that still matches the project's focus on secure SSH, SFTP, identity isolation, and zero-trust access.

## What This Project Is

- A self-hosted SSH/SFTP/FTP management app with browser and desktop modes.
- A single repository that contains the frontend, backend API, and Electron desktop shell.
- A research-oriented security project that implements identity scoping, secure secret storage, key isolation, session cleanup, and zero-trust access.
- A Node.js backend is part of the project. It is not a separate external service.

## How It Works

1. The React frontend in `src/` renders the landing page, auth screens, host manager, terminal UI, and file manager.
2. The Node HTTP API in `server/` handles auth, sessions, hosts, credentials, connect tokens, browser SSH relay, and SFTP operations.
3. Browser mode uses `/api/ssh` as an authenticated WebSocket relay and `/api/security/connect-token` for short-lived connect authorization.
4. Electron mode uses the main process in `electron/` plus the local API on `127.0.0.1:8790` for token issuance and SFTP authorization.
5. SSH, SFTP, and identity flows all resolve secret material only when needed, then clean it up after use.

## Core Files

| Path | Role |
| --- | --- |
| `src/App.tsx` | Main app shell, route handling, host/terminal layout, and mode switching. |
| `src/components/LandingPage.tsx` | Public landing page and feature showcase. |
| `src/components/TerminalView.tsx` | Terminal UI and SSH connect lifecycle for browser/desktop. |
| `src/components/SftpFileManager.tsx` | File manager UI and SFTP operation flow. |
| `src/lib/api.ts` | Browser API client for auth, hosts, security, and SFTP calls. |
| `server/index.js` | Main Node HTTP API router. |
| `server/sshWebSocket.js` | Browser SSH relay over WebSocket. |
| `server/accessPolicy.js` | Connect-token issuance and scope validation. |
| `server/connectToken.js` | Token creation, validation, and invalidation. |
| `server/identityResolver.js` | Host/identity resolution and secret material loading. |
| `server/sftpService.js` | SFTP backend operations. |
| `electron/main.js` | Electron main entrypoint. |
| `electron/sshHandler.js` | Electron SSH and SFTP IPC bridge. |
| `electron/credentialVault.js` | Electron secure storage helper. |

## Implemented Features

- Multiple SSH tabs and multi-session terminal management.
- SFTP/FTP file manager.
- Host management with create, edit, duplicate, delete, and identity assignment.
- Secure SSH identities and keychain support.
- Browser mode through authenticated WebSocket relay.
- Electron desktop mode.
- Session management with HttpOnly cookies.
- Admin/user approval system.
- Cloudflare Turnstile-protected auth forms.
- Modern dark UI built with TailwindCSS and Lucide icons.
- Research-guided security controls for zero-trust connect flow, secret isolation, vault hardening, and session cleanup.

## Phase 1 Implemented

Phase 1 is the security foundation already implemented in this repo:

- Phase 1.1 Smart Identity Engine: scoped identity resolution so a host/session only uses explicitly assigned or explicitly selected credentials.
- Phase 1.2 Secure Vault: encrypted secret storage with metadata-only API responses and redacted logs.
- Phase 1.3 Key Isolation: ephemeral secret exposure with resolve-then-connect lifecycle and best-effort cleanup.
- Phase 1.4 Session Cleanup: deterministic teardown for SSH, SFTP, browser relay, Electron IPC, and abandoned sessions.
- Phase 1.5 Zero-Trust Access: short-lived connect tokens, runtime scope checks, and one-time authorization before runtime access.

This is the set of features the landing page should be able to summarize as "kami pakai ini loh" for the public repo.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Styling | TailwindCSS |
| Desktop | Electron |
| Backend | Node.js HTTP API |
| Database | MySQL |
| Terminal | xterm.js |
| SSH/SFTP | ssh2 |
| Browser SSH Relay | WebSocket |
| Deployment | Nginx |
| Security Add-ons | HttpOnly cookies, Turnstile, optional Nginx WAF |

## Run It

### Prerequisites

- Node.js 18 or newer.
- npm.
- MySQL 8 or compatible.
- Nginx for production deployment.

### Clone

```bash
git clone https://github.com/aquarink/ssh-ftp-sync.git
cd ssh-ftp-sync
```

### Install Dependencies

```bash
npm install
```

### Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your local values.

### Run Database Migrations

```bash
npm run migrate
```

### Start the API

This project does not require `pm2`. The API is a plain Node.js process started by the repo scripts.

```bash
npm run api
```

What this starts:

- The backend HTTP API on `API_PORT` from `.env` or `8790` by default.
- Auth/session routes, host routes, connect-token routes, browser SSH relay, and SFTP endpoints.
- The same API used by both browser mode and Electron mode.

### Start Browser Development UI

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

### Start Electron Development App

```bash
npm run desktop
```

### Build Electron Package

```bash
npm run build
```

### Full Local Flow

If you want to run everything locally from scratch:

1. Clone the repository.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and fill in MySQL and secret values.
4. Run migrations with `npm run migrate`.
5. Start the API with `npm run api`.
6. Start the browser UI with `npm run dev`, or start the desktop app with `npm run desktop`.
7. Open `http://127.0.0.1:5173/` for browser mode.
8. Use Electron mode when you want the desktop shell and OS-backed secure storage.

### Production Notes

For production-style browser deployment:

1. Build the Vite app.
2. Serve `dist/` from Nginx.
3. Proxy `/api/` and `/api/ssh` to the Node API process.
4. Run migrations before deploying backend changes.
5. Start the API with your preferred process manager, init system, or service manager.
6. Use strong secrets and a secure vault key:
   - **Vault Key Setup**: Since the legacy host password storage has been deprecated, the API process **requires** `CREDENTIAL_VAULT_KEY` or `SESSION_SECRET` to be defined in `.env` (or in the system environment) to encrypt/decrypt host secrets.
   - **Permissions**: The `.credential-vault` directory must be owned by the user running the Node API process (e.g. `nginx:nginx`) with `700` (`drwx------`) permissions, and the credential JSON files inside it must have `600` (`-rw-------`) permissions. If migrations were executed as `root`, ensure to adjust ownership and permissions using:
     ```bash
     chown -R nginx:nginx .credential-vault
     chmod 700 .credential-vault
     chmod 600 .credential-vault/*
     ```

Examples of how the API can be kept running:

- `npm run api` in a terminal during development.
- `nohup npm run api >/tmp/ant-tech-async-api.log 2>&1 &` for a simple detached process.
- `systemd`, Docker, or another host-level service manager in production.
- `pm2` is optional if you want to use it, but this repository does not depend on it.

## Development Workflow

### Frontend

- Source: `src/`
- Main app shell: `src/App.tsx`
- Terminal view: `src/components/TerminalView.tsx`
- SFTP manager: `src/components/SftpFileManager.tsx`
- Keychain manager: `src/components/KeychainPanel.tsx`
- API client: `src/lib/api.ts`

### Backend

- Source: `server/`
- Main API router: `server/index.js`
- Auth/session helpers: `server/auth.js`
- MySQL pool: `server/db.js`
- SFTP service: `server/sftpService.js`
- Browser SSH relay: `server/sshWebSocket.js`
- Credential vault helpers: `server/credentialStore.js`

### Electron

- Main process: `electron/main.js`
- Preload bridge: `electron/preload.js`
- SSH IPC handlers: `electron/sshHandler.js`
- Terminal session manager: `electron/terminalSessionManager.js`
- Desktop secure storage helper: `electron/credentialVault.js`

### WebSocket Relay

Browser mode uses `/api/ssh` as an authenticated WebSocket relay. The backend resolves the user session, validates host ownership, and opens the SSH connection through `ssh2`.

### Database Migrations

Migrations live in `db/migrations/` and are applied by:

```bash
npm run migrate
```

## Security Notes

This project is still experimental and requires additional security audit before production use.

- Do not expose secrets in logs, API responses, localStorage, or database metadata.
- Host rows should store metadata and identity references, not raw private keys or passphrases.
- Browser/server mode stores identity secrets in an encrypted vault.
- Electron mode uses OS-backed secure storage through Electron `safeStorage`.
- Session cookies are HttpOnly.
- Login/register are protected by Turnstile when configured.
- Admin approval is required before normal users can sign in.
- SSH certificate and agent support are active compatibility research areas.

## Phase 1 Notes

### Phase 1.1 Smart Identity Engine

- Scoped identity selection per host and session.
- No auto-offer of all keys or identities.
- Browser and Electron runtime-specific policy enforcement.
- Secret resolution only during connection setup.

### Phase 1.2 Secure Vault

- Metadata-only identity API responses.
- Encrypted secret storage for browser/server and Electron runtimes.
- Redacted logs and safe vault error handling.
- Vault health check for admin/internal verification.
- Clear browser/Electron vault boundary.
- Legacy password migration note for compatibility-only host records.

### Phase 1.3 Key Isolation

- Ephemeral credential wrappers with short TTL metadata.
- Resolve-then-connect lifecycle for SSH, SFTP, and identity test flows.
- No raw secret material in long-lived session state, reconnect state, or renderer state.
- Best-effort secret cleanup with nested object deletion and Buffer overwrite.
- Browser and Electron runtimes clear secret material after use in their own trust boundaries.
- Reconnect and SFTP resolve fresh identity material instead of reusing cached secrets.

### Phase 1.4 Session Cleanup

- Deterministic session lifecycle keeps SSH and SFTP sessions in explicit states.
- Session maps remain metadata-only and do not store raw credential material.
- Cleanup is idempotent so duplicate close signals are safe.
- Browser WebSocket cleanup, Electron IPC cleanup, reconnect cleanup, and SFTP cleanup all flow through a central teardown path.
- A stale-session sweeper removes abandoned pending sessions.
- Frontend terminal and file-manager components dispose listeners, timers, and observers on unmount.

### Phase 1.5 Zero-Trust Access Layer

- Short-lived connect authorization before SSH or SFTP runtime access.
- One-time connect tokens scoped to user, host, runtime, purpose, and optional authType or identity.
- Browser relay authorization boundary that validates token scope before identity resolution.
- Electron runtime authorization that still validates session context and consumes a fresh token before connect.
- Token invalidation on logout, host deletion, identity deletion, reconnect failure, and validation failure.
- Metadata-only logging and metrics for token issuance, validation, rejection, expiration, reuse, and runtime-policy denial.

## Research References

- Practical Privacy-Preserving Authentication for SSH
- On the Security of SSH Client Signatures
- Enabling Secure Shell Access with OpenID Connect
- SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
- Towards SSH3: how HTTP/3 improves secure shells

## Open Source & Contribution

This repository is being prepared as an open source research project.

Contributions are welcome, especially around:

- SSH session lifecycle and reliability.
- SFTP/FTP abstraction.
- Secure vault/keychain providers.
- Cross-platform Electron compatibility.
- Windows/Linux/macOS testing.
- UI/UX for server operations.
- Documentation and architecture diagrams.

Before opening a large pull request, please create an issue or discussion describing the proposal. The architecture may evolve quickly during the research stage, and API/schema changes are still expected.

Suggested contribution flow:

1. Fork the repository.
2. Create a focused feature branch.
3. Run migrations and local verification.
4. Keep changes scoped and documented.
5. Open a pull request with screenshots or terminal output when relevant.

## Public Roadmap

This roadmap reflects the current baseline of the project.

- Done: Phase 1 is already implemented above.
- Next: Phase 2 research work.
- Later: Phase 3 research work.

The next research milestones are intentionally public so contributors can join the security work:

### Phase 2

- eBPF telemetry.
- Session risk engine.
- Behavioral detection.

### Phase 3

- SSH3/QUIC.
- Browser-native relay.
- Session mobility.

### Later Product Work

- FTP support.
- SSH certificates hardening.
- Session persistence.
- Host grouping and filters.
- Remote monitoring.
- Plugin system.
- AI-assisted terminal workflows.
- Team collaboration.
- Security audit.
- Stable open source release.

## License

License is not finalized yet.

Planned direction: an open source license such as MIT, Apache-2.0, or AGPL-3.0. Final selection will be made before the first public release.

## Disclaimer

This project is in an experimental research stage. It is not recommended for production use without additional security review, infrastructure hardening, credential storage review, and operational testing.
