# SSH/FTP Sync - Termius Alternative

A modern, cross-platform SSH and SFTP client built with Electron, React, and TailwindCSS. Features a beautiful user interface and built-in cloud sync via Supabase.

## Features (Roadmap)
- 🖥️ **Native Desktop App**: Built using Electron for Mac and Windows.
- 🎨 **Beautiful UI**: Modern, dark-themed UI using TailwindCSS and Lucide Icons.
- 💻 **Interactive Terminal**: Full-featured SSH terminal powered by `xterm.js`.
- 📁 **SFTP File Manager**: Manage remote files seamlessly.
- ☁️ **Cloud Sync**: Synchronize hosts, credentials, and settings across devices (End-to-End Encrypted).

## Tech Stack
- **Framework**: Electron + React + Vite
- **Language**: TypeScript / JavaScript
- **Styling**: TailwindCSS
- **Core Libraries**: `ssh2` (SSH connection), `xterm.js` (Terminal emulator), `@supabase/supabase-js` (Cloud sync)

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
