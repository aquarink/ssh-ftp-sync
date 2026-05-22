const { Client } = require('ssh2');
const { WebSocket, WebSocketServer } = require('ws');
const { getSessionUser } = require('./auth');
const { pool } = require('./db');

const maxTerminalMessageBytes = 64 * 1024;
const webSocketKeepaliveMs = 25000;

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function rejectUpgrade(socket, status, message) {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n` +
    message
  );
  socket.destroy();
}

async function getUserHost(req, url) {
  const user = await getSessionUser(req);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });

  const hostId = url.searchParams.get('hostId');
  if (!hostId) throw Object.assign(new Error('Host is required'), { status: 400 });

  const [rows] = await pool.execute(
    `SELECT id, host, port, username, password
       FROM hosts
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [hostId, user.id]
  );
  if (!rows[0]) throw Object.assign(new Error('Host not found'), { status: 404 });
  return rows[0];
}

function readMessage(raw) {
  if (raw.length > maxTerminalMessageBytes) {
    throw new Error('Terminal message is too large');
  }

  const message = JSON.parse(raw.toString('utf8'));
  if (!message || typeof message.type !== 'string') throw new Error('Invalid terminal message');
  return message;
}

function connectShell(ws, host) {
  const conn = new Client();
  let stream = null;
  let finished = false;
  const webSocketKeepalive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, webSocketKeepaliveMs);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(webSocketKeepalive);
    stream?.end();
    conn.end();
  };

  ws.on('message', (raw) => {
    try {
      const message = readMessage(raw);
      if (message.type === 'input' && stream && typeof message.data === 'string') {
        stream.write(message.data);
      }
      if (message.type === 'resize' && stream) {
        const cols = Number(message.cols);
        const rows = Number(message.rows);
        if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
          stream.setWindow(rows, cols, 480, 640);
        }
      }
    } catch (error) {
      send(ws, 'error', { message: error.message });
    }
  });

  ws.once('close', finish);
  ws.once('error', finish);

  conn.once('ready', () => {
    conn.shell({ term: 'xterm-256color' }, (error, shell) => {
      if (error) {
        send(ws, 'error', { message: error.message });
        ws.close();
        finish();
        return;
      }

      stream = shell;
      send(ws, 'connected');
      stream.on('data', (data) => send(ws, 'data', { data: data.toString('utf8') }));
      stream.once('close', () => {
        send(ws, 'closed');
        ws.close();
        finish();
      });
      stream.once('error', (streamError) => {
        send(ws, 'error', { message: streamError.message });
        ws.close();
        finish();
      });
    });
  });
  conn.once('error', (error) => {
    send(ws, 'error', { message: error.message });
    ws.close();
    finish();
  });
  conn.once('end', () => {
    send(ws, 'closed');
    ws.close();
    finish();
  });

  conn.connect({
    host: host.host,
    port: host.port || 22,
    username: host.username,
    password: host.password || undefined,
    readyTimeout: 15000,
    keepaliveInterval: webSocketKeepaliveMs,
    keepaliveCountMax: 3,
  });
}

function attachSshWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxTerminalMessageBytes });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/ssh') {
      rejectUpgrade(socket, 404, 'Not found');
      return;
    }

    getUserHost(req, url)
      .then((host) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          connectShell(ws, host);
        });
      })
      .catch((error) => rejectUpgrade(socket, error.status || 500, error.message || 'SSH unavailable'));
  });
}

module.exports = { attachSshWebSocket };
