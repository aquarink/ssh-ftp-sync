const { ipcMain } = require('electron');
const { Client } = require('ssh2');

let activeConnections = {};

ipcMain.on('ssh-connect', (event, { id, host, port, username, password, privateKey }) => {
  const conn = new Client();
  
  conn.on('ready', () => {
    event.reply('ssh-connected', { id });
    
    conn.shell((err, stream) => {
      if (err) {
        event.reply('ssh-error', { id, message: err.message });
        return;
      }
      
      activeConnections[id] = { conn, stream };
      
      // Listen to output from server and send to frontend
      stream.on('close', () => {
        event.reply('ssh-closed', { id });
        conn.end();
        delete activeConnections[id];
      }).on('data', (data) => {
        event.reply('ssh-data', { id, data: data.toString('utf8') });
      });
    });
  }).on('error', (err) => {
    event.reply('ssh-error', { id, message: err.message });
  }).on('end', () => {
    event.reply('ssh-closed', { id });
  }).connect({
    host: host,
    port: port || 22,
    username: username,
    password: password,
    privateKey: privateKey
  });
});

ipcMain.on('ssh-input', (event, { id, data }) => {
  if (activeConnections[id] && activeConnections[id].stream) {
    activeConnections[id].stream.write(data);
  }
});

ipcMain.on('ssh-resize', (event, { id, cols, rows }) => {
  if (activeConnections[id] && activeConnections[id].stream) {
    activeConnections[id].stream.setWindow(rows, cols, 480, 640);
  }
});

ipcMain.on('ssh-disconnect', (event, { id }) => {
  if (activeConnections[id]) {
    activeConnections[id].conn.end();
    delete activeConnections[id];
  }
});
