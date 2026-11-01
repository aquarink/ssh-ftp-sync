/**
 * Renderer-side view of the Electron runtime's network awareness
 * (see `electron/networkAwareness.js`). In the browser runtime nothing can be
 * observed, so every helper degrades to "unknown" and the UI simply shows less.
 */

export type ConnectivityHint =
  | 'reachable'
  | 'unreachable'
  | 'vpn_required'
  | 'vpn_route_missing'
  | 'dns_failed';

export interface VpnInterfaceInfo {
  name: string;
  address: string;
  cidr: string | null;
}

export interface ConnectivityAssessment {
  checkedAt: string;
  vpn: { active: boolean; interfaces: VpnInterfaceInfo[] };
  interfaceCount: number;
  target: {
    host: string;
    port: number;
    address: string | null;
    privateAddress: boolean;
    reachable: boolean;
    latencyMs: number | null;
    error: string | null;
    viaVpnInterface: string | null;
  };
  hint: ConnectivityHint;
}

export function canAssessConnectivity(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ipcRenderer);
}

/** Ask the Electron main process to observe VPN state and probe the target. */
export async function assessConnectivity(host: string, port: number): Promise<ConnectivityAssessment | null> {
  if (!canAssessConnectivity()) return null;
  try {
    return await window.ipcRenderer.invoke<ConnectivityAssessment>('network-assess', { host, port });
  } catch {
    return null;
  }
}

export function describeVpn(info: ConnectivityAssessment): string {
  if (!info.vpn.active) return 'No VPN interface detected';
  const names = info.vpn.interfaces.slice(0, 2).map((iface) => `${iface.name} ${iface.address}`).join(', ');
  const more = info.vpn.interfaces.length > 2 ? ` +${info.vpn.interfaces.length - 2}` : '';
  return `VPN active: ${names}${more}`;
}

export function describeTarget(info: ConnectivityAssessment): string {
  const { target } = info;
  const where = `${target.address || target.host}:${target.port}`;
  if (info.hint === 'dns_failed') return `${target.host} could not be resolved`;
  if (target.reachable) {
    const via = target.viaVpnInterface ? ` via ${target.viaVpnInterface}` : '';
    return `${where} reachable${target.latencyMs !== null ? ` (${target.latencyMs} ms)` : ''}${via}`;
  }
  return `${where} unreachable${target.error ? ` (${target.error})` : ''}`;
}

export type SshTransport = 'direct' | 'relay';

/**
 * Which path a terminal uses. The browser has exactly one: the relay. The
 * desktop runtime prefers a direct ssh2 connection from this computer and falls
 * back to the hosted relay (a bastion inside the VPN) when the target is not
 * reachable directly; an inconclusive check keeps the desktop default.
 */
export function chooseTransport(info: ConnectivityAssessment | null): SshTransport {
  if (!canAssessConnectivity()) return 'relay';
  if (!info) return 'direct';
  return info.target.reachable ? 'direct' : 'relay';
}

export function describeTransport(transport: SshTransport, info?: ConnectivityAssessment | null): string {
  if (transport === 'direct') return 'Direct SSH from this computer';
  if (canAssessConnectivity() && info && !info.target.reachable) {
    return 'Via relay: target not reachable directly from this computer';
  }
  return 'Via relay';
}

/** Hint-specific advice for a failed connect; null when there is nothing to add. */
export function adviceFor(info: ConnectivityAssessment): string | null {
  switch (info.hint) {
    case 'vpn_required':
      return 'The target is a private address and no VPN interface is active. Connect your VPN (for example WireGuard), then Reconnect.';
    case 'vpn_route_missing':
      return 'A VPN is up but its subnet does not include the target. Check the tunnel\'s AllowedIPs / routes, then Reconnect.';
    case 'dns_failed':
      return 'The host name could not be resolved. Check the host name or your DNS.';
    case 'unreachable':
      return 'The target did not accept a TCP connection on this port. Check the host, port and firewall.';
    default:
      return null;
  }
}
