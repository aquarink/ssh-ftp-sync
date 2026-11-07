import { useEffect, useState } from 'react';
import { Loader2, Monitor, Trash2 } from 'lucide-react';
import { api, ClientSession } from '../lib/api';

function formatTime(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export function DevicesPanel() {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { sessions: rows } = await api.listSessions();
      setSessions(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const revoke = async (session: ClientSession) => {
    const name = session.deviceLabel || 'this browser';
    if (!window.confirm(`Sign out ${name}? It will need to be approved again.`)) return;
    setBusyId(session.id);
    setError('');
    try {
      await api.revokeSession(session.id);
      setSessions((current) => current.filter((row) => row.id !== session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-2 text-white font-semibold">
            <Monitor size={18} className="text-primary" />
            Devices and sessions
          </div>
          <p className="text-xs text-textMuted mt-1">
            Every place this account is signed in. Revoke a desktop app you no longer use or do not recognize.
          </p>
        </div>

        {error && <div className="p-3 bg-red-500/10 text-red-300 border border-red-500/20 rounded text-xs">{error}</div>}

        {loading ? (
          <div className="flex items-center gap-2 text-textMuted text-sm"><Loader2 size={16} className="animate-spin" /> Loading</div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-textMuted">No active sessions.</p>
        ) : (
          <div className="border border-border bg-surface rounded-lg divide-y divide-border">
            {sessions.map((session) => (
              <div key={session.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-sm text-white">
                    <span className="truncate">{session.deviceLabel || (session.client === 'desktop' ? 'Desktop app' : 'Web browser')}</span>
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {session.client === 'desktop' ? 'Desktop' : 'Web'}
                    </span>
                    {session.current && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/10 text-green-300">This session</span>
                    )}
                  </div>
                  <div className="text-xs text-textMuted">
                    Signed in {formatTime(session.createdAt)} · last seen {formatTime(session.lastSeenAt)}
                  </div>
                </div>
                {!session.current && (
                  <button
                    onClick={() => revoke(session)}
                    disabled={busyId === session.id}
                    className="p-2 text-textMuted hover:text-red-300 cursor-pointer disabled:opacity-50"
                    title="Sign out this device"
                  >
                    {busyId === session.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
