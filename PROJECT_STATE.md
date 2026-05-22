# PROJECT_STATE.md (AI Agent Instructions)

**Hello AI Agent (Codex)!** 
If you are reading this, your job is to assist the user in building this Termius-Alternative (SSH/FTP Client). This document serves as the absolute source of truth for the project's current state, architecture, and next steps.

---

## 🟢 Completed (Phases 1, 2, & 4)

- **Phase 1 (Foundation)**:
  - Initialized project with React, TypeScript, and Vite.
  - TailwindCSS configured for dark-mode layout.
  - Electron shell set up (`electron/main.js` and `electron/preload.js`).
  - Running via `npm run desktop` starts both Vite and Electron.
- **Phase 2 (SSH Terminal)**:
  - Terminal view (`src/components/TerminalView.tsx`) uses `xterm.js`.
  - Electron main process manages SSH2 socket connections (`electron/sshHandler.js`).
- **Phase 4 (Cloud Sync - Secure Auth Revert)**:
  - Switched from custom DB auth back to secure **native Supabase Authentication** (`supabase.auth`) for production safety.
  - Added session listeners (`getSession` and `onAuthStateChange`) in `src/App.tsx`.
  - Refactored `hosts` queries to use `session.user.id` and leverage Row Level Security (RLS).
  - Created `migrate.js` in the project root to run database schema setup.
  - **Zero TypeScript errors** (compiled successfully with `npx tsc --noEmit`).

---

## 🔴 Current Block & Roadblock (Action Required First!)

### 1. Database Table Creation (IPv4 Pooler Issue)
The user's local network does not support IPv6. The default direct database connection `db.iuccdegvxugrnmgwzwtj.supabase.co` fails with `ENOTFOUND` during migration.
- **Fix**: The user needs to toggle **"Session pooler"** (or Transaction pooler) in their Supabase Dashboard (**Project Settings -> Database -> Connection Pooler**) to get the IPv4-compatible hostname (e.g. `aws-0-[region].pooler.supabase.com`).
- **Action**: Run `node migrate.js` on local terminal, paste the Pooler URI when prompted, and it will automatically set up the `hosts` table with active Row Level Security (RLS) and policies.

---

## 🟡 Next Steps (Phase 3 - SFTP Manager)

Once database tables are created:
1. **Test Authentication**: Run `npm run desktop`, register a new account, log in, add hosts, and verify they sync securely to Supabase.
2. **SFTP Browser UI**:
   - Build a split-pane or toggleable file explorer view next to the Terminal area.
   - Design directories and files table (displaying name, size, permissions, modified date).
3. **SFTP Backend Handlers**:
   - Implement directory reading (`sftp.readdir`), download, upload, and delete operations in Electron's Main process (`electron/main.js` or separate helper) via the established `ssh2` SFTP channel.
   - Bridge SFTP operations via Electron IPC (`sftp-list`, `sftp-download`, `sftp-upload`).
4. **Drag & Drop**:
   - Allow drag-and-drop transfers between the local file system and the remote SFTP file browser panel.
