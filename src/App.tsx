import { useState, useEffect } from 'react';
import { Terminal, FolderGit2, Settings, Plus, Server, X, Play, Loader2 } from 'lucide-react';
import { TerminalView } from './components/TerminalView';

interface Host {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
}

function App() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [activeHost, setActiveHost] = useState<Host | null>(null);
  const [isAddingHost, setIsAddingHost] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Form states
  const [fName, setFName] = useState('');
  const [fHost, setFHost] = useState('');
  const [fPort, setFPort] = useState('22');
  const [fUser, setFUser] = useState('root');
  const [fPass, setFPass] = useState('');

  useEffect(() => {
    if (!window.ipcRenderer) return;

    window.ipcRenderer.on('ssh-connected', (_, { id }) => {
      if (activeHost && id === activeHost.id) setStatus('connected');
    });

    window.ipcRenderer.on('ssh-error', (_, { id, message }) => {
      if (activeHost && id === activeHost.id) {
        setStatus('error');
        setErrorMsg(message);
      }
    });

    window.ipcRenderer.on('ssh-closed', (_, { id }) => {
      if (activeHost && id === activeHost.id) {
        setStatus('idle');
        setActiveHost(null);
      }
    });
  }, [activeHost]);

  const handleAddHost = (e: React.FormEvent) => {
    e.preventDefault();
    const newHost: Host = {
      id: Date.now().toString(),
      name: fName || fHost,
      host: fHost,
      port: parseInt(fPort),
      username: fUser,
      password: fPass
    };
    setHosts([...hosts, newHost]);
    setIsAddingHost(false);
    
    // reset form
    setFName(''); setFHost(''); setFPort('22'); setFUser('root'); setFPass('');
  };

  const connectToHost = (host: Host) => {
    setActiveHost(host);
    setStatus('connecting');
    setErrorMsg('');
    
    if (window.ipcRenderer) {
      window.ipcRenderer.send('ssh-connect', {
        id: host.id,
        host: host.host,
        port: host.port,
        username: host.username,
        password: host.password
      });
    }
  };

  return (
    <div className="flex h-screen w-screen bg-background text-textMain font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-16 bg-surface border-r border-border flex flex-col items-center py-4 space-y-6 shrink-0 z-10">
        <div className="p-2 bg-primary/10 text-primary rounded-xl cursor-pointer hover:bg-primary/20 transition">
          <Terminal size={24} />
        </div>
        <div className="p-2 text-textMuted hover:text-textMain cursor-pointer transition">
          <FolderGit2 size={24} />
        </div>
        <div className="flex-1"></div>
        <div className="p-2 text-textMuted hover:text-textMain cursor-pointer transition">
          <Settings size={24} />
        </div>
      </div>

      {/* Hosts List Panel */}
      <div className="w-64 bg-[#161b22]/50 border-r border-border flex flex-col shrink-0 z-10">
        <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
          <span className="font-semibold text-sm">Hosts</span>
          <button onClick={() => setIsAddingHost(true)} className="p-1 hover:bg-white/10 text-textMuted hover:text-white rounded-md transition">
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {hosts.length === 0 && (
            <div className="p-4 text-center text-xs text-textMuted">No hosts added yet.</div>
          )}
          {hosts.map(h => (
            <div 
              key={h.id} 
              onClick={() => connectToHost(h)}
              className={`flex items-center space-x-3 p-2 rounded-md cursor-pointer transition group ${activeHost?.id === h.id ? 'bg-primary/10' : 'hover:bg-white/5'}`}
            >
              <div className={`w-8 h-8 rounded flex items-center justify-center ${activeHost?.id === h.id ? 'bg-primary/20 text-primary' : 'bg-white/5 text-textMuted group-hover:text-white'}`}>
                <Server size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate text-white">{h.name}</div>
                <div className="text-xs text-textMuted truncate">{h.username}@{h.host}</div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded">
                <Play size={12} className="text-primary" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-background relative h-full min-w-0">
        {activeHost ? (
          <>
            <div className="h-14 border-b border-border flex items-center px-4 shrink-0 justify-between bg-surface/50">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-yellow-500'}`}></div>
                <span className="text-sm font-medium text-white">{activeHost.name}</span>
                <span className="text-xs text-textMuted ml-2">({activeHost.host})</span>
              </div>
              <button 
                onClick={() => {
                  window.ipcRenderer?.send('ssh-disconnect', { id: activeHost.id });
                  setActiveHost(null);
                  setStatus('idle');
                }}
                className="px-3 py-1 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-xs rounded transition text-textMuted"
              >
                Disconnect
              </button>
            </div>
            
            <div className="flex-1 relative bg-black">
              {status === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 flex-col space-y-3">
                  <Loader2 size={32} className="text-primary animate-spin" />
                  <span className="text-sm text-textMuted">Connecting to {activeHost.host}...</span>
                </div>
              )}
              {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-background z-10 flex-col space-y-3">
                  <div className="p-4 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg max-w-md text-center">
                    <h3 className="font-semibold mb-2">Connection Failed</h3>
                    <p className="text-sm opacity-80">{errorMsg}</p>
                  </div>
                </div>
              )}
              
              <TerminalView hostId={activeHost.id} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col space-y-4">
            <Terminal size={48} className="text-border" />
            <h2 className="text-xl font-semibold text-textMuted">Select a host to connect</h2>
            <button onClick={() => setIsAddingHost(true)} className="px-4 py-2 bg-primary text-background font-medium rounded-md hover:bg-primary/90 transition text-sm">
              Add New Server
            </button>
          </div>
        )}
      </div>

      {/* Add Host Modal */}
      {isAddingHost && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-surface border border-border rounded-xl w-[400px] shadow-2xl flex flex-col">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-white">Add New Host</h3>
              <button onClick={() => setIsAddingHost(false)} className="text-textMuted hover:text-white transition">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddHost} className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-textMuted mb-1">Display Name (Optional)</label>
                <input value={fName} onChange={e=>setFName(e.target.value)} type="text" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition" placeholder="My Server" />
              </div>
              <div className="flex space-x-4">
                <div className="flex-1">
                  <label className="block text-xs text-textMuted mb-1">Host / IP *</label>
                  <input value={fHost} onChange={e=>setFHost(e.target.value)} required type="text" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition" placeholder="192.168.1.1" />
                </div>
                <div className="w-24">
                  <label className="block text-xs text-textMuted mb-1">Port</label>
                  <input value={fPort} onChange={e=>setFPort(e.target.value)} type="number" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-textMuted mb-1">Username *</label>
                <input value={fUser} onChange={e=>setFUser(e.target.value)} required type="text" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition" />
              </div>
              <div>
                <label className="block text-xs text-textMuted mb-1">Password</label>
                <input value={fPass} onChange={e=>setFPass(e.target.value)} type="password" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition" placeholder="Leave empty if using key" />
              </div>
              
              <div className="pt-4 flex justify-end space-x-3">
                <button type="button" onClick={() => setIsAddingHost(false)} className="px-4 py-2 text-sm text-textMuted hover:text-white transition">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary text-background text-sm font-medium rounded-md hover:bg-primary/90 transition">Save Host</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
