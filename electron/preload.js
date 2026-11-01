const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const dependency of ['chrome', 'node', 'electron']) {
    replaceText(`${dependency}-version`, process.versions[dependency]);
  }
});

window.ipcRenderer = ipcRenderer;

// Published before the page runs so the renderer's API client can pick the
// origin synchronously (see electron/appConfig.js).
try {
  window.__ATA_CONFIG__ = ipcRenderer.sendSync('app-config');
} catch {
  window.__ATA_CONFIG__ = undefined;
}
