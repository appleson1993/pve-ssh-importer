# VS Code Marketplace 發布指南

本文件供維護者使用，不會放入最終 VSIX。

## 1. 建立 Publisher

1. 前往 [Visual Studio Marketplace Publisher 管理頁](https://marketplace.visualstudio.com/manage/publishers/)。
2. 使用 Microsoft 帳號登入並建立 Publisher。
3. 記下 Publisher ID。它只能使用英文字母、數字與連字號，且不同於顯示名稱。
4. 將 ID 寫入套件：

```powershell
npm pkg set publisher=<publisher-id>
```

`publisher` 與 `name` 組成永久擴充功能 ID，例如 `publisher-id.pve-ssh-importer`。首次發布前務必確認，發布後不要任意變更。

## 2. 建議補上來源與支援網址

若專案放在公開 GitHub 儲存庫，可執行：

```powershell
npm pkg set "repository.type=git" "repository.url=https://github.com/<owner>/<repo>.git"
npm pkg set "homepage=https://github.com/<owner>/<repo>#readme"
npm pkg set "bugs.url=https://github.com/<owner>/<repo>/issues"
```

沒有公開儲存庫仍可發布，但 Marketplace 不會顯示來源、首頁與問題回報連結。

## 3. 發布前檢查

在乾淨的原始碼目錄執行：

```powershell
npm ci
npm audit
npm run release:check
npm run package
```

`release:check` 會執行 lint、型別檢查、所有測試、正式編譯、圖示尺寸、文件、版本記錄、Publisher ID 與 VSIX 檔案清單檢查。任何一項失敗都不可發布。

安裝候選 VSIX 進行實機測試：

```powershell
code --install-extension .\pve-ssh-importer-<version>.vsix --force
```

不要雙擊 VSIX；Windows 可能錯誤地交給 Visual Studio VSIX Installer。

實機測試至少包含：

- 新增及測試 PVE API 權杖
- 顯示節點、LXC 與 QEMU
- LXC 與 QEMU IP 自動偵測
- 單一及批次匯入
- 自訂 `remote.SSH.configFile`
- `Include` 位於第一個 `Host` 之前
- Remote - SSH 密碼與私鑰登入
- 移除叢集後不再顯示相關目標

## 4. 準備 Marketplace PAT

在 Azure DevOps 建立 Personal Access Token，選擇可存取 Publisher 的組織，並只授與 Marketplace 發布管理所需權限。不要把 PAT 寫入程式碼、設定檔、命令參數或版本控制。

使用互動提示登入並驗證：

```powershell
npx vsce login <publisher-id>
npx vsce verify-pat <publisher-id>
```

在 `vsce login` 的隱藏輸入提示中貼上 PAT。

## 5. 正式發布

確認 `CHANGELOG.md` 已有目前版本，再執行：

```powershell
npm run publish:marketplace
```

發布完成後，在 Marketplace 管理頁確認圖示、README、相依套件、版本記錄與安裝按鈕均正常。索引與搜尋結果可能需要數分鐘更新。

## 6. 後續版本

每個 Marketplace 版本都必須使用新的 SemVer。修改完成後可執行：

```powershell
npm version patch --no-git-tag-version
```

接著更新 `CHANGELOG.md`、重新執行完整檢查並發布。不要覆用已發布的版本號，也不要把 `unpublish` 當成一般回滾方式。
