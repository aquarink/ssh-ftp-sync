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
      send: (channel: string, data: any) => void;
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}
