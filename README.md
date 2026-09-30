# 英译中助手 · Chrome 扩展

一个零配置、即装即用的 Chrome / Edge 翻译扩展，专门把英文翻译成中文。
基于 **腾讯交互翻译免费接口**，无需注册、无需 API Key，国内网络直连可用。

## ✨ 功能

| 方式 | 操作 |
| --- | --- |
| 划词 | 选中英文后自动出现「译」浮按钮，点击即译 |
| 快捷键 | `Alt+T` 翻译选区 · `Alt+Shift+T` 翻译整页 |
| 右键菜单 | 选中后右键 → 「翻译选中的英文」 |
| 弹窗 | 点击工具栏图标可手动输入 / 复制译文 |
| 整页翻译 | 一键翻译页面正文段，原文后追加译文小标签，可一键恢复 |

- 深色模式自动适配
- 译文支持一键复制
- 偏好设置（邮箱配额、每页段数、是否显示浮按钮）保存在 `chrome.storage.sync`

## 📁 目录结构

```
EnglishTranTool/
├── manifest.json          # Chrome MV3 清单
├── background.js          # Service Worker：菜单、快捷键、API、整页翻译
├── content.js             # 注入脚本：浮按钮、消息桥接
├── content.css            # 气泡 / 译文 / 恢复按钮样式
├── popup.html / .css / .js  # 弹窗：输入翻译、整页、选区
├── options.html / .css / .js # 设置页
├── i18n.js                # 文案
├── lib/
│   └── translate.js       # 翻译引擎封装（腾讯主 + 有道备，分段 + 批量）
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── tools/
    └── gen_icons.py       # 图标生成脚本
```

## 🚀 安装（开发者模式）

1. 打开 Chrome，访问 `chrome://extensions`
2. 打开右上角 **「开发者模式」**
3. 点击左上角 **「加载已解压的扩展程序」**
4. 选择本仓库根目录（包含 `manifest.json` 的那一层）
5. 浏览器工具栏会出现「译」字图标 ✅

Edge 浏览器：`edge://extensions`，步骤相同。

## 📦 打包为 .crx（分发用）

> 需要本机已安装 Chrome 或新版 Edge（脚本会自动寻找）。
> 首次打包会生成私钥；**升级扩展时必须复用同一私钥**，否则 Chrome 会拒绝更新。

```powershell
# 默认：自动复制源码到临时目录 → Chrome 命令行打包 → 输出到 dist/
powershell -ExecutionPolicy Bypass -File .\tools\pack.ps1

# 自定义：指定已有私钥（升级时用）
powershell -ExecutionPolicy Bypass -File .\tools\pack.ps1 -Key "D:\keys\my.pem"
```

产物：

```
dist/
├── et-extension.crx   # 直接拖入 chrome://extensions 即可安装
└── et-key.pem         # 私钥，务必妥善保管
```

> **⚠️ 注意** ：Chrome 已收紧 `.crx` 分发策略：
> - Chrome 88+ 默认**不允许**安装来自第三方网站直接下载的 `.crx`（会弹出"无法安装"对话框）。
> - 把 `.crx` 文件直接拖到 `chrome://extensions` 仅在部分版本可用。
> - 想要全网分发，请把扩展提交到 [Chrome Web Store](https://chromewebstore.google.com/) 或 [Edge Add-ons](https://microsoftedge.microsoft.com/addons)，首次发布需支付一次性 $5 注册费。
> - **企业内部分发** 可通过组策略 `ExtensionInstallForcelist` 强制安装，参考 [Microsoft 文档](https://learn.microsoft.com/deployedge/microsoft-edge-manage-extensions)。

## ⌨️ 快捷键

| 命令 | 默认 | 说明 |
| --- | --- | --- |
| `translate-selection` | `Alt+T` | 翻译当前选区 |
| `translate-page` | `Alt+Shift+T` | 翻译当前页面正文 |

快捷键冲突时可在 `chrome://extensions/shortcuts` 重新指定。

## ⚙️ 设置

点击弹窗右上角 ⚙ 进入 `options`：
- **翻译引擎**：三选一（见下）
- **每页最多翻译段落数**：默认 200
- **选中文字时显示「译」浮按钮**：关闭后只剩快捷键与右键菜单

## 🔁 翻译引擎（可切换）

| 引擎 | 质量 | 费用 | 需要什么 |
| --- | --- | --- | --- |
| **免费（默认）**：腾讯 TransMart + 有道兜底 | ★★ 基础机翻 | 完全免费 | 无需任何 Key |
| **DeepSeek**（推荐） | ★★★★ 大模型语义翻译 | 约 ¥1/百万字 | [API Key](https://platform.deepseek.com/api_keys) |
| **百度翻译开放平台** | ★★★ 传统机翻较优 | 标准版免费（QPS=1） | [APPID+密钥](https://fanyi-api.baidu.com/) |

切换方法：设置页 → 选择引擎 → 填 Key → 点「测试连通」验证 → 保存。无需改代码。

**想要最准的译文选 DeepSeek**：长难句、技术文档、习语俚语明显优于传统机翻；`deepseek-reasoner`（R1）更准但更慢。
DeepSeek 的 Key 仅保存在本机浏览器 `chrome.storage.sync`，不会上传到任何第三方。

诊断（Node 环境）：

```bash
node tools/diagnose.mjs                       # 检查四引擎连通性 + 免费引擎实测
DEEPSEEK_API_KEY=sk-xxx node tools/diagnose.mjs  # 追加 DeepSeek 实测
```

## 🛠 重新生成图标

需要更换 logo 时：

```bash
python tools/gen_icons.py
```

> Windows 上如报 GBK 错误，请改用 `set PYTHONIOENCODING=utf-8` 或直接忽略（图标本身已生成成功）。

## ⚠️ 限制

- 免费引擎（腾讯 TransMart / 有道）为非官方公开接口，不保证长期可用；追求质量与稳定请切换 DeepSeek 或百度。
- 无法翻译 `chrome://`、`https://chromewebstore.google.com/` 等禁止注入的页面。
- 免费引擎质量为基础机翻水平；专业内容建议切换 LLM 引擎或人工核对。

## 📜 License

MIT