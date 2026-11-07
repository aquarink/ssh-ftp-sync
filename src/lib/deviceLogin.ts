// Desktop sign-in through the browser. The main process runs the flow
// (electron/deviceLogin.js); this module is the renderer's typed view of it.

export interface DeviceLoginStarted {
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
}

export type DeviceLoginStatus =
  | { state: 'browser_not_opened'; message: string }
  | { state: 'approved'; user: unknown }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'error'; message: string };

const STATUS_CHANNEL = 'device-login-status';

/** Electron wraps errors thrown in the main process; show only the original message. */
export function cleanIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function startDeviceLogin(): Promise<DeviceLoginStarted> {
  return window.ipcRenderer.invoke<DeviceLoginStarted>('device-login-start', {});
}

export function cancelDeviceLogin(): Promise<unknown> {
  return window.ipcRenderer.invoke('device-login-cancel', {}).catch(() => undefined);
}

export function reopenDeviceLogin(): Promise<unknown> {
  return window.ipcRenderer.invoke('device-login-reopen', {});
}

/** Returns an unsubscribe function. */
export function onDeviceLoginStatus(listener: (status: DeviceLoginStatus) => void): () => void {
  const handler = (_event: unknown, status: DeviceLoginStatus) => listener(status);
  window.ipcRenderer.on(STATUS_CHANNEL, handler);
  return () => window.ipcRenderer.removeListener(STATUS_CHANNEL, handler);
}
