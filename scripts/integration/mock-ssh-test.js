const fs = require('fs');
const { generateKeyPairSync } = require('crypto');
const { Server: SSHServer, Client: SSHClient } = require('ssh2');
const path = require('path');

const { issueConnectToken } = require('../../server/connectToken');
const {
  createSession,
  cleanupSession,
  getSessionMetrics,
  addListenerCleanup,
  startSessionSweeper,
  sweepStaleSessions,
} = require('../../server/sessionLifecycle');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeEphemeralCredential(sessionId, material) {
  let cleared = false;
  return {
    id: `ephemeral-${sessionId}`,
    sessionId,
    material,
    clear() {
      // best-effort clear
      try {
        if (material && typeof material === 'object') {
          for (const k of Object.keys(material)) {
            try { material[k] = null; } catch {};
          }
        }
        cleared = true;
        return true;
      } catch {
        return false;
      }
    },
    isCleared() { return cleared; },
  };
}

async function startMockSshServer() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const server = new SSHServer({ hostKeys: [privateKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'testuser' && ctx.password === 'password123') {
        return ctx.accept();
      }
      return ctx.reject();
    });

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        // accept pty requests
        session.on('pty', (acceptPty) => { try { acceptPty && acceptPty(); } catch {} });
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          stream.write('mock-shell-welcome\\n');
          stream.on('data', (d) => {
            // echo back
            stream.write('echo:' + d.toString('utf8'));
          });
          // close after short delay
          setTimeout(() => {
            try { stream.exit(0); } catch {}
            try { stream.end(); } catch {}
          }, 800);
        });
      });
    });

    client.on('end', () => {});
    client.on('error', (err) => { try { /* ignore mock server socket errors */ } catch {} });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', function() {
      const addr = server.address();
      if (!addr || !addr.port) return reject(new Error('Failed to bind mock SSH server'));
      resolve(addr.port);
    });
  }).then((port) => port);

  const port = server.address().port;
  return { server, port };
}

async function run() {
  console.log('Starting mock SSH server...');
  const { server, port } = await startMockSshServer();
  console.log('Mock SSH server listening on', port);

  // start sweeper to emulate real runtime
  startSessionSweeper();

  // Issue a connect token (measure issuance)
  const t0 = Date.now();
  const tokenResp = issueConnectToken({ userId: 'user-1', hostId: 'host-1', runtime: 'browser' });
  const t1 = Date.now();
  console.log('Issued token:', { tokenId: tokenResp.tokenId, ttlSeconds: tokenResp.ttlSeconds, issuedMs: t1 - t0 });

  const report = {
    token: { issuedMs: t1 - t0, tokenId: tokenResp.tokenId },
    sessions: [],
    metricsBefore: getSessionMetrics(),
    metricsAfter: null,
  };

  // Scenario A: graceful connect + graceful close
  const sessionIdA = `test-grace-${Date.now()}`;
  const materialA = { password: 'password123' };
  const ephemeralA = makeEphemeralCredential(sessionIdA, materialA);

  createSession({ sessionId: sessionIdA, userId: 'user-1', hostId: 'host-1', credentialId: 'cred-A', runtime: 'browser', purpose: 'ssh', state: 'connecting', hasClient: true });

  addListenerCleanup(sessionIdA, () => {
    // listener cleanup observed
    // noop
  });

  const clientA = new SSHClient();
  const connectStartA = Date.now();
  let readyA = null;
  clientA.on('ready', () => {
    readyA = Date.now();
    console.log('[A] client ready, opening shell');
    clientA.shell({ term: 'xterm' }, (err, stream) => {
      if (err) {
        console.error('[A] shell error', err);
        return;
      }
      stream.on('data', (d) => {
        console.log('[A] stream data:', d.toString());
      });
      stream.write('hello from A\\n');
      // graceful end after a moment
      setTimeout(() => {
        clientA.end();
      }, 1200);
    });
  });

  clientA.on('close', () => {
    const closedA = Date.now();
    console.log('[A] client closed at', closedA);
    // invoke cleanup
    const cleanupStart = Date.now();
    const cleaned = cleanupSession(sessionIdA, 'client_closed_graceful');
    const cleanupEnd = Date.now();
    report.sessions.push({ id: sessionIdA, connectMs: readyA ? (readyA - connectStartA) : null, cleaned, cleanupMs: cleanupEnd - cleanupStart, ephemeralCleared: ephemeralA.clear ? ephemeralA.clear() && ephemeralA.isCleared() : false });
  });

  clientA.connect({ host: '127.0.0.1', port, username: 'testuser', password: ephemeralA.material.password, readyTimeout: 10000 });

  // Scenario B: abrupt destroy
  const sessionIdB = `test-abrupt-${Date.now()}`;
  const materialB = { password: 'password123' };
  const ephemeralB = makeEphemeralCredential(sessionIdB, materialB);

  createSession({ sessionId: sessionIdB, userId: 'user-2', hostId: 'host-2', credentialId: 'cred-B', runtime: 'browser', purpose: 'ssh', state: 'connecting', hasClient: true });

  const clientB = new SSHClient();
  let readyB = null;
  const connectStartB = Date.now();
  clientB.on('ready', () => {
    readyB = Date.now();
    console.log('[B] client ready, opening shell');
    clientB.shell({ term: 'xterm' }, (err, stream) => {
      if (err) {
        console.error('[B] shell error', err);
        return;
      }
      stream.on('data', (d) => { console.log('[B] stream data:', d.toString()); });
      stream.write('hello from B\\n');
      // abrupt destroy shortly after
      setTimeout(() => {
        try { clientB._sock && clientB._sock.destroy(); } catch {};
        try { clientB.emit && clientB.emit('close'); } catch {};
        // best-effort cleanup call after abrupt
        const cleanupStart = Date.now();
        const cleaned = cleanupSession(sessionIdB, 'client_abrupt_destroy');
        const cleanupEnd = Date.now();
        report.sessions.push({ id: sessionIdB, connectMs: readyB ? (readyB - connectStartB) : null, cleaned, cleanupMs: cleanupEnd - cleanupStart, ephemeralCleared: ephemeralB.clear ? ephemeralB.clear() && ephemeralB.isCleared() : false });
      }, 800);
    });
  });
  clientB.on('error', (err) => { console.error('[B] client error', err && err.message); });
  clientB.on('close', () => { console.log('[B] client close event'); });

  clientB.connect({ host: '127.0.0.1', port, username: 'testuser', password: ephemeralB.material.password, readyTimeout: 10000 });

  // Wait for scenarios to complete
  await sleep(3000);

  // force a sweep to cleanup stale sessions for test determinism
  try { sweepStaleSessions(); } catch {}

  report.metricsAfter = getSessionMetrics();

  // write report
  const outPath = path.join(__dirname, 'mock-ssh-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Report written to', outPath);

  // basic assertions to make CI fail on regressions
  try {
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (!Array.isArray(written.sessions) || written.sessions.length < 1) {
      console.error('Assertion failed: no sessions recorded in mock-ssh-report.json');
      process.exit(2);
    }
    for (const s of written.sessions) {
      if (!s.cleaned) {
        console.error('Assertion failed: session not cleaned', s.id);
        process.exit(2);
      }
      if (!s.ephemeralCleared) {
        console.error('Assertion failed: ephemeral credential not cleared for', s.id);
        process.exit(2);
      }
    }
  } catch (err) {
    console.error('Failed assertions on mock report:', err && err.message);
    process.exit(2);
  }

  // close server
  try { server.close(); } catch {}
  console.log('Done.');
  process.exit(0);
}

run().catch((err) => { console.error('Test run failed:', err); process.exit(1); });
