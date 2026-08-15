# PVE SSH 匯入器

在 VS Code 中讀取 Proxmox VE 節點、QEMU 虛擬機與 LXC 容器，建立受管理的 SSH 主機設定，並直接透過 Microsoft Remote - SSH 連線。

本擴充功能是社群專案，並非 Proxmox Server Solutions GmbH 或 Microsoft 的官方產品。

## 主要功能

- 使用 PVE API 權杖新增多個叢集，權杖密鑰存放於 VS Code 安全儲存區。
- 從活動列瀏覽 PVE 節點、QEMU 虛擬機及 LXC 容器。
- 自動補查 `/nodes/{node}/qemu` 與 `/nodes/{node}/lxc`，避免叢集資源清單不完整。
- 自動偵測 LXC 網路介面與 QEMU Guest Agent 回報的 IP 位址。
- 匯入單一或多個資源，設定 SSH 別名、使用者、連接埠、私鑰及選用的 `ProxyJump`。
- 寫入前預覽 SSH 設定差異，只維護有明確標記的區塊。
- 匯入後直接開啟 Remote - SSH，不需要再次從主機清單尋找。
- 所有操作介面、提示、狀態與錯誤訊息皆為繁體中文。

## 系統需求

- VS Code 1.96.0 或更新版本。
- Windows、macOS 或 Linux 的 OpenSSH 用戶端。
- 可從本機連線至 PVE API，通常是 `https://<PVE 主機>:8006`。
- PVE 7／8／9；擴充功能使用公開的 `/api2/json` API。
- Microsoft Remote - SSH。安裝本擴充功能時，VS Code 會一併處理此相依套件。

## 快速開始

1. 在活動列開啟「PVE SSH」。
2. 按下新增圖示，或從命令選擇區執行 `PVE：新增叢集`。
3. 輸入叢集名稱、PVE API 網址、權杖 ID 與權杖密鑰。
4. 展開資源樹，在節點、虛擬機或容器旁按下匯入圖示。
5. 確認自動偵測的 IP 與 SSH 帳號，檢查差異後允許寫入設定。
6. 擴充功能會在新 VS Code 視窗中啟動 Remote - SSH 連線。

第一次連線仍須輸入 SSH 密碼或使用有效私鑰。PVE API 權杖只用於讀取資源，不能代替 SSH 登入。

## PVE 權限

建議建立專用的唯讀 API 權杖，不要使用帳號密碼。最簡單的設定方式，是將內建角色 `PVEAuditor` 指派到 `/`，並套用至該權杖；若只允許部分資源，至少要讓權杖能讀取節點、虛擬機及容器清單。

權杖 ID 格式如下：

```text
user@realm!token-name
```

若建立權杖時啟用了 Privilege Separation，權杖不會自動繼承使用者的全部權限，必須另外將 ACL 指派給權杖主體。即使權杖屬於 `root@pam`，缺少 ACL 時仍可能收到 HTTP 403 或看不到 LXC／QEMU 資源。

常用 API 與用途：

| API | 用途 |
| --- | --- |
| `/version` | 測試 PVE API 連線 |
| `/cluster/resources` | 取得叢集資源清單 |
| `/nodes` | 資源清單缺少節點時補查 |
| `/nodes/{node}/qemu` | 補查 QEMU 虛擬機 |
| `/nodes/{node}/lxc` | 補查 LXC 容器 |
| `/nodes/{node}/lxc/{vmid}/interfaces` | 偵測 LXC IP |
| `/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces` | 偵測 QEMU IP |

## Guest IP 自動偵測

匯入 LXC 時會讀取目前的介面資料；匯入 QEMU 時會查詢 QEMU Guest Agent。系統會排除 loopback、link-local、multicast 與未指定位址，並優先選擇 IPv4。

下列情況會改為要求手動輸入 IP 或 DNS 名稱：

- Guest 已關機。
- QEMU Guest Agent 未安裝、未啟用或未執行。
- API 權杖無權讀取介面資料。
- Guest 只有不可用的本機或自動設定位址。

## SSH 連線

受管理主機預設寫入：

```text
~/.ssh/pve_vscode_hosts
```

每次同步只會取代以下標記之間的內容：

```sshconfig
# >>> PVE SSH Importer managed hosts >>>
# <<< PVE SSH Importer managed hosts <<<
```

當 Remote - SSH 使用另一個設定檔時，擴充功能會在該檔案的全域設定最前方加入一次絕對路徑 `Include`。例如 Windows：

```sshconfig
Include C:/Users/<使用者>/.ssh/pve_vscode_hosts

Host example
    HostName 192.0.2.10
```

`Include` 必須位於第一個 `Host` 區段之前，否則 OpenSSH 可能無法解析匯入的別名。擴充功能會自動修正舊版產生在錯誤位置的指令。

SSH 登入權限與 PVE API 權限彼此獨立。使用 `root` 作為 SSH 帳號並不會略過密碼、私鑰、`sshd_config` 或容器內的登入限制。

## 設定

| 設定 | 預設值 | 說明 |
| --- | --- | --- |
| `pveSshImporter.sshConfigFile` | `~/.ssh/pve_vscode_hosts` | 受管理的 SSH 主機設定檔 |
| `pveSshImporter.defaultUser` | `root` | 新匯入目標的 SSH 使用者 |
| `pveSshImporter.defaultPort` | `22` | 新匯入目標的 SSH 連接埠 |
| `pveSshImporter.defaultIdentityFile` | 空白 | 選用私鑰路徑；不儲存私鑰內容 |
| `pveSshImporter.useProxyJump` | `false` | 將 PVE 節點用作 Guest 跳板 |
| `pveSshImporter.autoDetectGuestIp` | `true` | 自動偵測 LXC／QEMU IP |
| `pveSshImporter.autoSyncOnStartup` | `false` | VS Code 啟動時同步已匯入目標 |
| `pveSshImporter.allowInsecureTls` | `false` | 允許不受信任的 PVE TLS 憑證 |

## 指令

| 指令 | 用途 |
| --- | --- |
| `PVE：新增叢集` | 測試並安全儲存 PVE API 連線 |
| `PVE：測試連線` | 驗證現有叢集認證 |
| `PVE：重新整理資源` | 清除快取並重新載入資源 |
| `PVE：匯入並連線` | 匯入單一資源並立即連線 |
| `PVE：匯入所選資源` | 批次匯入，再選擇一台連線 |
| `PVE：同步 SSH 主機` | 預覽並寫入受管理設定 |
| `PVE：連線至資源` | 使用 Remote - SSH 開啟已匯入主機 |
| `PVE：開啟 SSH 設定檔` | 開啟受管理的 SSH 設定檔 |
| `PVE：移除叢集` | 刪除叢集、權杖密鑰及相關目標 |

## 疑難排解

### 看不到 LXC 或 QEMU

確認權杖具有相關資源的 `VM.Audit` 權限。Privilege Separation 開啟時，ACL 必須指派給權杖本身。重新整理後，可在「PVE SSH 匯入器」輸出面板查看補查失敗的 API。

### 無法自動取得 IP

確認 Guest 正在執行。QEMU 必須安裝並啟用 Guest Agent；LXC 權杖必須能讀取介面資訊。無法偵測時可以直接輸入 IP。

### 顯示 Could not resolve hostname

執行 `PVE：同步 SSH 主機`，並確認 VS Code 的 `remote.SSH.configFile` 指向包含全域 `Include` 的設定檔。不要把 `Include` 放在任何 `Host` 區段後方。

### 主機可達但登入失敗

這代表 DNS／IP 與 SSH 連接埠已正常，仍須修正密碼、私鑰、SSH 使用者或伺服器端登入政策。PVE 權杖不能用來登入 SSH。

### PVE TLS 憑證錯誤

優先在 PVE 安裝受信任憑證。只有在了解中間人攻擊風險後，才啟用 `pveSshImporter.allowInsecureTls`。

## 資料與隱私

本擴充功能不包含遙測、分析或廣告，也不會把 PVE 資料傳送給開發者。它只會連線至使用者設定的 PVE API，並將選定的 SSH 設定寫入本機檔案。權杖密鑰使用 VS Code `SecretStorage` 保存；叢集網址、權杖 ID 與 SSH 目標保存在 VS Code 的本機設定或擴充功能狀態中。完整細節請參閱套件內的 `PRIVACY.md`。

## 從原始碼建置

```powershell
npm ci
npm run check
npm run compile
```

以 VS Code 開啟專案並按下 `F5`，即可啟動擴充功能開發主機。

## 授權

本專案採用 MIT License。Proxmox、Proxmox VE 與 Microsoft Visual Studio Code 是其各自所有者的商標。
