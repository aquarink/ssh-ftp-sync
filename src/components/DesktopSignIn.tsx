import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Monitor } from 'lucide-react';
import { cancelDeviceLogin, cleanIpcError, onDeviceLoginStatus, reopenDeviceLogin, startDeviceLogin } from '../lib/deviceLogin';

type Phase =
  | { kind: 'starting' }
  | { kind: 'waiting'; userCode: string; expiresAtMs: number; notice: string }
  | { kind: 'finishing' }
  | { kind: 'ended'; message: string };

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Desktop sign-in: shows a one-time code, opens the browser to approve it, and
 * calls `onSignedIn` once the main process reports the session is in place.
 */
export function DesktopSignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [now, setNow] = useState(() => Date.now());
  // Read through a ref so the flow is not restarted when the parent re-renders.
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    let active = true;
    const unsubscribe = onDeviceLoginStatus((status) => {
      if (!active) return;
      if (status.state === 'browser_not_opened') {
        setPhase((current) => (current.kind === 'waiting' ? { ...current, notice: status.message } : current));
        return;
      }
      if (status.state === 'approved') {
        setPhase({ kind: 'finishing' });
        onSignedInRef.current().catch((error) => {
          if (active) setPhase({ kind: 'ended', message: cleanIpcError(error) });
        });
        return;
      }
      if (status.state === 'denied') setPhase({ kind: 'ended', message: 'The sign-in was denied in the browser.' });
      else if (status.state === 'expired') setPhase({ kind: 'ended', message: 'The code expired before it was approved.' });
      else if (status.state === 'error') setPhase({ kind: 'ended', message: status.message });
    });

    setPhase({ kind: 'starting' });
    startDeviceLogin()
      .then((started) => {
        if (!active) return;
        setPhase({
          kind: 'waiting',
          userCode: started.userCode,
          expiresAtMs: new Date(started.expiresAt).getTime(),
          notice: '',
        });
      })
      .catch((error) => {
        if (active) setPhase({ kind: 'ended', message: cleanIpcError(error) });
      });

    return () => {
      active = false;
      unsubscribe();
      cancelDeviceLogin();
    };
    // `attempt` restarts the flow with a new code.
  }, [attempt]);

  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

  const retry = () => setAttempt((value) => value + 1);

  return (
    <div className="space-y-6 text-center">
      {phase.kind === 'starting' && (
        <div className="flex items-center justify-center gap-2 text-sm text-textMuted py-6">
          <Loader2 size={16} className="animate-spin" /> Preparing a sign-in code
        </div>
      )}

      {phase.kind === 'waiting' && (
        <>
          <p className="text-sm text-textMuted leading-relaxed">
            Enter this code in your browser to approve sign-in on this device.
          </p>
          <div className="font-mono text-3xl font-bold tracking-[0.3em] text-white bg-background border border-border rounded-xl py-4 select-all">
            {phase.userCode}
          </div>
          <p className="text-xs text-textMuted">
            Expires in {formatRemaining(phase.expiresAtMs - now)}
          </p>
          {phase.notice && (
            <p className="text-xs text-yellow-200 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2">{phase.notice}</p>
          )}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => reopenDeviceLogin().catch((error) => setPhase({ kind: 'ended', message: cleanIpcError(error) }))}
              className="w-full py-2.5 bg-primary text-background font-semibold rounded-lg hover:bg-primary/95 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Monitor size={16} /> Open browser again
            </button>
            <button onClick={retry} className="text-xs text-textMuted hover:text-textMain cursor-pointer">
              Get a new code
            </button>
          </div>
        </>
      )}

      {phase.kind === 'finishing' && (
        <div className="flex items-center justify-center gap-2 text-sm text-textMuted py-6">
          <Loader2 size={16} className="animate-spin" /> Signing you in
        </div>
      )}

      {phase.kind === 'ended' && (
        <div className="space-y-4">
          <div className="p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs leading-relaxed">{phase.message}</div>
          <button
            onClick={retry}
            className="w-full py-2.5 bg-primary text-background font-semibold rounded-lg hover:bg-primary/95 transition cursor-pointer flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
