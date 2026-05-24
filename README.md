# Ant Tech Async SSH Client

> Working name. Final open source project name may change.

[![Status](https://img.shields.io/badge/status-research-orange)](#)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Electron%20%2B%20Node-blue)](#)
[![License](https://img.shields.io/badge/license-TBD-lightgrey)](#license)

Ant Tech Async SSH Client is an experimental open source SSH/SFTP/FTP client for self-hosted infrastructure management and research-guided secure remote operations. It combines a modern web dashboard, an Electron desktop runtime, a multi-session terminal manager, and a Node.js backend for authenticated browser preview.

The project is inspired by the operational workflows of tools such as Termius, MobaXterm, Tabby, and VSCode Remote, while remaining an original implementation focused on self-hosted control, modular architecture, and research-friendly extensibility.

## Main Features

- Multiple SSH tabs.
- Multi-session terminal management.
- SFTP/FTP file manager.
- Secure SSH identities/keychain.
- SSH private key and certificate support.
- Browser mode through authenticated WebSocket relay.
- Electron desktop mode.
- Host management with create, edit, duplicate, delete, and identity assignment.
- Session management with HttpOnly cookies.
- Cross-platform direction for Linux, Windows, and macOS.
- Admin/user approval system.
- Cloudflare Turnstile-protected auth forms.
- Modern dark UI built with TailwindCSS and Lucide icons.
- Experimental research features for plugins, AI-assisted terminal workflows, and team collaboration.

## Screenshots

Screenshots will be added as the open source UI stabilizes.

| View | Preview |
| --- | --- |
| Landing page | _Coming soon_ |
| SSH terminal | _Coming soon_ |
| File manager | _Coming soon_ |
| Keychain manager | _Coming soon_ |

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

## Installation

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

### Start Development API

```bash
npm run api
```

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

### Production Notes

For production-style browser deployment:

1. Build the Vite app.
2. Serve `dist/` from Nginx.
3. Proxy `/api/` and `/api/ssh` to the Node API.
4. Run migrations before deploying backend changes.
5. Use strong secrets and a secure vault key.

## Environment Variables

See `.env.example` for the current template. Common values include:

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=ant_tech_async
MYSQL_USER=ant_tech_async
MYSQL_PASSWORD=change-me

API_PORT=8790
SESSION_DAYS=30
SESSION_SECRET=change-me

VITE_TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key

QUICKEMAILVERIFICATION_API_KEY=optional
CREDENTIAL_VAULT_KEY=change-me
CREDENTIAL_VAULT_DIR=.credential-vault
```

Never commit `.env`, vault files, private keys, passphrases, passwords, or production tokens.

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

## Research-Guided Security Features

- Smart Identity Engine for scoped credential resolution.
- Scoped identity selection per host and session.
- No auto-offer of all keys or identities.
- Browser and Electron runtime-specific policy enforcement.
- Secret resolution only during connection setup.

### Secure Vault

- Metadata-only identity API responses.
- Encrypted secret storage for browser/server and Electron runtimes.
- Redacted logs and safe vault error handling.
- Vault health check for admin/internal verification.
- Clear browser/Electron vault boundary.
- Legacy password migration note for compatibility-only host records.

### Key Isolation

- Ephemeral credential wrappers with short TTL metadata.
- Resolve-then-connect lifecycle for SSH, SFTP, and identity test flows.
- No raw secret material in long-lived session state, reconnect state, or renderer state.
- Best-effort secret cleanup with nested object deletion and Buffer overwrite.
- Browser and Electron runtimes clear secret material after use in their own trust boundaries.
- Reconnect and SFTP resolve fresh identity material instead of reusing cached secrets.
- Research references by title only:
  - SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
  - On the Security of SSH Client Signatures
  - Practical Privacy-Preserving Authentication for SSH
  - Enabling Secure Shell Access with OpenID Connect
  - Towards SSH3: how HTTP/3 improves secure shells

### Zero-Trust Access Layer

- Short-lived connect authorization before SSH or SFTP runtime access.
- One-time connect tokens scoped to user, host, runtime, purpose, and optional authType or identity.
- Browser relay authorization boundary that validates token scope before identity resolution.
- Electron runtime authorization that still validates session context and consumes a fresh token before connect.
- Token invalidation on logout, host deletion, identity deletion, reconnect failure, and validation failure.
- Metadata-only logging and metrics for token issuance, validation, rejection, expiration, reuse, and runtime-policy denial.
- Research references by title only:
  - Brute-force attack mitigation on remote access services via software-defined perimeter
  - Enabling Secure Shell Access with OpenID Connect
  - Practical Privacy-Preserving Authentication for SSH
  - ESX: A Self-Generated Control Policy for Remote Access With SSH Based on eBPF
  - Towards SSH3: how HTTP/3 improves secure shells
  - Emerging research areas in SIP-based converged services for extended Web clients

### Research References

- Practical Privacy-Preserving Authentication for SSH
- On the Security of SSH Client Signatures
- Enabling Secure Shell Access with OpenID Connect
- SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
- Towards SSH3: how HTTP/3 improves secure shells

### Research-Guided Security Features

#### Key Isolation

- Ephemeral credential wrapper keeps resolved secret material inside a short-lived runtime object.
- Resolve-then-connect ensures secrets are only available for the connection attempt that needs them.
- Long-lived session state stays metadata-only.
- Secret cleanup is best-effort and runs after connect attempts, failures, and test operations.
- Reconnect resolves identity again instead of reusing cached secret material.
- Browser and Electron runtimes use separate secret boundaries so renderer state never receives resolved secrets.
- Research references:
  - SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
  - On the Security of SSH Client Signatures
  - Practical Privacy-Preserving Authentication for SSH
  - Enabling Secure Shell Access with OpenID Connect
  - Towards SSH3: how HTTP/3 improves secure shells

#### Session Cleanup

- Deterministic session lifecycle keeps SSH and SFTP sessions in explicit states.
- Session maps remain metadata-only and do not store raw credential material.
- Cleanup is idempotent so duplicate close signals are safe.
- Browser WebSocket cleanup, Electron IPC cleanup, reconnect cleanup, and SFTP cleanup all flow through a central teardown path.
- A stale-session sweeper removes abandoned pending sessions.
- Frontend terminal and file-manager components dispose listeners, timers, and observers on unmount.
- Research references:
  - SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic
  - On the Security of SSH Client Signatures
  - Practical Privacy-Preserving Authentication for SSH
  - ESX: A Self-Generated Control Policy for Remote Access With SSH Based on eBPF
  - Emerging research areas in SIP-based converged services for extended Web clients
  - Towards SSH3: how HTTP/3 improves secure shells

### Experimental Features

- Browser SSH relay.
- Electron SSH IPC sessions.
- Scoped identity assignment and metadata-only identity listing.
- Runtime-specific secure storage routing.

### Security Architecture

- Browser mode resolves secrets from the server-encrypted vault only.
- Electron mode resolves secrets from local secure storage only.
- Identity metadata is exposed separately from secret material.
- Host-to-credential assignment is enforced before connection setup.

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

## Roadmap

- [x] SSH terminal.
- [x] Authentication system.
- [x] Admin approval.
- [x] Landing page.
- [x] Host create/delete.
- [x] Host edit/duplicate.
- [x] Multiple tabs.
- [x] SFTP manager.
- [x] Keychain / SSH identities.
- [ ] FTP support.
- [ ] SSH certificates hardening.
- [ ] Session persistence.
- [ ] Host grouping and filters.
- [ ] Remote monitoring.
- [ ] Plugin system.
- [ ] AI-assisted terminal workflows.
- [ ] Team collaboration.
- [ ] Security audit.
- [ ] Stable open source release.

## License

License is not finalized yet.

Planned direction: an open source license such as MIT, Apache-2.0, or AGPL-3.0. Final selection will be made before the first public release.

## Disclaimer

This project is in an experimental research stage. It is not recommended for production use without additional security review, infrastructure hardening, credential storage review, and operational testing.
