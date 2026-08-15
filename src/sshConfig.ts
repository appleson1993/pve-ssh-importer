import os from 'node:os';
import path from 'node:path';
import { SshTarget } from './types';

export const managedStart = '# >>> PVE SSH Importer managed hosts >>>';
export const managedEnd = '# <<< PVE SSH Importer managed hosts <<<';

export function renderManagedBlock(targets: SshTarget[], eol = os.EOL): string {
  const entries = targets
    .filter((target) => target.enabled)
    .sort((left, right) => left.hostAlias.localeCompare(right.hostAlias))
    .map((target) => renderTarget(target, eol));
  const body = entries.length > 0 ? `${eol}${entries.join(`${eol}${eol}`)}${eol}` : eol;
  return `${managedStart}${body}${managedEnd}`;
}

export function mergeManagedBlock(existing: string, managedBlock: string, eol = os.EOL): string {
  const normalizedBlock = managedBlock.replace(/\r?\n/g, eol);
  const blockPattern = new RegExp(
    `${escapeRegExp(managedStart)}[\\s\\S]*?${escapeRegExp(managedEnd)}`,
    'm',
  );
  if (blockPattern.test(existing)) {
    return existing.replace(blockPattern, normalizedBlock);
  }

  const trimmed = existing.replace(/[\t ]+$/gm, '').replace(/\s+$/, '');
  return trimmed ? `${trimmed}${eol}${eol}${normalizedBlock}${eol}` : `${normalizedBlock}${eol}`;
}

export function ensureIncludeDirective(
  existing: string,
  includedFile: string,
  eol = os.EOL,
): string {
  const includeValue = toSshPath(includedFile);
  const directive = `Include ${quoteIfNeeded(includeValue)}`;
  const withoutDirective = removeIncludeDirective(existing, includedFile, eol);
  if (!withoutDirective) {
    return `${directive}${eol}`;
  }

  const separator = withoutDirective.startsWith(eol) ? '' : eol;
  return `${directive}${eol}${separator}${withoutDirective}`;
}

export function removeIncludeDirective(
  existing: string,
  includedFile: string,
  eol = os.EOL,
): string {
  const normalizedTarget = stripQuotes(toSshPath(includedFile)).toLocaleLowerCase();
  const lines = existing.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const match = line.match(/^\s*Include\s+(.+?)\s*$/i);
    if (!match) return true;
    const candidates = includeCandidates(match[1]);
    return !(
      candidates.length === 1 &&
      candidates[0].toLocaleLowerCase() === normalizedTarget
    );
  });
  return filtered.join(eol);
}

export function resolveUserPath(value: string, homeDirectory = os.homedir()): string {
  const normalized = value.trim();
  if (normalized === '~') {
    return homeDirectory;
  }
  if (normalized.startsWith('~/') || normalized.startsWith('~\\')) {
    return path.join(homeDirectory, normalized.slice(2));
  }
  return path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(homeDirectory, normalized);
}

export function resolveRemoteSshConfigPath(
  configuredPath?: string,
  homeDirectory = os.homedir(),
): string {
  return configuredPath?.trim()
    ? resolveUserPath(configuredPath, homeDirectory)
    : path.join(homeDirectory, '.ssh', 'config');
}

export function validateSshTarget(target: SshTarget): string | undefined {
  if (!/^[A-Za-z0-9._-]+$/.test(target.hostAlias)) {
    return '主機別名只能包含英文字母、數字、句點、底線與連字號。';
  }
  if (!target.hostName || /[\s\r\n]/.test(target.hostName)) {
    return '主機位址必須是單一 IP 位址或 DNS 名稱。';
  }
  if (!target.user || /[\s\r\n]/.test(target.user)) {
    return 'SSH 使用者名稱不可包含空白。';
  }
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    return 'SSH 連接埠必須介於 1 到 65535。';
  }
  for (const value of [target.identityFile, target.proxyJump]) {
    if (value && /[\r\n]/.test(value)) {
      return 'SSH 設定值不可包含換行字元。';
    }
  }
  if (target.proxyJump && /\s/.test(target.proxyJump)) {
    return 'ProxyJump 不可包含空白。';
  }
  return undefined;
}

export function defaultAlias(clusterName: string, resourceName: string, vmid?: number): string {
  return [clusterName, resourceName, vmid]
    .filter((part) => part !== undefined && String(part).length > 0)
    .map((part) => String(part).toLocaleLowerCase())
    .join('-')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function renderTarget(target: SshTarget, eol: string): string {
  const validationError = validateSshTarget(target);
  if (validationError) {
    throw new Error(`${target.hostAlias || '未命名目標'}：${validationError}`);
  }
  const lines = [
    `Host ${target.hostAlias}`,
    `    HostName ${target.hostName}`,
    `    User ${target.user}`,
    `    Port ${target.port}`,
  ];
  if (target.identityFile) {
    lines.push(`    IdentityFile ${quoteIfNeeded(target.identityFile)}`);
  }
  if (target.proxyJump) {
    lines.push(`    ProxyJump ${target.proxyJump}`);
  }
  return lines.join(eol);
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function toSshPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function includeCandidates(value: string): string[] {
  return (value.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g) ?? [])
    .map((candidate) => candidate.replace(/\\"/g, '"'))
    .map(stripQuotes);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
