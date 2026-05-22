import { useState, useEffect } from 'react';
import { Terminal, FolderGit2, Settings, Plus, Server, X, Play, Loader2, LogOut, User, Trash2 } from 'lucide-react';
import { TerminalView } from './components/TerminalView';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';

interface Host {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [activeHost, setActiveHost] = useState<Host | null>(null);
  const [isAddingHost, setIsAddingHost] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Auth states
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [loadingHosts, setLoadingHosts] = useState(false);

  // Form states
  const [fName, setFName] = useState('');
  const [fHost, setFHost] = useState('');
  const [fPort, setFPort] = useState('22');
  const [fUser, setFUser] = useState('root');
  const [fPass, setFPass] = useState('');

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchHosts = async () => {
    if (!supabase || !session) return;
    setLoadingHosts(true);
    try {
      const { data, error } = await supabase
        .from('hosts')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setHosts(data || []);
    } catch (err: any) {
      console.error('Error fetching hosts:', err.message);
    } finally {
      setLoadingHosts(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchHosts();
    } else {
      setHosts([]);
      setActiveHost(null);
    }
  }, [session]);

  useEffect(() => {
    if (!window.ipcRenderer) return;

    const onConnected = (_: any, { id }: { id: string }) => {
      if (activeHost && id === activeHost.id) setStatus('connected');
    };

    const onError = (_: any, { id, message }: { id: string, message: string }) => {
      if (activeHost && id === activeHost.id) {
        setStatus('error');
        setErrorMsg(message);
      }
    };

    const onClosed = (_: any, { id }: { id: string }) => {
      if (activeHost && id === activeHost.id) {
        setStatus('idle');
        setActiveHost(null);
      }
    };

    window.ipcRenderer.on('ssh-connected', onConnected);
    window.ipcRenderer.on('ssh-error', onError);
    window.ipcRenderer.on('ssh-closed', onClosed);

    return () => {
      if (window.ipcRenderer) {
        window.ipcRenderer.removeAllListeners('ssh-connected');
        window.ipcRenderer.removeAllListeners('ssh-error');
        window.ipcRenderer.removeAllListeners('ssh-closed');
      }
    };
  }, [activeHost]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const emailLower = authEmail.trim().toLowerCase();

      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailLower,
          password: authPassword,
        });

        if (error) throw error;
        
        // Reset form
        setAuthEmail('');
        setAuthPassword('');
      } else {
        // Register
        if (authPassword !== authConfirmPassword) {
          throw new Error("Passwords do not match");
        }

        const { error } = await supabase.auth.signUp({
          email: emailLower,
          password: authPassword,
        });

        if (error) throw error;

        alert("Registration successful! Please check your email for confirmation.");
        setAuthEmail('');
        setAuthPassword('');
        setAuthConfirmPassword('');
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (activeHost && window.ipcRenderer) {
      window.ipcRenderer.send('ssh-disconnect', { id: activeHost.id });
    }
    await supabase.auth.signOut();
  };

  const handleAddHost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    const newHostData = {
      user_id: session.user.id,
      name: fName || fHost,
      host: fHost,
      port: parseInt(fPort) || 22,
      username: fUser,
      password: fPass
    };

    try {
      const { data, error } = await supabase
        .from('hosts')
        .insert([newHostData])
        .select();

      if (error) throw error;

      if (data && data[0]) {
        setHosts([...hosts, data[0]]);
      } else {
        fetchHosts();
      }

      setIsAddingHost(false);
      // reset form
      setFName(''); setFHost(''); setFPort('22'); setFUser('root'); setFPass('');
    } catch (err: any) {
      alert('Error saving host: ' + err.message);
    }
  };

  const handleDeleteHost = async (hostId: string) => {
    if (!session) return;
    try {
      const { error } = await supabase
        .from('hosts')
        .delete()
        .eq('id', hostId)
        .eq('user_id', session.user.id);

      if (error) throw error;

      setHosts(hosts.filter(h => h.id !== hostId));
      if (activeHost?.id === hostId) {
        if (window.ipcRenderer) {
          window.ipcRenderer.send('ssh-disconnect', { id: hostId });
        }
        setActiveHost(null);
        setStatus('idle');
      }
    } catch (err: any) {
      alert('Error deleting host: ' + err.message);
    }
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

  if (!session) {
    return (
      <div className="flex h-screen w-screen bg-background text-textMain font-sans overflow-hidden items-center justify-center relative">
        {/* Decorative gradient blur background */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none"></div>

        <div className="bg-surface/80 backdrop-blur-md border border-border rounded-2xl w-[400px] shadow-2xl p-8 flex flex-col z-10 transition-all duration-300">
          <div className="flex flex-col items-center mb-8">
            <div className="p-3 bg-primary/10 text-primary rounded-2xl mb-3 shadow-lg shadow-primary/5">
              <Terminal size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Ant Tech Async</h2>
            <p className="text-xs text-textMuted mt-1">
              {authMode === 'login' ? 'Sign in to sync your hosts' : 'Create an account to start syncing'}
            </p>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs leading-relaxed">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-textMuted mb-1.5">Email Address</label>
              <input
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                required
                type="email"
                placeholder="you@example.com"
                className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-textMuted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-textMuted mb-1.5">Password</label>
              <input
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                required
                type="password"
                placeholder="••••••••"
                className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-textMuted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200"
              />
            </div>

            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-textMuted mb-1.5">Confirm Password</label>
                <input
                  value={authConfirmPassword}
                  onChange={e => setAuthConfirmPassword(e.target.value)}
                  required
                  type="password"
                  placeholder="••••••••"
                  className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-textMuted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full mt-2 py-2.5 bg-primary text-background font-semibold rounded-lg hover:bg-primary/95 transition-all duration-200 text-sm flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
            >
              {authLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>{authMode === 'login' ? 'Sign In' : 'Sign Up'}</span>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-xs">
            <span className="text-textMuted">
              {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            </span>
            <button
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError('');
                setAuthPassword('');
                setAuthConfirmPassword('');
              }}
              className="text-primary hover:underline font-medium cursor-pointer"
            >
              {authMode === 'login' ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        {/* User profile & Sign out */}
        <div className="border-t border-border pt-4 w-full flex flex-col items-center space-y-4">
          <div className="p-2 text-textMuted hover:text-textMain cursor-pointer transition relative group" title={session.user?.email || ''}>
            <User size={20} />
            <div className="absolute left-16 bottom-2 bg-surface border border-border px-2 py-1 rounded text-xs text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none z-50">
              {session.user?.email || ''}
            </div>
          </div>
          <div onClick={handleLogout} className="p-2 text-textMuted hover:text-red-400 cursor-pointer transition" title="Log Out">
            <LogOut size={20} />
          </div>
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
          {loadingHosts ? (
            <div className="p-4 flex flex-col items-center space-y-2 text-center text-xs text-textMuted">
              <Loader2 size={16} className="animate-spin text-primary" />
              <span>Syncing hosts...</span>
            </div>
          ) : hosts.length === 0 ? (
            <div className="p-4 text-center text-xs text-textMuted">No hosts added yet.</div>
          ) : (
            hosts.map(h => (
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
                <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Are you sure you want to delete ${h.name}?`)) {
                        handleDeleteHost(h.id);
                      }
                    }} 
                    className="p-1 hover:bg-white/10 rounded text-textMuted hover:text-red-400 transition"
                  >
                    <Trash2 size={12} />
                  </button>
                  <div className="p-1 hover:bg-white/10 rounded">
                    <Play size={12} className="text-primary" />
                  </div>
                </div>
              </div>
            ))
          )}
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
