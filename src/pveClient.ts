import https from 'node:https';
import { isIP } from 'node:net';
import axios, { isAxiosError } from 'axios';
import {
  PveCluster,
  PveResource,
  PveResourceType,
  PveVersion,
  resourceKey,
} from './types';

type ApiEnvelope<T> = { data: T };
type RawResource = Record<string, unknown>;
export type PveGetData = <T>(path: string) => Promise<T>;

export interface PveClientOptions {
  getData?: PveGetData;
  onWarning?: (message: string) => void;
}

const supportedTypes = new Set<PveResourceType>(['node', 'qemu', 'lxc']);

export class PveClient {
  private readonly getData: PveGetData;
  private readonly onWarning?: (message: string) => void;

  public constructor(
    cluster: PveCluster,
    tokenSecret: string,
    allowInsecureTls: boolean,
    options: PveClientOptions = {},
  ) {
    this.onWarning = options.onWarning;
    if (options.getData) {
      this.getData = options.getData;
      return;
    }

    const http = axios.create({
      baseURL: normalizeApiUrl(cluster.apiUrl),
      timeout: 15_000,
      headers: {
        Authorization: `PVEAPIToken=${cluster.tokenId}=${tokenSecret}`,
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: !allowInsecureTls }),
    });
    this.getData = async <T>(requestPath: string): Promise<T> => {
      const response = await http.get<ApiEnvelope<T>>(requestPath);
      return response.data.data;
    };
  }

  public async testConnection(): Promise<PveVersion> {
    return this.getData<PveVersion>('/version');
  }

  public async fetchResources(clusterId: string): Promise<PveResource[]> {
    const rawClusterResources = await this.getData<RawResource[]>('/cluster/resources');
    let resources = rawClusterResources
      .map((item) => mapPveResource(clusterId, item))
      .filter((item): item is PveResource => item !== undefined);

    if (!resources.some((resource) => resource.type === 'node')) {
      const nodeResources = await this.fetchNodes(clusterId);
      resources = mergePveResources(resources, nodeResources);
    }

    const nodes = resources
      .filter((resource) => resource.type === 'node')
      .map((resource) => resource.node);
    const missingGuestTypes = (['qemu', 'lxc'] as const).filter(
      (type) => !resources.some((resource) => resource.type === type),
    );
    if (nodes.length > 0 && missingGuestTypes.length > 0) {
      const guestResources = await this.fetchGuests(clusterId, nodes, missingGuestTypes);
      resources = mergePveResources(resources, guestResources);
    }

    return resources.sort(compareResources);
  }

  public async fetchGuestIp(resource: PveResource): Promise<string | undefined> {
    if (resource.type === 'node' || resource.vmid === undefined || resource.status === 'stopped') {
      return resource.suggestedHostName;
    }

    const node = encodeURIComponent(resource.node);
    try {
      if (resource.type === 'lxc') {
        const interfaces = await this.getData<unknown[]>(
          `/nodes/${node}/lxc/${resource.vmid}/interfaces`,
        );
        return extractLxcIp(interfaces);
      }

      const agentResult = await this.getData<unknown>(
        `/nodes/${node}/qemu/${resource.vmid}/agent/network-get-interfaces`,
      );
      return extractQemuGuestAgentIp(agentResult);
    } catch (error) {
      this.onWarning?.(
        `無法自動偵測 ${resource.name} 的 IP 位址：${describePveError(error)} ` +
          (resource.type === 'qemu'
            ? '請確認 QEMU Guest Agent 已安裝、啟用並正在執行。'
            : '請確認 LXC 容器正在執行，且 API 權杖可讀取介面資訊。'),
      );
      return undefined;
    }
  }

  private async fetchNodes(clusterId: string): Promise<PveResource[]> {
    try {
      const rawNodes = await this.getData<RawResource[]>('/nodes');
      return rawNodes
        .map((item) =>
          mapPveResource(clusterId, {
            ...item,
            type: 'node',
            node: item.node ?? item.name,
          }),
        )
        .filter((item): item is PveResource => item !== undefined);
    } catch (error) {
      this.warnFallback('/nodes', error);
      return [];
    }
  }

  private async fetchGuests(
    clusterId: string,
    nodes: string[],
    types: readonly Exclude<PveResourceType, 'node'>[],
  ): Promise<PveResource[]> {
    const requests = nodes.flatMap((node) =>
      types.map(async (type): Promise<PveResource[]> => {
        const endpoint = `/nodes/${encodeURIComponent(node)}/${type}`;
        try {
          const records = await this.getData<RawResource[]>(endpoint);
          return records
            .map((item) => mapPveResource(clusterId, { ...item, type, node }))
            .filter((item): item is PveResource => item !== undefined);
        } catch (error) {
          this.warnFallback(endpoint, error);
          return [];
        }
      }),
    );
    return (await Promise.all(requests)).flat();
  }

  private warnFallback(endpoint: string, error: unknown): void {
    this.onWarning?.(
      `無法從 ${endpoint} 取得 PVE 資源：${describePveError(error)} ` +
        '若找不到虛擬機或容器，請確認 API 權杖具有 VM.Audit 權限。',
    );
  }
}

export function mergePveResources(
  primary: PveResource[],
  fallback: PveResource[],
): PveResource[] {
  const byKey = new Map(fallback.map((resource) => [resourceKey(resource), resource]));
  for (const resource of primary) {
    byKey.set(resourceKey(resource), resource);
  }
  return [...byKey.values()];
}

export function extractLxcIp(interfaces: unknown): string | undefined {
  if (!Array.isArray(interfaces)) return undefined;
  const candidates: string[] = [];
  for (const item of interfaces) {
    if (!isRecord(item) || asString(item.name)?.toLocaleLowerCase() === 'lo') continue;
    candidates.push(...addressValues(item.inet), ...addressValues(item.inet6));
  }
  return selectPreferredIp(candidates);
}

export function extractQemuGuestAgentIp(agentResult: unknown): string | undefined {
  const interfaces = Array.isArray(agentResult)
    ? agentResult
    : isRecord(agentResult) && Array.isArray(agentResult.result)
      ? agentResult.result
      : [];
  const candidates: string[] = [];
  for (const item of interfaces) {
    if (!isRecord(item) || asString(item.name)?.toLocaleLowerCase() === 'lo') continue;
    const addresses = item['ip-addresses'];
    if (!Array.isArray(addresses)) continue;
    for (const address of addresses) {
      if (isRecord(address)) {
        const value = asString(address['ip-address']);
        if (value) candidates.push(value);
      }
    }
  }
  return selectPreferredIp(candidates);
}

export function selectPreferredIp(candidates: string[]): string | undefined {
  return candidates
    .map(normalizeIpCandidate)
    .filter((candidate): candidate is string => candidate !== undefined)
    .map((address, index) => ({ address, index, score: ipScore(address) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.address;
}

export function normalizeApiUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('PVE 網址必須使用 http:// 或 https://。');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('PVE 網址不可包含帳號密碼、查詢參數或片段。');
  }

  const trimmedPath = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\/api2\/json$/i, '');
  return `${parsed.origin}${trimmedPath}/api2/json`;
}

export function mapPveResource(clusterId: string, raw: RawResource): PveResource | undefined {
  const type = asString(raw.type) as PveResourceType | undefined;
  if (!type || !supportedTypes.has(type)) {
    return undefined;
  }

  const node = asString(raw.node) ?? (type === 'node' ? asString(raw.name) : undefined);
  if (!node) {
    return undefined;
  }

  const vmid = type === 'node' ? undefined : asNumber(raw.vmid);
  if (type !== 'node' && vmid === undefined) {
    return undefined;
  }

  const fallbackName = type === 'node' ? node : `${type}-${vmid}`;
  const tags = asString(raw.tags)
    ?.split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    clusterId,
    type,
    node,
    vmid,
    name: asString(raw.name) ?? fallbackName,
    status: asString(raw.status),
    tags: tags && tags.length > 0 ? tags : undefined,
    suggestedHostName: asString(raw.ip) ?? asString(raw.ipAddress),
  };
}

export function describePveError(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status) {
      return `PVE API 請求失敗（HTTP ${status}）。`;
    }
    if (error.code === 'ECONNABORTED') {
      return 'PVE API 請求逾時。';
    }
    if (error.code === 'ECONNREFUSED') {
      return 'PVE API 拒絕連線，請確認網址、連接埠與服務狀態。';
    }
    if (error.code === 'ENOTFOUND') {
      return '找不到 PVE API 主機，請確認 DNS 名稱或 IP 位址。';
    }
    if (
      error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      error.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
      return 'PVE TLS 憑證驗證失敗；請安裝受信任憑證，或確認風險後啟用允許不安全 TLS。';
    }
    return 'PVE API 請求失敗，請確認網路與 PVE 服務狀態。';
  }
  return error instanceof Error ? error.message : '發生未預期的錯誤。';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function addressValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(addressValues);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\s,]+/)
    .map((address) => address.trim())
    .filter(Boolean);
}

function normalizeIpCandidate(value: string): string | undefined {
  const withoutPrefix = value.trim().replace(/\/\d+$/, '').replace(/^\[|\]$/g, '');
  const withoutZone = withoutPrefix.replace(/%[^%]+$/, '');
  return isIP(withoutZone) ? withoutZone : undefined;
}

function ipScore(address: string): number {
  const normalized = address.toLocaleLowerCase();
  const version = isIP(normalized);
  if (version === 4) {
    const firstTwo = normalized.split('.').slice(0, 2).map(Number);
    if (
      firstTwo[0] === 0 ||
      firstTwo[0] === 127 ||
      (firstTwo[0] === 169 && firstTwo[1] === 254) ||
      firstTwo[0] >= 224
    ) {
      return -1;
    }
    return 100;
  }
  if (
    version !== 6 ||
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  ) {
    return -1;
  }
  return 50;
}

function compareResources(left: PveResource, right: PveResource): number {
  const order: Record<PveResourceType, number> = { node: 0, qemu: 1, lxc: 2 };
  return order[left.type] - order[right.type] || left.name.localeCompare(right.name);
}
