import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const allowLocalPublisher = process.argv.includes('--allow-local-publisher');
const errors = [];
const warnings = [];

const requiredFiles = [
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'PRIVACY.md',
  'SECURITY.md',
  'dist/extension.js',
  'media/icon.png',
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`缺少發布檔案：${file}`);
  }
}

if (!/^[a-z0-9][a-z0-9-]*$/i.test(manifest.publisher ?? '')) {
  errors.push('package.json 的 publisher 不是有效的 Marketplace Publisher ID。');
} else if (manifest.publisher.toLocaleLowerCase() === 'local' && !allowLocalPublisher) {
  errors.push('package.json 的 publisher 仍是 local，請替換為實際的 Marketplace Publisher ID。');
}

if (manifest.private === true) {
  errors.push('package.json 不可保留 private: true。');
}
if (manifest.extensionPack) {
  errors.push('Remote - SSH 應宣告為 extensionDependencies，而不是 extensionPack。');
}
if (!manifest.extensionDependencies?.includes('ms-vscode-remote.remote-ssh')) {
  errors.push('缺少 Remote - SSH 擴充功能相依關係。');
}
if (manifest.icon !== 'media/icon.png') {
  errors.push('Marketplace 圖示必須指定為 media/icon.png。');
}
if (!manifest.repository?.url) {
  warnings.push('尚未設定 repository；可以發布，但 Marketplace 不會顯示來源與問題回報連結。');
}

const iconPath = path.join(root, 'media', 'icon.png');
if (fs.existsSync(iconPath)) {
  const icon = fs.readFileSync(iconPath);
  const pngSignature = '89504e470d0a1a0a';
  if (icon.subarray(0, 8).toString('hex') !== pngSignature) {
    errors.push('media/icon.png 不是有效的 PNG 檔案。');
  } else if (icon.length < 24 || icon.readUInt32BE(16) !== 128 || icon.readUInt32BE(20) !== 128) {
    errors.push('media/icon.png 必須是 128 x 128 像素。');
  }
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const heading of ['快速開始', 'PVE 權限', 'SSH 連線', '疑難排解', '資料與隱私']) {
  if (!readme.includes(heading)) {
    errors.push(`README.md 缺少「${heading}」說明。`);
  }
}
if (readme.includes('C:\\Users\\')) {
  errors.push('README.md 包含本機使用者路徑。');
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## ${manifest.version}`)) {
  errors.push(`CHANGELOG.md 缺少目前版本 ${manifest.version}。`);
}

for (const warning of warnings) {
  console.warn(`警告：${warning}`);
}
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`錯誤：${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`發布檢查通過：${manifest.publisher}.${manifest.name}@${manifest.version}`);
}
