const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const os = require('os');
const path = require('path');
const { getAppConfig } = require('./appConfig');
const { installRelayCookieInjector, registerApiProxyIpc, registerAppConfigIpc } = require('./apiProxy');
const { registerDeviceLoginIpc } = require('./deviceLogin');

let sshLifecycle = null;
// One API origin for the whole desktop runtime (hosted by default; see appConfig.js).
const appConfig = getAppConfig();

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    titleBarStyle: 'hiddenInset', // looks more like termius on mac
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (process.env.NODE_ENV !== 'development') {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  }

  win.on('close', () => {
    sshLifecycle?.cleanupSessionsByWindowId?.(win.id, 'window_close');
  });

  return win;
}

app.whenReady().then(() => {
  // The renderer learns the API origin synchronously from preload, routes its API
  // calls through the main process (the file:// page cannot fetch the hosted API
  // directly: no CORS, SameSite cookie withheld), and the relay WebSocket it opens
  // gets the session cookie injected for that same origin.
  registerAppConfigIpc(ipcMain, appConfig);
  registerApiProxyIpc(ipcMain, {
    apiOrigin: appConfig.apiOrigin,
    fetchImpl: (url, init) => session.defaultSession.fetch(url, init),
  });
  installRelayCookieInjector(session.defaultSession, appConfig);

  // Sign-in through the browser: the poll's Set-Cookie lands in the same jar.
  registerDeviceLoginIpc(ipcMain, {
    apiOrigin: appConfig.apiOrigin,
    fetchImpl: (url, init) => session.defaultSession.fetch(url, init),
    openExternal: (url) => shell.openExternal(url),
    deviceLabel: `${os.hostname()} (${process.platform})`,
    appVersion: app.getVersion(),
  });

  // Register the SSH IPC channels before the window loads so none are missed.
  sshLifecycle = require('./sshHandler');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('before-quit', () => {
    sshLifecycle?.cleanupAllSessions?.('app_quit');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
