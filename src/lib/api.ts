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
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
}

export interface ManagedUser extends User {
  createdAt: string;
  emailCheckResult?: string | null;
  emailSafeToSend?: boolean | null;
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

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
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
};
