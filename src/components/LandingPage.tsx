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

  return (
    <div className="min-h-screen bg-background text-textMain overflow-auto">
      <header className="h-16 border-b border-border bg-surface/80 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center">
            <Terminal size={20} />
          </div>
          <span className="font-semibold text-white">Ant Tech Async</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/login"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/login');
            }}
            className="px-3 py-2 text-sm text-textMuted hover:text-white"
          >
            Login
          </a>
          <a
            href="/register"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/register');
            }}
            className="px-3 py-2 text-sm rounded-md bg-primary text-background font-medium hover:bg-primary/90"
          >
            Register
          </a>
        </div>
      </header>

      <main>
        <section className="min-h-[calc(100vh-64px)] flex items-center border-b border-border">
          <div className="w-full max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-border text-xs text-textMuted mb-5">
                <Monitor size={14} />
                Web + Electron desktop SSH/SFTP/FTP client
              </div>
              <h1 className="text-5xl font-bold text-white leading-tight tracking-normal">Ant Tech Async</h1>
              <p className="mt-5 text-lg text-textMuted leading-8 max-w-2xl">
                Manage Linux and Windows servers with multiple SSH tabs, integrated SFTP/FTP file management, private key authentication, and browser preview mode.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="/login"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate('/login');
                  }}
                  className="px-5 py-3 rounded-md bg-primary text-background font-semibold inline-flex items-center gap-2 hover:bg-primary/90"
                >
                  Get Started <ArrowRight size={18} />
                </a>
                <a
                  href="/register"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate('/register');
                  }}
                  className="px-5 py-3 rounded-md border border-border text-white hover:bg-white/5"
                >
                  Create Account
                </a>
              </div>
            </div>

            <div className="border border-border bg-surface rounded-lg overflow-hidden shadow-2xl">
              <div className="h-11 border-b border-border flex items-center px-4 gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                <span className="ml-3 text-xs text-textMuted">ssh root@production</span>
              </div>
              <div className="grid grid-cols-[1fr_220px] min-h-[320px]">
                <div className="bg-black p-5 font-mono text-sm text-green-300 leading-7">
                  <div>$ uptime</div>
                  <div>12:42:18 up 48 days, 3 users</div>
                  <div>$ tail -f /var/log/app.log</div>
                  <div className="text-textMuted">worker started, queue healthy</div>
                  <div className="text-primary">multi-session tab active</div>
                </div>
                <div className="border-l border-border p-4 text-xs">
                  <div className="text-white font-medium mb-3">/var/www</div>
                  {['app', 'logs', 'releases', '.env', 'backup.zip'].map((item) => (
                    <div key={item} className="py-2 border-b border-border text-textMuted">{item}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-semibold text-white">Core Features</h2>
          <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map(([title, description, Icon]) => (
              <div key={title} className="border border-border rounded-lg p-5 bg-surface/60">
                <Icon size={22} className="text-primary mb-4" />
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm text-textMuted leading-6">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-surface/40">
          <div className="max-w-6xl mx-auto px-6 py-14 grid lg:grid-cols-2 gap-8">
            <div>
              <ShieldCheck className="text-primary mb-4" size={26} />
              <h2 className="text-2xl font-semibold text-white">Security Controls</h2>
              <p className="mt-3 text-textMuted leading-7">Credentials are separated from host metadata and protected by encrypted vault or OS secure storage where available.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {['Encrypted credential storage', 'HttpOnly session cookie', 'Admin approval', 'Turnstile protection'].map((item) => (
                <div key={item} className="border border-border rounded-md px-4 py-3 text-white bg-background/50">{item}</div>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="flex items-center gap-3 mb-6">
            <Workflow className="text-primary" size={24} />
            <h2 className="text-2xl font-semibold text-white">How It Works</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {['Create an account and wait for admin approval.', 'Add hosts and choose password, keychain, or one-time private key auth.', 'Open multiple SSH terminals and manage files through SFTP/FTP panels.'].map((step, index) => (
              <div key={step} className="border border-border rounded-lg p-5 bg-surface/60">
                <div className="text-primary text-sm font-semibold">Step {index + 1}</div>
                <p className="mt-3 text-sm text-textMuted leading-6">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-6 text-xs text-textMuted flex flex-col gap-2 sm:flex-row sm:justify-between">
        <span>Ant Tech Async</span>
        <span>SSH/SFTP/FTP for desktop and browser preview</span>
      </footer>
    </div>
  );
}
