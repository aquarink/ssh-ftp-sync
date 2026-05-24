import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Copy, Clipboard } from 'lucide-react';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  sessionId: string;
  hostId: string;
  host?: {
    host: string;
    port: number;
    username: string;
    password?: string;
    credentialId?: string | null;
  };
  active: boolean;
  fontSize: number;
  bottomPaddingPx?: number;
  onConnected?: () => void;
  onError?: (message: string) => void;
  onClosed?: () => void;
}

type SshSocketMessage = {
  type: 'connected' | 'closed' | 'error' | 'data';
  message?: string;
  data?: string;
};

function sshSocketUrl(hostId: string, sessionId: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ssh?hostId=${encodeURIComponent(hostId)}&sessionId=${encodeURIComponent(sessionId)}`;
}

export function TerminalView({
  sessionId,
  hostId,
  host,
  active,
  fontSize,
  bottomPaddingPx = 24,
  onConnected,
  onError,
  onClosed,
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);

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
        navigator.clipboard.readText().then((text) => {
          if (text) {
            terminal.paste(text);
          }
        }).catch((err) => {
          console.error('Failed to read clipboard:', err);
        });
        return false;
      }

      return true;
    });
    let socket: WebSocket | null = null;
    let socketFailed = false;

    if (window.ipcRenderer && host) {
      window.ipcRenderer.send('ssh-connect', {
        id: sessionId,
        hostId,
        host: host.host,
        port: host.port,
        username: host.username,
        password: host.password,
        credentialId: host.credentialId,
      });
    }

    if (!window.ipcRenderer) {
      socket = new WebSocket(sshSocketUrl(hostId, sessionId));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as SshSocketMessage;
          if (message.type === 'connected') onConnected?.();
          if (message.type === 'closed') onClosed?.();
          if (message.type === 'error') {
            socketFailed = true;
            onError?.(message.message || 'SSH connection failed');
          }
          if (message.type === 'data' && message.data) term.current?.write(message.data);
        } catch {
          socketFailed = true;
          onError?.('SSH relay sent an invalid response');
        }
      };
      socket.onerror = () => {
        socketFailed = true;
        onError?.('SSH relay connection failed');
      };
      socket.onclose = () => {
        if (!socketFailed) onClosed?.();
      };
    }

    // Listen to input from the user (typing)
    term.current.onData((data) => {
      if (window.ipcRenderer) {
        window.ipcRenderer.send('ssh-input', { id: sessionId, data });
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Listen to resize
    const handleResize = () => {
      if (!fitAddon.current || !term.current) return;
      fitAddon.current.fit();
      if (window.ipcRenderer) {
        window.ipcRenderer.send('ssh-resize', { 
          id: sessionId, 
          cols: term.current.cols, 
          rows: term.current.rows 
        });
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'resize',
          cols: term.current.cols,
          rows: term.current.rows,
        }));
      }
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

    // Listen to data from SSH server
    const onData = (_: any, data: { id: string, data: string }) => {
      if (data.id === sessionId && term.current) {
        term.current.write(data.data);
      }
    };

    if (window.ipcRenderer) {
      window.ipcRenderer.on('ssh-data', onData);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (window.ipcRenderer) {
        window.ipcRenderer.send('ssh-disconnect', { id: sessionId });
        window.ipcRenderer.removeListener('ssh-data', onData);
      }
      socket?.close();
      term.current?.dispose();
    };
  }, [hostId, sessionId]);

  useEffect(() => {
    if (active && fitAddon.current && term.current) {
      requestAnimationFrame(() => {
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
    }
  }, [active, sessionId]);

  useEffect(() => {
    if (!term.current) return;
    term.current.options.fontSize = fontSize;
    if (!active || !fitAddon.current) return;

    requestAnimationFrame(() => {
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

  const handleCopy = () => {
    if (!term.current) return;
    const selectedText = term.current.getSelection();
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
    }
    setContextMenu(null);
    term.current.focus();
  };

  const handlePaste = () => {
    if (!term.current) return;
    navigator.clipboard.readText().then((text) => {
      if (text && term.current) {
        term.current.paste(text);
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
      <div
        ref={terminalRef}
        className="terminal-shell w-full h-full px-3 pt-3 pb-4"
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
            disabled={!hasSelection}
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
