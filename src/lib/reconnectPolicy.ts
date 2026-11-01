/**
 * Reconnect policy shared by the browser relay path and the Electron IPC path.
 *
 * Every attempt goes through the full zero-trust connect flow (fresh one-time
 * connect token, access policy, identity resolution, ephemeral credential), so
 * the policy has to stay inside the server-side rate limits: by default the API
 * issues at most 8 connect tokens per host per minute and accepts at most 12
 * connect attempts per host per minute. Six attempts with exponential backoff
 * (1s, 2s, 4s, 8s, 16s, 30s, about one minute in total) fit inside that budget.
 */
export const RECONNECT_MAX_ATTEMPTS = 6;
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30000;
export const RECONNECT_JITTER_RATIO = 0.2;

/**
 * The relay sends an application-level `keepalive` frame every 25s (browsers
 * cannot observe protocol-level pings). If no frame of any kind arrives for this
 * long the socket is treated as half-open and closed locally so the reconnect
 * policy can take over instead of waiting for the TCP stack.
 */
export const RELAY_WATCHDOG_MS = 65000;

export interface ConnectionCloseInfo {
  /** Server- or client-assigned close reason, e.g. `shell_exit`, `client_end`, `transport`. */
  reason: string;
  /** Whether the peer that reported the close considers a retry meaningful. */
  retryable: boolean;
  /** Human readable error, present when the close was an error rather than a clean close. */
  message?: string;
}

export type ReconnectDecision =
  | { action: 'retry'; attempt: number; maxAttempts: number; delayMs: number }
  | { action: 'stop'; final: 'closed' | 'error'; message: string };

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** exponent, RECONNECT_MAX_DELAY_MS);
  const jitter = base * RECONNECT_JITTER_RATIO * (random() * 2 - 1);
  return Math.max(250, Math.round(base + jitter));
}

export function describeCloseReason(reason: string): string {
  switch (reason) {
    case 'shell_exit':
      return 'The remote shell exited.';
    case 'explicit_disconnect':
      return 'Disconnected.';
    default:
      return 'SSH connection closed.';
  }
}

/**
 * Decide what to do after a connection ended.
 *
 * - A close the peer marked as not retryable (clean shell exit, authentication
 *   or policy failure, a connect that never reached a shell) stops immediately.
 * - A retryable drop schedules another attempt until the budget is spent.
 */
export function decideReconnect(
  info: ConnectionCloseInfo,
  previousAttempts: number,
  options: { maxAttempts?: number; random?: () => number } = {}
): ReconnectDecision {
  const maxAttempts = options.maxAttempts ?? RECONNECT_MAX_ATTEMPTS;

  if (!info.retryable) {
    if (info.message) {
      return { action: 'stop', final: 'error', message: info.message };
    }
    return { action: 'stop', final: 'closed', message: describeCloseReason(info.reason) };
  }

  if (previousAttempts >= maxAttempts) {
    return {
      action: 'stop',
      final: 'error',
      message: `Connection lost. Automatic reconnect gave up after ${maxAttempts} attempts.`,
    };
  }

  const attempt = previousAttempts + 1;
  return {
    action: 'retry',
    attempt,
    maxAttempts,
    delayMs: reconnectDelayMs(attempt, options.random),
  };
}
