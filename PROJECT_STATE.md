# PROJECT_STATE.md (AI Agent Instructions)

**Hello AI Agent!** 
If you are reading this, your job is to assist the user in building this Termius-Alternative (SSH/FTP Client). This document serves as the absolute source of truth for the project's current state, architecture, and next steps.

## Project Context
The user wants a premium, cross-platform Desktop SSH/FTP client similar to Termius.
- **Tech Stack**: Electron, React, Vite, TailwindCSS.
- **Backend/Sync**: Supabase (for syncing hosts/credentials across devices).
- **Core Logic**: Node.js `ssh2` module (for SSH/SFTP backend), `xterm.js` (for frontend terminal).

---

## 🟢 Completed (Phase 1)
- [x] Initialized project with `create-vite` (React + TypeScript).
- [x] Configured TailwindCSS for a premium dark-mode aesthetic.
- [x] Setup Electron shell (`electron/main.js` and `electron/preload.js`).
- [x] Created the basic UI Layout (`src/App.tsx`):
  - Sidebar Navigation.
  - Hosts List Panel (with dummy data).
  - Main Terminal Area layout.
- [x] Configured `npm run desktop` script to launch the Vite server + Electron window simultaneously.

---

## 🟡 Currently Working On (Phase 2 - SSH Terminal)
This is what you should focus on next if the user asks to continue:
1. **Initialize `xterm.js`**: Create a React component that mounts an `xterm.js` terminal instance inside the Main Area.
2. **Node.js SSH Integration**:
   - Establish an IPC bridge between React (Renderer) and Electron (Main Process).
   - Use the `ssh2` library in `electron/main.js` to connect to a real SSH server.
   - Forward terminal input/output (pty) between `xterm.js` and the `ssh2` session via IPC channels.
3. **Dynamic Host Form**: Create a modal/form in React for the user to input IP, Port, Username, and Password, which will be passed to the SSH connector.

---

## 🔴 Pending (Phase 3 & 4)
- **Phase 3 (SFTP Manager)**: Build a file explorer UI to navigate, upload, download, and delete files on the remote server using the SFTP channel from `ssh2`.
- **Phase 4 (Cloud Sync)**: Integrate Supabase authentication (Login/Register). Encrypt the SSH credentials on the client-side before uploading them to the Supabase database to ensure the user's keys/passwords are secure.

## Important Notes for AI Agents
- **Styling**: Always prioritize aesthetics. Use rich colors, subtle borders (`border-border`), and micro-interactions (hover states). The UI MUST feel premium (like Termius). Do NOT make it look like a basic bootstrap app.
- **Electron IPC**: Ensure proper Context Isolation rules are followed if possible, or use standard IPC if `contextIsolation` is explicitly disabled in `main.js`. (Currently `contextIsolation` is `false` for MVP speed, but keep security in mind).
- **Update this file**: Whenever you finish a major milestone, PLEASE update this `PROJECT_STATE.md` file so the next agent knows what's been done.
