# SSH/FTP Sync - Termius Alternative

A modern, cross-platform SSH and SFTP client built with Electron, React, and TailwindCSS. Features a dark desktop UI and self-hosted host sync.

## Features (Roadmap)
- 🖥️ **Native Desktop App**: Built using Electron for Mac and Windows.
- 🎨 **Beautiful UI**: Modern, dark-themed UI using TailwindCSS and Lucide Icons.
- 💻 **Interactive Terminal**: Full-featured SSH terminal powered by `xterm.js` over Electron IPC or an authenticated browser WebSocket relay.
- 📁 **SFTP File Manager**: Manage remote files seamlessly.
- ☁️ **Cloud Sync**: Synchronize hosts across devices through the self-hosted API.
- ✅ **Controlled Signup**: New signup emails are checked server-side before an administrator approves access.
- 🛡️ **Bot Gate**: Login and register forms require Cloudflare Turnstile validation on the API.
- 🧱 **Preview WAF**: The deployed Nginx vhost runs ModSecurity with OWASP CRS.

## Tech Stack
- **Framework**: Electron + React + Vite
- **Language**: TypeScript / JavaScript
- **Styling**: TailwindCSS
- **Core Libraries**: `ssh2` (SSH connection), `xterm.js` (Terminal emulator), `mysql2` (MySQL API storage)

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/aquarink/ssh-ftp-sync.git
   cd ssh-ftp-sync
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Development
Copy `.env.example` to `.env`, set the MySQL connection values, and apply the schema:
```bash
npm run migrate
```

Set `QUICKEMAILVERIFICATION_API_KEY` in `.env` to validate signup emails.
Set `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` for the Turnstile form widget and backend Siteverify check.

Create or rotate an administrator account with:
```bash
npm run create-admin -- <username> <strong-password>
```

Start the self-hosted API in one terminal:
```bash
npm run api
```

To run the app in development mode with live-reloading:
```bash
npm run desktop
```
*(This command starts the Vite dev server and launches the native Electron window)*

To preview just the UI in your browser without Electron:
```bash
npm run dev
```

### Build for Production
To package the app into a standalone installer (.dmg, .exe):
```bash
npm run build
```
