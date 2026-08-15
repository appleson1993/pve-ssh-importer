import * as vscode from 'vscode';
import { localizePveStatus, resourceTypeLabels } from './locale';
import { describePveError } from './pveClient';
import { PveService } from './pveService';
import { ExtensionStore } from './store';
import { PveCluster, PveResource, PveResourceType, resourceKey } from './types';

type TreeNode = ClusterNode | CategoryNode | ResourceNode | MessageNode;

interface ClusterNode {
  kind: 'cluster';
  cluster: PveCluster;
}

interface CategoryNode {
  kind: 'category';
  cluster: PveCluster;
  resourceType: PveResourceType;
  resources: PveResource[];
}

interface ResourceNode {
  kind: 'resource';
  resource: PveResource;
}

interface MessageNode {
  kind: 'message';
  label: string;
  description?: string;
}

export class PveTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changed = new vscode.EventEmitter<TreeNode | undefined | void>();
  private readonly cache = new Map<string, PveResource[]>();
  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(
    private readonly store: ExtensionStore,
    private readonly service: PveService,
  ) {}

  public refresh(clusterId?: string): void {
    if (clusterId) {
      this.cache.delete(clusterId);
    } else {
      this.cache.clear();
    }
    this.changed.fire();
  }

  public getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'cluster':
        return this.clusterItem(element.cluster);
      case 'category':
        return this.categoryItem(element);
      case 'resource':
        return this.resourceItem(element.resource);
      case 'message':
        return this.messageItem(element);
    }
  }

  public async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this.store.getClusters().map((cluster) => ({ kind: 'cluster', cluster }));
    }
    if (element.kind === 'cluster') {
      try {
        const resources = await this.resourcesFor(element.cluster);
        return (['node', 'qemu', 'lxc'] as const).map((resourceType) => ({
          kind: 'category',
          cluster: element.cluster,
          resourceType,
          resources: resources.filter((resource) => resource.type === resourceType),
        }));
      } catch (error) {
        return [{ kind: 'message', label: '無法載入資源', description: describePveError(error) }];
      }
    }
    if (element.kind === 'category') {
      if (element.resources.length === 0) {
        return [{
          kind: 'message',
          label: '目前沒有資源',
        }];
      }
      return element.resources.map((resource) => ({ kind: 'resource', resource }));
    }
    return [];
  }

  public async allResources(): Promise<PveResource[]> {
    const resources = await Promise.all(
      this.store.getClusters().map((cluster) => this.resourcesFor(cluster)),
    );
    return resources.flat();
  }

  private async resourcesFor(cluster: PveCluster): Promise<PveResource[]> {
    const cached = this.cache.get(cluster.id);
    if (cached) {
      return cached;
    }
    const resources = await this.service.fetchResources(cluster);
    this.cache.set(cluster.id, resources);
    return resources;
  }

  private clusterItem(cluster: PveCluster): vscode.TreeItem {
    const item = new vscode.TreeItem(cluster.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = new URL(cluster.apiUrl).host;
    item.contextValue = 'pveCluster';
    item.iconPath = new vscode.ThemeIcon('server-environment');
    item.tooltip = `${cluster.name}\n${cluster.apiUrl}\nAPI 權杖：${cluster.tokenId}`;
    return item;
  }

  private categoryItem(node: CategoryNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      resourceTypeLabels[node.resourceType],
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.description = String(node.resources.length);
    item.iconPath = new vscode.ThemeIcon(
      node.resourceType === 'node' ? 'server' : node.resourceType === 'qemu' ? 'vm' : 'package',
    );
    return item;
  }

  private resourceItem(resource: PveResource): vscode.TreeItem {
    const imported = this.store.getTarget(resourceKey(resource));
    const item = new vscode.TreeItem(resource.name, vscode.TreeItemCollapsibleState.None);
    const localizedStatus = localizePveStatus(resource.status);
    item.description = [resource.vmid, localizedStatus].filter(Boolean).join(' | ');
    item.contextValue = imported ? 'pveResourceImported' : 'pveResource';
    item.iconPath = new vscode.ThemeIcon(
      resource.status === 'running' ? 'vm-active' : resource.status === 'stopped' ? 'vm-outline' : 'remote',
      resource.status === 'running' ? new vscode.ThemeColor('testing.iconPassed') : undefined,
    );
    item.tooltip = [
      `${resourceTypeLabels[resource.type]}：${resource.name}`,
      `節點：${resource.node}`,
      resource.vmid !== undefined ? `VMID: ${resource.vmid}` : undefined,
      localizedStatus ? `狀態：${localizedStatus}` : undefined,
      resource.tags?.length ? `標籤：${resource.tags.join(', ')}` : undefined,
      imported ? `SSH：${imported.user}@${imported.hostName}:${imported.port}` : '尚未匯入',
    ]
      .filter(Boolean)
      .join('\n');
    item.command = {
      command: imported ? 'pveSshImporter.connectResource' : 'pveSshImporter.importResource',
      title: imported ? '連線' : '匯入並連線',
      arguments: [resource],
    };
    return item;
  }

  private messageItem(node: MessageNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon(node.description ? 'error' : 'info');
    item.tooltip = node.description;
    return item;
  }
}
