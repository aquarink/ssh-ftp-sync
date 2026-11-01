/**
 * One API origin for the desktop runtime.
 *
 * The renderer used to hard-code a retired hostname for `file://` builds while
 * the main process talked to `127.0.0.1:8790`, so the two halves of the desktop
 * app never agreed on which backend they were using. The main process is now
 * the single source of truth: it resolves the origin here, hands it to the
 * renderer synchronously from preload (`window.__ATA_CONFIG__`), proxies the
 * renderer's API calls to it, and injects the session cookie for its relay.
 *
 * Resolution order: `ATA_API_ORIGIN` (any http/https origin) → the local API on
 * `API_PORT` in development → the hosted deployment.
 */
const DEFAULT_HOSTED_ORIGIN = 'https://ata.uinjakarta.id';
const DEFAULT_API_PORT = 8790;

function normalizeOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

function toWebSocketOrigin(origin) {
  return origin.replace(/^http(s?):/, 'ws$1:');
}

function resolveApiOrigin({ env = process.env, isDev = env.NODE_ENV === 'development' } = {}) {
  const configured = normalizeOrigin(env.ATA_API_ORIGIN);
  if (configured) return configured;
  if (isDev) return `http://127.0.0.1:${Number(env.API_PORT) || DEFAULT_API_PORT}`;
  return DEFAULT_HOSTED_ORIGIN;
}

function getAppConfig(options) {
  const apiOrigin = resolveApiOrigin(options);
  return {
    apiOrigin,
    wsOrigin: toWebSocketOrigin(apiOrigin),
    hostedMode: !isLocalOrigin(apiOrigin),
  };
}

module.exports = {
  DEFAULT_API_PORT,
  DEFAULT_HOSTED_ORIGIN,
  getAppConfig,
  isLocalOrigin,
  normalizeOrigin,
  resolveApiOrigin,
  toWebSocketOrigin,
};
