/**
 * Main-process API access for the desktop runtime.
 *
 * The renderer runs from `file://`, so a direct `fetch` to the hosted API is a
 * cross-site request: the API has no CORS and its `SameSite=Lax` session cookie
 * is withheld. Instead the renderer sends `api-request` over IPC and the main
 * process fetches with the Electron session's own cookie jar. Nothing on the
 * server has to be loosened for the desktop app.
 *
 * The relay WebSocket (`/api/ssh`) is opened by the renderer itself (same code
 * path as the browser) and would hit the same cookie problem, so the main
 * process injects the session cookie into that one handshake.
 *
 * Kept free of `electron` imports so it can be unit tested with plain Node.
 */

const SESSION_COOKIE_NAME = 'ats_session';
const FORWARDED_REQUEST_HEADERS = new Set(['content-type', 'accept']);
const ALLOWED_METHODS = /^(GET|POST|PUT|PATCH|DELETE)$/;

/** Only same-origin `/api/...` paths; the renderer never picks the origin. */
function isSafeApiPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) return false;
  if (/[\r\n]/.test(path)) return false;
  const pathname = path.split('?')[0];
  if (pathname.startsWith('//') || pathname.includes('..') || pathname.includes('://') || pathname.includes('\\')) {
    return false;
  }
  return true;
}

/** Forward only harmless headers; Cookie/Authorization are the main process's job. */
function pickForwardedHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (FORWARDED_REQUEST_HEADERS.has(String(name).toLowerCase()) && typeof value === 'string') {
      out[name] = value;
    }
  }
  return out;
}

async function proxyApiRequest({ apiOrigin, fetchImpl }, payload = {}) {
  const { path, method = 'GET', headers, body } = payload;
  if (!isSafeApiPath(path)) throw new Error('Invalid API path');
  const safeMethod = String(method).toUpperCase();
  if (!ALLOWED_METHODS.test(safeMethod)) throw new Error('Unsupported HTTP method');

  const response = await fetchImpl(`${apiOrigin}${path}`, {
    method: safeMethod,
    headers: { 'Content-Type': 'application/json', ...pickForwardedHeaders(headers) },
    body: typeof body === 'string' && safeMethod !== 'GET' ? body : undefined,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const text = await response.text().catch(() => '');
  let json = {};
  if (isJson && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText || '',
    contentType,
    payload: json,
    text: isJson ? '' : text,
    server: response.headers.get('server') || null,
  };
}

function registerApiProxyIpc(ipcMain, { apiOrigin, fetchImpl }) {
  ipcMain.handle('api-request', (_event, payload) => proxyApiRequest({ apiOrigin, fetchImpl }, payload));
}

/** Synchronous so preload can publish the config before the page runs. */
function registerAppConfigIpc(ipcMain, config) {
  ipcMain.on('app-config', (event) => {
    event.returnValue = config;
  });
}

/**
 * Add the session cookie to the relay WebSocket handshake for the API origin.
 * Electron allows one onBeforeSendHeaders listener per session; this is it.
 */
function installRelayCookieInjector(session, { apiOrigin, wsOrigin, cookieName = SESSION_COOKIE_NAME }) {
  const urls = [`${wsOrigin}/api/ssh*`, `${apiOrigin}/api/ssh*`];
  const listener = (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    const hasCookie = Object.keys(requestHeaders).some((name) => name.toLowerCase() === 'cookie');
    if (hasCookie) {
      callback({ requestHeaders });
      return;
    }
    Promise.resolve(session.cookies.get({ url: apiOrigin, name: cookieName }))
      .then((cookies) => {
        if (cookies && cookies.length > 0) {
          requestHeaders.Cookie = `${cookieName}=${cookies[0].value}`;
        }
        callback({ requestHeaders });
      })
      .catch(() => callback({ requestHeaders }));
  };
  session.webRequest.onBeforeSendHeaders({ urls }, listener);
  return { urls, listener };
}

module.exports = {
  SESSION_COOKIE_NAME,
  installRelayCookieInjector,
  isSafeApiPath,
  pickForwardedHeaders,
  proxyApiRequest,
  registerApiProxyIpc,
  registerAppConfigIpc,
};
