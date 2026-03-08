# 115网盘 PotPlayer播放 & Aria2下载

> 油猴脚本 + 本地 Helper，为 115 网盘网页端注入两个功能按钮，实现一键在 PotPlayer 中播放视频、一键将文件发送到 NAS Aria2 下载。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![UserScript](https://img.shields.io/badge/Tampermonkey-UserScript-red)](115_potplayer.user.js)

---

## 功能

- 🚀 **PotPlayer 播放**：勾选视频后一键获取 115 直链，唤起本地 PotPlayer 批量播放，支持大文件，无大小限制
- ⬇️ **Aria2 下载**：勾选任意文件后一键提交到 NAS Aria2，自动检测并修正 Aria2 的 User-Agent 设置，避免 115 CDN 返回 403

## 效果截图

> 安装后，115 网盘顶部操作栏会出现两个按钮：

| 按钮 | 功能 |
|------|------|
| 🚀 PotPlayer播放 | 勾选视频 → 一键在 PotPlayer 中播放 |
| ⬇️ Aria2下载 | 勾选任意文件 → 一键发送到 NAS Aria2 |

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `115_potplayer.user.js` | 油猴脚本主体，安装到 Tampermonkey 即可 |
| `115helper.py` | 本地 Helper 服务（可选），实现 PotPlayer 播放时 Downloads 文件夹无文件落盘 |
| `install.bat` | 一键安装 Helper 为开机自启后台服务（无窗口） |
| `uninstall.bat` | 一键卸载 Helper 自启任务 |

---

## 安装

### 第一步：安装油猴脚本

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)
2. 打开本仓库的 [`115_potplayer.user.js`](115_potplayer.user.js) → 点击右上角「Raw」
3. Tampermonkey 会自动弹出安装页面，点击「安装」

### 第二步：配置脚本参数

打开 Tampermonkey 脚本编辑器，修改顶部配置区（约第 35-37 行）：

```javascript
const ARIA2_RPC   = 'http://192.168.50.93:6800/jsonrpc';  // Aria2 RPC 地址（改成你的 NAS IP）
const ARIA2_TOKEN = '111111';                              // Aria2 Secret Token（没有留空 ''）
const ARIA2_DIR   = '/downloads';                          // NAS 下载保存目录
```

### 第三步：安装本地 Helper（可选，推荐）

不安装 Helper 也能正常使用 PotPlayer 播放，只是会在 Downloads 文件夹生成一个临时 `.m3u` 文件；安装 Helper 后播放更干净，无临时文件落盘。

**前提条件：** 已安装 Python 3.6+，且安装时勾选了「Add to PATH」

1. 打开 `115helper.py`，确认第 20 行 PotPlayer 路径正确：
   ```python
   POTPLAYER = r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe"
   ```
   如路径不同，修改为你的实际安装路径。

2. 右键 `install.bat` → **以管理员身份运行**

3. 看到 `Done!` 提示即安装完成，之后开机自动在后台无窗口运行

**卸载 Helper：** 右键 `uninstall.bat` → 以管理员身份运行

---

## 使用说明

### 🚀 PotPlayer 播放

1. 在 115 网盘中勾选一个或多个视频文件
2. 点击顶部「🚀 PotPlayer播放」按钮
3. 脚本自动获取 115 直链，唤起 PotPlayer 批量播放

**两种运行模式：**

| 模式 | 条件 | 行为 |
|------|------|------|
| Helper 模式（推荐） | 本地 Helper 正在运行 | 直接唤起 PotPlayer，无临时文件 |
| 降级模式 | Helper 未运行 | 生成 `.m3u` 文件到 Downloads，需在浏览器设置「总是打开此类文件」 |

### ⬇️ Aria2 下载

1. 在 115 网盘中勾选一个或多个文件（视频、压缩包、任意格式均可）
2. 点击顶部「⬇️ Aria2下载」按钮
3. 脚本自动检测并修正 Aria2 全局 UA，然后批量获取直链并提交任务

---

## 技术说明

- **直链获取**：调用 `proapi.115.com/app/chrome/downurl` 接口，请求体使用 RSA + 自定义 XOR 加密，移植自 [kkHAIKE/fake115](https://github.com/kkHAIKE/fake115)，无文件大小限制
- **Cookie 传递**：PotPlayer 播放通过 `iframe.contentWindow.fetch` 继承登录态；Aria2 下载通过 `GM_xmlhttpRequest` + 手动读取 iframe Cookie
- **UA 修正**：通过 `aria2.getGlobalOption` + `aria2.changeGlobalOption` JSON-RPC 调用自动修正，避免断点重试时 115 CDN 返回 403
- **本地 Helper**：纯 Python 标准库实现的轻量 HTTP 服务，监听 `127.0.0.1:19190`，接收播放请求后在 `%TEMP%` 生成临时 M3U，播放结束后自动删除

---

## 常见问题

**Q: 点击按钮提示「无法访问文件列表」**
A: 刷新 115 网盘页面重试。

**Q: 获取直链失败，提示 errno:990001**
A: 登录状态已过期，重新登录 115 网盘即可。

**Q: Aria2 提示「无法连接」**
A: 检查 `ARIA2_RPC` 地址是否正确，以及 NAS 防火墙是否放行了对应端口（默认 6800）。

**Q: PotPlayer 播放提示 403**
A: 115 直链绑定 UA，确保 Helper 正在运行且 PotPlayer 版本较新。

**Q: Helper 安装成功但 PotPlayer 没有弹出**
A: 检查 `115helper.log`（与 `115helper.py` 同目录），查看启动日志和错误信息。

**Q: 降级模式下 .m3u 文件没有自动打开**
A: 在浏览器下载栏右键 `.m3u` 文件 → Chrome/Edge 选择「总是打开此类文件」，之后会自动关联 PotPlayer 打开。

---

## 系统要求

- 操作系统：Windows（Helper 功能）/ 任意平台（仅油猴脚本）
- 浏览器：Chrome / Edge（推荐），Firefox（需测试）
- PotPlayer：已安装 [PotPlayer](https://potplayer.daum.net/)（64 位版本）
- Python：3.6+（仅 Helper 功能需要）
- Aria2：已部署并开启 JSON-RPC（仅 Aria2 下载功能需要）

---

## License

MIT
