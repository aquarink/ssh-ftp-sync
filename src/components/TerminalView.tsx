import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
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

export function TerminalView({ sessionId, hostId, host, active, onConnected, onError, onClosed }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

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
    });

    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);
    
    term.current.open(terminalRef.current);
    fitAddon.current.fit();
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
      if (fitAddon.current && term.current && window.ipcRenderer) {
        fitAddon.current.fit();
        window.ipcRenderer.send('ssh-resize', { 
          id: sessionId, 
          cols: term.current.cols, 
          rows: term.current.rows 
        });
      }
      if (fitAddon.current && term.current && socket?.readyState === WebSocket.OPEN) {
        fitAddon.current.fit();
        socket.send(JSON.stringify({
          type: 'resize',
          cols: term.current.cols,
          rows: term.current.rows,
        }));
      }
    };
    window.addEventListener('resize', handleResize);

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
      if (window.ipcRenderer) {
        window.ipcRenderer.send('ssh-disconnect', { id: sessionId });
        window.ipcRenderer.removeListener('ssh-data', onData);
      }
      socket?.close();
      term.current?.dispose();
    };
  }, [hostId, host, sessionId]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => fitAddon.current?.fit());
    }
  }, [active]);

  return <div ref={terminalRef} className="w-full h-full p-2" />;
}
