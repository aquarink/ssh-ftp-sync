#!/usr/bin/env node
/**
 * Integration test for relay detach + resume (Phase 2.2).
 *
 * Starts a mock SSH server and the real relay (`attachSshWebSocket`) with the auth,
 * access-policy and identity layers stubbed out, then drives a real WebSocket client
 * through: connect -> abrupt transport drop -> detach -> output while detached ->
 * resume -> buffered output replayed. Also checks that a resume token is one-time,
 * that another user cannot resume, and that a detached session expires after its
 * grace period.
 *
 * Run: node scripts/integration/relay-resume-test.js
 * Writes a JSON report next to this file and exits non-zero on failure.
 */
process.env.DETACHED_SESSION_GRACE_MS = process.env.DETACHED_SESSION_GRACE_MS || '1200';

const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Server: SSHServer } = require('ssh2');
const { WebSocket } = require('ws');
const { generateKeyPairSync } = require('crypto');

let mockSshPort = 0;
let currentUser = { id: 42 };
let currentShellStream = null;

// Stub the auth/access/identity layers by intercepting their module ids, so the relay
// runs for real while the test controls the user and target host.
const projectRoot = path.join(__dirname, '..', '..');
const { createEphemeralCredential } = require(path.join(projectRoot, 'server/ephemeralCredential'));
// Match the relay's own relative requires (./auth) as well as absolute paths.
const basename = (id) => id.replace(/\.js$/, '').split('/').pop();
const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
  if (basename(id) === 'auth') {
    return { getSessionUser: async () => currentUser };
  }
  if (basename(id) === 'securityLog') {
    return { logAccessEvent() {}, logIdentityEvent() {}, logVaultEvent() {}, redactSecretFields: (x) => x };
  }
  if (basename(id) === 'accessPolicy') {
    return {
      authorizeConnectRequest: async (userId, body) => ({
        host: { id: body.hostId, host: '127.0.0.1', port: mockSshPort, username: 'testuser' },
        credentialId: null,
        authType: 'password',
        runtime: 'browser',
        purpose: 'ssh',
      }),
    };
  }
  if (basename(id) === 'identityResolver') {
    return {
      resolveIdentity: async (args) => ({
        userId: args.userId,
        hostId: args.hostId,
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        host: { id: args.hostId, host: '127.0.0.1', port: mockSshPort, username: 'testuser' },
        ephemeralCredential: createEphemeralCredential({
          sessionId: args.sessionId,
          userId: args.userId,
          runtime: 'browser',
          purpose: 'ssh',
          authType: 'password',
          material: { password: 'testpass' },
          ttlMs: 30000,
        }),
      }),
    };
  }
  return originalRequire.apply(this, arguments);
};

// Silence the relay's metadata logging for a clean report.
console.info = () => {};

const { attachSshWebSocket } = require(path.join(projectRoot, 'server/sshWebSocket'));
const { getSession, SESSION_STATE, getSessionMetrics } = require(path.join(projectRoot, 'server/sessionLifecycle'));

function startMockSsh() {
  return new Promise((resolve) => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const server = new SSHServer({ hostKeys: [privateKey] }, (client) => {
      client.on('authentication', (ctx) => ctx.accept());
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (a) => a && a());
          session.on('shell', (acceptShell) => {
            const stream = acceptShell();
            currentShellStream = stream;
            stream.on('data', (d) => stream.write(d));
          });
        });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function startRelay() {
  return new Promise((resolve) => {
    const server = http.createServer();
    attachSshWebSocket(server);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Collect every message a socket receives so a waitFor cannot miss a message that
// arrives in the gap between two awaits (e.g. the replay `data` right after `resumed`).
function track(ws) {
  const received = [];
  ws.__received = received;
  ws.on('message', (raw) => {
    try { received.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  return ws;
}

function waitFor(ws, predicate, timeoutMs = 5000) {
  const existing = (ws.__received || []).find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timed out waiting for message'));
    }, timeoutMs);
    function onMessage(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

function waitClosed(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
    const done = () => { clearTimeout(timer); resolve(); };
    ws.on('close', done);
    ws.on('error', done);
  });
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail: detail || null });
  const tag = condition ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` (${detail})` : ''}`);
}

async function main() {
  const sshServer = await startMockSsh();
  mockSshPort = sshServer.address().port;
  const relay = await startRelay();
  const port = relay.address().port;
  const base = `ws://127.0.0.1:${port}/api/ssh`;
  const connectUrl = (sessionId) => `${base}?hostId=1&sessionId=${sessionId}&connectToken=x&purpose=ssh`;
  const resumeUrl = (sessionId, token) => `${base}?resume=${sessionId}&resumeToken=${encodeURIComponent(token)}`;

  try {
    // 1. detach + resume replays buffered output
    {
      const sessionId = 'resume-1';
      const ws1 = track(new WebSocket(connectUrl(sessionId)));
      const connected = await waitFor(ws1, (m) => m.type === 'connected');
      check('connect yields a resume token', Boolean(connected.resumeToken));
      check('session is connected', getSession(sessionId)?.state === SESSION_STATE.CONNECTED);

      ws1.terminate();
      await sleep(200);
      check('abrupt drop detaches the shell', getSession(sessionId)?.state === SESSION_STATE.DETACHED);

      currentShellStream.write('WHILE-DETACHED\n');
      await sleep(120);

      const ws2 = track(new WebSocket(resumeUrl(sessionId, connected.resumeToken)));
      const resumed = await waitFor(ws2, (m) => m.type === 'resumed');
      check('resume issues a fresh token', resumed.resumeToken && resumed.resumeToken !== connected.resumeToken);
      const replay = await waitFor(ws2, (m) => m.type === 'data' && m.data.includes('WHILE-DETACHED'));
      check('buffered output is replayed on resume', replay.data.includes('WHILE-DETACHED'));
      check('session is connected again', getSession(sessionId)?.state === SESSION_STATE.CONNECTED);

      ws2.send(JSON.stringify({ type: 'disconnect' }));
      await sleep(150);
      check('explicit disconnect tears the session down', !getSession(sessionId));
    }

    // 2. resume token is one-time
    {
      const sessionId = 'resume-2';
      const ws1 = track(new WebSocket(connectUrl(sessionId)));
      const connected = await waitFor(ws1, (m) => m.type === 'connected');
      ws1.terminate();
      await sleep(200);
      const ws2 = track(new WebSocket(resumeUrl(sessionId, connected.resumeToken)));
      await waitFor(ws2, (m) => m.type === 'resumed');
      ws2.terminate();
      await sleep(200);
      const ws3 = track(new WebSocket(resumeUrl(sessionId, connected.resumeToken)));
      await waitClosed(ws3);
      check('a consumed resume token cannot be reused', true);
      const s = getSession(sessionId);
      if (s) s.ws = null;
    }

    // 3. another user cannot resume
    {
      const sessionId = 'resume-3';
      const ws1 = track(new WebSocket(connectUrl(sessionId)));
      const connected = await waitFor(ws1, (m) => m.type === 'connected');
      ws1.terminate();
      await sleep(200);
      currentUser = { id: 999 };
      const ws2 = track(new WebSocket(resumeUrl(sessionId, connected.resumeToken)));
      await waitClosed(ws2);
      check('another user is refused resume', getSession(sessionId)?.userId === 42);
      currentUser = { id: 42 };
    }

    // 4. detached session expires after grace
    {
      const sessionId = 'resume-4';
      const before = getSessionMetrics().detachExpired;
      const ws1 = track(new WebSocket(connectUrl(sessionId)));
      await waitFor(ws1, (m) => m.type === 'connected');
      ws1.terminate();
      await sleep(200);
      check('session detached before grace', getSession(sessionId)?.state === SESSION_STATE.DETACHED);
      await sleep(1500);
      check('detached session is cleaned up after grace', !getSession(sessionId));
      check('detachExpired metric incremented', getSessionMetrics().detachExpired > before);
    }
  } finally {
    await new Promise((r) => relay.close(r));
    await new Promise((r) => sshServer.close(r));
  }

  const report = {
    ranAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  fs.writeFileSync(path.join(__dirname, 'relay-resume-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed}/${report.total} checks passed`);
  if (report.failed > 0) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode || 0)).catch((error) => {
  console.error('relay-resume-test failed:', error);
  process.exit(1);
});
