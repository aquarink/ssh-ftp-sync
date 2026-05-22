import { useState, useEffect, useRef } from 'react';
import { Terminal, FolderGit2, Settings, Plus, Server, X, Play, Loader2, LogOut, User, Trash2, Check, ShieldCheck } from 'lucide-react';
import { TerminalView } from './components/TerminalView';
import { api, Host, ManagedUser, Session } from './lib/api';

function App() {
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef('');
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
  const [authNotice, setAuthNotice] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isUsersOpen, setIsUsersOpen] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmNextPassword, setConfirmNextPassword] = useState('');

  // Form states
  const [fName, setFName] = useState('');
  const [fHost, setFHost] = useState('');
  const [fPort, setFPort] = useState('22');
  const [fUser, setFUser] = useState('root');
  const [fPass, setFPass] = useState('');

  useEffect(() => {
    api.getSession()
      .then(({ user }) => setSession(user ? { user } : null))
      .catch((err) => {
        console.error('Error fetching session:', err.message);
        setSession(null);
      });
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey || session) return;

    const renderTurnstile = window.setInterval(() => {
      if (!turnstileRef.current || !window.turnstile || turnstileWidgetId.current) return;
      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: turnstileSiteKey,
        theme: 'dark',
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
      window.clearInterval(renderTurnstile);
    }, 100);

    return () => {
      window.clearInterval(renderTurnstile);
      if (turnstileWidgetId.current) {
        window.turnstile?.remove?.(turnstileWidgetId.current);
        turnstileWidgetId.current = '';
      }
    };
  }, [session, turnstileSiteKey]);

  const resetTurnstile = () => {
    setTurnstileToken('');
    if (turnstileWidgetId.current) window.turnstile?.reset(turnstileWidgetId.current);
  };

  const fetchHosts = async () => {
    if (!session) return;
    setLoadingHosts(true);
    try {
      const { hosts } = await api.listHosts();
      setHosts(hosts);
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
    setAuthNotice('');
    setAuthLoading(true);

    try {
      const emailLower = authEmail.trim().toLowerCase();

      if (authMode === 'login') {
        const { user } = await api.login(emailLower, authPassword, turnstileToken);
        setSession({ user });

        // Reset form
        setAuthEmail('');
        setAuthPassword('');
      } else {
        // Register
        if (authPassword !== authConfirmPassword) {
          throw new Error("Passwords do not match");
        }

        const { message } = await api.register(emailLower, authPassword, turnstileToken);
        setAuthMode('login');
        setAuthNotice(message);
        setAuthEmail('');
        setAuthPassword('');
        setAuthConfirmPassword('');
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      resetTurnstile();
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (activeHost && window.ipcRenderer) {
      window.ipcRenderer.send('ssh-disconnect', { id: activeHost.id });
    }
    await api.logout();
    setSession(null);
  };

  const handleAddHost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    const newHostData = {
      name: fName || fHost,
      host: fHost,
      port: parseInt(fPort) || 22,
      username: fUser,
      password: fPass
    };

    try {
      const { host } = await api.createHost(newHostData);
      setHosts([...hosts, host]);

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
      await api.deleteHost(hostId);

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

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const { users } = await api.listUsers();
      setManagedUsers(users);
    } catch (err: any) {
      alert('Error loading users: ' + err.message);
    } finally {
      setUsersLoading(false);
    }
  };

  const openUsers = () => {
    setIsAccountOpen(false);
    setIsUsersOpen(true);
    fetchUsers();
  };

  const reviewUser = async (userId: string, approvalStatus: 'approved' | 'rejected') => {
    try {
      const { user } = await api.reviewUser(userId, approvalStatus);
      setManagedUsers(managedUsers.map(item => item.id === user.id ? user : item));
    } catch (err: any) {
      alert('Error reviewing user: ' + err.message);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountError('');
    setAccountNotice('');
    if (nextPassword !== confirmNextPassword) {
      setAccountError('New passwords do not match');
      return;
    }

    try {
      await api.changePassword(currentPassword, nextPassword);
      setCurrentPassword('');
      setNextPassword('');
      setConfirmNextPassword('');
      setAccountNotice('Password updated.');
    } catch (err: any) {
      setAccountError(err.message);
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

          {authNotice && (
            <div className="mb-4 p-3 bg-green-500/10 text-green-300 border border-green-500/20 rounded-lg text-xs leading-relaxed">
              {authNotice}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-textMuted mb-1.5">
                {authMode === 'login' ? 'Email or Username' : 'Email Address'}
              </label>
              <input
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                required
                type={authMode === 'login' ? 'text' : 'email'}
                placeholder={authMode === 'login' ? 'you@example.com or username' : 'you@example.com'}
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

            {turnstileSiteKey ? (
              <div
                ref={turnstileRef}
                className="min-h-[65px]"
              />
            ) : (
              <div className="p-3 bg-yellow-500/10 text-yellow-200 border border-yellow-500/20 rounded-lg text-xs">
                Human verification is not configured.
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading || !turnstileToken}
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
                setAuthNotice('');
                setAuthPassword('');
                setAuthConfirmPassword('');
                resetTurnstile();
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
        {session.user.role === 'admin' && (
          <button
            onClick={openUsers}
            className="p-2 text-textMuted hover:text-textMain cursor-pointer transition"
            title="User Approval"
          >
            <ShieldCheck size={24} />
          </button>
        )}
        <div className="flex-1"></div>
        <div onClick={() => setIsAccountOpen(true)} className="p-2 text-textMuted hover:text-textMain cursor-pointer transition" title="Account Settings">
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

              <TerminalView
                hostId={activeHost.id}
                onConnected={() => setStatus('connected')}
                onError={(message) => {
                  setStatus('error');
                  setErrorMsg(message);
                }}
                onClosed={() => {
                  setStatus('error');
                  setErrorMsg('SSH connection closed. Reconnect from the host list to open a new shell.');
                }}
              />
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

      {isAccountOpen && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-surface border border-border rounded-xl w-[440px] shadow-2xl">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-white">Account</h3>
              <button onClick={() => setIsAccountOpen(false)} className="text-textMuted hover:text-white transition">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{session.user.email}</div>
                  <div className="text-xs text-textMuted">{session.user.role === 'admin' ? 'Administrator' : 'User'}</div>
                </div>
                {session.user.role === 'admin' && (
                  <button onClick={openUsers} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-sm text-white rounded-md flex items-center gap-2">
                    <ShieldCheck size={16} />
                    <span>Users</span>
                  </button>
                )}
              </div>
              {accountError && <div className="mb-3 p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-md text-xs">{accountError}</div>}
              {accountNotice && <div className="mb-3 p-3 bg-green-500/10 text-green-300 border border-green-500/20 rounded-md text-xs">{accountNotice}</div>}
              <form onSubmit={changePassword} className="space-y-3">
                <input value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required type="password" placeholder="Current password" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                <input value={nextPassword} onChange={e => setNextPassword(e.target.value)} required minLength={8} type="password" placeholder="New password" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                <input value={confirmNextPassword} onChange={e => setConfirmNextPassword(e.target.value)} required minLength={8} type="password" placeholder="Confirm new password" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                <div className="flex justify-end">
                  <button type="submit" className="px-4 py-2 bg-primary text-background text-sm font-medium rounded-md hover:bg-primary/90">Change Password</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {isUsersOpen && (
        <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center">
          <div className="bg-surface border border-border rounded-xl w-[min(760px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] shadow-2xl flex flex-col">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-white">User Approval</h3>
              <button onClick={() => setIsUsersOpen(false)} className="text-textMuted hover:text-white transition">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-auto">
              {usersLoading ? (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-textMuted">
                  <Loader2 size={16} className="animate-spin" />
                  <span>Loading users...</span>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-xs text-textMuted">
                    <tr>
                      <th className="px-5 py-3 font-medium">Account</th>
                      <th className="px-3 py-3 font-medium">Role</th>
                      <th className="px-3 py-3 font-medium">Status</th>
                      <th className="px-3 py-3 font-medium">Email Check</th>
                      <th className="px-5 py-3 font-medium text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedUsers.map(user => (
                      <tr key={user.id} className="border-t border-border align-middle">
                        <td className="px-5 py-3">
                          <div className="text-white">{user.username || user.email}</div>
                          {user.username && <div className="text-xs text-textMuted">{user.email}</div>}
                        </td>
                        <td className="px-3 py-3 text-textMuted">{user.role}</td>
                        <td className="px-3 py-3 text-white">{user.approvalStatus}</td>
                        <td className="px-3 py-3 text-textMuted">{user.emailCheckResult || 'manual'}</td>
                        <td className="px-5 py-3">
                          {user.role === 'admin' ? (
                            <div className="text-right text-xs text-textMuted">Protected</div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <button onClick={() => reviewUser(user.id, 'approved')} title="Approve" className="p-2 bg-green-500/10 hover:bg-green-500/20 text-green-300 rounded-md">
                                <Check size={16} />
                              </button>
                              <button onClick={() => reviewUser(user.id, 'rejected')} title="Reject" className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-md">
                                <X size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
