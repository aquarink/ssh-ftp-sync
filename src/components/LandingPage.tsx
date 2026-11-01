import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  DatabaseZap,
  Fingerprint,
  GitBranch,
  KeyRound,
  Layers,
  LockKeyhole,
  Monitor,
  Server,
  ShieldCheck,
  Terminal,
  Users,
  Workflow,
} from 'lucide-react';

interface LandingPageProps {
  onNavigate: (path: string, options?: { reload?: boolean }) => void;
}

const architectureLayers = [
  {
    title: 'Smart Identity Engine',
    icon: KeyRound,
    description: 'Scoped identity resolution with host-bound selection and no auto-offer of all keys.',
    points: [
      'Selects only the identity assigned to the host or explicitly chosen by the user.',
      'Keeps identity metadata separate from secret material and session execution.',
      'Prepares the connection path for future federated identity workflows.',
    ],
  },
  {
    title: 'Secure Vault',
    icon: DatabaseZap,
    description: 'Encrypted credential storage with metadata-only APIs and redacted logging.',
    points: [
      'Keeps secrets encrypted at rest in browser/server and Electron-specific vaults.',
      'Returns fingerprints and metadata without exposing raw secret material.',
      'Maintains a clear browser vs Electron vault boundary.',
    ],
  },
  {
    title: 'Key Isolation',
    icon: LockKeyhole,
    description: 'Ephemeral credential lifecycles that resolve secrets only when the connect starts.',
    points: [
      'Uses resolve-then-connect and best-effort cleanup for every SSH/SFTP runtime flow.',
      'Keeps secrets out of long-lived session state and renderer state.',
      'Clears connection material after use instead of caching it for reuse.',
    ],
  },
  {
    title: 'Session Cleanup',
    icon: Workflow,
    description: 'Deterministic session lifecycle management with centralized cleanup orchestration.',
    points: [
      'Uses one teardown path for browser relay, Electron IPC, logout, reconnect, and shutdown.',
      'Sweeps stale sessions so abandoned connections do not linger.',
      'Keeps terminal and file-manager cleanup predictable and reconnect-safe.',
    ],
  },
  {
    title: 'Zero-Trust Access Layer',
    icon: ShieldCheck,
    description: 'Short-lived connect authorization that validates context before any SSH or SFTP connect.',
    points: [
      'Requires a one-time token scoped to user, host, runtime, purpose, and optional auth type.',
      'Validates browser relay requests before identity resolution and blocks direct hostId-only access.',
      'Treats reconnects as new authorization events with fresh tokens and metadata-only logs.',
    ],
  },
] as const;

const timeline = [
  { phase: '1.1', title: 'Smart Identity Engine' },
  { phase: '1.2', title: 'Secure Vault' },
  { phase: '1.3', title: 'Key Isolation' },
  { phase: '1.4', title: 'Session Cleanup' },
  { phase: '1.5', title: 'Zero-Trust Access Layer' },
  { phase: '4.0', title: 'Client Local Network Access' },
] as const;

const whyItems = [
  {
    title: 'Runtime isolation',
    description: 'Browser relay and Electron desktop are treated as different trust zones, not interchangeable shells.',
    icon: Layers,
  },
  {
    title: 'Lifecycle-aware credentials',
    description: 'Identity resolution, ephemeral material, and cleanup are all tied to the connection lifecycle.',
    icon: Fingerprint,
  },
  {
    title: 'Scoped identity access',
    description: 'The app does not auto-offer every key. It resolves only the identity that belongs to the host.',
    icon: BadgeCheck,
  },
  {
    title: 'Modern remote operations',
    description: 'Browser preview, desktop SSH, and file operations all share one architecture with clear boundaries.',
    icon: Server,
  },
] as const;

const runtimeComparison = [
  {
    title: 'Browser Runtime',
    icon: Monitor,
    items: [
      'Relay-only SSH access through the Node WebSocket boundary.',
      'No local agent or local filesystem identity capability.',
      'Token validation happens before identity resolution.',
    ],
  },
  {
    title: 'Electron Runtime',
    icon: Terminal,
    items: [
      'Higher-trust local runtime with IPC-based shell access.',
      'Local secure-storage capability remains scoped to the signed-in user session.',
      'Still requires short-lived connect authorization before SSH/SFTP connect.',
    ],
  },
] as const;

const researchTitles = [
  'Practical Privacy-Preserving Authentication for SSH',
  'On the Security of SSH Client Signatures',
  'SSHkex: Leveraging Virtual Machine Introspection for Extracting SSH Keys and Decrypting SSH Network Traffic',
  'Enabling Secure Shell Access with OpenID Connect',
  'Towards SSH3: how HTTP/3 improves secure shells',
  'ESX: A Self-Generated Control Policy for Remote Access With SSH Based on eBPF',
] as const;

const phase4Highlights = [
  {
    title: 'Browser Relay Guard',
    detail: 'Blocks localhost and private-LAN targets from remote backend context.',
  },
  {
    title: 'Electron Local Reachability',
    detail: 'Supports localhost, VM IP, LAN private IP, and VPN-reachable targets from user laptop.',
  },
  {
    title: 'Wildcard Target Rejection',
    detail: 'Rejects 0.0.0.0 and :: as invalid connection targets in all runtimes.',
  },
  {
    title: 'Approved Local Bridge',
    detail: 'Explicit approval, scoped short-lived session, deterministic cleanup, metadata-only logs.',
  },
] as const;

export function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-textMain selection:bg-primary/30 selection:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(88,166,255,0.18),_transparent_30%),radial-gradient(circle_at_right,_rgba(88,166,255,0.08),_transparent_28%),linear-gradient(180deg,_rgba(13,17,23,0.94),_rgba(13,17,23,1))]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(88,166,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(88,166,255,0.10)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 border-b border-primary/10 bg-gradient-to-b from-primary/10 to-transparent" />
      <div className="pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 top-72 h-96 w-96 rounded-full bg-primary/8 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/8 blur-3xl" />

      <header className="relative z-10 border-b border-border/80 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-lg shadow-primary/10">
              <Terminal size={19} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide text-white">Ant Tech Async</div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-textMuted">Secure remote operations</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="rounded-lg px-3 py-2 text-sm text-textMuted transition hover:bg-white/5 hover:text-white"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/register')}
              className="inline-flex items-center gap-2 rounded-lg border border-primary/25 bg-primary px-4 py-2 text-sm font-medium text-background transition hover:bg-primary/90"
            >
              Get started
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 lg:px-8 lg:pt-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-medium tracking-wide text-primary">
                <ShieldCheck size={14} />
                Matrix-style blue control plane
              </div>
              <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Hybrid SSH and SFTP runtime with explicit trust boundaries.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-textMuted sm:text-lg">
                Ant Tech Async is built as a browser-plus-desktop remote operations system, not just a terminal
                client. It separates identity selection, secret storage, runtime authorization, session cleanup, and
                connection execution so each layer stays scoped and auditable.
              </p>

              <div className="mt-6 max-w-2xl rounded-2xl border border-border bg-surface/70 p-4 text-sm leading-7 text-textMuted">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-primary/85">
                  <BadgeCheck size={14} />
                  Name note
                </div>
                <p className="mt-2">
                  Ant Tech Async is a playful working name for async remote operations. It is not intended as a
                  political statement or a reference to any foreign affiliation.
                </p>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('/register')}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-background transition hover:bg-primary/90"
                >
                  Create account
                  <ArrowRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/login')}
                  className="rounded-xl border border-border bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  Open dashboard
                </button>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Identity', 'Scoped and host-bound'],
                  ['Vault', 'Encrypted metadata-first storage'],
                  ['Session', 'Deterministic cleanup'],
                  ['Access', 'Short-lived authorization'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-border bg-surface/60 p-4 backdrop-blur-sm transition hover:border-primary/25 hover:bg-surface/80"
                  >
                    <div className="text-[11px] uppercase tracking-[0.24em] text-textMuted">{label}</div>
                    <div className="mt-2 text-sm font-medium text-textMain">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 rounded-[30px] bg-primary/10 blur-3xl" />
              <div className="relative overflow-hidden rounded-[30px] border border-border bg-surface/85 shadow-2xl shadow-black/30">
                <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                  <span className="h-3 w-3 rounded-full bg-red-400/90" />
                  <span className="h-3 w-3 rounded-full bg-amber-400/90" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400/90" />
                  <div className="ml-3 text-xs uppercase tracking-[0.24em] text-textMuted">
                    Command relay / runtime authorization
                  </div>
                </div>

                <div className="grid gap-3 border-b border-border bg-background/35 px-5 py-4 sm:grid-cols-3">
                  {[
                    ['Relay', 'Browser / Electron'],
                    ['Policy', 'Token checked before connect'],
                    ['Cleanup', 'Best-effort teardown'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-border bg-surface/70 p-3">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-textMuted">{label}</div>
                      <div className="mt-2 text-sm font-medium text-textMain">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 p-5">
                  {[
                    'auth session',
                    'request connect token',
                    'access policy validation',
                    'token issued',
                    'SSH/SFTP connect',
                    'token validation',
                    'identity resolve',
                    'ephemeral credential',
                    'session lifecycle',
                    'cleanup',
                    'token invalidated',
                  ].map((step, index) => (
                    <div
                      key={step}
                      className="flex items-center gap-4 rounded-2xl border border-border bg-background/55 px-4 py-3 transition hover:border-primary/25 hover:bg-surface/80"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-xs font-semibold text-primary">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div className="text-sm text-textMain">{step}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center gap-3">
            <GitBranch size={20} className="text-primary" />
            <div>
              <h2 className="text-2xl font-semibold text-white">Phase 1 Security Architecture</h2>
              <p className="mt-1 text-sm text-textMuted">
                Each layer is isolated so access, identity, secrets, and cleanup can evolve independently.
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {architectureLayers.map(({ title, icon: Icon, description, points }) => (
              <article
                key={title}
                className="group rounded-3xl border border-border bg-surface/60 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-surface/85"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                      <Icon size={20} />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
                  </div>
                  <div className="rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-textMuted">
                    Layer
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 text-textMuted">{description}</p>
                <ul className="mt-5 space-y-3">
                  {points.map((point) => (
                    <li key={point} className="flex gap-3 text-sm leading-6 text-textMuted">
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary/90" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
            <article className="rounded-[32px] border border-border bg-surface/60 p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <BadgeCheck className="text-primary" size={22} />
                <h2 className="text-2xl font-semibold text-white">Why Ant Tech Async?</h2>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-textMuted sm:text-base">
                Traditional SSH tools focus mainly on connectivity. Ant Tech Async focuses on runtime isolation,
                lifecycle-aware credential handling, scoped identity access, and hybrid browser/Electron security
                boundaries so remote operations stay explicit instead of implicit.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {whyItems.map(({ title, description, icon: Icon }) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-border bg-background/55 p-4 transition hover:border-primary/25 hover:bg-background/75"
                  >
                    <Icon size={18} className="text-primary" />
                    <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-textMuted">{description}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[32px] border border-border bg-surface/60 p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <Clock3 className="text-primary" size={22} />
                <h2 className="text-2xl font-semibold text-white">Browser vs Electron</h2>
              </div>
              <div className="mt-6 grid gap-4">
                {runtimeComparison.map(({ title, icon: Icon, items }) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-border bg-background/55 p-5 transition hover:border-primary/25 hover:bg-background/75"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon size={18} />
                      </div>
                      <h3 className="text-base font-semibold text-white">{title}</h3>
                    </div>
                    <ul className="mt-4 space-y-2">
                      {items.map((item) => (
                        <li key={item} className="flex gap-3 text-sm leading-6 text-textMuted">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary/80" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-border bg-surface/60 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Users className="text-primary" size={22} />
              <h2 className="text-2xl font-semibold text-white">Research Inspiration</h2>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-textMuted sm:text-base">
              The architecture is guided by remote-access and authentication research. The project does not claim
              affiliation with these works; it uses the titles below as design inspiration for scoped, runtime-aware,
              and privacy-conscious SSH handling.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {researchTitles.map((title) => (
                <span
                  key={title}
                  className="rounded-full border border-border bg-background/70 px-4 py-2 text-sm text-textMain transition hover:border-primary/25 hover:bg-background/90"
                >
                  {title}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {timeline.map(({ phase, title }) => (
              <div
                key={phase}
                className="rounded-2xl border border-border bg-surface/60 p-4 transition hover:border-primary/25 hover:bg-surface/85"
              >
                <div className="text-[11px] uppercase tracking-[0.24em] text-primary/80">{phase}</div>
                <div className="mt-2 text-sm font-medium text-white">{title}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6 rounded-2xl border border-primary/25 bg-primary/10 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-primary/90">
              <ShieldCheck size={14} />
              Phase 4
            </div>
            <h3 className="mt-2 text-lg font-semibold text-white sm:text-xl">Client Local Network Access</h3>
            <p className="mt-2 text-sm leading-7 text-textMuted sm:text-base">
              Browser relay blocks localhost and private LAN targets because they are local to the user's device, not
              the hosted backend server. Local and VPN-private connections are supported through Electron runtime and
              approved local bridge sessions with scoped short-lived authorization.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {phase4Highlights.map(({ title, detail }) => (
                <div
                  key={title}
                  className="rounded-xl border border-primary/20 bg-background/40 px-4 py-3"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/85">{title}</div>
                  <p className="mt-2 text-xs leading-6 text-textMuted sm:text-sm">{detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-primary/20 bg-gradient-to-r from-primary/10 via-surface/80 to-background/70 p-6 sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-primary/75">Operational model</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Hybrid remote access with scoped identity, runtime policy, and metadata-only governance.
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-textMuted sm:text-base">
                  Ant Tech Async keeps browser relay, Electron desktop, identity storage, secret resolution, session
                  lifecycle, and access authorization as separate concerns so the runtime can evolve toward a
                  zero-trust remote operations model without turning the application into a monolith.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/register')}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-background transition hover:bg-primary/90"
              >
                Start using Ant Tech Async
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/80 bg-background/70">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-xs text-textMuted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-white">Ant Tech Async</span>
            <span>Research-guided secure remote operations platform</span>
          </div>
          <div className="flex items-center gap-6">
            <button
              onClick={() => onNavigate('/terms')}
              className="hover:text-white transition cursor-pointer bg-transparent border-none p-0"
            >
              Terms & Conditions
            </button>
            <button
              onClick={() => onNavigate('/privacy')}
              className="hover:text-white transition cursor-pointer bg-transparent border-none p-0"
            >
              Privacy Policy
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
