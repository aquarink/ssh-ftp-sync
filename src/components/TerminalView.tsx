import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Copy, Clipboard } from 'lucide-react';
import 'xterm/css/xterm.css';
import { api } from '../lib/api';
import {
  RELAY_WATCHDOG_MS,
  decideReconnect,
  type ConnectionCloseInfo,
  type ReconnectDecision,
} from '../lib/reconnectPolicy';

export interface TerminalReconnectInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface TerminalClosedInfo {
  reason: string;
  message: string;
}

interface TerminalViewProps {
  sessionId: string;
  hostId: string;
  connectToken: string;
  host?: {
    userId?: string;
    host: string;
    port: number;
    username: string;
    authType?: string;
    credentialId?: string | null;
  };
  active: boolean;
  fontSize: number;
  bottomPaddingPx?: number;
  showQuickActions?: boolean;
  /** Increment to force an immediate manual reconnect (resets the automatic attempt counter). */
  reconnectNonce?: number;
  onConnected?: () => void;
  onError?: (message: string) => void;
  onClosed?: (info: TerminalClosedInfo) => void;
  onReconnecting?: (info: TerminalReconnectInfo) => void;
  onConnectTokenConsumed?: () => void;
}

type SshSocketMessage = {
  type: 'connected' | 'resumed' | 'closed' | 'error' | 'data' | 'keepalive';
  message?: string;
  data?: string;
  reason?: string;
  retryable?: boolean;
  sessionId?: string;
  resumeToken?: string;
  resumeGraceSeconds?: number;
};

type IpcLifecyclePayload = {
  id: string;
  message?: string;
  reason?: string;
  retryable?: boolean;
};

const WATCHDOG_CLOSE_CODE = 4000;

function sshSocketUrl(hostId: string, sessionId: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ssh?hostId=${encodeURIComponent(hostId)}&sessionId=${encodeURIComponent(sessionId)}`;
}

export function TerminalView({
  sessionId,
  hostId,
  connectToken,
  host,
  active,
  fontSize,
  bottomPaddingPx = 24,
  showQuickActions = false,
  reconnectNonce = 0,
  onConnected,
  onError,
  onClosed,
  onReconnecting,
  onConnectTokenConsumed,
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const inputDisposable = useRef<{ dispose: () => void } | null>(null);
  const inputSendRef = useRef<(data: string) => void>(() => {});
  const reconnectRef = useRef<() => void>(() => {});
  const activeRef = useRef(active);
  // Always call the latest callbacks even though the connection closure is created once.
  const callbacksRef = useRef({ onConnected, onError, onClosed, onReconnecting, onConnectTokenConsumed });
  callbacksRef.current = { onConnected, onError, onClosed, onReconnecting, onConnectTokenConsumed };

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    const handleOutsideClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('mousedown', handleOutsideClick, { capture: true });
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick, { capture: true });
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!terminalRef.current) return;
    if (!connectToken) {
      callbacksRef.current.onError?.('Connect authorization unavailable');
      return;
    }

    // Initialize xterm.js
    term.current = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        selectionBackground: '#58a6ff40',
        black: '#484f58',
        blue: '#58a6ff',
        cyan: '#39c5cf',
        green: '#3fb950',
        magenta: '#bc8cff',
        red: '#ff7b72',
        white: '#b1bac4',
        yellow: '#d29922',
      },
      fontFamily: '"Fira Code", "JetBrains Mono", monospace',
      fontSize,
    });

    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);

    term.current.open(terminalRef.current);
    fitAddon.current.fit();

    const terminal = term.current;
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

      const isCopy = (isMac && event.metaKey && event.key === 'c') ||
                     (!isMac && event.ctrlKey && event.shiftKey && event.key === 'C') ||
                     (!isMac && event.ctrlKey && event.key === 'c' && terminal.hasSelection());

      const isPaste = (isMac && event.metaKey && event.key === 'v') ||
                      (!isMac && event.ctrlKey && event.shiftKey && event.key === 'V') ||
                      (!isMac && event.ctrlKey && event.key === 'v');

      if (isCopy) {
        const selectedText = terminal.getSelection();
        if (selectedText) {
          navigator.clipboard.writeText(selectedText);
        }
        return false;
      }

      if (isPaste) {
        // Prevent duplicate paste forwarding between xterm and custom handlers.
        return false;
      }

      return true;
    });

    // ---------------------------------------------------------------------
    // Connection state machine (shared by the browser relay and Electron IPC)
    // ---------------------------------------------------------------------
    const runtime: 'browser' | 'electron' = window.ipcRenderer && host ? 'electron' : 'browser';
    let disposed = false;
    let socket: WebSocket | null = null;
    // Bumped whenever the socket is replaced or the component unmounts, so late
    // events from a previous socket are ignored.
    let socketGeneration = 0;
    let attempts = 0;          // consecutive automatic reconnect attempts
    let everConnected = false; // this tab reached a ready shell at least once
    let retryTimer: number | null = null;
    let watchdogTimer: number | null = null;
    let waitingForOnline = false;
    let consumeTokenTimer: number | null = null;
    // Resume state: the relay hands out a resume token while connected so a dropped
    // socket can re-attach to the same still-running shell within the grace window,
    // instead of opening a brand new shell.
    let resumeToken: string | null = null;
    let resumeDeadline = 0;

    const writeStatus = (text: string) => {
      term.current?.write(`\r\n\x1b[2m[${text}]\x1b[0m\r\n`);
    };

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        window.clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const armWatchdog = () => {
      clearWatchdog();
      watchdogTimer = window.setTimeout(() => {
        watchdogTimer = null;
        // No data and no keepalive for too long: assume a half-open socket and close
        // it locally so the reconnect policy can take over.
        try {
          socket?.close(WATCHDOG_CLOSE_CODE, 'relay watchdog');
        } catch {
          // Already closed.
        }
      }, RELAY_WATCHDOG_MS);
    };

    const sendTerminalInput = (data: string) => {
      if (runtime === 'electron') {
        window.ipcRenderer.send('ssh-input', { id: sessionId, data });
        return;
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    };
    inputSendRef.current = sendTerminalInput;

    const sendResize = () => {
      if (!term.current) return;
      const { cols, rows } = term.current;
      if (runtime === 'electron') {
        window.ipcRenderer.send('ssh-resize', { id: sessionId, cols, rows });
        return;
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    const pasteText = (text: string) => {
      if (!text) return;
      sendTerminalInput(text);
    };

    const handlePasteEvent = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') || '';
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();
      pasteText(text);
    };

    terminalRef.current.addEventListener('paste', handlePasteEvent, true);

    const storeResumeInfo = (message: SshSocketMessage) => {
      if (message.resumeToken) {
        resumeToken = message.resumeToken;
        const graceMs = Math.max(0, Number(message.resumeGraceSeconds || 0) * 1000);
        resumeDeadline = graceMs > 0 ? Date.now() + graceMs : 0;
      }
    };

    const markConnected = () => {
      everConnected = true;
      attempts = 0;
      waitingForOnline = false;
      callbacksRef.current.onConnected?.();
      // The server shell may have been created with default dimensions; sync them.
      sendResize();
    };

    const canResume = () =>
      runtime === 'browser' && resumeToken !== null && (resumeDeadline === 0 || Date.now() < resumeDeadline);

    const finish = (decision: Extract<ReconnectDecision, { action: 'stop' }>, info: ConnectionCloseInfo) => {
      if (decision.final === 'closed') {
        callbacksRef.current.onClosed?.({ reason: info.reason, message: decision.message });
      } else {
        callbacksRef.current.onError?.(decision.message);
      }
    };

    const scheduleRetry = (decision: Extract<ReconnectDecision, { action: 'retry' }>) => {
      attempts = decision.attempt;
      callbacksRef.current.onReconnecting?.({
        attempt: decision.attempt,
        maxAttempts: decision.maxAttempts,
        delayMs: decision.delayMs,
      });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        waitingForOnline = true;
        writeStatus(`connection lost, offline: waiting for network (attempt ${decision.attempt}/${decision.maxAttempts})`);
        return;
      }
      writeStatus(`connection lost, reconnecting in ${Math.max(1, Math.round(decision.delayMs / 1000))}s (attempt ${decision.attempt}/${decision.maxAttempts})`);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect(null);
      }, decision.delayMs);
    };

    const handleDrop = (info: ConnectionCloseInfo) => {
      if (disposed) return;
      clearRetryTimer();
      clearWatchdog();
      const decision = decideReconnect(info, attempts);
      if (decision.action === 'retry') {
        scheduleRetry(decision);
        return;
      }
      finish(decision, info);
    };

    const openSocket = (options: { token: string } | { resume: string }) => {
      const generation = ++socketGeneration;
      const isResume = 'resume' in options;
      const socketUrl = new URL(sshSocketUrl(hostId, sessionId));
      if (isResume) {
        socketUrl.searchParams.set('resume', sessionId);
        socketUrl.searchParams.set('resumeToken', options.resume);
      } else {
        socketUrl.searchParams.set('connectToken', options.token);
        if (host?.credentialId) socketUrl.searchParams.set('credentialId', host.credentialId);
        if (host?.authType) socketUrl.searchParams.set('authType', host.authType);
        socketUrl.searchParams.set('purpose', 'ssh');
      }

      const ws = new WebSocket(socketUrl.toString());
      socket = ws;
      let serverOutcome: ConnectionCloseInfo | null = null;
      let connectedThisSocket = false;

      ws.onmessage = (event) => {
        if (generation !== socketGeneration || disposed) return;
        armWatchdog();
        try {
          const message = JSON.parse(event.data) as SshSocketMessage;
          switch (message.type) {
            case 'connected':
              connectedThisSocket = true;
              storeResumeInfo(message);
              markConnected();
              break;
            case 'resumed':
              connectedThisSocket = true;
              storeResumeInfo(message);
              writeStatus('reconnected to the existing session');
              markConnected();
              break;
            case 'data':
              if (message.data) term.current?.write(message.data);
              break;
            case 'keepalive':
              break;
            case 'closed':
              serverOutcome = {
                reason: message.reason || 'closed',
                retryable: Boolean(message.retryable),
              };
              break;
            case 'error':
              serverOutcome = {
                reason: message.reason || 'error',
                retryable: Boolean(message.retryable),
                message: message.message || 'SSH connection failed',
              };
              break;
            default:
              break;
          }
        } catch {
          serverOutcome = { reason: 'invalid_response', retryable: false, message: 'SSH relay sent an invalid response' };
          ws.close();
        }
      };
      ws.onerror = () => {
        // The close event that follows carries the decision; nothing to do here.
      };
      ws.onclose = (event) => {
        if (generation !== socketGeneration || disposed) return;
        clearWatchdog();
        // A resume attempt that never re-attached (token expired, grace elapsed, or the
        // relay was restarted) is not a real drop: fall back to a fresh connect without
        // spending a reconnect attempt.
        if (isResume && !connectedThisSocket) {
          resumeToken = null;
          resumeDeadline = 0;
          void connect(null);
          return;
        }
        const info: ConnectionCloseInfo = serverOutcome ?? {
          reason: event.code === WATCHDOG_CLOSE_CODE ? 'watchdog' : 'transport',
          // A transport drop is only worth retrying once a shell has existed; a socket
          // that never connected usually failed authorization at the upgrade.
          retryable: everConnected,
          message: connectedThisSocket || everConnected ? undefined : 'SSH relay connection failed',
        };
        handleDrop(info);
      };
      armWatchdog();
    };

    const sendElectronConnect = (token: string) => {
      if (!host) return;
      window.ipcRenderer.send('ssh-connect', {
        id: sessionId,
        userId: host.userId,
        hostUserId: host.userId,
        hostId,
        host: host.host,
        port: host.port,
        username: host.username,
        authType: host.authType,
        credentialId: host.credentialId,
        connectToken: token,
        purpose: 'ssh',
      });
    };

    const connect = async (token: string | null) => {
      if (disposed) return;
      // Prefer resuming the running shell over opening a new one. A resume needs no
      // connect token; if it fails the socket's onclose falls back here for a fresh one.
      if (!token && canResume()) {
        const resume = resumeToken as string;
        openSocket({ resume });
        return;
      }
      try {
        let effectiveToken = token;
        if (!effectiveToken) {
          // Every reconnect goes through the zero-trust flow again with a fresh
          // one-time token; nothing from the previous connection is reused.
          const response = await api.requestConnectToken({
            hostId,
            runtime,
            purpose: 'ssh',
            authType: host?.authType || null,
            credentialId: host?.credentialId || null,
          });
          effectiveToken = response.token;
        }
        if (disposed) return;
        if (runtime === 'electron') {
          sendElectronConnect(effectiveToken);
        } else {
          openSocket({ token: effectiveToken });
        }
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : 'Unable to authorize SSH connect';
        handleDrop({ reason: 'authorize_error', retryable: false, message });
      }
    };

    // Electron lifecycle events for this session id.
    const onIpcConnected = (_: unknown, payload: IpcLifecyclePayload) => {
      if (payload.id !== sessionId || disposed) return;
      markConnected();
    };
    const onIpcError = (_: unknown, payload: IpcLifecyclePayload) => {
      if (payload.id !== sessionId || disposed) return;
      handleDrop({
        reason: payload.reason || 'error',
        retryable: Boolean(payload.retryable),
        message: payload.message || 'SSH connection failed',
      });
    };
    const onIpcClosed = (_: unknown, payload: IpcLifecyclePayload) => {
      if (payload.id !== sessionId || disposed) return;
      handleDrop({ reason: payload.reason || 'closed', retryable: Boolean(payload.retryable) });
    };
    const onIpcData = (_: unknown, data: { id: string; data: string }) => {
      if (data.id === sessionId && term.current) {
        term.current.write(data.data);
      }
    };

    if (runtime === 'electron') {
      window.ipcRenderer.on('ssh-connected', onIpcConnected);
      window.ipcRenderer.on('ssh-error', onIpcError);
      window.ipcRenderer.on('ssh-closed', onIpcClosed);
      window.ipcRenderer.on('ssh-data', onIpcData);
    }

    // Network hints: retry immediately when the network comes back or the tab is
    // shown again instead of waiting out the backoff.
    const handleOnline = () => {
      if (disposed || !waitingForOnline) return;
      waitingForOnline = false;
      writeStatus('network is back, reconnecting');
      void connect(null);
    };
    const handleVisibility = () => {
      if (disposed || document.visibilityState !== 'visible' || retryTimer === null) return;
      clearRetryTimer();
      void connect(null);
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    reconnectRef.current = () => {
      if (disposed) return;
      clearRetryTimer();
      clearWatchdog();
      waitingForOnline = false;
      attempts = 0;
      if (socket) {
        // Ignore the close event of the socket we are abandoning.
        socketGeneration += 1;
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        socket = null;
      }
      writeStatus('reconnecting');
      void connect(null);
    };

    void connect(connectToken);
    consumeTokenTimer = window.setTimeout(() => callbacksRef.current.onConnectTokenConsumed?.(), 0);

    // Listen to input from the user (typing)
    inputDisposable.current = term.current.onData((data) => {
      sendTerminalInput(data);
    });

    // Listen to resize
    const handleResize = () => {
      if (!fitAddon.current || !term.current) return;
      fitAddon.current.fit();
      sendResize();
    };
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      if (activeRef.current) {
        handleResize();
      }
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      disposed = true;
      socketGeneration += 1;
      clearRetryTimer();
      clearWatchdog();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      resizeObserver.disconnect();
      terminalRef.current?.removeEventListener('paste', handlePasteEvent, true);
      inputDisposable.current?.dispose?.();
      inputDisposable.current = null;
      if (consumeTokenTimer !== null) {
        window.clearTimeout(consumeTokenTimer);
      }
      if (runtime === 'electron') {
        window.ipcRenderer.send('ssh-disconnect', { id: sessionId });
        window.ipcRenderer.removeListener('ssh-connected', onIpcConnected);
        window.ipcRenderer.removeListener('ssh-error', onIpcError);
        window.ipcRenderer.removeListener('ssh-closed', onIpcClosed);
        window.ipcRenderer.removeListener('ssh-data', onIpcData);
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'disconnect' }));
      }
      socket?.close();
      socket = null;
      reconnectRef.current = () => {};
      fitAddon.current = null;
      inputSendRef.current = () => {};
      term.current?.dispose();
      term.current = null;
    };
  }, [hostId, sessionId]);

  useEffect(() => {
    if (reconnectNonce > 0) {
      reconnectRef.current();
    }
  }, [reconnectNonce]);

  useEffect(() => {
    if (active && fitAddon.current && term.current) {
      const frame = requestAnimationFrame(() => {
        if (fitAddon.current && term.current) {
          fitAddon.current.fit();
          if (window.ipcRenderer) {
            window.ipcRenderer.send('ssh-resize', {
              id: sessionId,
              cols: term.current.cols,
              rows: term.current.rows
            });
          }
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [active, sessionId]);

  useEffect(() => {
    if (!term.current) return;
    term.current.options.fontSize = fontSize;
    if (!active || !fitAddon.current) return;

    const frame = requestAnimationFrame(() => {
      if (!term.current || !fitAddon.current) return;
      fitAddon.current.fit();
      if (window.ipcRenderer) {
        window.ipcRenderer.send('ssh-resize', {
          id: sessionId,
          cols: term.current.cols,
          rows: term.current.rows,
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [fontSize, active, sessionId]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!term.current) return;

    setHasSelection(term.current.hasSelection());

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  const getCopyText = () => {
    if (!term.current) return '';

    const selectedText = term.current.getSelection();
    if (selectedText) {
      return selectedText;
    }

    const buffer = term.current.buffer.active;
    const start = buffer.viewportY;
    const end = Math.min(buffer.viewportY + term.current.rows - 1, buffer.length - 1);
    const lines: string[] = [];

    for (let index = start; index <= end; index += 1) {
      const line = buffer.getLine(index);
      if (line) lines.push(line.translateToString(true));
    }

    return lines.join('\n').trimEnd();
  };

  const handleCopy = async () => {
    const text = getCopyText();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        console.error('Failed to write clipboard:', err);
      }
    }
    setContextMenu(null);
    term.current?.focus();
  };

  const handlePaste = () => {
    if (!term.current) return;
    navigator.clipboard.readText().then((text) => {
      if (text) {
        inputSendRef.current(text);
      }
    }).catch((err) => {
      console.error('Failed to read clipboard:', err);
    });
    setContextMenu(null);
    term.current.focus();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onContextMenu={handleContextMenu}
    >
      {showQuickActions && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-lg border border-border/70 bg-[#0d1117]/90 p-1 shadow-lg backdrop-blur pointer-events-auto">
          <button
            type="button"
            onClick={handleCopy}
            title={term.current?.hasSelection() ? 'Copy selected text' : 'Copy visible terminal text'}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white hover:bg-white/10 transition cursor-pointer"
          >
            <Copy size={13} />
            Copy
          </button>
          <button
            type="button"
            onClick={handlePaste}
            title="Paste clipboard text"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white hover:bg-white/10 transition cursor-pointer"
          >
            <Clipboard size={13} />
            Paste
          </button>
        </div>
      )}
      <div
        ref={terminalRef}
        className="terminal-shell w-full h-full px-4 md:px-5 pt-3 pb-4 overflow-hidden"
        style={{
          '--terminal-bottom-padding': `${bottomPaddingPx}px`,
          '--terminal-background': '#0d1117',
        } as CSSProperties}
      />
      {contextMenu && (
        <div
          className="absolute z-50 bg-[#161b22] border border-slate-700 rounded-lg shadow-xl py-1 text-sm text-slate-200 select-none animate-in fade-in zoom-in duration-100"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            minWidth: '160px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopy}
            disabled={!hasSelection && !getCopyText()}
            className="w-full text-left px-4 py-2 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-transparent flex items-center justify-between transition-colors duration-150"
          >
            <span className="flex items-center gap-2">
              <Copy size={14} />
              Copy
            </span>
            <span className="text-xs text-slate-500 font-mono">
              {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘C' : 'Ctrl+Shift+C'}
            </span>
          </button>
          <button
            onClick={handlePaste}
            className="w-full text-left px-4 py-2 hover:bg-slate-800 flex items-center justify-between transition-colors duration-150"
          >
            <span className="flex items-center gap-2">
              <Clipboard size={14} />
              Paste
            </span>
            <span className="text-xs text-slate-500 font-mono">
              {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘V' : 'Ctrl+Shift+V'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
