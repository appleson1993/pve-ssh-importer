import { PveClient } from './pveClient';
import { ExtensionStore } from './store';
import { PveCluster, PveResource, PveVersion } from './types';

export class PveService {
  public constructor(
    private readonly store: ExtensionStore,
    private readonly onWarning?: (message: string) => void,
  ) {}

  public async testConnection(cluster: PveCluster, tokenOverride?: string): Promise<PveVersion> {
    const client = await this.clientFor(cluster, tokenOverride);
    return client.testConnection();
  }

  public async fetchResources(cluster: PveCluster): Promise<PveResource[]> {
    const client = await this.clientFor(cluster);
    return client.fetchResources(cluster.id);
  }

  public async resolveGuestIp(resource: PveResource): Promise<string | undefined> {
    const cluster = this.store
      .getClusters()
      .find((item) => item.id === resource.clusterId);
    if (!cluster) {
      throw new Error('此資源所屬的 PVE 叢集已不存在。');
    }
    const client = await this.clientFor(cluster);
    return client.fetchGuestIp(resource);
  }

  private async clientFor(cluster: PveCluster, tokenOverride?: string): Promise<PveClient> {
    const tokenSecret = tokenOverride ?? (await this.store.getTokenSecret(cluster.id));
    if (!tokenSecret) {
      throw new Error(`找不到 ${cluster.name} 的 API 權杖密鑰，請重新新增此叢集。`);
    }
    const allowInsecureTls = this.store.getConfiguration('allowInsecureTls', false);
    return new PveClient(cluster, tokenSecret, allowInsecureTls, {
      onWarning: this.onWarning,
    });
  }
}
