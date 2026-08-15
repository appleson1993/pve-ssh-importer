import * as vscode from 'vscode';
import { PveCluster, SshTarget } from './types';

const configurationSection = 'pveSshImporter';
const targetsKey = 'pveSshImporter.targets';
const tokenSecretPrefix = 'pveSshImporter.token.';

export class ExtensionStore {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public getClusters(): PveCluster[] {
    return vscode.workspace
      .getConfiguration(configurationSection)
      .get<PveCluster[]>('clusters', []);
  }

  public async saveCluster(cluster: PveCluster, tokenSecret: string): Promise<void> {
    const clusters = this.getClusters().filter((item) => item.id !== cluster.id);
    clusters.push(cluster);
    await vscode.workspace
      .getConfiguration(configurationSection)
      .update('clusters', clusters, vscode.ConfigurationTarget.Global);
    await this.context.secrets.store(this.tokenKey(cluster.id), tokenSecret);
  }

  public async removeCluster(clusterId: string): Promise<void> {
    const clusters = this.getClusters().filter((cluster) => cluster.id !== clusterId);
    const targets = this.getTargets().filter(
      (target) => !target.resourceKey.startsWith(`${clusterId}:`),
    );
    await vscode.workspace
      .getConfiguration(configurationSection)
      .update('clusters', clusters, vscode.ConfigurationTarget.Global);
    await this.context.globalState.update(targetsKey, targets);
    await this.context.secrets.delete(this.tokenKey(clusterId));
  }

  public async getTokenSecret(clusterId: string): Promise<string | undefined> {
    return this.context.secrets.get(this.tokenKey(clusterId));
  }

  public getTargets(): SshTarget[] {
    return this.context.globalState.get<SshTarget[]>(targetsKey, []);
  }

  public getTarget(resourceKey: string): SshTarget | undefined {
    return this.getTargets().find((target) => target.resourceKey === resourceKey);
  }

  public async saveTargets(newTargets: SshTarget[]): Promise<void> {
    const byResource = new Map(this.getTargets().map((target) => [target.resourceKey, target]));
    for (const target of newTargets) {
      byResource.set(target.resourceKey, target);
    }
    await this.context.globalState.update(targetsKey, [...byResource.values()]);
  }

  public getConfiguration<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(configurationSection).get<T>(key, fallback);
  }

  private tokenKey(clusterId: string): string {
    return `${tokenSecretPrefix}${clusterId}`;
  }
}
