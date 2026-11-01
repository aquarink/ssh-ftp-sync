import { Terminal, ArrowLeft } from 'lucide-react';
import { User } from '../lib/api';

interface PrivacyPageProps {
  onNavigate: (path: string) => void;
  session: { user: User } | null;
}

export function PrivacyPage({ onNavigate, session }: PrivacyPageProps) {
  const handleBack = () => {
    if (session) {
      onNavigate('/app');
    } else {
      onNavigate('/');
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-textMain selection:bg-primary/30 selection:text-white font-sans">
      {/* Decorative gradient blur background */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(88,166,255,0.15),_transparent_45%),linear-gradient(180deg,_rgba(13,17,23,0.95),_rgba(13,17,23,1))]" />
      <div className="pointer-events-none absolute inset-0 opacity-10 [background-image:linear-gradient(rgba(88,166,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(88,166,255,0.08)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />

      <header className="relative z-10 border-b border-border/80 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-lg shadow-primary/5">
              <Terminal size={20} />
            </div>
            <span className="font-bold text-white tracking-tight">Ant Tech Async</span>
          </div>
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-xs font-semibold text-textMuted hover:text-white transition cursor-pointer border border-border bg-surface/50 px-3.5 py-2 rounded-xl"
          >
            <ArrowLeft size={14} />
            Back to {session ? 'App' : 'Home'}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="bg-surface/60 backdrop-blur-md border border-border rounded-3xl p-6 sm:p-10 shadow-2xl">
          <div className="border-b border-border/60 pb-6 mb-8">
            <div className="text-xs uppercase tracking-[0.24em] text-primary/80 font-semibold mb-2">Legal Agreements</div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Privacy Policy</h1>
            <p className="text-xs text-textMuted mt-2">Last Updated: May 2026 • Version: 2026-05</p>
          </div>

          <div className="space-y-8 text-sm leading-relaxed text-textMain">
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">1.</span> What Data is Collected
              </h2>
              <p>
                As a secure remote operations platform, we minimize the data we store. However, to coordinate connections and provide the operational dashboard, we collect and process the following information:
              </p>
              <ul className="list-disc list-inside pl-4 space-y-2 text-textMuted">
                <li><strong>Account Information</strong>: Email addresses, hashed passwords, usernames, and account approval status.</li>
                <li><strong>Host Metadata</strong>: Host labels, IP addresses/hostnames, ports, and login usernames of remote systems.</li>
                <li><strong>Identity Metadata</strong>: Fingerprints, label names, and host assignment mappings of SSH credentials.</li>
                <li><strong>Session Metadata</strong>: Session identifiers, timestamps, and active state to sweep stale relays.</li>
                <li><strong>Security Event Logs</strong>: Hashed token logs, rate-limit triggers, and metadata-only access logs to block brute-force attacks.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">2.</span> What is NOT Collected
              </h2>
              <p>
                To maintain confidentiality of remote infrastructure sessions, the platform **does not collect or store**:
              </p>
              <ul className="list-disc list-inside pl-4 space-y-2 text-textMuted">
                <li><strong>Plaintext Secrets in Logs</strong>: Master keys, vault credentials, passwords, and private key content are stripped from all log outputs.</li>
                <li><strong>Terminal Content</strong>: Keystrokes, commands executed, and output streams are relayed in memory (through a WebSocket or local IPC bridge) and are never persisted or indexed.</li>
                <li><strong>Unscoped Keys</strong>: The application does not scan or search your user directory for default secure shell keys automatically.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">3.</span> Credential Storage & Encryption Disclosure
              </h2>
              <p>
                Credentials (passwords, private keys, certificates) are handled securely:
              </p>
              <ul className="list-disc list-inside pl-4 space-y-2 text-textMuted">
                <li><strong>Browser/Server Mode</strong>: Decrypted material resides in memory for the shortest possible connect window. At rest, secrets are encrypted in the `.credential-vault` directory using keys managed by the application.</li>
                <li><strong>Electron Desktop Mode</strong>: Secrets are stored in local secure storage managed by the OS (using Electron's `safeStorage`), separated per system user profile.</li>
                <li><strong>API Protection</strong>: API responses return metadata-only references (fingerprints). Raw secrets are never sent back to the renderer once saved.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">4.</span> Cookies & Session Management
              </h2>
              <p>
                We use secure `HttpOnly` and `SameSite=Lax` cookies (specifically `ats_session`) to verify your login session. 
              </p>
              <p className="text-textMuted">
                These cookies are strictly required for authentication and session management. We do not use third-party tracking, advertising cookies, or analytics scripts.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">5.</span> Third Parties & Infrastructure Providers
              </h2>
              <p>
                In standard self-hosted deployments:
              </p>
              <ul className="list-disc list-inside pl-4 space-y-2 text-textMuted">
                <li><strong>Cloudflare Turnstile</strong>: Used on login and registration pages to prevent automated bot registrations.</li>
                <li><strong>Email Verification</strong>: Accounts check signup emails via verification services (QuickEmailVerification) to prevent spam.</li>
                <li><strong>No Analytics Sharing</strong>: No analytics or user data is sent back to the developers of Ant Tech Async.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">6.</span> Security Limitations
              </h2>
              <p>
                We use state-of-the-art security patterns (smart identity engines, key isolation, memory wiping buffers). However, you acknowledge that no software, library, or memory layout can claim 100% security against client-side compromise or physical hardware attacks. 
              </p>
              <p className="text-textMuted font-medium">
                Protecting your local desktop, host systems, master vault keys, and local SSH daemon is your responsibility.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">7.</span> Data Retention & Rights
              </h2>
              <p>
                Host and identity records are retained until you delete them. Operational security logs and session records are retained on a self-hosted retention cycle. 
              </p>
              <p>
                <strong>Account Deletion</strong>: If you delete your account or request deletion, all associated host metadata, vault items, and active session tokens are wiped permanently from the local datastore.
              </p>
            </section>

            <section className="space-y-3 border-t border-border/60 pt-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">8.</span> Research Disclaimer
              </h2>
              <p className="text-xs text-textMuted">
                Ant Tech Async is an open-source development prototype inspired by academic security research papers. The developers are not affiliated with, sponsored by, or associated with the authors of the referenced academic papers (e.g. SSHkex, Practical Privacy-Preserving SSH, SSH3).
              </p>
            </section>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-border/80 bg-background/70 py-8 text-center text-xs text-textMuted">
        <p>© 2026 Ant Tech Async • Research-guided secure remote operations platform</p>
      </footer>
    </div>
  );
}
