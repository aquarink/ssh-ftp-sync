const dns = require('dns');
const net = require('net');
const os = require('os');

/**
 * Runtime network awareness for the Electron runtime.
 *
 * A browser cannot see network interfaces or routes, which is why the browser
 * runtime relies on the relay as a bastion inside the VPN. The Electron runtime
 * has a Node main process and can observe both: whether a VPN-style tunnel
 * interface is up, and whether the SSH target accepts a TCP connection at all.
 * Nothing here creates or changes network state (no TUN devices, no routes, no
 * elevated privileges); it only observes and explains, so a failed connect can
 * say "no VPN interface is active" instead of a bare timeout.
 *
 * Kept free of `electron` imports so it can be unit tested with plain Node;
 * `registerNetworkAwarenessIpc(ipcMain)` wires it into the main process.
 */

const DEFAULT_PROBE_TIMEOUT_MS = Number(process.env.NETWORK_PROBE_TIMEOUT_MS || 4000);
const MIN_PROBE_TIMEOUT_MS = 250;
const MAX_PROBE_TIMEOUT_MS = 15000;

// Interface names used by tunnel/VPN drivers across platforms.
const VPN_INTERFACE_NAME = /^(utun|wg|tun|tap|ppp|ipsec|tailscale|zt|nordlynx|proton)/i;
const VPN_INTERFACE_WORDS = /(wireguard|tunnel|vpn|tap-windows|openvpn|tailscale)/i;

const HINT = Object.freeze({
  REACHABLE: 'reachable',
  UNREACHABLE: 'unreachable',
  VPN_REQUIRED: 'vpn_required',
  VPN_ROUTE_MISSING: 'vpn_route_missing',
  DNS_FAILED: 'dns_failed',
});

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value * 256) + n;
  }
  return value;
}

function ipInCidr(ip, cidr) {
  if (!ip || !cidr) return false;
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

function isPrivateIPv4(ip) {
  return ipInCidr(ip, '10.0.0.0/8')
    || ipInCidr(ip, '172.16.0.0/12')
    || ipInCidr(ip, '192.168.0.0/16')
    || ipInCidr(ip, '100.64.0.0/10') // CGNAT range, also used by Tailscale
    || ipInCidr(ip, '169.254.0.0/16');
}

function looksLikeVpnInterface(name) {
  return VPN_INTERFACE_NAME.test(name) || VPN_INTERFACE_WORDS.test(name);
}

/**
 * Split the host's IPv4 interfaces into "all external" and "looks like a VPN".
 * `interfaces` defaults to os.networkInterfaces() and can be injected for tests.
 */
function classifyInterfaces(interfaces = os.networkInterfaces()) {
  const all = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      all.push({
        name,
        address: entry.address,
        cidr: entry.cidr || null,
        netmask: entry.netmask || null,
      });
    }
  }
  const vpn = all.filter((iface) => looksLikeVpnInterface(iface.name));
  return { all, vpn };
}

function findVpnInterfaceFor(targetIp, vpnInterfaces) {
  return (vpnInterfaces || []).find((iface) => iface.cidr && ipInCidr(targetIp, iface.cidr)) || null;
}

function resolveHost(host, lookup = dns.lookup) {
  return new Promise((resolve) => {
    if (net.isIP(host)) {
      resolve({ address: host, error: null });
      return;
    }
    lookup(host, { family: 4 }, (error, address) => {
      if (error) resolve({ address: null, error: error.code || error.message });
      else resolve({ address, error: null });
    });
  });
}

/** Plain TCP connect probe. Resolves (never rejects) with reachability + latency. */
function probeTcp(address, port, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const socket = new net.Socket();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ reachable: true, latencyMs: Date.now() - startedAt, error: null }));
    socket.once('timeout', () => finish({ reachable: false, latencyMs: Date.now() - startedAt, error: 'ETIMEDOUT' }));
    socket.once('error', (error) => finish({ reachable: false, latencyMs: Date.now() - startedAt, error: error.code || error.message }));
    socket.connect({ host: address, port });
  });
}

function hintFor({ reachable, dnsError, targetAddress, vpnActive, viaVpn }) {
  if (dnsError) return HINT.DNS_FAILED;
  if (reachable) return HINT.REACHABLE;
  if (targetAddress && isPrivateIPv4(targetAddress)) {
    if (!vpnActive) return HINT.VPN_REQUIRED;
    if (!viaVpn) return HINT.VPN_ROUTE_MISSING;
  }
  return HINT.UNREACHABLE;
}

/**
 * Observe VPN state and probe the target. `interfaces`, `lookup` and `probe` are
 * injectable so the decision logic can be tested without touching the network.
 */
async function assessConnectivity({
  host,
  port,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  interfaces,
  lookup,
  probe = probeTcp,
} = {}) {
  const checkedAt = new Date().toISOString();
  const safePort = Number(port);
  if (!host || typeof host !== 'string' || !Number.isInteger(safePort) || safePort < 1 || safePort > 65535) {
    throw new Error('A host and a TCP port (1-65535) are required');
  }
  const boundedTimeout = Math.min(
    Math.max(Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS, MIN_PROBE_TIMEOUT_MS),
    MAX_PROBE_TIMEOUT_MS
  );

  const { vpn, all } = classifyInterfaces(interfaces);
  const resolved = await resolveHost(host, lookup);
  let result = { reachable: false, latencyMs: null, error: resolved.error };
  if (resolved.address) result = await probe(resolved.address, safePort, boundedTimeout);

  const viaVpnInterface = resolved.address ? findVpnInterfaceFor(resolved.address, vpn) : null;
  const hint = hintFor({
    reachable: result.reachable,
    dnsError: resolved.error,
    targetAddress: resolved.address,
    vpnActive: vpn.length > 0,
    viaVpn: Boolean(viaVpnInterface),
  });

  return {
    checkedAt,
    vpn: { active: vpn.length > 0, interfaces: vpn },
    interfaceCount: all.length,
    target: {
      host,
      port: safePort,
      address: resolved.address,
      privateAddress: resolved.address ? isPrivateIPv4(resolved.address) : false,
      reachable: Boolean(result.reachable),
      latencyMs: result.reachable ? result.latencyMs : null,
      error: result.error || null,
      viaVpnInterface: viaVpnInterface ? viaVpnInterface.name : null,
    },
    hint,
  };
}

/** Wire the read-only `network-assess` channel into an Electron ipcMain. */
function registerNetworkAwarenessIpc(ipcMain) {
  ipcMain.handle('network-assess', async (_event, payload = {}) => {
    const host = typeof payload.host === 'string' ? payload.host.trim() : '';
    const port = Number(payload.port) || 22;
    return assessConnectivity({ host, port, timeoutMs: payload.timeoutMs });
  });
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  HINT,
  assessConnectivity,
  classifyInterfaces,
  findVpnInterfaceFor,
  ipInCidr,
  isPrivateIPv4,
  looksLikeVpnInterface,
  probeTcp,
  registerNetworkAwarenessIpc,
};
