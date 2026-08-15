import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { localizePveStatus, resourceTypeLabels } from './locale';
import { describePveError, normalizeApiUrl } from './pveClient';
import { PreviewProvider } from './previewProvider';
import { PveService } from './pveService';
import {
  defaultAlias,
  ensureIncludeDirective,
  mergeManagedBlock,
  removeIncludeDirective,
  renderManagedBlock,
  resolveRemoteSshConfigPath,
  resolveUserPath,
  validateSshTarget,
} from './sshConfig';
import { ExtensionStore } from './store';
import { PveTreeProvider } from './treeProvider';
import { PveCluster, PveResource, SshTarget, resourceKey } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new ExtensionStore(context);
  const output = vscode.window.createOutputChannel('PVE SSH 匯入器', { log: true });
  const service = new PveService(store, (message) => output.warn(message));
  const tree = new PveTreeProvider(store, service);
  const preview = new PreviewProvider();

  context.subscriptions.push(
    output,
    vscode.window.registerTreeDataProvider('pveSshImporter.resources', tree),
    vscode.workspace.registerTextDocumentContentProvider(preview.scheme, preview),
    vscode.commands.registerCommand('pveSshImporter.addCluster', () =>
      addCluster(store, service, tree, output),
    ),
    vscode.commands.registerCommand('pveSshImporter.testConnection', (value?: unknown) =>
      testConnection(value, store, service, output),
    ),
    vscode.commands.registerCommand('pveSshImporter.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('pveSshImporter.importResource', (value?: unknown) =>
      importResource(value, store, tree, service, preview, output),
    ),
    vscode.commands.registerCommand('pveSshImporter.importSelectedResources', () =>
      importSelectedResources(store, tree, service, preview, output),
    ),
    vscode.commands.registerCommand('pveSshImporter.syncHosts', () =>
      syncHosts(store, preview, output),
    ),
    vscode.commands.registerCommand('pveSshImporter.connectResource', (value?: unknown) =>
      connectResource(value, store, tree, service, preview, output),
    ),
    vscode.commands.registerCommand('pveSshImporter.openSshConfig', () => openSshConfig(store)),
    vscode.commands.registerCommand('pveSshImporter.removeCluster', (value?: unknown) =>
      removeCluster(value, store, tree),
    ),
  );

  if (store.getConfiguration('autoSyncOnStartup', false) && store.getTargets().length > 0) {
    void syncHosts(store, preview, output, false);
  }
}

export function deactivate(): void {}

async function addCluster(
  store: ExtensionStore,
  service: PveService,
  tree: PveTreeProvider,
  output: vscode.LogOutputChannel,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: '新增 Proxmox VE 叢集',
    prompt: '叢集顯示名稱',
    placeHolder: '正式環境',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : '請輸入叢集名稱。'),
  });
  if (!name) return;

  const apiUrlInput = await vscode.window.showInputBox({
    title: '新增 Proxmox VE 叢集',
    prompt: 'PVE API 網址',
    placeHolder: 'https://pve.example.com:8006',
    ignoreFocusOut: true,
    validateInput: (value) => validateApiUrl(value),
  });
  if (!apiUrlInput) return;

  const tokenId = await vscode.window.showInputBox({
    title: '新增 Proxmox VE 叢集',
    prompt: 'API 權杖 ID（user@realm!token-name）',
    placeHolder: 'root@pam!vscode',
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^[^\s=!]+@[^\s=!]+![^\s=!]+$/.test(value.trim())
        ? undefined
        : '請使用 PVE 權杖格式：user@realm!token-name。',
  });
  if (!tokenId) return;

  const tokenSecret = await vscode.window.showInputBox({
    title: '新增 Proxmox VE 叢集',
    prompt: 'API 權杖密鑰（安全儲存於 VS Code 安全儲存區）',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : '請輸入權杖密鑰。'),
  });
  if (!tokenSecret) return;

  const cluster: PveCluster = {
    id: crypto.randomUUID(),
    name: name.trim(),
    apiUrl: normalizeApiUrl(apiUrlInput),
    tokenId: tokenId.trim(),
  };

  try {
    const version = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `正在測試 ${cluster.name}...` },
      () => service.testConnection(cluster, tokenSecret),
    );
    await store.saveCluster(cluster, tokenSecret);
    tree.refresh();
    const versionLabel = version.version ?? version.release;
    void vscode.window.showInformationMessage(
      `已連線至 ${cluster.name}${versionLabel ? `（PVE ${versionLabel}）` : ''}。`,
    );
    output.info(`已新增叢集 ${cluster.name}（${cluster.apiUrl}）。`);
  } catch (error) {
    const message = describePveError(error);
    output.error(`無法新增叢集 ${cluster.name}：${message}`);
    void vscode.window.showErrorMessage(`無法連線至 ${cluster.name}：${message}`);
  }
}

async function testConnection(
  value: unknown,
  store: ExtensionStore,
  service: PveService,
  output: vscode.LogOutputChannel,
): Promise<void> {
  const cluster = await selectCluster(value, store, '選擇要測試的叢集');
  if (!cluster) return;

  try {
    const version = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `正在測試 ${cluster.name}...` },
      () => service.testConnection(cluster),
    );
    const versionLabel = version.version ?? version.release ?? '未知';
    void vscode.window.showInformationMessage(`${cluster.name} 連線正常（PVE ${versionLabel}）。`);
    output.info(`${cluster.name} 連線測試成功。`);
  } catch (error) {
    const message = describePveError(error);
    output.error(`${cluster.name} 連線測試失敗：${message}`);
    void vscode.window.showErrorMessage(`${cluster.name}：${message}`);
  }
}

async function importResource(
  value: unknown,
  store: ExtensionStore,
  tree: PveTreeProvider,
  service: PveService,
  preview: PreviewProvider,
  output: vscode.LogOutputChannel,
): Promise<SshTarget | undefined> {
  const resource = isPveResource(value) ? value : await selectResource(tree, store, false);
  if (!resource) return undefined;
  const target = await promptForTarget(resource, store, service);
  if (!target) return undefined;

  await store.saveTargets([target]);
  tree.refresh(resource.clusterId);
  await connectToTarget(resource, target, store, preview, output);
  return target;
}

async function importSelectedResources(
  store: ExtensionStore,
  tree: PveTreeProvider,
  service: PveService,
  preview: PreviewProvider,
  output: vscode.LogOutputChannel,
): Promise<void> {
  const resources = await loadResources(tree);
  if (!resources) return;

  const clusters = new Map(store.getClusters().map((cluster) => [cluster.id, cluster]));
  const picks = resources.map((resource) => ({
    label: `$(remote) ${resource.name}`,
    description: `${clusters.get(resource.clusterId)?.name ?? '未知叢集'} | ${resourceTypeLabels[resource.type]}${resource.vmid ? ` ${resource.vmid}` : ''}`,
    detail: `${resource.node}${resource.status ? ` | ${localizePveStatus(resource.status)}` : ''}`,
    resource,
    picked: Boolean(store.getTarget(resourceKey(resource))),
  }));
  const selected = await vscode.window.showQuickPick(picks, {
    title: '匯入 PVE 資源',
    placeHolder: '選擇一個或多個資源',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!selected || selected.length === 0) return;

  const targets: SshTarget[] = [];
  for (const pick of selected) {
    const target = await promptForTarget(pick.resource, store, service);
    if (!target) return;
    targets.push(target);
  }
  await store.saveTargets(targets);
  tree.refresh();
  const synced = await syncHosts(store, preview, output);
  if (!synced) return;

  const targetToConnect = targets.length === 1
    ? { target: targets[0], resource: selected[0].resource }
    : await vscode.window.showQuickPick(
        targets.map((target, index) => ({
          label: `$(remote) ${target.hostAlias}`,
          description: target.hostName,
          target,
          resource: selected[index].resource,
        })),
        {
          title: '選擇要立即連線的主機',
          placeHolder: 'SSH 設定已同步，請選擇一台主機連線',
        },
      );
  if (targetToConnect) {
    await connectToTarget(
      targetToConnect.resource,
      targetToConnect.target,
      store,
      preview,
      output,
    );
  }
}

async function connectResource(
  value: unknown,
  store: ExtensionStore,
  tree: PveTreeProvider,
  service: PveService,
  preview: PreviewProvider,
  output: vscode.LogOutputChannel,
): Promise<void> {
  const resource = isPveResource(value) ? value : await selectResource(tree, store, true);
  if (!resource) return;

  let target = store.getTarget(resourceKey(resource));
  if (!target) {
    target = await promptForTarget(resource, store, service);
    if (!target) return;
    await store.saveTargets([target]);
    tree.refresh(resource.clusterId);
  }

  await connectToTarget(resource, target, store, preview, output);
}

async function connectToTarget(
  resource: PveResource,
  initialTarget: SshTarget,
  store: ExtensionStore,
  preview: PreviewProvider,
  output: vscode.LogOutputChannel,
): Promise<void> {
  let target = await confirmNodeHostName(resource, initialTarget, store);
  if (!target) return;
  target = await confirmIdentityFile(target, store);
  if (!target) return;
  const proxyJumpReady = await confirmProxyJumpTarget(target, store);
  if (!proxyJumpReady) return;
  const synced = await syncHosts(store, preview, output);
  if (!synced) return;

  const remoteSsh = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
  if (!remoteSsh) {
    const action = await vscode.window.showErrorMessage(
      '必須安裝 Remote - SSH 才能連線至此目標。',
      '開啟擴充功能',
    );
    if (action === '開啟擴充功能') {
      await vscode.commands.executeCommand(
        'workbench.extensions.search',
        '@id:ms-vscode-remote.remote-ssh',
      );
    }
    return;
  }

  const uri = vscode.Uri.from({
    scheme: 'vscode-remote',
    authority: `ssh-remote+${target.hostAlias}`,
    path: '/',
  });
  output.info(`正在使用 SSH 別名 ${target.hostAlias} 連線。`);
  await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
}

async function syncHosts(
  store: ExtensionStore,
  preview: PreviewProvider,
  output: vscode.LogOutputChannel,
  interactive = true,
): Promise<boolean> {
  const targets = store.getTargets().filter((target) => target.enabled);
  if (targets.length === 0) {
    if (interactive) void vscode.window.showWarningMessage('目前沒有已啟用的 SSH 匯入目標。');
    return false;
  }

  try {
    const configuredPath = store.getConfiguration('sshConfigFile', '~/.ssh/pve_vscode_hosts');
    const managedPath = resolveUserPath(configuredPath);
    const remoteConfigSetting = vscode.workspace
      .getConfiguration('remote.SSH')
      .get<string>('configFile');
    const remoteConfigPath = resolveRemoteSshConfigPath(remoteConfigSetting);
    const oldManaged = await readIfExists(managedPath);
    const newManaged = mergeManagedBlock(oldManaged, renderManagedBlock(targets));
    const shouldAddInclude =
      path.resolve(managedPath).toLocaleLowerCase() !==
      path.resolve(remoteConfigPath).toLocaleLowerCase();
    const oldRemoteConfig = shouldAddInclude ? await readIfExists(remoteConfigPath) : '';
    const withoutLegacyInclude = shouldAddInclude
      ? removeIncludeDirective(oldRemoteConfig, configuredPath)
      : oldRemoteConfig;
    const newRemoteConfig = shouldAddInclude
      ? ensureIncludeDirective(
          withoutLegacyInclude,
          managedPath,
        )
      : oldRemoteConfig;
    const hasManagedChanges = oldManaged !== newManaged;
    const hasIncludeChanges = shouldAddInclude && oldRemoteConfig !== newRemoteConfig;

    if (!hasManagedChanges && !hasIncludeChanges) {
      output.info('SSH 主機設定已是最新狀態。');
      return true;
    }

    if (interactive) {
      if (hasManagedChanges) {
        await showDiff(
          preview,
          oldManaged,
          newManaged,
          `${path.basename(managedPath)}（PVE 受管理主機）`,
        );
      }
      if (hasIncludeChanges) {
        await showDiff(
          preview,
          oldRemoteConfig,
          newRemoteConfig,
          `${path.basename(remoteConfigPath)}（Remote - SSH Include 指令）`,
        );
      }
      const choice = await vscode.window.showWarningMessage(
        `要將 ${targets.length} 個受管理的 SSH 主機寫入 ${managedPath} 嗎？`,
        { modal: true },
        '寫入 SSH 設定',
      );
      if (choice !== '寫入 SSH 設定') return false;
    }

    if (hasManagedChanges) {
      await writeConfig(managedPath, newManaged);
    }
    if (hasIncludeChanges) {
      await writeConfig(remoteConfigPath, newRemoteConfig);
    }
    output.info(`已將 ${targets.length} 個主機同步至 ${managedPath}。`);
    if (interactive) {
      void vscode.window.showInformationMessage(`已同步 ${targets.length} 個 PVE SSH 主機。`);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`SSH 設定同步失敗：${message}`);
    if (interactive) void vscode.window.showErrorMessage(`SSH 設定同步失敗：${message}`);
    return false;
  }
}

async function openSshConfig(store: ExtensionStore): Promise<void> {
  const configuredPath = store.getConfiguration('sshConfigFile', '~/.ssh/pve_vscode_hosts');
  const filePath = resolveUserPath(configuredPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '', { encoding: 'utf8', mode: 0o600 });
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(document);
}

async function removeCluster(
  value: unknown,
  store: ExtensionStore,
  tree: PveTreeProvider,
): Promise<void> {
  const cluster = await selectCluster(value, store, '選擇要移除的叢集');
  if (!cluster) return;
  const choice = await vscode.window.showWarningMessage(
    `要移除 ${cluster.name} 及其匯入目標嗎？SSH 設定檔會在下次同步時更新。`,
    { modal: true },
    '移除叢集',
  );
  if (choice !== '移除叢集') return;
  await store.removeCluster(cluster.id);
  tree.refresh();
}

async function promptForTarget(
  resource: PveResource,
  store: ExtensionStore,
  service: PveService,
): Promise<SshTarget | undefined> {
  const cluster = store.getClusters().find((item) => item.id === resource.clusterId);
  if (!cluster) {
    void vscode.window.showErrorMessage('此資源所屬的叢集已不存在。');
    return undefined;
  }
  const existing = store.getTarget(resourceKey(resource));
  const currentResourceKey = resourceKey(resource);
  const alias = await vscode.window.showInputBox({
    title: `匯入 ${resource.name}`,
    prompt: 'SSH 主機別名',
    value: existing?.hostAlias ?? defaultAlias(cluster.name, resource.name, resource.vmid),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const normalizedAlias = value.trim();
      const validationError = validateField({
        ...targetDefaults(resource, store),
        hostAlias: normalizedAlias,
      }, 'hostAlias');
      if (validationError) return validationError;
      const conflict = store.getTargets().find(
        (target) =>
          target.resourceKey !== currentResourceKey &&
          target.hostAlias.toLocaleLowerCase() === normalizedAlias.toLocaleLowerCase(),
      );
      return conflict ? `此主機別名已由 ${conflict.resourceKey} 使用。` : undefined;
    },
  });
  if (!alias) return undefined;

  let detectedHostName = existing?.hostName ?? resource.suggestedHostName;
  let attemptedIpDetection = false;
  if (
    !detectedHostName &&
    resource.type !== 'node' &&
    store.getConfiguration('autoDetectGuestIp', true)
  ) {
    attemptedIpDetection = true;
    detectedHostName = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `正在偵測 ${resource.name} 的 IP 位址...`,
      },
      () => service.resolveGuestIp(resource),
    );
    if (detectedHostName) {
      resource.suggestedHostName = detectedHostName;
    }
  }

  const hostName = await vscode.window.showInputBox({
    title: `匯入 ${resource.name}`,
    prompt:
      resource.type === 'node'
        ? '節點 IP 位址或 DNS 名稱'
        : detectedHostName
          ? `已自動偵測 IP 位址；請確認或修改`
          : attemptedIpDetection
            ? '無法自動偵測 IP，請手動輸入 IP 位址或 DNS 名稱'
            : '請輸入虛擬機／容器 IP 位址或 DNS 名稱',
    value:
      detectedHostName ??
      (resource.type === 'node' ? new URL(cluster.apiUrl).hostname : ''),
    placeHolder: resource.type === 'node' ? resource.node : '10.0.1.201',
    ignoreFocusOut: true,
    validateInput: (value) =>
      validateField({ ...targetDefaults(resource, store), hostName: value.trim() }, 'hostName'),
  });
  if (!hostName) return undefined;

  const user = await vscode.window.showInputBox({
    title: `匯入 ${resource.name}`,
    prompt: 'SSH 使用者名稱',
    value: existing?.user ?? store.getConfiguration('defaultUser', 'root'),
    ignoreFocusOut: true,
    validateInput: (value) =>
      validateField({ ...targetDefaults(resource, store), user: value.trim() }, 'user'),
  });
  if (!user) return undefined;

  const portText = await vscode.window.showInputBox({
    title: `匯入 ${resource.name}`,
    prompt: 'SSH 連接埠',
    value: String(existing?.port ?? store.getConfiguration('defaultPort', 22)),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65535
        ? undefined
        : 'SSH 連接埠必須介於 1 到 65535。';
    },
  });
  if (!portText) return undefined;

  const identityFile = await vscode.window.showInputBox({
    title: `匯入 ${resource.name}`,
    prompt: '私鑰路徑（選填；不會儲存私鑰內容）',
    value: existing?.identityFile ?? store.getConfiguration('defaultIdentityFile', ''),
    ignoreFocusOut: true,
    validateInput: (value) => /[\r\n]/.test(value) ? '路徑不可包含換行字元。' : undefined,
  });
  if (identityFile === undefined) return undefined;

  let proxyJump = existing?.proxyJump ?? '';
  if (resource.type !== 'node' && store.getConfiguration('useProxyJump', false)) {
    const nodeResource: PveResource = {
      clusterId: resource.clusterId,
      type: 'node',
      node: resource.node,
      name: resource.node,
    };
    proxyJump = store.getTarget(resourceKey(nodeResource))?.hostAlias ?? proxyJump;
    const enteredProxy = await vscode.window.showInputBox({
      title: `匯入 ${resource.name}`,
      prompt: 'ProxyJump SSH 別名（選填）',
      value: proxyJump,
      placeHolder: 'pve-node1',
      ignoreFocusOut: true,
      validateInput: (value) => /\s/.test(value) ? 'ProxyJump 不可包含空白。' : undefined,
    });
    if (enteredProxy === undefined) return undefined;
    proxyJump = enteredProxy.trim();
  }

  const target: SshTarget = {
    resourceKey: resourceKey(resource),
    hostAlias: alias.trim(),
    hostName: hostName.trim(),
    user: user.trim(),
    port: Number(portText),
    identityFile: identityFile.trim() || undefined,
    proxyJump: proxyJump || undefined,
    enabled: true,
  };
  const validationError = validateSshTarget(target);
  if (validationError) {
    void vscode.window.showErrorMessage(validationError);
    return undefined;
  }
  return target;
}

function targetDefaults(resource: PveResource, store: ExtensionStore): SshTarget {
  return {
    resourceKey: resourceKey(resource),
    hostAlias: 'host',
    hostName: 'host.example.com',
    user: store.getConfiguration('defaultUser', 'root'),
    port: store.getConfiguration('defaultPort', 22),
    enabled: true,
  };
}

function validateField(target: SshTarget, field: 'hostAlias' | 'hostName' | 'user'): string | undefined {
  const validationError = validateSshTarget(target);
  if (!validationError) return undefined;
  const expectedPrefix: Record<typeof field, string> = {
    hostAlias: '主機別名',
    hostName: '主機位址',
    user: 'SSH 使用者名稱',
  };
  return validationError.startsWith(expectedPrefix[field]) ? validationError : undefined;
}

async function selectCluster(
  value: unknown,
  store: ExtensionStore,
  placeHolder: string,
): Promise<PveCluster | undefined> {
  const fromArgument = getClusterFromArgument(value);
  if (fromArgument) return fromArgument;
  const clusters = store.getClusters();
  if (clusters.length === 0) {
    void vscode.window.showWarningMessage('尚未設定 PVE 叢集。');
    return undefined;
  }
  if (clusters.length === 1) return clusters[0];
  const selected = await vscode.window.showQuickPick(
    clusters.map((cluster) => ({
      label: cluster.name,
      description: cluster.apiUrl,
      cluster,
    })),
    { placeHolder },
  );
  return selected?.cluster;
}

async function selectResource(
  tree: PveTreeProvider,
  store: ExtensionStore,
  importedOnly: boolean,
): Promise<PveResource | undefined> {
  const resources = await loadResources(tree);
  if (!resources) return undefined;
  const filtered = importedOnly
    ? resources.filter((resource) => store.getTarget(resourceKey(resource)))
    : resources;
  if (filtered.length === 0) {
    void vscode.window.showWarningMessage(
      importedOnly ? '目前沒有可用的已匯入 PVE 資源。' : '目前沒有可用的 PVE 資源。',
    );
    return undefined;
  }
  const clusters = new Map(store.getClusters().map((cluster) => [cluster.id, cluster]));
  const selected = await vscode.window.showQuickPick(
    filtered.map((resource) => ({
      label: resource.name,
      description: `${clusters.get(resource.clusterId)?.name ?? '未知叢集'} | ${resourceTypeLabels[resource.type]}`,
      detail: localizePveStatus(resource.status),
      resource,
    })),
    { placeHolder: importedOnly ? '選擇要連線的資源' : '選擇要匯入的資源' },
  );
  return selected?.resource;
}

async function loadResources(tree: PveTreeProvider): Promise<PveResource[] | undefined> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: '正在載入 PVE 資源' },
      () => tree.allResources(),
    );
  } catch (error) {
    void vscode.window.showErrorMessage(describePveError(error));
    return undefined;
  }
}

async function showDiff(
  preview: PreviewProvider,
  before: string,
  after: string,
  title: string,
): Promise<void> {
  const beforeUri = preview.create(`${title}-before`, before);
  const afterUri = preview.create(`${title}-after`, after);
  await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title, { preview: true });
}

async function confirmNodeHostName(
  resource: PveResource,
  target: SshTarget,
  store: ExtensionStore,
): Promise<SshTarget | undefined> {
  if (resource.type !== 'node' || target.hostName !== resource.node) {
    return target;
  }
  const cluster = store.getClusters().find((item) => item.id === resource.clusterId);
  if (!cluster) return target;
  const apiHostName = new URL(cluster.apiUrl).hostname;
  if (apiHostName === resource.node) return target;

  const useApiAddress = `改用 ${apiHostName}`;
  const keepNodeName = `保留 ${resource.node}`;
  const action = await vscode.window.showWarningMessage(
    `SSH 主機位址目前是節點名稱「${resource.node}」，本機可能無法解析。要改用 PVE API 位址「${apiHostName}」嗎？`,
    { modal: true },
    useApiAddress,
    keepNodeName,
  );
  if (!action) return undefined;
  if (action === keepNodeName) return target;

  const updated = { ...target, hostName: apiHostName };
  await store.saveTargets([updated]);
  return updated;
}

async function confirmIdentityFile(
  target: SshTarget,
  store: ExtensionStore,
): Promise<SshTarget | undefined> {
  if (!target.identityFile) return target;
  const identityPath = resolveUserPath(target.identityFile);
  try {
    await fs.access(identityPath);
    return target;
  } catch {
    const removeIdentity = '移除私鑰路徑';
    const action = await vscode.window.showWarningMessage(
      `指定的 SSH 私鑰不存在：${identityPath}。移除此設定後，SSH 仍可嘗試其他預設金鑰、SSH agent 或密碼登入。`,
      { modal: true },
      removeIdentity,
    );
    if (action !== removeIdentity) return undefined;
    const updated = { ...target, identityFile: undefined };
    await store.saveTargets([updated]);
    return updated;
  }
}

async function confirmProxyJumpTarget(
  target: SshTarget,
  store: ExtensionStore,
): Promise<boolean> {
  if (!target.proxyJump) return true;
  const jumpTarget = store
    .getTargets()
    .find((candidate) => candidate.hostAlias === target.proxyJump);
  if (!jumpTarget) return true;

  const nodeMatch = jumpTarget.resourceKey.match(/^(.+):node:(.+)$/);
  let verifiedTarget = jumpTarget;
  if (nodeMatch) {
    const nodeResource: PveResource = {
      clusterId: nodeMatch[1],
      type: 'node',
      node: nodeMatch[2],
      name: nodeMatch[2],
    };
    const corrected = await confirmNodeHostName(nodeResource, verifiedTarget, store);
    if (!corrected) return false;
    verifiedTarget = corrected;
  }

  return Boolean(await confirmIdentityFile(verifiedTarget, store));
}

async function readIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function writeConfig(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
}

function getClusterFromArgument(value: unknown): PveCluster | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if ('cluster' in value) {
    const cluster = (value as { cluster?: unknown }).cluster;
    return isPveCluster(cluster) ? cluster : undefined;
  }
  return isPveCluster(value) ? value : undefined;
}

function isPveCluster(value: unknown): value is PveCluster {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PveCluster).id === 'string' &&
      typeof (value as PveCluster).name === 'string' &&
      typeof (value as PveCluster).apiUrl === 'string' &&
      typeof (value as PveCluster).tokenId === 'string',
  );
}

function isPveResource(value: unknown): value is PveResource {
  if (!value || typeof value !== 'object') return false;
  if ('resource' in value) {
    return isPveResource((value as { resource?: unknown }).resource);
  }
  const candidate = value as PveResource;
  return (
    typeof candidate.clusterId === 'string' &&
    ['node', 'qemu', 'lxc'].includes(candidate.type) &&
    typeof candidate.node === 'string' &&
    typeof candidate.name === 'string'
  );
}

function validateApiUrl(value: string): string | undefined {
  try {
    normalizeApiUrl(value);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : '請輸入有效的 PVE 網址。';
  }
}
