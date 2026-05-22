# PROJECT_STATE.md

## Current Architecture

- React, TypeScript, Vite, TailwindCSS, and Electron provide the UI shell.
- `src/components/TerminalView.tsx` uses `xterm.js` for the SSH terminal.
- `electron/sshHandler.js` owns live `ssh2` shell connections through Electron IPC.
- Browser preview SSH shells use the authenticated `/api/ssh` WebSocket relay in `server/sshWebSocket.js`.
- Host sync and account auth are self-hosted now:
  - Node HTTP API: `server/index.js`
  - MySQL pool and auth helpers: `server/db.js`, `server/auth.js`
  - Browser/Electron client wrapper: `src/lib/api.ts`
  - MySQL schema: `db/migrations/001_mysql_init.sql`, applied by `npm run migrate`

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

## Remaining Product Work

1. Test register, admin approval/rejection, login, host create/delete, and SSH browser/desktop connection from a real user flow.
2. Build the SFTP browser UI next to or alongside the terminal.
3. Add Electron SFTP IPC handlers for list, upload, download, and delete via `ssh2`.
4. Decide how remote host credentials should be protected before production use. The current host password column preserves the existing behavior but is not end-to-end encrypted.
