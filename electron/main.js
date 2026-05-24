const { app, BrowserWindow } = require('electron');
const path = require('path');

let sshLifecycle = null;

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
  createWindow();

  // Initialize SSH handler
  sshLifecycle = require('./sshHandler');

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
