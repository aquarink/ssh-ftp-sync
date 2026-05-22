import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  hostId: string;
}

export function TerminalView({ hostId }: TerminalViewProps) {
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

    // Listen to input from the user (typing)
    term.current.onData((data) => {
      if (window.ipcRenderer) {
        window.ipcRenderer.send('ssh-input', { id: hostId, data });
      }
    });

    // Listen to resize
    const handleResize = () => {
      if (fitAddon.current && term.current && window.ipcRenderer) {
        fitAddon.current.fit();
        window.ipcRenderer.send('ssh-resize', { 
          id: hostId, 
          cols: term.current.cols, 
          rows: term.current.rows 
        });
      }
    };
    window.addEventListener('resize', handleResize);

    // Listen to data from SSH server
    const onData = (_: any, data: { id: string, data: string }) => {
      if (data.id === hostId && term.current) {
        term.current.write(data.data);
      }
    };

    if (window.ipcRenderer) {
      window.ipcRenderer.on('ssh-data', onData);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.ipcRenderer) {
        window.ipcRenderer.send('ssh-disconnect', { id: hostId });
        window.ipcRenderer.removeAllListeners('ssh-data');
      }
      term.current?.dispose();
    };
  }, [hostId]);

  return <div ref={terminalRef} className="w-full h-full p-2" />;
}
