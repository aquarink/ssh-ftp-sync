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

function getApiUrl(path: string) {
  if (configuredBaseUrl) return `${configuredBaseUrl}${path}`;
  if (window.location.protocol === 'file:') {
    return `https://ant-tech-async.mobwn.my.id${path}`;
  }
  return path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      const server = response.headers.get('server');
      const source = server?.toLowerCase().includes('nginx') ? ' from nginx/ModSecurity' : '';
      const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(`Request failed with status ${response.status} ${response.statusText}${source}${excerpt ? `: ${excerpt}` : ''}`);
    }
    const detail = payload.details ? ` (${payload.details})` : '';
    const message = payload.error?.message || payload.error || payload.message || `Request failed with status ${response.status}`;
    throw new Error(`${message}${detail}`);
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
  register: (email: string, password: string, turnstileToken: string) =>
    request<{ ok: true; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, turnstileToken }),
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
  sftpOperation: <T = any>(hostId: string, operation: string, payload: Record<string, any>) =>
    request<T>(`/api/hosts/${encodeURIComponent(hostId)}/sftp/${encodeURIComponent(operation)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
