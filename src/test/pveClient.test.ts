import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLxcIp,
  extractQemuGuestAgentIp,
  mapPveResource,
  mergePveResources,
  normalizeApiUrl,
  PveClient,
  PveGetData,
  selectPreferredIp,
} from '../pveClient';
import { PveCluster, PveResource } from '../types';

const cluster: PveCluster = {
  id: 'cluster-1',
  name: 'Test cluster',
  apiUrl: 'https://pve.example.com:8006',
  tokenId: 'root@pam!test',
};

test('normalizeApiUrl appends the API path exactly once', () => {
  assert.equal(normalizeApiUrl('https://pve.example.com:8006'), 'https://pve.example.com:8006/api2/json');
  assert.equal(
    normalizeApiUrl('https://pve.example.com:8006/api2/json/'),
    'https://pve.example.com:8006/api2/json',
  );
});

test('normalizeApiUrl preserves a reverse proxy base path', () => {
  assert.equal(
    normalizeApiUrl('https://infra.example.com/proxmox/'),
    'https://infra.example.com/proxmox/api2/json',
  );
});

test('normalizeApiUrl rejects credentials and unsupported schemes', () => {
  assert.throws(() => normalizeApiUrl('ssh://pve.example.com'), /http/);
  assert.throws(() => normalizeApiUrl('https://root:secret@pve.example.com'), /帳號密碼/);
});

test('mapPveResource maps node, QEMU, and LXC records', () => {
  assert.deepEqual(mapPveResource('cluster-1', { type: 'node', node: 'pve1', status: 'online' }), {
    clusterId: 'cluster-1',
    type: 'node',
    node: 'pve1',
    vmid: undefined,
    name: 'pve1',
    status: 'online',
    tags: undefined,
    suggestedHostName: undefined,
  });

  assert.deepEqual(
    mapPveResource('cluster-1', {
      type: 'qemu',
      node: 'pve1',
      vmid: 101,
      name: 'web',
      status: 'running',
      tags: 'prod;linux',
      ip: '10.0.1.101',
    }),
    {
      clusterId: 'cluster-1',
      type: 'qemu',
      node: 'pve1',
      vmid: 101,
      name: 'web',
      status: 'running',
      tags: ['prod', 'linux'],
      suggestedHostName: '10.0.1.101',
    },
  );

  assert.equal(
    mapPveResource('cluster-1', { type: 'lxc', node: 'pve1', vmid: '201' })?.vmid,
    201,
  );
});

test('mapPveResource ignores unsupported or incomplete records', () => {
  assert.equal(mapPveResource('cluster-1', { type: 'storage', node: 'pve1' }), undefined);
  assert.equal(mapPveResource('cluster-1', { type: 'qemu', node: 'pve1' }), undefined);
  assert.equal(mapPveResource('cluster-1', { type: 'lxc', vmid: 201 }), undefined);
});

test('fetchResources falls back to node-specific LXC and QEMU endpoints', async () => {
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    '/cluster/resources': [{ type: 'node', node: 'pve1', status: 'online' }],
    '/nodes/pve1/qemu': [],
    '/nodes/pve1/lxc': [{ vmid: 201, name: 'web-ct', status: 'running', tags: 'prod' }],
  };
  const getData: PveGetData = async <T>(requestPath: string): Promise<T> => {
    calls.push(requestPath);
    return responses[requestPath] as T;
  };

  const resources = await new PveClient(cluster, 'secret', false, { getData })
    .fetchResources(cluster.id);

  assert.deepEqual(calls, [
    '/cluster/resources',
    '/nodes/pve1/qemu',
    '/nodes/pve1/lxc',
  ]);
  assert.deepEqual(
    resources.find((resource) => resource.type === 'lxc'),
    {
      clusterId: 'cluster-1',
      type: 'lxc',
      node: 'pve1',
      vmid: 201,
      name: 'web-ct',
      status: 'running',
      tags: ['prod'],
      suggestedHostName: undefined,
    },
  );
});

test('fetchResources only requests guest types missing from cluster resources', async () => {
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    '/cluster/resources': [
      { type: 'node', node: 'pve1' },
      { type: 'qemu', node: 'pve1', vmid: 101, name: 'vm' },
    ],
    '/nodes/pve1/lxc': [{ vmid: 201, name: 'ct' }],
  };
  const getData: PveGetData = async <T>(requestPath: string): Promise<T> => {
    calls.push(requestPath);
    return responses[requestPath] as T;
  };

  const resources = await new PveClient(cluster, 'secret', false, { getData })
    .fetchResources(cluster.id);

  assert.deepEqual(calls, ['/cluster/resources', '/nodes/pve1/lxc']);
  assert.deepEqual(resources.map((resource) => resource.type), ['node', 'qemu', 'lxc']);
});

test('fetchResources keeps primary resources when fallback calls fail', async () => {
  const warnings: string[] = [];
  const getData: PveGetData = async <T>(requestPath: string): Promise<T> => {
    if (requestPath === '/cluster/resources') {
      return [{ type: 'node', node: 'pve1' }] as T;
    }
    throw new Error('permission denied');
  };

  const resources = await new PveClient(cluster, 'secret', false, {
    getData,
    onWarning: (message) => warnings.push(message),
  }).fetchResources(cluster.id);

  assert.equal(resources.length, 1);
  assert.equal(resources[0].type, 'node');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /VM\.Audit/);
});

test('mergePveResources removes duplicates and prefers cluster inventory data', () => {
  const fallback: PveResource = {
    clusterId: 'cluster-1',
    type: 'lxc',
    node: 'pve1',
    vmid: 201,
    name: 'fallback-name',
  };
  const primary = { ...fallback, name: 'cluster-name', status: 'running' };

  assert.deepEqual(mergePveResources([primary], [fallback]), [primary]);
});

test('extractLxcIp selects a usable IPv4 address from container interfaces', () => {
  assert.equal(
    extractLxcIp([
      { name: 'lo', inet: '127.0.0.1/8', inet6: '::1/128' },
      { name: 'eth0', inet: '10.0.1.201/24', inet6: 'fe80::1234/64' },
    ]),
    '10.0.1.201',
  );
});

test('extractQemuGuestAgentIp reads the network-get-interfaces result', () => {
  assert.equal(
    extractQemuGuestAgentIp({
      result: [
        {
          name: 'lo',
          'ip-addresses': [{ 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4' }],
        },
        {
          name: 'ens18',
          'ip-addresses': [
            { 'ip-address': 'fe80::100', 'ip-address-type': 'ipv6' },
            { 'ip-address': '192.168.1.201', 'ip-address-type': 'ipv4' },
          ],
        },
      ],
    }),
    '192.168.1.201',
  );
});

test('selectPreferredIp rejects local-only addresses and prefers IPv4', () => {
  assert.equal(
    selectPreferredIp(['127.0.0.1', '::1', '169.254.2.3', 'fe80::1', '2001:db8::10', '10.0.0.8']),
    '10.0.0.8',
  );
  assert.equal(selectPreferredIp(['127.0.0.1', 'fe80::1']), undefined);
});

test('fetchGuestIp calls the resource-specific PVE endpoint', async () => {
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    '/nodes/pve1/lxc/201/interfaces': [
      { name: 'eth0', inet: '10.0.1.201/24' },
    ],
    '/nodes/pve1/qemu/101/agent/network-get-interfaces': {
      result: [
        {
          name: 'ens18',
          'ip-addresses': [{ 'ip-address': '10.0.1.101' }],
        },
      ],
    },
  };
  const getData: PveGetData = async <T>(requestPath: string): Promise<T> => {
    calls.push(requestPath);
    return responses[requestPath] as T;
  };
  const client = new PveClient(cluster, 'secret', false, { getData });
  const lxc: PveResource = {
    clusterId: cluster.id,
    type: 'lxc',
    node: 'pve1',
    vmid: 201,
    name: 'car',
    status: 'running',
  };
  const qemu: PveResource = {
    clusterId: cluster.id,
    type: 'qemu',
    node: 'pve1',
    vmid: 101,
    name: 'vm',
    status: 'running',
  };

  assert.equal(await client.fetchGuestIp(lxc), '10.0.1.201');
  assert.equal(await client.fetchGuestIp(qemu), '10.0.1.101');
  assert.deepEqual(calls, [
    '/nodes/pve1/lxc/201/interfaces',
    '/nodes/pve1/qemu/101/agent/network-get-interfaces',
  ]);
});
