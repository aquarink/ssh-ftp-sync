import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Monitor, ShieldAlert, XCircle } from 'lucide-react';
import { api, DeviceAuthorization, Session } from '../lib/api';

// Only the device approval page may be a post-login destination. Anything else in
// `next` is ignored, so the login form cannot be used to bounce users elsewhere.
const DEVICE_NEXT = /^\/device(\?code=[A-Za-z0-9-]{0,12})?$/;

export function postLoginPath(search: string): string {
  const next = new URLSearchParams(search).get('next') || '';
  return DEVICE_NEXT.test(next) ? next : '/app';
}

function codeFromLocation(): string {
  return new URLSearchParams(window.location.search).get('code')?.toUpperCase() || '';
}

type Status = 'idle' | 'loading' | 'ready' | 'approved' | 'denied';

export function DevicePage({ session, onNavigate }: { session: Session | null; onNavigate: (path: string) => void }) {
  const [code, setCode] = useState(codeFromLocation);
  const [info, setInfo] = useState<DeviceAuthorization | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async (value: string) => {
    setError('');
    setInfo(null);
    setStatus('loading');
    try {
      const result = await api.getDeviceAuthorization(value.trim());
      setInfo(result);
      setStatus('ready');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Look the code up as soon as a signed-in user lands here from the desktop app.
  useEffect(() => {
    if (session && code.length >= 8) lookup(code);
  }, [session]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!info) return;
    setBusy(true);
    setError('');
    try {
      if (decision === 'approve') await api.approveDevice(info.userCode);
      else await api.denyDevice(info.userCode);
      setStatus(decision === 'approve' ? 'approved' : 'denied');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const signInHref = `/device${code ? `?code=${encodeURIComponent(code)}` : ''}`;

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background text-textMain font-sans p-6">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl p-8 space-y-6">
        <div className="flex items-center gap-2 text-white font-semibold">
          <Monitor size={20} className="text-primary" />
          Approve a desktop app
        </div>

        {!session && (
          <div className="space-y-4 text-sm text-textMuted">
            <p>Sign in to approve the desktop app that is asking for access.</p>
            <button
              onClick={() => onNavigate(`/login?next=${encodeURIComponent(signInHref)}`)}
              className="w-full py-2.5 bg-primary text-background font-semibold rounded-lg hover:bg-primary/95 transition cursor-pointer"
            >
              Sign in
            </button>
          </div>
        )}

        {session && status !== 'approved' && status !== 'denied' && (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                lookup(code);
              }}
              className="space-y-3"
            >
              <label className="block text-xs text-textMuted" htmlFor="device-code">Code shown in the desktop app</label>
              <div className="flex gap-2">
                <input
                  id="device-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-lg tracking-widest font-mono text-white outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={status === 'loading' || code.trim().length < 8}
                  className="px-4 py-2 bg-primary text-background font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : 'Check'}
                </button>
              </div>
            </form>

            {error && <div className="p-3 bg-red-500/10 text-red-300 border border-red-500/20 rounded text-xs leading-5">{error}</div>}

            {info && status === 'ready' && (
              <div className="space-y-4">
                <div className="p-4 bg-background border border-border rounded-lg text-sm space-y-2">
                  <div className="flex justify-between gap-4"><span className="text-textMuted">Device</span><span className="text-white text-right">{info.deviceLabel || 'Unnamed device'}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-textMuted">App version</span><span className="text-white">{info.appVersion || 'unknown'}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-textMuted">Requested from</span><span className="text-white font-mono text-xs">{info.requesterIp || 'unknown'}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-textMuted">Requested at</span><span className="text-white">{new Date(info.requestedAt).toLocaleString()}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-textMuted">Expires in</span><span className="text-white">{Math.max(1, Math.ceil(info.expiresIn / 60))} min</span></div>
                </div>

                <div className="flex gap-2 p-3 bg-yellow-500/10 text-yellow-200 border border-yellow-500/20 rounded text-xs leading-5">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  Approve only if this exact code is shown in the desktop app on your own device right now.
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => decide('deny')}
                    disabled={busy}
                    className="py-2.5 border border-border text-textMain rounded-lg hover:bg-white/5 disabled:opacity-50 cursor-pointer"
                  >
                    Deny
                  </button>
                  <button
                    onClick={() => decide('approve')}
                    disabled={busy}
                    className="py-2.5 bg-primary text-background font-semibold rounded-lg hover:bg-primary/95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                  >
                    {busy && <Loader2 size={16} className="animate-spin" />}
                    Approve
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {session && status === 'approved' && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <CheckCircle2 size={40} className="text-green-400" />
            <p className="text-white font-semibold">Approved</p>
            <p className="text-sm text-textMuted">You can return to the desktop app. It signs in automatically.</p>
          </div>
        )}

        {session && status === 'denied' && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <XCircle size={40} className="text-red-400" />
            <p className="text-white font-semibold">Denied</p>
            <p className="text-sm text-textMuted">The desktop app was not given access.</p>
          </div>
        )}
      </div>
    </div>
  );
}
