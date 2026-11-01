/// <reference types="vite/client" />

export {};

declare global {
  interface Turnstile {
    render: (widget: HTMLElement | string, options: {
      sitekey: string;
      theme?: 'auto' | 'dark' | 'light';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }) => string;
    reset: (widget?: HTMLElement | string) => void;
    remove?: (widget?: HTMLElement | string) => void;
  }

  interface Window {
    turnstile?: Turnstile;
    ipcRenderer: {
      send: (channel: string, data: unknown) => void;
      invoke: <T = unknown>(channel: string, data: unknown) => Promise<T>;
      on: (channel: string, listener: (event: unknown, ...args: any[]) => void) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
      removeListener: (channel: string, listener: (event: unknown, ...args: any[]) => void) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
      removeAllListeners: (channel: string) => void;
    };
  }
}
