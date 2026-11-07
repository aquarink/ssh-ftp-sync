import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api } from '../lib/api';

// The emailed link lands here. The token is sent once per page load; a React
// StrictMode double mount must not spend the single-use link twice, so the
// attempt is remembered for the lifetime of the page.
const attempted = new Set<string>();

type State = { kind: 'working' } | { kind: 'done'; message: string } | { kind: 'failed'; message: string };

export function VerifyEmailPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState<State>(() => (token ? { kind: 'working' } : { kind: 'failed', message: 'This page needs the link from your email.' }));

  useEffect(() => {
    if (!token || attempted.has(token)) return;
    attempted.add(token);
    api.verifyEmail(token)
      .then((result) => setState({ kind: 'done', message: result.message }))
      .catch((error) => setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }));
  }, [token]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background text-textMain font-sans p-6">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl p-8 space-y-6 text-center">
        {state.kind === 'working' && (
          <div className="flex items-center justify-center gap-2 text-sm text-textMuted py-6">
            <Loader2 size={16} className="animate-spin" /> Verifying your email
          </div>
        )}
        {state.kind === 'done' && (
          <>
            <CheckCircle2 size={40} className="text-green-400 mx-auto" />
            <p className="text-white font-semibold">Email verified</p>
            <p className="text-sm text-textMuted">{state.message}</p>
          </>
        )}
        {state.kind === 'failed' && (
          <>
            <XCircle size={40} className="text-red-400 mx-auto" />
            <p className="text-white font-semibold">Could not verify</p>
            <p className="text-sm text-textMuted">{state.message}</p>
          </>
        )}
        <button
          onClick={() => onNavigate('/login')}
          className="w-full py-2.5 bg-primary text-background font-semibold rounded-lg hover:bg-primary/95 transition cursor-pointer"
        >
          Go to sign in
        </button>
      </div>
    </div>
  );
}
