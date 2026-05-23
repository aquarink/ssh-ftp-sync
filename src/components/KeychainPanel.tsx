import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';
import { api, Host, SshIdentity } from '../lib/api';

const identityTypes: Array<{ value: SshIdentity['type']; label: string }> = [
  { value: 'password', label: 'Password' },
  { value: 'private_key', label: 'Private key' },
  { value: 'key_pair', label: 'Public + private key pair' },
  { value: 'certificate', label: 'SSH certificate' },
  { value: 'key_with_certificate', label: 'Private key + SSH certificate' },
  { value: 'agent', label: 'Agent / OS keychain identity' },
  { value: 'one_time', label: 'One-time identity' },
];

function sshBlobFingerprint(value: string): Promise<string> {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) return Promise.resolve('');
  try {
    const bytes = Uint8Array.from(atob(parts[1]), char => char.charCodeAt(0));
    return crypto.subtle.digest('SHA-256', bytes).then(hash => {
      const digest = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=+$/, '');
      return `SHA256:${digest}`;
    });
  } catch {
    return Promise.resolve('');
  }
}

export function KeychainPanel() {
  const [identities, setIdentities] = useState<SshIdentity[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostAssignments, setHostAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<SshIdentity['type']>('private_key');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [certificate, setCertificate] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [notes, setNotes] = useState('');
  const [publicKeyFingerprint, setPublicKeyFingerprint] = useState('');
  const [certificateFingerprint, setCertificateFingerprint] = useState('');

  const needsPassword = type === 'password';
  const needsPrivateKey = ['private_key', 'key_pair', 'key_with_certificate'].includes(type);
  const needsPublicKey = type === 'key_pair';
  const needsCertificate = ['certificate', 'key_with_certificate'].includes(type);
  const isSaveable = type !== 'one_time';

  const privateKeyFormat = useMemo(() => {
    if (!privateKey) return '';
    return /-----BEGIN (OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/.test(privateKey)
      ? 'Private key format looks valid. Fingerprint is calculated after server-side validation.'
      : 'Private key must be OPENSSH, RSA, EC, or DSA PEM format.';
  }, [privateKey]);

  useEffect(() => {
    let cancelled = false;
    if (!publicKey) {
      setPublicKeyFingerprint('');
      return;
    }
    sshBlobFingerprint(publicKey).then(value => {
      if (!cancelled) setPublicKeyFingerprint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  useEffect(() => {
    let cancelled = false;
    if (!certificate) {
      setCertificateFingerprint('');
      return;
    }
    sshBlobFingerprint(certificate).then(value => {
      if (!cancelled) setCertificateFingerprint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [certificate]);

  const loadIdentities = async () => {
    setLoading(true);
    setError('');
    try {
      const [identityResult, hostResult] = await Promise.all([
        api.listIdentities(),
        api.listHosts(),
      ]);
      setIdentities(identityResult.identities || identityResult.credentials || []);
      setHosts(hostResult.hosts);
    } catch (err: any) {
      setError(err.message || 'Unable to load identities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIdentities();
  }, []);

  const resetForm = () => {
    setLabel('');
    setUsername('');
    setPassword('');
    setPrivateKey('');
    setPublicKey('');
    setCertificate('');
    setPassphrase('');
    setNotes('');
  };

  const saveIdentity = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isSaveable) {
      setError('One-time identities are entered from the host connection form and are not saved.');
      return;
    }
    try {
      const secret = { type, password, privateKey, publicKey, certificate, passphrase };
      const { identity } = await api.createIdentity({ type, label, username, password, privateKey, publicKey, certificate, passphrase, notes });
      if (window.ipcRenderer) {
        await window.ipcRenderer.invoke('identity-save-secret', { id: identity.id, secret });
      }
      resetForm();
      await loadIdentities();
    } catch (err: any) {
      setError(err.message || 'Unable to save identity');
    }
  };

  const removeIdentity = async (id: string) => {
    if (!confirm('Remove this SSH identity? Hosts assigned to it will no longer connect.')) return;
    await api.deleteIdentity(id);
    if (window.ipcRenderer) await window.ipcRenderer.invoke('identity-remove-secret', { id });
    await loadIdentities();
  };

  const testIdentity = async (id: string) => {
    const host = prompt('SSH host or IP');
    if (!host) return;
    const username = prompt('Username', 'root');
    if (!username) return;
    const port = Number.parseInt(prompt('Port', '22') || '22', 10) || 22;
    setError('');
    try {
      await api.testIdentity(id, { host, username, port });
      alert('Identity test succeeded.');
    } catch (err: any) {
      setError(err.message || 'Identity test failed');
    }
  };

  const assignIdentity = async (identityId: string) => {
    const hostId = hostAssignments[identityId];
    if (!hostId) return;
    setError('');
    try {
      await api.assignIdentityToHost(hostId, identityId);
      await loadIdentities();
      alert('Identity assigned to host.');
    } catch (err: any) {
      setError(err.message || 'Unable to assign identity');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[420px_minmax(0,1fr)] gap-6">
        <form onSubmit={saveIdentity} className="border border-border bg-surface rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold">
            <KeyRound size={18} className="text-primary" />
            SSH Keys / Identities
          </div>
          {error && <div className="p-3 bg-red-500/10 text-red-300 border border-red-500/20 rounded text-xs">{error}</div>}
          <input value={label} onChange={e => setLabel(e.target.value)} required placeholder="Identity label" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Default username, optional" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />
          <select value={type} onChange={e => setType(e.target.value as SshIdentity['type'])} className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none">
            {identityTypes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>

          {needsPassword && <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />}
          {needsPrivateKey && (
            <>
              <textarea value={privateKey} onChange={e => setPrivateKey(e.target.value)} required placeholder="Paste OpenSSH/PEM private key" className="w-full h-40 bg-background border border-border rounded px-3 py-2 text-xs font-mono text-white outline-none resize-none" />
              {privateKeyFormat && <div className="text-xs text-textMuted">{privateKeyFormat}</div>}
              <input value={passphrase} onChange={e => setPassphrase(e.target.value)} type="password" placeholder="Passphrase, optional" className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none" />
            </>
          )}
          {needsPublicKey && (
            <>
              <textarea value={publicKey} onChange={e => setPublicKey(e.target.value)} placeholder="Public key, optional" className="w-full h-20 bg-background border border-border rounded px-3 py-2 text-xs font-mono text-white outline-none resize-none" />
              {publicKeyFingerprint && <div className="text-xs text-textMuted">Public key {publicKeyFingerprint}</div>}
            </>
          )}
          {needsCertificate && (
            <>
              <textarea value={certificate} onChange={e => setCertificate(e.target.value)} required placeholder="OpenSSH certificate" className="w-full h-24 bg-background border border-border rounded px-3 py-2 text-xs font-mono text-white outline-none resize-none" />
              {certificateFingerprint && <div className="text-xs text-textMuted">Certificate {certificateFingerprint}</div>}
            </>
          )}
          {type === 'agent' && <div className="text-xs text-textMuted leading-5">Uses SSH_AUTH_SOCK on Linux/macOS or Pageant/OpenSSH-compatible agent on Windows. No private key is stored.</div>}
          {type === 'one_time' && <div className="text-xs text-yellow-200 leading-5">One-time identities are intentionally not saved. Use this mode from a host connection form when needed.</div>}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes, optional" className="w-full h-20 bg-background border border-border rounded px-3 py-2 text-sm text-white outline-none resize-none" />
          <button disabled={!isSaveable} className="w-full bg-primary text-background rounded-md py-2 text-sm font-semibold disabled:opacity-40">Save identity</button>
          <p className="text-xs text-textMuted leading-5">Secrets are not returned by the API after save. Database rows contain metadata and fingerprints only.</p>
        </form>

        <div className="border border-border bg-surface rounded-lg overflow-hidden">
          <div className="h-12 border-b border-border px-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Saved identities</span>
            {loading && <Loader2 size={16} className="animate-spin text-primary" />}
          </div>
          <div>
            {identities.length === 0 && !loading ? (
              <div className="p-6 text-sm text-textMuted">No identities saved yet.</div>
            ) : identities.map((identity) => (
              <div key={identity.id} className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <KeyRound size={16} className="text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{identity.label}</div>
                    <div className="text-xs text-textMuted truncate">{identity.type} {identity.fingerprint || identity.certificateFingerprint || ''}</div>
                  </div>
                  <button onClick={() => testIdentity(identity.id)} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-textMuted hover:text-white">Test</button>
                  <button onClick={() => removeIdentity(identity.id)} className="p-2 rounded hover:bg-red-500/20 text-textMuted hover:text-red-300"><Trash2 size={15} /></button>
                </div>
                <div className="mt-3 flex gap-2">
                  <select value={hostAssignments[identity.id] || ''} onChange={e => setHostAssignments(value => ({ ...value, [identity.id]: e.target.value }))} className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs text-white outline-none">
                    <option value="">Assign to host...</option>
                    {hosts.map(host => <option key={host.id} value={host.id}>{host.name} ({host.username}@{host.host})</option>)}
                  </select>
                  <button onClick={() => assignIdentity(identity.id)} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-textMuted hover:text-white">Assign</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
