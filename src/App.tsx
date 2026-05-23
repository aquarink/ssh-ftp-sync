import { useState, useEffect, useRef } from 'react';
import { Terminal, Settings, Plus, Server, X, Play, Loader2, LogOut, Trash2, Check, ShieldCheck, KeyRound, Pin, PinOff, Pencil, Copy } from 'lucide-react';
import { KeychainPanel } from './components/KeychainPanel';
import { LandingPage } from './components/LandingPage';
import { SftpFileManager } from './components/SftpFileManager';
import { TerminalView } from './components/TerminalView';
import { api, Host, ManagedUser, Session, SshCredential } from './lib/api';

type SshTabStatus = 'connecting' | 'connected' | 'error' | 'closed';

interface SshTab {
  id: string;
  hostId: string;
  name: string;
  hostname: string;
  host: Host;
  status: SshTabStatus;
  errorMsg?: string;
}

function App() {
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef('');
  const [session, setSession] = useState<Session | null>(null);
  const [route, setRoute] = useState(() => window.location.pathname);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<SshCredential[]>([]);
  const [sshTabs, setSshTabs] = useState<SshTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isAddingHost, setIsAddingHost] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [removeSavedCredential, setRemoveSavedCredential] = useState(false);
  const [isHostSidebarHovered, setIsHostSidebarHovered] = useState(false);
  const [isHostSidebarPinned, setIsHostSidebarPinned] = useState(() => localStorage.getItem('hostSidebarPinned') === 'true');

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
  const [fAuthType, setFAuthType] = useState<'password' | 'identity' | 'one_time'>('password');
  const [fCredentialId, setFCredentialId] = useState('');
  const [fStartupDirectory, setFStartupDirectory] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fTags, setFTags] = useState('');

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(path);
  };

  const isHostSidebarExpanded = isHostSidebarPinned || isHostSidebarHovered;

  useEffect(() => {
    localStorage.setItem('hostSidebarPinned', String(isHostSidebarPinned));
    localStorage.setItem('hostSidebarCollapsed', String(!isHostSidebarExpanded));
  }, [isHostSidebarPinned, isHostSidebarExpanded]);

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    api.getSession()
      .then(({ user }) => setSession(user ? { user } : null))
      .catch((err) => {
        console.error('Error fetching session:', err.message);
        setSession(null);
      });
  }, []);

  useEffect(() => {
    if (session && ['/', '/login', '/register'].includes(route)) {
      window.history.replaceState({}, '', '/app');
      setRoute('/app');
    }
    if (!session && route !== '/' && route !== '/login' && route !== '/register') {
      window.history.replaceState({}, '', '/');
      setRoute('/');
    }
    if (route === '/register') setAuthMode('register');
    if (route === '/login') setAuthMode('login');
  }, [session, route]);

  useEffect(() => {
    if (!turnstileSiteKey || session || !['/login', '/register'].includes(route)) return;

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

  const fetchCredentials = async () => {
    if (!session) return;
    try {
      const { identities, credentials } = await api.listIdentities();
      setCredentials(identities || credentials);
    } catch (err: any) {
      console.error('Error fetching credentials:', err.message);
    }
  };

  useEffect(() => {
    if (session) {
      fetchHosts();
      fetchCredentials();
    } else {
      setHosts([]);
      setCredentials([]);
      setSshTabs([]);
      setActiveTabId(null);
    }
  }, [session]);

  useEffect(() => {
    if (!window.ipcRenderer) return;

    const onConnected = (_: any, { id }: { id: string }) => {
      setSshTabs(tabs => tabs.map(tab => tab.id === id ? { ...tab, status: 'connected', errorMsg: '' } : tab));
    };

    const onError = (_: any, { id, message }: { id: string, message: string }) => {
      setSshTabs(tabs => tabs.map(tab => tab.id === id ? { ...tab, status: 'error', errorMsg: message } : tab));
    };

    const onClosed = (_: any, { id }: { id: string }) => {
      setSshTabs(tabs => tabs.map(tab => tab.id === id ? { ...tab, status: 'closed', errorMsg: 'SSH connection closed.' } : tab));
    };

    window.ipcRenderer.on('ssh-connected', onConnected);
    window.ipcRenderer.on('ssh-error', onError);
    window.ipcRenderer.on('ssh-closed', onClosed);

    return () => {
      if (window.ipcRenderer) {
        window.ipcRenderer.removeListener('ssh-connected', onConnected);
        window.ipcRenderer.removeListener('ssh-error', onError);
        window.ipcRenderer.removeListener('ssh-closed', onClosed);
      }
    };
  }, []);

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
        navigate('/app');

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
    if (window.ipcRenderer) {
      sshTabs.forEach(tab => window.ipcRenderer.send('ssh-disconnect', { id: tab.id }));
    }
    await api.logout();
    setSession(null);
    navigate('/');
  };

  const resetHostForm = () => {
    setFName('');
    setFHost('');
    setFPort('22');
    setFUser('root');
    setFPass('');
    setFAuthType('password');
    setFCredentialId('');
    setFStartupDirectory('');
    setFNotes('');
    setFTags('');
    setRemoveSavedCredential(false);
    setEditingHost(null);
  };

  const openAddHost = () => {
    resetHostForm();
    setIsAddingHost(true);
  };

  const openEditHost = (host: Host) => {
    setEditingHost(host);
    setFName(host.name || '');
    setFHost(host.host || '');
    setFPort(String(host.port || 22));
    setFUser(host.username || 'root');
    setFPass('');
    setFAuthType(host.credentialId ? 'identity' : 'password');
    setFCredentialId(host.credentialId || '');
    setFStartupDirectory(host.startupDirectory || '');
    setFNotes(host.notes || '');
    setFTags(host.tags || '');
    setRemoveSavedCredential(false);
    setIsAddingHost(true);
  };

  const openDuplicateHost = (host: Host) => {
    setEditingHost(null);
    setFName(`${host.name} Copy`);
    setFHost(host.host || '');
    setFPort(String(host.port || 22));
    setFUser(host.username || 'root');
    setFPass('');
    setFAuthType(host.credentialId ? 'identity' : 'password');
    setFCredentialId(host.credentialId || '');
    setFStartupDirectory(host.startupDirectory || '');
    setFNotes(host.notes || '');
    setFTags(host.tags || '');
    setRemoveSavedCredential(false);
    setIsAddingHost(true);
  };

  const closeHostModal = () => {
    setIsAddingHost(false);
    resetHostForm();
  };

  const handleHostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    try {
      let authType = fAuthType;
      let credentialId = fAuthType === 'identity' ? fCredentialId : '';
      const hostName = fName || fHost;

      if (fAuthType === 'password' && fPass) {
        const { identity } = await api.createIdentity({
          type: 'password',
          label: `${hostName} password`,
          username: fUser,
          password: fPass,
        });
        credentialId = identity.id;
        authType = 'identity';
        if (window.ipcRenderer) {
          await window.ipcRenderer.invoke('identity-save-secret', {
            id: identity.id,
            secret: { type: 'password', password: fPass },
          });
        }
      }

      const newHostData: Omit<Host, 'id'> & { removeCredential?: boolean } = {
        name: hostName,
        host: fHost,
        port: parseInt(fPort) || 22,
        username: fUser,
        authType,
        credentialId: credentialId || null,
        startupDirectory: fStartupDirectory || null,
        notes: fNotes || null,
        tags: fTags || null,
      };
      if (fAuthType === 'password' && fPass) newHostData.password = fPass;
      if (removeSavedCredential) newHostData.removeCredential = true;
      const { host } = editingHost
        ? await api.updateHost(editingHost.id, newHostData)
        : await api.createHost(newHostData);

      setHosts(current => editingHost
        ? current.map(item => item.id === host.id ? host : item)
        : [...current, host]
      );
      fetchCredentials();

      closeHostModal();
    } catch (err: any) {
      alert('Error saving host: ' + err.message);
    }
  };

  const handleDeleteHost = async (hostId: string) => {
    if (!session) return;
    try {
      await api.deleteHost(hostId);

      setHosts(hosts.filter(h => h.id !== hostId));
      const closingTabs = sshTabs.filter(tab => tab.hostId === hostId);
      closingTabs.forEach(tab => window.ipcRenderer?.send('ssh-disconnect', { id: tab.id }));
      setSshTabs(tabs => tabs.filter(tab => tab.hostId !== hostId));
      if (closingTabs.some(tab => tab.id === activeTabId)) setActiveTabId(null);
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
    const tabId = crypto.randomUUID();
    const tab: SshTab = {
      id: tabId,
      hostId: host.id,
      name: host.name,
      hostname: host.host,
      host,
      status: 'connecting',
    };
    setSshTabs(tabs => [...tabs, tab]);
    setActiveTabId(tabId);
  };

  const closeTab = (tabId: string) => {
    window.ipcRenderer?.send('ssh-disconnect', { id: tabId });
    setSshTabs(tabs => {
      const next = tabs.filter(tab => tab.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next.length ? next[next.length - 1].id : null);
      }
      return next;
    });
  };

  const updateTab = (tabId: string, patch: Partial<SshTab>) => {
    setSshTabs(tabs => tabs.map(tab => tab.id === tabId ? { ...tab, ...patch } : tab));
  };

  const activeTab = sshTabs.find(tab => tab.id === activeTabId) || null;
  const hostStatus = (hostId: string) => {
    const tabs = sshTabs.filter(tab => tab.hostId === hostId);
    if (tabs.some(tab => tab.status === 'connected')) return 'connected';
    if (tabs.some(tab => tab.status === 'connecting')) return 'connecting';
    if (tabs.some(tab => tab.status === 'error')) return 'error';
    if (tabs.some(tab => tab.status === 'closed')) return 'closed';
    return 'idle';
  };
  const hostStatusClass = (status: string) => {
    if (status === 'connected') return 'bg-green-500';
    if (status === 'connecting') return 'bg-yellow-500';
    if (status === 'error' || status === 'closed') return 'bg-red-500';
    return 'bg-textMuted';
  };

  if (!session) {
    if (route === '/') {
      return <LandingPage onNavigate={navigate} />;
    }

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
                const nextPath = authMode === 'login' ? '/register' : '/login';
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                navigate(nextPath);
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
        <button onClick={() => navigate('/app')} className={`p-2 rounded-xl cursor-pointer transition ${route === '/app' ? 'bg-primary/10 text-primary' : 'text-textMuted hover:text-textMain'}`} title="Terminals">
          <Terminal size={24} />
        </button>
        <button onClick={() => navigate('/app/keychain')} className={`p-2 rounded-xl cursor-pointer transition ${route === '/app/keychain' ? 'bg-primary/10 text-primary' : 'text-textMuted hover:text-textMain'}`} title="SSH Keys">
          <KeyRound size={24} />
        </button>
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
          <div onClick={handleLogout} className="p-2 text-textMuted hover:text-red-400 cursor-pointer transition" title="Log Out">
            <LogOut size={20} />
          </div>
        </div>
      </div>

      {/* Hosts List Panel */}
      <div
        onMouseEnter={() => setIsHostSidebarHovered(true)}
        onMouseLeave={() => setIsHostSidebarHovered(false)}
        className={`${isHostSidebarExpanded ? 'w-72' : 'w-[72px]'} bg-[#161b22]/50 border-r border-border flex flex-col shrink-0 z-30 transition-[width] duration-200 ease-out`}
      >
        <div className={`h-14 border-b border-border flex items-center ${isHostSidebarExpanded ? 'justify-between px-3' : 'justify-center px-2'} gap-2 shrink-0`}>
          {isHostSidebarExpanded && <span className="font-semibold text-sm truncate">Hosts</span>}
          <button
            onClick={() => setIsHostSidebarPinned(value => !value)}
            title={isHostSidebarPinned ? 'Unpin host sidebar' : 'Pin host sidebar'}
            aria-label={isHostSidebarPinned ? 'Unpin host sidebar' : 'Pin host sidebar'}
            className="p-1.5 hover:bg-white/10 text-textMuted hover:text-white rounded-md transition"
          >
            {isHostSidebarPinned ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
          <button onClick={openAddHost} title="Add host" aria-label="Add host" className="p-1.5 hover:bg-white/10 text-textMuted hover:text-white rounded-md transition">
            <Plus size={16} />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${isHostSidebarExpanded ? 'p-2' : 'px-2 py-2'} space-y-1 overflow-x-visible`}>
          {loadingHosts ? (
            <div className="p-4 flex flex-col items-center space-y-2 text-center text-xs text-textMuted">
              <Loader2 size={16} className="animate-spin text-primary" />
              {isHostSidebarExpanded && <span>Syncing hosts...</span>}
            </div>
          ) : hosts.length === 0 ? (
            <div className="p-4 text-center text-xs text-textMuted">{isHostSidebarExpanded ? 'No hosts added yet.' : 'Empty'}</div>
          ) : (
            hosts.map(h => {
              const status = hostStatus(h.id);
              const tooltipId = `host-tooltip-${h.id}`;
              return (
              <div 
                key={h.id} 
                onClick={() => connectToHost(h)}
                title={`${h.name} - ${h.username}@${h.host}:${h.port}`}
                aria-label={`Connect to ${h.name}, ${h.username} at ${h.host} port ${h.port}, ${h.authType || 'password'} authentication, ${status} status`}
                aria-describedby={tooltipId}
                className={`relative flex items-center ${isHostSidebarExpanded ? 'gap-3 p-2' : 'justify-center p-2'} rounded-md cursor-pointer transition group ${activeTab?.hostId === h.id ? 'bg-primary/10' : 'hover:bg-white/5'}`}
              >
                <div className={`relative w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${activeTab?.hostId === h.id ? 'bg-primary/20 text-primary' : 'bg-white/5 text-textMuted group-hover:text-white'}`}>
                  <Server size={16} />
                  <span className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#161b22] ${hostStatusClass(status)}`} />
                </div>
                {isHostSidebarExpanded && (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate text-white">{h.name}</div>
                      <div className="text-xs text-textMuted truncate">{h.username}@{h.host}</div>
                      <div className="text-[10px] text-textMuted truncate capitalize">{status}</div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          connectToHost(h);
                        }}
                        className="p-1 hover:bg-white/10 rounded text-textMuted hover:text-primary transition"
                        title="Connect"
                        aria-label={`Connect to ${h.name}`}
                      >
                        <Play size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditHost(h);
                        }}
                        className="p-1 hover:bg-white/10 rounded text-textMuted hover:text-white transition"
                        title="Edit host"
                        aria-label={`Edit ${h.name}`}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDuplicateHost(h);
                        }}
                        className="p-1 hover:bg-white/10 rounded text-textMuted hover:text-white transition"
                        title="Duplicate host"
                        aria-label={`Duplicate ${h.name}`}
                      >
                        <Copy size={12} />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Are you sure you want to delete ${h.name}?`)) {
                            handleDeleteHost(h.id);
                          }
                        }} 
                        className="p-1 hover:bg-white/10 rounded text-textMuted hover:text-red-400 transition"
                        title="Delete host"
                        aria-label={`Delete ${h.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </>
                )}
                <div
                  id={tooltipId}
                  role="tooltip"
                  className="pointer-events-none absolute left-2 right-2 top-[calc(100%+6px)] rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-2xl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition z-50"
                >
                  <div className="font-semibold text-white truncate">{h.name}</div>
                  <div className="mt-1 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 text-textMuted">
                    <span>Host</span><span className="truncate text-textMain">{h.host}</span>
                    <span>User</span><span className="truncate text-textMain">{h.username}</span>
                    <span>Port</span><span className="text-textMain">{h.port}</span>
                    <span>Auth</span><span className="truncate text-textMain">{h.authType || 'password'}</span>
                    <span>Status</span><span className="capitalize text-textMain">{status}</span>
                  </div>
                </div>
              </div>
            )})
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-background relative h-full min-w-0">
        {route === '/app/keychain' ? (
          <KeychainPanel onHostUpdated={(host) => setHosts(current => current.map(item => item.id === host.id ? host : item))} />
        ) : activeTab ? (
          <>
            <div className="h-12 border-b border-border flex items-center bg-surface/50 overflow-x-auto shrink-0">
              {sshTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`h-full min-w-[180px] max-w-[240px] border-r border-border px-3 flex items-center gap-2 text-left ${activeTabId === tab.id ? 'bg-background text-white' : 'text-textMuted hover:bg-white/5'}`}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${tab.status === 'connected' ? 'bg-green-500' : tab.status === 'error' || tab.status === 'closed' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{tab.name}</div>
                    <div className="text-[10px] text-textMuted truncate">{tab.hostname}</div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeTab(tab.id);
                      }
                    }}
                    className="p-1 rounded hover:bg-red-500/20 hover:text-red-300"
                  >
                    <X size={14} />
                  </span>
                </button>
              ))}
              <div className="flex-1" />
              <div className="px-4 text-xs text-textMuted whitespace-nowrap">{activeTab.status}</div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_360px]">
              <div className="relative bg-black min-w-0">
                {sshTabs.map(tab => (
                  <div key={tab.id} className={`absolute inset-0 ${activeTabId === tab.id ? 'block' : 'hidden'}`}>
                    {tab.status === 'connecting' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 flex-col space-y-3">
                        <Loader2 size={32} className="text-primary animate-spin" />
                        <span className="text-sm text-textMuted">Connecting to {tab.hostname}...</span>
                      </div>
                    )}
                    {(tab.status === 'error' || tab.status === 'closed') && tab.errorMsg && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background z-10 flex-col space-y-3">
                        <div className="p-4 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg max-w-md text-center">
                          <h3 className="font-semibold mb-2">Connection Failed</h3>
                          <p className="text-sm opacity-80">{tab.errorMsg}</p>
                        </div>
                      </div>
                    )}

                    <TerminalView
                      sessionId={tab.id}
                      hostId={tab.hostId}
                      host={tab.host}
                      active={activeTabId === tab.id}
                      onConnected={() => updateTab(tab.id, { status: 'connected', errorMsg: '' })}
                      onError={(message) => updateTab(tab.id, { status: 'error', errorMsg: message })}
                      onClosed={() => updateTab(tab.id, { status: 'closed', errorMsg: 'SSH connection closed. Reconnect from the host list to open a new shell.' })}
                    />
                  </div>
                ))}
              </div>
              <SftpFileManager sessionId={activeTab.id} hostId={activeTab.hostId} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col space-y-4">
            <Terminal size={48} className="text-border" />
            <h2 className="text-xl font-semibold text-textMuted">Select a host to connect</h2>
            <button onClick={openAddHost} className="px-4 py-2 bg-primary text-background font-medium rounded-md hover:bg-primary/90 transition text-sm">
              Add New Server
            </button>
          </div>
        )}
      </div>

      {/* Add Host Modal */}
      {isAddingHost && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-surface border border-border rounded-xl w-[min(520px,calc(100vw-32px))] max-h-[min(820px,calc(100vh-32px))] shadow-2xl flex flex-col">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-white">{editingHost ? 'Edit Host' : 'Add New Host'}</h3>
              <button onClick={closeHostModal} className="text-textMuted hover:text-white transition">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleHostSubmit} className="p-6 space-y-4 overflow-auto">
              {editingHost && (
                <div className="p-3 bg-primary/10 text-primary border border-primary/20 rounded text-xs leading-5">
                  Changes apply to new connections. Active SSH tabs keep their current session until reconnect.
                </div>
              )}
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
                <label className="block text-xs text-textMuted mb-1">Authentication</label>
                <select value={fAuthType} onChange={e => setFAuthType(e.target.value as any)} className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition">
                  <option value="password">Password</option>
                  <option value="identity">Identity / Keychain</option>
                  <option value="one_time">One-time key</option>
                </select>
              </div>
              {fAuthType === 'identity' && (
                <div>
                  <label className="block text-xs text-textMuted mb-1">Identity</label>
                  <select value={fCredentialId} onChange={e => setFCredentialId(e.target.value)} required className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition">
                    <option value="">Select identity</option>
                    {credentials.map(credential => (
                      <option key={credential.id} value={credential.id}>{credential.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {fAuthType === 'one_time' && (
                <div className="p-3 bg-yellow-500/10 text-yellow-200 border border-yellow-500/20 rounded text-xs leading-5">
                  One-time key is intentionally not saved with the host. Save the host first, then use a saved identity or connect with a transient identity flow.
                </div>
              )}
              {editingHost && (
                <div className="p-3 bg-white/5 border border-border rounded text-xs text-textMuted leading-5">
                  {editingHost.credentialId && !removeSavedCredential
                    ? `Using identity: ${credentials.find(item => item.id === editingHost.credentialId)?.label || 'saved identity'}`
                    : 'No credential selected'}
                </div>
              )}
              <div>
                <label className="block text-xs text-textMuted mb-1">{editingHost ? 'New password' : 'Password'}</label>
                <input value={fPass} onChange={e=>setFPass(e.target.value)} disabled={fAuthType !== 'password'} type="password" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition disabled:opacity-50" placeholder={editingHost ? 'Leave empty to keep saved credential' : 'Leave empty if using identity'} />
              </div>
              {editingHost?.credentialId && (
                <label className="flex items-center gap-2 text-xs text-textMuted">
                  <input type="checkbox" checked={removeSavedCredential} onChange={event => setRemoveSavedCredential(event.target.checked)} />
                  <span>Remove saved credential from this host</span>
                </label>
              )}
              <div>
                <label className="block text-xs text-textMuted mb-1">Startup directory</label>
                <input value={fStartupDirectory} onChange={e => setFStartupDirectory(e.target.value)} type="text" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition" placeholder="/var/www" />
              </div>
              <div>
                <label className="block text-xs text-textMuted mb-1">Tags / Group</label>
                <input value={fTags} onChange={e => setFTags(e.target.value)} type="text" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition" placeholder="production, web" />
              </div>
              <div>
                <label className="block text-xs text-textMuted mb-1">Notes</label>
                <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} className="w-full h-20 bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition resize-none" placeholder="Optional notes" />
              </div>

              <div className="pt-4 flex justify-end space-x-3">
                <button type="button" onClick={closeHostModal} className="px-4 py-2 text-sm text-textMuted hover:text-white transition">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary text-background text-sm font-medium rounded-md hover:bg-primary/90 transition">{editingHost ? 'Save Changes' : 'Save Host'}</button>
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
