# 版本記錄

## 0.2.2

- Windows OpenSSH 的 Include 改用絕對路徑並固定置於全域設定最前方，避免 `~` 未展開或落入 `Host` 區段而導致 alias 無法解析。
- 自動移除舊版產生的 tilde Include，避免重複設定。
- 連線 Guest 前驗證並修正已匯入的 ProxyJump 節點與私鑰。
- 新 Guest 預設不使用 ProxyJump；需要跳板時仍可在設定中啟用。
- 補齊 Marketplace 圖示、隱私、安全與正式發布文件。

## 0.2.1

- 單台資源完成匯入後，自動同步 SSH 設定並立即開啟 Remote - SSH 連線。
- 批次匯入會先同步全部 SSH 設定，再讓使用者選擇一台主機立即連線。

## 0.2.0

- 匯入 LXC 容器時，自動從 `/interfaces` 取得目前 IP 位址。
- 匯入 QEMU 虛擬機時，自動透過 QEMU Guest Agent 取得網路介面 IP。
- 自動排除 loopback、link-local、multicast 與未指定位址，並優先選擇 IPv4。
- 無法自動偵測時顯示原因提示，並保留手動輸入流程。

## 0.1.5

- 空資源分類改為一般資訊，不再錯誤顯示 `VM.Audit` 權限警告。
- 只有 API 補查實際失敗時，才會在輸出面板記錄權限檢查建議。

## 0.1.4

- 連線前檢查指定的 SSH 私鑰是否存在，避免不存在的預設路徑造成連線失敗。
- 新匯入目標不再預填未經驗證的私鑰路徑。

## 0.1.3

- 自動偵測 `remote.SSH.configFile`，將受管理主機加入 Remote - SSH 實際使用的設定檔。
- 每次連線前確認 SSH alias 已同步，避免已匯入但尚未寫入時直接連線失敗。
- PVE 節點預設使用 API 主機位址，並協助修正無法解析的既有節點名稱。

## 0.1.2

- 將所有使用者介面、狀態、提示、錯誤訊息與設定說明改為繁體中文。

## 0.1.1

- 當 `/cluster/resources` 缺少 Guest 類型時，使用 `/nodes/{node}/qemu` 與 `/nodes/{node}/lxc` 補查資源。
- 補查失敗時顯示可操作的 `VM.Audit` 權限診斷。

## 0.1.0

- 首個 MVP，提供 PVE API 權杖認證與資源探索。
- 加入資源樹、單一及批次匯入、受管理 SSH 設定同步、差異預覽與 Remote - SSH 連線。
