const net = require('net');
const {
  HINT,
  assessConnectivity,
  classifyInterfaces,
  ipInCidr,
  isPrivateIPv4,
  looksLikeVpnInterface,
  probeTcp,
  registerNetworkAwarenessIpc,
} = require('./networkAwareness');

const macInterfaces = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' }],
  en0: [
    { address: '192.168.1.20', family: 'IPv4', internal: false, cidr: '192.168.1.20/24' },
    { address: 'fe80::1', family: 'IPv6', internal: false, cidr: 'fe80::1/64' },
  ],
  utun6: [{ address: '10.88.0.10', family: 'IPv4', internal: false, cidr: '10.88.0.10/24' }],
};

const noVpnInterfaces = { en0: macInterfaces.en0, lo0: macInterfaces.lo0 };
const otherVpnInterfaces = {
  en0: macInterfaces.en0,
  utun9: [{ address: '10.99.0.51', family: 'IPv4', internal: false, cidr: '10.99.0.51/24' }],
};

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end());
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

const unreachableProbe = async () => ({ reachable: false, latencyMs: 5, error: 'ETIMEDOUT' });

describe('ipInCidr / isPrivateIPv4', () => {
  test('matches addresses inside a CIDR and rejects outside', () => {
    expect(ipInCidr('10.88.0.12', '10.88.0.10/24')).toBe(true);
    expect(ipInCidr('10.88.1.12', '10.88.0.10/24')).toBe(false);
    expect(ipInCidr('10.88.0.12', '10.88.0.12')).toBe(true); // bare host = /32
    expect(ipInCidr('10.88.0.13', '10.88.0.12/32')).toBe(false);
    expect(ipInCidr('bad', '10.0.0.0/8')).toBe(false);
  });

  test('classifies RFC1918, CGNAT and link-local as private', () => {
    expect(isPrivateIPv4('10.88.0.12')).toBe(true);
    expect(isPrivateIPv4('172.20.32.25')).toBe(true);
    expect(isPrivateIPv4('192.168.1.1')).toBe(true);
    expect(isPrivateIPv4('100.100.1.1')).toBe(true);
    expect(isPrivateIPv4('38.47.180.2')).toBe(false);
  });
});

describe('classifyInterfaces', () => {
  test('keeps external IPv4 only and flags tunnel-style names as VPN', () => {
    const { all, vpn } = classifyInterfaces(macInterfaces);
    expect(all.map((i) => i.name)).toEqual(['en0', 'utun6']);
    expect(vpn).toEqual([{ name: 'utun6', address: '10.88.0.10', cidr: '10.88.0.10/24', netmask: null }]);
  });

  test('recognises Windows and Linux VPN interface names', () => {
    expect(looksLikeVpnInterface('WireGuard Tunnel')).toBe(true);
    expect(looksLikeVpnInterface('wg0')).toBe(true);
    expect(looksLikeVpnInterface('tun0')).toBe(true);
    expect(looksLikeVpnInterface('Ethernet')).toBe(false);
    expect(looksLikeVpnInterface('en0')).toBe(false);
  });
});

describe('probeTcp', () => {
  test('reports a listening port as reachable with a latency', async () => {
    const server = await listen();
    try {
      const result = await probeTcp('127.0.0.1', server.address().port, 2000);
      expect(result.reachable).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeNull();
    } finally {
      await closeServer(server);
    }
  });

  test('reports a closed port as unreachable with the socket error', async () => {
    const server = await listen();
    const { port } = server.address();
    await closeServer(server);
    const result = await probeTcp('127.0.0.1', port, 2000);
    expect(result.reachable).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });
});

describe('assessConnectivity', () => {
  test('rejects a missing host or invalid port', async () => {
    await expect(assessConnectivity({ host: '', port: 22 })).rejects.toThrow(/host and a TCP port/);
    await expect(assessConnectivity({ host: '10.0.0.1', port: 0 })).rejects.toThrow(/host and a TCP port/);
  });

  test('reachable target yields the reachable hint and VPN details', async () => {
    const server = await listen();
    try {
      const info = await assessConnectivity({ host: '127.0.0.1', port: server.address().port, interfaces: macInterfaces });
      expect(info.hint).toBe(HINT.REACHABLE);
      expect(info.target.reachable).toBe(true);
      expect(info.target.latencyMs).toBeGreaterThanOrEqual(0);
      expect(info.vpn.active).toBe(true);
      expect(info.vpn.interfaces[0].name).toBe('utun6');
      expect(typeof info.checkedAt).toBe('string');
    } finally {
      await closeServer(server);
    }
  });

  test('private target, no VPN interface -> vpn_required', async () => {
    const info = await assessConnectivity({ host: '10.88.0.12', port: 22, interfaces: noVpnInterfaces, probe: unreachableProbe });
    expect(info.hint).toBe(HINT.VPN_REQUIRED);
    expect(info.vpn.active).toBe(false);
    expect(info.target.privateAddress).toBe(true);
    expect(info.target.error).toBe('ETIMEDOUT');
  });

  test('private target, VPN up but subnet does not cover it -> vpn_route_missing', async () => {
    const info = await assessConnectivity({ host: '10.88.0.12', port: 22, interfaces: otherVpnInterfaces, probe: unreachableProbe });
    expect(info.hint).toBe(HINT.VPN_ROUTE_MISSING);
    expect(info.target.viaVpnInterface).toBeNull();
  });

  test('private target, VPN subnet covers it but still down -> unreachable', async () => {
    const info = await assessConnectivity({ host: '10.88.0.12', port: 22, interfaces: macInterfaces, probe: unreachableProbe });
    expect(info.hint).toBe(HINT.UNREACHABLE);
    expect(info.target.viaVpnInterface).toBe('utun6');
  });

  test('public target that is down -> unreachable, never a VPN hint', async () => {
    const info = await assessConnectivity({ host: '38.47.180.2', port: 21522, interfaces: noVpnInterfaces, probe: unreachableProbe });
    expect(info.hint).toBe(HINT.UNREACHABLE);
    expect(info.target.privateAddress).toBe(false);
  });

  test('DNS failure -> dns_failed without probing', async () => {
    const probe = jest.fn();
    const lookup = (_host, _opts, cb) => cb(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }));
    const info = await assessConnectivity({ host: 'no-such-host.invalid', port: 22, interfaces: macInterfaces, lookup, probe });
    expect(info.hint).toBe(HINT.DNS_FAILED);
    expect(info.target.address).toBeNull();
    expect(info.target.error).toBe('ENOTFOUND');
    expect(probe).not.toHaveBeenCalled();
  });

  test('resolves hostnames through the injected lookup before probing', async () => {
    const probe = jest.fn(async () => ({ reachable: true, latencyMs: 3, error: null }));
    const lookup = (_host, _opts, cb) => cb(null, '10.88.0.12');
    const info = await assessConnectivity({ host: 'vm105.internal', port: 22, interfaces: macInterfaces, lookup, probe });
    expect(probe).toHaveBeenCalledWith('10.88.0.12', 22, expect.any(Number));
    expect(info.target.address).toBe('10.88.0.12');
    expect(info.target.viaVpnInterface).toBe('utun6');
    expect(info.hint).toBe(HINT.REACHABLE);
  });
});

describe('registerNetworkAwarenessIpc', () => {
  test('registers a network-assess handler that validates and assesses', async () => {
    const handlers = new Map();
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
    registerNetworkAwarenessIpc(ipcMain);
    const handler = handlers.get('network-assess');
    expect(typeof handler).toBe('function');

    const server = await listen();
    try {
      const info = await handler({}, { host: ' 127.0.0.1 ', port: String(server.address().port) });
      expect(info.hint).toBe(HINT.REACHABLE);
      expect(info.target.host).toBe('127.0.0.1');
    } finally {
      await closeServer(server);
    }

    await expect(handler({}, { host: 42, port: 22 })).rejects.toThrow(/host and a TCP port/);
  });
});
