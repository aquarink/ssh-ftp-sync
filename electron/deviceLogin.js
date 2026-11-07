/**
 * Desktop sign-in through the browser (device authorization, RFC 8628 adapted).
 * Design: docs/DESKTOP_DEVICE_LOGIN_DESIGN.md. Server side: server/deviceAuth.js.
 *
 * The desktop never handles the password or a Turnstile token. It asks the API
 * for a short code, shows it, opens the system browser on the real site (where
 * the user signs in as usual and approves the code), and polls until the server
 * hands back a session cookie. That cookie lands in the Electron session jar, so
 * the rest of the runtime (API proxy, relay cookie injector, sshHandler) works
 * unchanged.
 *
 * Kept free of `electron` imports so it can be unit tested with plain Node: the
 * fetch, browser opener, clock and sleep are all injected.
 */

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const SLOW_DOWN_STEP_MS = 5_000;
const MAX_CONSECUTIVE_NETWORK_ERRORS = 5;

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** The verification URL must be on the API origin we were configured with. */
function isTrustedVerificationUrl(url, apiOrigin) {
  try {
    return new URL(url).origin === apiOrigin;
  } catch {
    return false;
  }
}

function parseBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function createDeviceLoginController({
  apiOrigin,
  fetchImpl,
  openExternal,
  deviceLabel,
  appVersion,
  now = () => Date.now(),
  sleep = defaultSleep,
}) {
  let current = null;
  // Each start() takes a generation. A start whose server reply arrives after a newer
  // start began is superseded and must not install its flow as the current one.
  let generation = 0;

  async function postJson(path, payload) {
    const response = await fetchImpl(`${apiOrigin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    const text = await response.text().catch(() => '');
    return { status: response.status, ok: response.ok, body: parseBody(text) };
  }

  async function openVerificationUrl(url) {
    if (!isTrustedVerificationUrl(url, apiOrigin)) {
      throw new Error('Refusing to open a sign-in page outside the configured server');
    }
    await openExternal(url);
  }

  async function pollUntilDone(flow) {
    let intervalMs = flow.intervalMs;
    let networkErrors = 0;

    while (!flow.signal.aborted) {
      try {
        await sleep(intervalMs, flow.signal);
      } catch {
        return; // cancelled or replaced
      }
      if (flow.signal.aborted) return;
      if (now() >= flow.expiresAtMs) {
        flow.emit({ state: 'expired' });
        return;
      }

      let result;
      try {
        result = await postJson('/api/auth/device/poll', { deviceCode: flow.deviceCode });
        networkErrors = 0;
      } catch {
        networkErrors += 1;
        if (networkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
          flow.emit({ state: 'error', message: 'Lost contact with the server. Try again.' });
          return;
        }
        continue;
      }
      if (flow.signal.aborted) return;

      if (result.status === 200) {
        flow.emit({ state: 'approved', user: result.body.user || null });
        return;
      }
      if (result.status === 428) {
        intervalMs = Number(result.body.interval) > 0 ? Number(result.body.interval) * 1000 : intervalMs;
        continue;
      }
      if (result.status === 429) {
        intervalMs += SLOW_DOWN_STEP_MS;
        continue;
      }
      if (result.status === 403) {
        flow.emit({ state: 'denied' });
        return;
      }
      if (result.status === 410) {
        flow.emit({ state: 'expired' });
        return;
      }
      flow.emit({ state: 'error', message: result.body.error || 'Sign-in failed' });
      return;
    }
  }

  /**
   * Starts a new sign-in. Resolves with the code to show as soon as the server
   * has issued it; status changes arrive through `onStatus` until the flow ends.
   * A new start cancels any flow still in progress.
   */
  async function start(onStatus) {
    cancel();
    generation += 1;
    const myGeneration = generation;

    const response = await postJson('/api/auth/device/start', {
      runtime: 'electron',
      deviceLabel,
      appVersion,
    });
    if (myGeneration !== generation) {
      throw new Error('Superseded by a newer sign-in');
    }
    if (!response.ok) {
      throw new Error(response.body.error || 'Could not start sign-in');
    }

    const { deviceCode, userCode, verificationUrlComplete, expiresAt, interval } = response.body;
    if (!isTrustedVerificationUrl(verificationUrlComplete, apiOrigin)) {
      throw new Error('The server returned a sign-in page outside the configured server');
    }

    const controller = new AbortController();
    const flow = {
      deviceCode,
      userCode,
      verificationUrl: verificationUrlComplete,
      expiresAtMs: new Date(expiresAt).getTime(),
      intervalMs: (Number(interval) > 0 ? Number(interval) : DEFAULT_POLL_INTERVAL_MS / 1000) * 1000,
      signal: controller.signal,
      controller,
      emit(status) {
        if (!controller.signal.aborted) onStatus(status);
        if (status.state !== 'awaiting_approval') {
          if (current === flow) current = null;
        }
      },
    };
    current = flow;

    try {
      await openVerificationUrl(verificationUrlComplete);
    } catch (error) {
      // The code is still valid: the user can open the page by hand from the app.
      onStatus({ state: 'browser_not_opened', message: error.message });
    }

    pollUntilDone(flow).catch((error) => {
      flow.emit({ state: 'error', message: error.message || 'Sign-in failed' });
    });

    return { userCode, verificationUrl: verificationUrlComplete, expiresAt };
  }

  function cancel() {
    if (!current) return;
    const flow = current;
    current = null;
    flow.controller.abort();
  }

  async function reopen() {
    if (!current) throw new Error('No sign-in is in progress');
    await openVerificationUrl(current.verificationUrl);
  }

  return { start, cancel, reopen, isActive: () => Boolean(current) };
}

/**
 * IPC surface for the renderer (`window.ipcRenderer`):
 *   device-login-start  (invoke) -> { userCode, verificationUrl, expiresAt }
 *   device-login-cancel (invoke)
 *   device-login-reopen (invoke) -> reopens the browser page
 *   device-login-status (event from main) -> { state, ... }
 */
function registerDeviceLoginIpc(ipcMain, controllerOptions) {
  const controller = createDeviceLoginController(controllerOptions);

  ipcMain.handle('device-login-start', (event) => {
    const sender = event?.sender;
    return controller.start((status) => {
      if (sender && !sender.isDestroyed?.()) sender.send('device-login-status', status);
    });
  });
  ipcMain.handle('device-login-cancel', () => {
    controller.cancel();
    return { ok: true };
  });
  ipcMain.handle('device-login-reopen', () => controller.reopen().then(() => ({ ok: true })));

  return controller;
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  MAX_CONSECUTIVE_NETWORK_ERRORS,
  SLOW_DOWN_STEP_MS,
  createDeviceLoginController,
  isTrustedVerificationUrl,
  registerDeviceLoginIpc,
};
