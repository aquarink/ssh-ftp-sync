import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';
import { api, SshCredential } from '../lib/api';

export function KeychainPanel() {
  const [credentials, setCredentials] = useState<SshCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'password' | 'private_key'>('private_key');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const loadCredentials = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.listCredentials();
      setCredentials(result.credentials);
    } catch (err: any) {
      setError(err.message || 'Unable to load credentials');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCredentials();
  }, []);

  const importCredential = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const { credential } = await api.createCredential({ type, label, username, password, privateKey, passphrase });
      if (window.ipcRenderer) {
        await window.ipcRenderer.invoke('credential-save-secret', {
          id: credential.id,
          secret: type === 'password' ? { type, password } : { type, privateKey, passphrase },
        });
      }
      setLabel('');
      setUsername('');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
      await loadCredentials();
    } catch (err: any) {
      setError(err.message || 'Unable to save credential');
    }
  };

  const removeCredential = async (id: string) => {
    if (!confirm('Remove this SSH credential? Hosts assigned to it will no longer connect.')) return;
    await api.deleteCredential(id);
    if (window.ipcRenderer) await window.ipcRenderer.invoke('credential-remove-secret', { id });
    await loadCredentials();
  };

  const testCredential = async (id: string) => {
    const host = prompt('SSH host or IP');
    if (!host) return;
    const username = prompt('Username', 'root');
    if (!username) return;
    const port = Number.parseInt(prompt('Port', '22') || '22', 10) || 22;
    setError('');
    try {
      await api.testCredential(id, { host, username, port });
      alert('Credential test succeeded.');
    } catch (err: any) {
      setError(err.message || 'Credential test failed');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-5xl mx-auto grid lg:grid-cols-[360px_minmax(0,1fr)] gap-6">
        <form onSubmit={importCredential} className="border border-border bg-surface rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold">
            <KeyRound size={18} className="text-primary" />
            SSH Keys / Keychain
          </div>
          {error && <div className="p-3 bg-red-500/10 text-red-300 border border-red-500/20 rounded text-xs">{error}</div>}
          <input value={label} onChange={e => setLabel(e.target.value)} required placeholder="Label" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username override" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />
          <select value={type} onChange={e => setType(e.target.value as any)} className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none">
            <option value="private_key">Private key</option>
            <option value="password">Password</option>
          </select>
          {type === 'password' ? (
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />
          ) : (
            <>
              <textarea value={privateKey} onChange={e => setPrivateKey(e.target.value)} required placeholder="Paste OpenSSH/PEM private key" className="w-full h-44 bg-background border border-border rounded px-3 py-2 text-xs font-mono text-white outline-none resize-none" />
              <input value={passphrase} onChange={e => setPassphrase(e.target.value)} type="password" placeholder="Passphrase, if any" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />
            </>
          )}
          <button className="w-full bg-primary text-background rounded-md py-2 text-sm font-semibold">Remember credential</button>
          <p className="text-xs text-textMuted leading-5">Use once is available from the host connection form by leaving the credential unassigned and entering the secret only for that connection.</p>
        </form>

        <div className="border border-border bg-surface rounded-lg overflow-hidden">
          <div className="h-12 border-b border-border px-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Saved credentials</span>
            {loading && <Loader2 size={16} className="animate-spin text-primary" />}
          </div>
          <div>
            {credentials.length === 0 && !loading ? (
              <div className="p-6 text-sm text-textMuted">No credentials saved yet.</div>
            ) : credentials.map((credential) => (
              <div key={credential.id} className="px-4 py-3 border-b border-border flex items-center gap-3">
                <KeyRound size={16} className="text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{credential.label}</div>
                <div className="text-xs text-textMuted truncate">{credential.type} {credential.fingerprint || ''}</div>
              </div>
                <button onClick={() => testCredential(credential.id)} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-textMuted hover:text-white">
                  Test
                </button>
                <button onClick={() => removeCredential(credential.id)} className="p-2 rounded hover:bg-red-500/20 text-textMuted hover:text-red-300">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
