export type PveResourceType = 'node' | 'qemu' | 'lxc';

export interface PveCluster {
  id: string;
  name: string;
  apiUrl: string;
  tokenId: string;
}

export interface PveResource {
  clusterId: string;
  type: PveResourceType;
  node: string;
  vmid?: number;
  name: string;
  status?: string;
  tags?: string[];
  suggestedHostName?: string;
}

export interface SshTarget {
  resourceKey: string;
  hostAlias: string;
  hostName: string;
  user: string;
  port: number;
  identityFile?: string;
  proxyJump?: string;
  enabled: boolean;
}

export interface PveVersion {
  version?: string;
  release?: string;
  repoid?: string;
}

export function resourceKey(resource: PveResource): string {
  const localId = resource.type === 'node' ? resource.node : String(resource.vmid);
  return `${resource.clusterId}:${resource.type}:${localId}`;
}
