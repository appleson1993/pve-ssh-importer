# 隱私權說明

最後更新：2026-08-16

PVE SSH 匯入器在本機 VS Code 擴充功能主機中執行，不提供遙測、使用行為分析、廣告或開發者控制的雲端服務。

## 儲存的資料

| 資料 | 儲存位置 | 用途 |
| --- | --- | --- |
| 叢集名稱、PVE API 網址、權杖 ID | VS Code 全域使用者設定 | 顯示及重新連線至已設定叢集 |
| PVE API 權杖密鑰 | VS Code `SecretStorage` | 呼叫 PVE API |
| SSH 別名、主機、帳號、連接埠、私鑰路徑及 ProxyJump | VS Code 擴充功能全域狀態 | 重新產生受管理 SSH 設定 |
| 受管理 SSH 主機區塊 | 使用者指定的本機 SSH 設定檔 | 供 OpenSSH 與 Remote - SSH 使用 |

擴充功能只儲存私鑰路徑，不會讀取、複製或上傳私鑰內容。

## 網路連線

擴充功能只會向使用者設定的 PVE API 網址發出請求。API 權杖會放在 PVE 標準 `Authorization` 標頭中，不會寫入輸出記錄。若啟用 `allowInsecureTls`，PVE API 的 TLS 憑證不會被驗證，可能遭受中間人攻擊。

實際 SSH 連線由 Microsoft Remote - SSH 與系統 OpenSSH 處理，適用其各自的隱私權與安全設定。

## 刪除資料

執行 `PVE：移除叢集` 會刪除該叢集設定、權杖密鑰及相關 SSH 目標。解除安裝擴充功能不一定會移除已寫入的 SSH 檔案；需要時可手動刪除受管理標記區塊及主設定檔中的對應 `Include`。

## 資料分享

擴充功能不會將資料分享、出售或傳送給擴充功能發布者。PVE API 與 SSH 主機的管理者仍可能依其系統政策記錄連線資訊。
