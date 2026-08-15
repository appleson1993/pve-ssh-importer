# PVE SSH Importer for VS Code - Product Requirements Document

## 1. 文件資訊

- 產品：PVE SSH Importer
- 版本：MVP 0.1
- 平台：VS Code Desktop
- 主要整合：Proxmox VE API、OpenSSH config、Microsoft Remote - SSH

## 2. 問題與目標

管理 PVE 的開發者常需要先到 PVE 查詢節點或 Guest，再手動維護 SSH alias，最後回到 VS Code Remote - SSH 連線。這個流程重複、容易輸入錯誤，也無法反映叢集資源清單。

本產品在 VS Code 內提供 PVE 資源樹，將 node、QEMU VM 與 LXC 映射成 SSH target，經使用者預覽後寫入 OpenSSH config，並使用 Remote - SSH 開啟連線。

MVP 成功條件：

- 能連線至少一個 PVE API 並列出 node、qemu、lxc。
- 能把任一資源轉成合法的 SSH `Host` entry。
- 能批次選擇資源並逐一確認必要的 SSH 欄位。
- 寫檔前顯示差異，且不修改 managed block 以外的內容。
- 能以產生的 alias 觸發 Remote - SSH。
- Token Secret 不出現在 settings、log 或錯誤訊息中。

## 3. 使用者與核心情境

主要使用者是管理自架 PVE 環境的開發者、維運工程師與小型團隊管理者。

核心流程：

1. 使用者執行 `PVE: Add Cluster`。
2. 輸入顯示名稱、API URL、Token ID 與 Token Secret。
3. Extension 先呼叫 `/api2/json/version`；只有測試成功才保存設定。
4. 使用者從 Activity Bar 展開 cluster、Nodes、QEMU VMs 或 LXCs。
5. 使用者匯入資源並確認 alias、IP/DNS、user、port、key path 與 ProxyJump。
6. 使用者執行同步，檢查 diff 後確認寫檔。
7. 使用者點選已匯入資源，Extension 以 `vscode-remote://ssh-remote+<alias>` 開啟 Remote - SSH 視窗。

## 4. 功能需求

### FR-01 Cluster 管理（P0）

- 支援多個 cluster。
- Cluster 欄位包含 `id`、`name`、`apiUrl`、`tokenId`。
- Token ID 使用 `user@realm!token-name` 格式。
- Token Secret 必須存於 VS Code `SecretStorage`。
- 移除 cluster 時，同時刪除 secret 與該 cluster 的 target mapping；既有 SSH 檔案等下次同步才更新。

### FR-02 API 連線（P0）

- `GET /api2/json/version` 用於連線測試。
- `GET /api2/json/cluster/resources` 作為 MVP 唯一資源清單來源。
- 支援 `node`、`qemu`、`lxc`，忽略其他資源類型。
- 預設驗證 TLS 憑證；使用者可明確開啟 insecure TLS。
- API timeout 為 15 秒。

### FR-03 資源樹（P0）

- 第一層顯示 cluster。
- 第二層固定顯示 Nodes、QEMU VMs、LXCs 與數量。
- 資源顯示名稱、VMID（如適用）、狀態、node 與 tags。
- 已匯入資源的預設動作為 Connect，未匯入資源為 Import。
- Refresh 清除記憶體快取並於下次展開重新讀取。

### FR-04 SSH mapping（P0）

- 必填：Host alias、HostName、User、Port。
- 選填：IdentityFile、ProxyJump。
- Node 預設 HostName 為 PVE node 名稱。
- QEMU/LXC 優先自動偵測即時 IP，偵測失敗時才由使用者輸入 IP 或 DNS。
- LXC 使用 `/nodes/{node}/lxc/{vmid}/interfaces`；QEMU 使用 Guest Agent `network-get-interfaces`。
- 自動排除 loopback、link-local、multicast 與未指定位址，並優先選擇 IPv4。
- 若同一 node 已匯入且 `useProxyJump=true`，Guest 預填該 node alias。
- 相同 `resourceKey` 再次匯入時更新 target，不新增重複 mapping。

### FR-05 SSH config 同步（P0）

- 預設目標為 `~/.ssh/pve_vscode_hosts`。
- 只管理明確 marker 之間的內容。
- 同步前顯示舊內容與新內容 diff，經 modal confirmation 後才寫檔。
- 專用檔案以 `Include` 接入 `~/.ssh/config`，重複同步不得新增重複 directive。
- Host 依 alias 排序，以產生穩定 diff。
- Alias 僅允許字母、數字、點、底線與連字號；其他欄位拒絕換行等可能造成額外設定注入的輸入。

### FR-06 Remote - SSH（P0）

- 連線前檢查 `ms-vscode-remote.remote-ssh` 是否存在。
- 若不存在，提供前往 Extensions 的動作。
- 若 `remote.SSH.configFile` 指向非主要或 managed 檔案，同步後提出警告。

## 5. 非功能需求

- 安全：SecretStorage、預設 TLS 驗證、log 去敏感資訊、SSH 欄位驗證。
- 資料完整性：不覆寫 managed block 外的使用者內容。
- 可測試性：API 資源映射與 SSH 純函式可在 VS Code 外執行單元測試。
- 可維護性：PVE client、storage、tree、SSH writer、preview 與 command orchestration 分離。
- 可用性：所有長時間 API 呼叫顯示 progress；取消輸入不得留下部分 cluster 設定。

## 6. 資料模型

```ts
type PveCluster = {
  id: string;
  name: string;
  apiUrl: string;
  tokenId: string;
};

type PveResource = {
  clusterId: string;
  type: 'node' | 'qemu' | 'lxc';
  node: string;
  vmid?: number;
  name: string;
  status?: string;
  tags?: string[];
  suggestedHostName?: string;
};

type SshTarget = {
  resourceKey: string;
  hostAlias: string;
  hostName: string;
  user: string;
  port: number;
  identityFile?: string;
  proxyJump?: string;
  enabled: boolean;
};
```

儲存位置：

| 資料 | 儲存位置 | 理由 |
| --- | --- | --- |
| Cluster metadata、Token ID | VS Code global settings | 可檢視與多視窗共用 |
| Token Secret | SecretStorage | 避免明文設定 |
| SSH target mappings | Extension globalState | 不污染使用者 settings |
| SSH entries | 使用者設定的 OpenSSH config file | 供 Remote - SSH 使用 |

## 7. 設定

| Key | 預設值 | 說明 |
| --- | --- | --- |
| `pveSshImporter.clusters` | `[]` | 非敏感 cluster metadata |
| `pveSshImporter.sshConfigFile` | `~/.ssh/pve_vscode_hosts` | managed SSH 檔案 |
| `pveSshImporter.defaultUser` | `root` | 匯入時的預設 user |
| `pveSshImporter.defaultPort` | `22` | 匯入時的預設 port |
| `pveSshImporter.defaultIdentityFile` | `~/.ssh/id_ed25519` | 私鑰路徑，不存內容 |
| `pveSshImporter.useProxyJump` | `true` | Guest 是否預填 PVE node alias |
| `pveSshImporter.autoSyncOnStartup` | `false` | 啟動時同步已匯入 targets |
| `pveSshImporter.allowInsecureTls` | `false` | 是否略過 PVE TLS 驗證 |

## 8. 驗收測試

- 有效 Token 可新增 cluster；無效 Token 不保存 cluster 或 secret。
- 資源樹能正確分組至少一個 node、一個 QEMU 與一個 LXC。
- 重複匯入同一資源更新既有 mapping。
- Guest 沒有 IP 時，不輸入 HostName 就不能完成匯入。
- Sync diff 與實際寫入內容一致。
- 既有 `Host github.com` 等設定在同步後完全保留。
- 連續同步兩次只存在一個 managed block 與一個 `Include`。
- Host alias 含空白、wildcard、URI 分隔字元或欄位含換行時被拒絕。
- Output channel 不顯示 Token Secret。
- Remote - SSH 已安裝時可用 alias 開啟新視窗。

## 9. MVP 不包含

- DHCP lease、DNS、NAT 或 port-forward 自動推導。
- 定時背景輪詢、狀態通知與失效 target 自動刪除。
- PVE password/TFA login；MVP 僅支援 API Token。
- SSH 連線健康檢查與私鑰內容管理。

## 10. 後續里程碑

- P1：編輯或停用 target、更多 ProxyJump 策略及多網卡選擇介面。
- P1：Cluster credential 更新與每個 cluster 的 TLS 選項。
- P2：排程同步、離線資源標示、失效 host 清理預覽。
- P2：Workspace/Profiles scope 與 managed config 匯出/匯入。

## 11. 風險與決策

- `/cluster/resources` 不保證 Guest IP，因此另查 LXC 介面或 QEMU Guest Agent；查不到時不猜測，改由使用者輸入。
- Remote - SSH 沒有穩定的公開「connect host」command contract，因此採官方 remote URI resolver 形式交給 `vscode.openFolder`。
- OpenSSH `Include` 需較新的 client；若環境不支援，使用者可將 `remote.SSH.configFile` 直接設為 managed file。
- Insecure TLS 是全域設定且風險高，預設關閉並在設定說明中明確提示。
