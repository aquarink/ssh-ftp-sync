export interface User {
  id: string;
  email: string;
  username?: string | null;
  role: 'admin' | 'user';
  approvalStatus: 'pending' | 'approved' | 'rejected';
}

export interface Session {
  user: User;
}

export interface DeviceAuthorization {
  userCode: string;
  deviceLabel: string | null;
  appVersion: string | null;
  runtime: string;
  requesterIp: string | null;
  requestedAt: string;
  expiresAt: string;
  expiresIn: number;
}

export interface ClientSession {
  id: string;
  client: 'web' | 'desktop';
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
}

export interface Host {
  id: string;
  userId?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  authType?: 'password' | 'private_key' | 'private_key_passphrase' | 'key_with_certificate' | 'certificate' | 'credential' | 'identity' | 'agent' | 'manual' | 'one_time';
  credentialId?: string | null;
  startupDirectory?: string | null;
  notes?: string | null;
  tags?: string | null;
  updatedAt?: string;
}

export interface IdentityTestResult {
  ok: true;
  authType: string | null;
  fingerprint: string | null;
  message: string;
}

export interface SessionMetrics {
  activeSessions: number;
  sessionsCreated: number;
  sessionsClosed: number;
  cleanupCalls: number;
  cleanupDuplicateCalls: number;
  staleSessionsCleaned: number;
  reconnectAttempts: number;
  cleanupErrors: number;
}

export interface ConnectTokenResponse {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

export interface ManagedUser extends User {
  createdAt: string;
  emailCheckResult?: string | null;
  emailSafeToSend?: boolean | null;
}

export interface SftpEntry {
  name: string;
  path: string;
  size: number;
  mode: number;
  permissions: string;
  mtime: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface SshCredential {
  id: string;
  type: 'password' | 'private_key' | 'private_key_passphrase' | 'key_pair' | 'certificate' | 'key_with_certificate' | 'agent' | 'one_time';
  label: string;
  username?: string | null;
  fingerprint?: string | null;
  publicKeyFingerprint?: string | null;
  certificateFingerprint?: string | null;
  notes?: string | null;
  assignedHostCount?: number;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SshIdentity = SshCredential;

export interface SshIdentityPayload {
  type: SshIdentity['type'];
  label: string;
  username?: string;
  password?: string;
  privateKey?: string;
  publicKey?: string;
  certificate?: string;
  passphrase?: string;
  notes?: string;
  runtime?: 'browser' | 'electron';
}

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
/** Hosted deployment the desktop runtime targets when nothing else is configured. */
export const DEFAULT_HOSTED_ORIGIN = 'https://ata.uinjakarta.id';

/**
 * Origin of the API. In the browser it is the page's own origin (empty prefix).
 * In Electron the main process is the source of truth (`window.__ATA_CONFIG__`,
 * published by preload); a `file://` page without it falls back to the hosted
 * deployment.
 */
export function getApiOrigin(): string {
  if (configuredBaseUrl) return configuredBaseUrl;
  const desktop = window.__ATA_CONFIG__?.apiOrigin;
  if (desktop) return desktop.replace(/\/$/, '');
  if (window.location.protocol === 'file:') return DEFAULT_HOSTED_ORIGIN;
  return '';
}

/** `ws(s)://` origin of the relay, derived from the API origin. */
export function getWebSocketOrigin(): string {
  const origin = getApiOrigin() || window.location.origin;
  return origin.replace(/^http(s?):/, 'ws$1:');
}

function getApiUrl(path: string) {
  return `${getApiOrigin()}${path}`;
}

/** What the Electron main process returns for a proxied API call. */
interface ProxiedResponse {
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  payload: Record<string, unknown>;
  text: string;
  server: string | null;
}

function throwForResponse(res: ProxiedResponse): never {
  if (!res.contentType.includes('application/json')) {
    const isNginx = res.server?.toLowerCase().includes('nginx');
    const source = isNginx
      ? res.status === 403
        ? ' from nginx/ModSecurity'
        : ' from nginx upstream proxy'
      : '';
    const excerpt = res.text.replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(`Request failed with status ${res.status} ${res.statusText}${source}${excerpt ? `: ${excerpt}` : ''}`);
  }
  const payload = res.payload as { details?: unknown; error?: { message?: string } | string; message?: string };
  const detail = payload.details ? ` (${String(payload.details)})` : '';
  const error = payload.error;
  const message = (typeof error === 'object' && error?.message)
    || (typeof error === 'string' ? error : null)
    || payload.message
    || `Request failed with status ${res.status}`;
  throw new Error(`${message}${detail}`);
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Electron: the renderer runs from file://, so a direct fetch to the hosted API
  // would be cross-site (no CORS on the API, SameSite cookie withheld). Route it
  // through the main process, which fetches with the Electron session's cookie jar.
  if (window.ipcRenderer) {
    const res = await window.ipcRenderer.invoke<ProxiedResponse>('api-request', {
      path,
      method: init?.method || 'GET',
      headers: headersToRecord(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (!res.ok) throwForResponse(res);
    return res.payload as T;
  }

  const response = await fetch(getApiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};
  if (!response.ok) {
    const text = contentType.includes('application/json') ? '' : await response.text().catch(() => '');
    throwForResponse({
      ok: false,
      status: response.status,
      statusText: response.statusText,
      contentType,
      payload,
      text,
      server: response.headers.get('server'),
    });
  }

  return payload as T;
}

export const api = {
  getSession: () => request<{ user: User | null }>('/api/auth/session'),
  login: (identifier: string, password: string, turnstileToken: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, turnstileToken }),
    }),
  register: (email: string, password: string, turnstileToken: string, agreeLegal?: boolean, legalVersion?: string) =>
    request<{ ok: true; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, turnstileToken, agreeLegal, legalVersion }),
    }),
  logout: () =>
    request<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  getDeviceAuthorization: (code: string) =>
    request<DeviceAuthorization>(`/api/auth/device?code=${encodeURIComponent(code)}`),
  approveDevice: (userCode: string) =>
    request<{ ok: true; deviceLabel: string | null }>('/api/auth/device/approve', {
      method: 'POST',
      body: JSON.stringify({ userCode }),
    }),
  denyDevice: (userCode: string) =>
    request<{ ok: true }>('/api/auth/device/deny', {
      method: 'POST',
      body: JSON.stringify({ userCode }),
    }),
  listSessions: () => request<{ sessions: ClientSession[] }>('/api/auth/sessions'),
  revokeSession: (id: string) =>
    request<{ ok: true }>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  verifyEmail: (token: string) =>
    request<{ ok: true; message: string }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: (email: string, turnstileToken: string) =>
    request<{ ok: true; message: string }>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email, turnstileToken }),
    }),
  getPreferences: () => request<{ loginAlerts: boolean }>('/api/auth/preferences'),
  setLoginAlerts: (loginAlerts: boolean) =>
    request<{ loginAlerts: boolean }>('/api/auth/preferences', {
      method: 'PUT',
      body: JSON.stringify({ loginAlerts }),
    }),
  listHosts: () => request<{ hosts: Host[] }>('/api/hosts'),
  createHost: (host: Omit<Host, 'id'>) =>
    request<{ host: Host }>('/api/hosts', {
      method: 'POST',
      body: JSON.stringify(host),
    }),
  updateHost: (id: string, host: Partial<Omit<Host, 'id'>> & { removeCredential?: boolean }) =>
    request<{ host: Host }>(`/api/hosts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(host),
    }),
  deleteHost: (id: string) =>
    request<{ ok: true }>(`/api/hosts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  listUsers: () => request<{ users: ManagedUser[] }>('/api/admin/users'),
  reviewUser: (id: string, approvalStatus: 'approved' | 'rejected') =>
    request<{ user: ManagedUser }>(`/api/admin/users/${encodeURIComponent(id)}/approval`, {
      method: 'PUT',
      body: JSON.stringify({ approvalStatus }),
    }),
  listIdentities: () => request<{ identities: SshIdentity[]; credentials: SshIdentity[] }>('/api/identities'),
  createIdentity: (identity: SshIdentityPayload) =>
    request<{ identity: SshIdentity; credential: SshIdentity }>('/api/identities', {
      method: 'POST',
      body: JSON.stringify(identity),
    }),
  updateIdentity: (id: string, identity: { label: string; username?: string; notes?: string }) =>
    request<{ identity: SshIdentity }>(`/api/identities/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(identity),
    }),
  deleteIdentity: (id: string) =>
    request<{ ok: true }>(`/api/identities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  testIdentity: (id: string, payload: { host: string; port: number; username: string; runtime?: 'browser' | 'electron'; authType?: string }) =>
    request<IdentityTestResult>(`/api/identities/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  assignIdentityToHost: (hostId: string, identityId: string | null) =>
    request<{ host: Host }>(`/api/hosts/${encodeURIComponent(hostId)}/identity`, {
      method: 'PUT',
      body: JSON.stringify({ identityId }),
    }),
  listCredentials: () => request<{ credentials: SshCredential[] }>('/api/identities'),
  createCredential: (credential: SshIdentityPayload) =>
    request<{ credential: SshCredential; identity: SshIdentity }>('/api/identities', {
      method: 'POST',
      body: JSON.stringify(credential),
    }),
  deleteCredential: (id: string) =>
    request<{ ok: true }>(`/api/identities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  testCredential: (id: string, payload: { host: string; port: number; username: string }) =>
    request<{ ok: true }>(`/api/identities/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  vaultHealth: () =>
    request<{
      ok: boolean;
      storageReady: boolean;
      encryptionReady: boolean;
      testEncryptDecryptOk: boolean;
      warning: string[];
      checkedAt: string;
    }>('/api/security/vault-health'),
  sessionMetrics: () =>
    request<{ ok: true; metrics: SessionMetrics }>('/api/security/session-metrics'),
  securityMetrics: () =>
    request<{ ok: true; metrics: Record<string, number> }>('/api/security/access-metrics'),
  requestConnectToken: (payload: { hostId: string; runtime: 'browser' | 'electron'; purpose: string; authType?: string | null; credentialId?: string | null }) =>
    request<ConnectTokenResponse>('/api/security/connect-token', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  consumeConnectToken: (payload: { userId: string; hostId: string; runtime: 'browser' | 'electron'; purpose: string; authType?: string | null; credentialId?: string | null; connectToken: string }) =>
    request<{ ok: true; hostId: string; runtime: 'browser' | 'electron'; purpose: string; authType: string | null; credentialId: string | null; connectTokenId: string }>('/api/security/connect-token/consume', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sftpOperation: <T = unknown>(hostId: string, operation: string, payload: Record<string, unknown>) =>
    request<T>(`/api/hosts/${encodeURIComponent(hostId)}/sftp/${encodeURIComponent(operation)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
