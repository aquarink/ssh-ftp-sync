import { ArrowRight, DatabaseZap, KeyRound, Layers, Monitor, ShieldCheck, Terminal, Users, Workflow } from 'lucide-react';

interface LandingPageProps {
  onNavigate: (path: string, options?: { reload?: boolean }) => void;
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  const features = [
    ['Multi-tab SSH terminal', 'Open several independent SSH sessions without disconnecting the others.', Terminal],
    ['SFTP/FTP file manager', 'Browse, upload, edit, chmod, archive, extract, copy, move, and download files.', DatabaseZap],
    ['Secure keychain/private key auth', 'Use password, private keys, passphrases, and reusable per-host identities.', KeyRound],
    ['Cross-platform desktop app', 'Run the Electron desktop client on Linux and Windows with Node/Electron runtime.', Monitor],
    ['Browser preview mode', 'Use the same dashboard through the web relay when desktop is not available.', Layers],
    ['User/account management', 'Built-in sessions, admin approval, and account controls for managed teams.', Users],
  ] as const;
  const phases = [
    {
      code: '01',
      title: 'Smart Identity Engine',
      summary: 'Each host uses only the identity you assigned or explicitly selected.',
      detail: 'No auto-offer of every key. Browser and Electron follow separate runtime policies.',
    },
    {
      code: '02',
      title: 'Secure Vault',
      summary: 'Secrets stay encrypted at rest and hidden from API responses and logs.',
      detail: 'Browser/server vault and Electron secure storage stay separated by design.',
    },
    {
      code: '03',
      title: 'Key Isolation',
      summary: 'Secret material is resolved only when a connection is starting.',
      detail: 'Secret material stays out of long-lived session state, reconnect state, and renderer state.',
    },
    {
      code: '04',
      title: 'Session Cleanup',
      summary: 'SSH and SFTP sessions are torn down deterministically and safely.',
      detail: 'Cleanup is idempotent and session maps stay metadata-only.',
    },
    {
      code: '05',
      title: 'Zero-Trust Access',
      summary: 'Short-lived connect tokens gate access before SSH or SFTP starts.',
      detail: 'One-time authorization, scope checks, logout invalidation, and runtime-policy enforcement.',
    },
  ] as const;

  return (
    <div className="relative h-dvh overflow-y-auto overflow-x-hidden bg-[#050b08] text-textMain selection:bg-emerald-400/30 selection:text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-80"
        style={{
          backgroundImage: [
            'radial-gradient(circle at top left, rgba(74, 222, 128, 0.16), transparent 30%)',
            'radial-gradient(circle at top right, rgba(16, 185, 129, 0.12), transparent 28%)',
            'linear-gradient(to bottom, rgba(5, 11, 8, 0.35), rgba(5, 11, 8, 0.82))',
            'linear-gradient(rgba(34, 197, 94, 0.08) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(34, 197, 94, 0.08) 1px, transparent 1px)',
          ].join(', '),
          backgroundSize: '100% 100%, 100% 100%, 100% 100%, 32px 32px, 32px 32px',
          backgroundPosition: '0 0, 0 0, 0 0, 0 0, 0 0',
          maskImage: 'linear-gradient(to bottom, black 0%, black 72%, transparent 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.05]"
        style={{
          backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.8) 0px, rgba(255,255,255,0.8) 1px, transparent 3px, transparent 6px)',
        }}
      />
      <header className="relative z-10 h-16 border-b border-emerald-400/20 bg-black/40 backdrop-blur-md flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 flex items-center justify-center shadow-[0_0_24px_rgba(16,185,129,0.12)]">
            <Terminal size={20} />
          </div>
          <div className="leading-tight">
            <span className="block font-semibold tracking-[0.2em] text-emerald-200 uppercase text-xs">Ant Tech Async</span>
            <span className="block text-[11px] text-textMuted font-mono">secure shell relay online</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/8 text-[11px] text-emerald-200 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.8)]" />
            matrix link stable
          </span>
          <a
            href="/login"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/login');
            }}
            className="px-3 py-2 text-sm text-textMuted hover:text-emerald-200 transition-colors"
          >
            Login
          </a>
          <a
            href="/register"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/register');
            }}
            className="px-3 py-2 text-sm rounded-md border border-emerald-400/20 bg-emerald-400/10 text-emerald-100 font-medium hover:bg-emerald-400/15 hover:border-emerald-300/30 transition-colors"
          >
            Register
          </a>
        </div>
      </header>

      <main className="relative z-10">
        <section className="min-h-[calc(100vh-64px)] flex items-center border-b border-emerald-400/15">
          <div className="w-full max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-emerald-400/20 bg-black/35 text-xs text-emerald-200 mb-5 font-mono">
                <Monitor size={14} />
                web + electron shell access
              </div>
              <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight text-white">
                <span className="block text-emerald-200/95">Ant Tech</span>
                <span className="block bg-gradient-to-r from-emerald-300 via-teal-200 to-green-100 bg-clip-text text-transparent">Async</span>
              </h1>
              <p className="mt-5 text-lg text-textMuted leading-8 max-w-2xl">
                Manage Linux and Windows servers with multiple SSH tabs, integrated SFTP/FTP file management, private key authentication, browser relay, and desktop mode.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="/login"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate('/login');
                  }}
                  className="px-5 py-3 rounded-md bg-emerald-400 text-black font-semibold inline-flex items-center gap-2 hover:bg-emerald-300 transition-colors shadow-[0_0_30px_rgba(74,222,128,0.15)]"
                >
                  Get Started <ArrowRight size={18} />
                </a>
                <a
                  href="/register"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate('/register');
                  }}
                  className="px-5 py-3 rounded-md border border-emerald-400/20 text-emerald-100 hover:bg-emerald-400/8 transition-colors"
                >
                  Create Account
                </a>
              </div>
            </div>

            <div className="border border-emerald-400/20 bg-black/55 rounded-xl overflow-hidden shadow-[0_0_60px_rgba(16,185,129,0.08)] backdrop-blur-sm">
              <div className="h-11 border-b border-emerald-400/15 flex items-center px-4 gap-2 bg-emerald-400/5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/90" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/90" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/90" />
                <span className="ml-3 text-xs text-emerald-200/80 font-mono">ssh root@production</span>
                <span className="ml-auto text-[11px] text-textMuted font-mono">live relay</span>
              </div>
              <div className="grid grid-cols-[1fr_220px] min-h-[320px]">
                <div className="bg-[#030705] p-5 font-mono text-sm leading-7">
                  <div className="text-emerald-300">$ uptime</div>
                  <div className="text-emerald-100/85">12:42:18 up 48 days, 3 users</div>
                  <div className="mt-3 text-emerald-300">$ tail -f /var/log/app.log</div>
                  <div className="text-textMuted">worker started, queue healthy</div>
                  <div className="text-emerald-200">multi-session tab active</div>
                  <div className="mt-3 text-emerald-300">$ connect host --mode zero-trust</div>
                  <div className="text-textMuted">token issued, scope validated, shell opened</div>
                </div>
                <div className="border-l border-emerald-400/15 p-4 text-xs bg-black/35">
                  <div className="text-emerald-100 font-medium mb-3 font-mono">/var/www</div>
                  {['app', 'logs', 'releases', '.env', 'backup.zip'].map((item) => (
                    <div key={item} className="py-2 border-b border-emerald-400/10 text-textMuted font-mono">{item}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-emerald-400/20 bg-black/35 text-[11px] text-emerald-200 font-mono uppercase tracking-[0.18em] mb-4">
                implemented security stack
              </div>
              <h2 className="text-2xl md:text-3xl font-semibold text-emerald-100">What works in the app right now</h2>
            </div>
            <p className="max-w-xl text-sm md:text-base text-textMuted leading-7">
              The sections below show the working SSH workflow, the implemented security layers, and the next research milestones.
            </p>
          </div>
          <div className="mt-8 grid lg:grid-cols-2 gap-4">
            {phases.map((phase) => (
              <article key={phase.code} className="group border border-emerald-400/15 rounded-xl bg-black/35 hover:bg-black/45 transition-colors overflow-hidden">
                <div className="flex items-center justify-between gap-4 border-b border-emerald-400/10 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 font-mono text-sm flex items-center justify-center shadow-[0_0_18px_rgba(74,222,128,0.08)]">
                      {phase.code}
                    </div>
                  <div>
                    <h3 className="text-base font-semibold text-emerald-100">{phase.title}</h3>
                      <div className="text-[11px] text-textMuted font-mono uppercase tracking-[0.16em]">available now</div>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-[11px] text-emerald-200 font-mono border border-emerald-400/15 rounded-full px-3 py-1 bg-emerald-400/8">
                    implemented
                  </div>
                </div>
                <div className="px-5 py-4">
                  <p className="text-sm text-textMuted leading-6">{phase.summary}</p>
                  <p className="mt-3 text-sm text-emerald-100/80 leading-6 font-mono">{phase.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-emerald-400/20 bg-black/35 text-[11px] text-emerald-200 font-mono uppercase tracking-[0.18em] mb-6">
            current features
          </div>
          <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map(([title, description, Icon]) => (
              <div key={title} className="group border border-emerald-400/15 rounded-lg p-5 bg-black/35 hover:bg-black/45 transition-colors">
                <div className="w-10 h-10 rounded-md border border-emerald-400/15 bg-emerald-400/8 flex items-center justify-center text-emerald-300 mb-4 shadow-[0_0_20px_rgba(74,222,128,0.08)]">
                  <Icon size={22} />
                </div>
                <h3 className="text-sm font-semibold text-emerald-100">{title}</h3>
              <p className="mt-2 text-sm text-textMuted leading-6">{description}</p>
            </div>
          ))}
        </div>
        </section>

        <section className="border-y border-emerald-400/15 bg-black/25">
          <div className="max-w-6xl mx-auto px-6 py-14 grid lg:grid-cols-2 gap-8">
            <div>
              <ShieldCheck className="text-emerald-300 mb-4" size={26} />
              <h2 className="text-2xl font-semibold text-emerald-100">Security Controls</h2>
              <p className="mt-3 text-textMuted leading-7">Credentials are separated from host metadata and protected by encrypted vault or OS secure storage where available.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm font-mono">
              {['Encrypted credential storage', 'HttpOnly session cookie', 'Admin approval', 'Turnstile protection'].map((item) => (
                <div key={item} className="border border-emerald-400/15 rounded-md px-4 py-3 text-emerald-100 bg-black/35">{item}</div>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="flex items-center gap-3 mb-6">
            <Workflow className="text-emerald-300" size={24} />
            <h2 className="text-2xl font-semibold text-emerald-100">How It Works</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {['Create an account and wait for admin approval.', 'Add hosts and choose password, keychain, or one-time private key auth.', 'Open multiple SSH terminals and manage files through SFTP/FTP panels.'].map((step, index) => (
              <div key={step} className="border border-emerald-400/15 rounded-lg p-5 bg-black/35">
                <div className="text-emerald-300 text-sm font-semibold font-mono">Step {index + 1}</div>
                <p className="mt-3 text-sm text-textMuted leading-6">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-emerald-400/15 px-6 py-6 text-xs text-textMuted flex flex-col gap-2 sm:flex-row sm:justify-between bg-black/35 backdrop-blur-sm">
        <span>Ant Tech Async</span>
        <span>SSH/SFTP/FTP for desktop and browser preview</span>
      </footer>
    </div>
  );
}
