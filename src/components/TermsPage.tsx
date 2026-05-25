import { Terminal, ArrowLeft } from 'lucide-react';
import { User } from '../lib/api';

interface TermsPageProps {
  onNavigate: (path: string) => void;
  session: { user: User } | null;
}

export function TermsPage({ onNavigate, session }: TermsPageProps) {
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
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Terms & Conditions</h1>
            <p className="text-xs text-textMuted mt-2">Last Updated: May 2026 • Version: 2026-05</p>
          </div>

          <div className="space-y-8 text-sm leading-relaxed text-textMain">
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">1.</span> Experimental Software Notice
              </h2>
              <p>
                Ant Tech Async is an experimental, research-guided secure remote operations platform. It is currently in a research and development stage. The application is provided "as is" and "as available" without any warranty of any kind, either express or implied, including but not limited to the implied warranties of merchantability and fitness for a particular purpose.
              </p>
              <p className="text-textMuted">
                We make no guarantees of uninterrupted service, absolute availability, or that any specific feature will remain unchanged or available in future versions.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">2.</span> User Responsibility & Authorization
              </h2>
              <p>
                You represent and warrant that you own or have explicit authorization to access the remote servers, credentials, and network infrastructure that you register or connect to through the platform. 
              </p>
              <p>
                You are solely responsible for the configuration of hosts, network connectivity, and the credentials/private keys you upload or resolve through the platform. You must ensure that your use of the software complies with all local, national, and international laws, as well as the policies of the host network provider.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">3.</span> Credential Handling & Vault Security
              </h2>
              <p>
                Ant Tech Async implements advanced security layers, including a scoped Smart Identity Engine, secure vault storage, and key isolation lifecycles (which attempt to clear decrypted credentials from memory immediately after connection).
              </p>
              <p className="text-textMuted font-medium">
                Important Security Disclaimer: While these mechanisms are designed to minimize exposure, no software, memory layout, or crypto implementation can guarantee absolute protection against all types of side-channel, memory extraction, or advanced persistent threat (APT) attacks. You remain responsible for maintaining the operational security of your host keys and vault master secrets.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">4.</span> Prohibited Activities
              </h2>
              <p>You agree not to use the platform to perform or facilitate any of the following activities:</p>
              <ul className="list-disc list-inside pl-4 space-y-2 text-textMuted">
                <li>Attempting unauthorized access to any infrastructure or target systems.</li>
                <li>Conducting security scanning, port discovery, vulnerability assessments, or DDoS attacks through the platform's browser relay.</li>
                <li>Hosting, distributing, or executing malware, spyware, or credential theft tools.</li>
                <li>Collapsing or intentionally bypassing trust boundaries (such as attempting cross-user identity reuse or renderer-side spoofing).</li>
                <li>Any other illegal activity under applicable local or international laws.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">5.</span> Session Monitoring & Logging Disclosure
              </h2>
              <p>
                For security validation, rate limiting, and operational governance, the platform records metadata-only logs (e.g. user ID, host ID, runtime mode, connection timestamps, and authorization metrics). 
              </p>
              <p className="text-textMuted">
                Raw terminal keystrokes, commands executed on the target host, and sensitive credential materials (such as private keys or passwords) are explicitly excluded from logs and are not intentionally captured.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">6.</span> Future Architecture & Local Bridge disclaimer
              </h2>
              <p>
                Future releases may introduce experimental zero-trust overlay networking, VPN orchestration (such as WireGuard or Tailscale), or localhost reverse tunnels. 
              </p>
              <p>
                You acknowledge that using the Local Secure Bridge to connect to localhost (127.0.0.1) requires explicit local daemon execution on your client machine. The local bridge is strictly restricted to loopback-only destinations when active to prevent open-proxy vulnerabilities.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">7.</span> Limitation of Liability
              </h2>
              <p className="text-textMuted uppercase text-xs tracking-wider font-semibold border-l-2 border-primary/30 pl-4 py-1">
                In no event shall the authors, operators, or contributors of Ant Tech Async be liable for any claims, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software, the use of the software, or any credential compromise, target system downtime, or data loss. Use the software entirely at your own risk.
              </p>
            </section>

            <section className="space-y-3 border-t border-border/60 pt-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="text-primary">8.</span> Account Suspension
              </h2>
              <p>
                The administrators of self-hosted nodes reserve the right to suspend, terminate, or deny approval for any account suspected of malicious behavior, abuse of resources, or violating these Terms & Conditions.
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
