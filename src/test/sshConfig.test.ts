import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  defaultAlias,
  ensureIncludeDirective,
  managedEnd,
  managedStart,
  mergeManagedBlock,
  removeIncludeDirective,
  renderManagedBlock,
  resolveRemoteSshConfigPath,
  resolveUserPath,
  validateSshTarget,
} from '../sshConfig';
import { SshTarget } from '../types';

const target: SshTarget = {
  resourceKey: 'cluster:lxc:201',
  hostAlias: 'lxc-web-201',
  hostName: '10.0.1.201',
  user: 'root',
  port: 22,
  identityFile: '~/.ssh/id ed25519',
  proxyJump: 'pve-prod-node1',
  enabled: true,
};

test('renderManagedBlock emits a complete, sorted SSH entry', () => {
  const second = { ...target, resourceKey: 'cluster:node:node1', hostAlias: 'a-node' };
  const result = renderManagedBlock([target, second], '\n');

  assert.ok(result.startsWith(managedStart));
  assert.ok(result.endsWith(managedEnd));
  assert.ok(result.indexOf('Host a-node') < result.indexOf('Host lxc-web-201'));
  assert.match(result, /HostName 10\.0\.1\.201/);
  assert.match(result, /IdentityFile "~\/\.ssh\/id ed25519"/);
  assert.match(result, /ProxyJump pve-prod-node1/);
});

test('renderManagedBlock excludes disabled targets', () => {
  const result = renderManagedBlock([{ ...target, enabled: false }], '\n');
  assert.equal(result, `${managedStart}\n${managedEnd}`);
});

test('renderManagedBlock omits an empty optional identity file', () => {
  const result = renderManagedBlock([{ ...target, identityFile: undefined }], '\n');
  assert.doesNotMatch(result, /IdentityFile/);
});

test('mergeManagedBlock preserves unmanaged content and replaces the old block', () => {
  const existing = [
    'Host github.com',
    '    User git',
    '',
    managedStart,
    'Host stale-host',
    '    HostName 192.0.2.1',
    managedEnd,
    '',
    'Host manual',
    '    HostName 192.0.2.2',
    '',
  ].join('\n');
  const updated = mergeManagedBlock(existing, renderManagedBlock([target], '\n'), '\n');

  assert.match(updated, /Host github\.com/);
  assert.match(updated, /Host manual/);
  assert.match(updated, /Host lxc-web-201/);
  assert.doesNotMatch(updated, /stale-host/);
  assert.equal(updated.match(new RegExp(managedStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length, 1);
});

test('ensureIncludeDirective adds one normalized Include line', () => {
  const once = ensureIncludeDirective('Host manual\n    HostName example.com\n', '~/.ssh/pve_hosts', '\n');
  const twice = ensureIncludeDirective(once, '~/.ssh/pve_hosts', '\n');

  assert.equal(once, twice);
  assert.ok(once.startsWith('Include ~/.ssh/pve_hosts\n\nHost manual'));
  assert.equal(once.match(/^Include ~\/\.ssh\/pve_hosts$/gm)?.length, 1);
});

test('ensureIncludeDirective moves an Include out of a Host section to global scope', () => {
  const existing = [
    'Host manual',
    '    HostName example.com',
    'Include C:/Users/test/.ssh/pve_hosts',
    '',
  ].join('\n');
  const result = ensureIncludeDirective(existing, 'C:\\Users\\test\\.ssh\\pve_hosts', '\n');

  assert.equal(
    result,
    [
      'Include C:/Users/test/.ssh/pve_hosts',
      '',
      'Host manual',
      '    HostName example.com',
      '',
    ].join('\n'),
  );
});

test('ensureIncludeDirective recognizes a quoted Windows path', () => {
  const existing = 'Include "C:/Users/Test User/.ssh/pve_hosts"\n';
  assert.equal(
    ensureIncludeDirective(existing, 'C:\\Users\\Test User\\.ssh\\pve_hosts', '\n'),
    existing,
  );
});

test('removeIncludeDirective removes a legacy tilde include only once', () => {
  const existing = [
    'Host manual',
    '    HostName example.com',
    'Include ~/.ssh/pve_hosts',
    'Include ~/.ssh/other_hosts',
    '',
  ].join('\n');
  assert.equal(
    removeIncludeDirective(existing, '~/.ssh/pve_hosts', '\n'),
    [
      'Host manual',
      '    HostName example.com',
      'Include ~/.ssh/other_hosts',
      '',
    ].join('\n'),
  );
});

test('validateSshTarget rejects SSH wildcard and line injection', () => {
  assert.match(validateSshTarget({ ...target, hostAlias: 'prod-*' }) ?? '', /英文字母/);
  assert.match(validateSshTarget({ ...target, hostAlias: 'prod/host' }) ?? '', /英文字母/);
  assert.match(validateSshTarget({ ...target, identityFile: 'key\nProxyCommand evil' }) ?? '', /換行/);
  assert.match(validateSshTarget({ ...target, hostName: 'host\nUser attacker' }) ?? '', /單一 IP/);
});

test('defaultAlias creates a stable SSH-safe alias', () => {
  assert.equal(defaultAlias('PVE Production', 'Web / API', 201), 'pve-production-web-api-201');
});

test('resolveUserPath expands home and resolves relative paths from home', () => {
  const fakeHome = path.join(path.parse(process.cwd()).root, 'Users', 'tester');
  assert.equal(resolveUserPath('~/.ssh/pve_hosts', fakeHome), path.join(fakeHome, '.ssh', 'pve_hosts'));
  assert.equal(resolveUserPath('.ssh/pve_hosts', fakeHome), path.join(fakeHome, '.ssh', 'pve_hosts'));
  assert.equal(resolveUserPath('~', fakeHome), fakeHome);
  assert.equal(typeof os.homedir(), 'string');
});

test('resolveRemoteSshConfigPath honors Remote - SSH custom config', () => {
  const fakeHome = path.join(path.parse(process.cwd()).root, 'Users', 'tester');
  assert.equal(
    resolveRemoteSshConfigPath('~/.ssh/config_vscode', fakeHome),
    path.join(fakeHome, '.ssh', 'config_vscode'),
  );
  assert.equal(
    resolveRemoteSshConfigPath(undefined, fakeHome),
    path.join(fakeHome, '.ssh', 'config'),
  );
});
