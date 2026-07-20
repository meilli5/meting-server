# Firefly Meting API Server

自定义 Meting API 服务器，支持 QQ Music VIP 歌曲播放，带 cookie 自动刷新。

## 快速开始

```bash
pnpm install
npx playwright install chromium  # 仅首次
pnpm start
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `METING_TENCENT_COOKIE` | QQ 音乐 cookie（必需） |
| `METING_NETEASE_COOKIE` | 网易云音乐 cookie（可选） |
| `METING_KUGOU_COOKIE` | 酷狗音乐 cookie（可选） |
| `PORT` | 端口号（默认 3000） |

## API 端点

| 路径 | 说明 |
|---|---|
| `GET /` | 服务状态 |
| `GET /api?server=tencent&type=playlist&id=xxx` | 获取歌单 |
| `GET /api?server=tencent&type=url&id=xxx` | 代理音频流 |
| `GET /api?server=tencent&type=pic&id=xxx` | 代理封面图 |
| `GET /api?server=tencent&type=lrc&id=xxx` | 代理歌词 |
| `GET /api/health` | Cookie 健康状态 |

---

## 🔄 Cookie 自动刷新

QQ 音乐 cookie 有效期约 **2 天**，本工具通过 Playwright 维护持久浏览器登录态实现自动刷新。

### 首次配置（必须手动运行一次）

```bash
# 安装 Playwright 浏览器
npx playwright install chromium

# 运行刷新工具（会打开浏览器，扫码登录 QQ 音乐）
./scripts/refresh-cookie.sh
```

登录成功后 cookie 会保存到 `.tencent-cookie` 文件，浏览器登录态保存在 `.browser-profile/` 目录。

### 配置定时自动刷新

```bash
# 安装 launchd 定时任务（macOS）
cp scripts/com.firefly.meting-cookie-refresh.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.firefly.meting-cookie-refresh.plist

# 查看状态
launchctl list | grep meting

# 手动触发一次
launchctl start com.firefly.meting-cookie-refresh

# 卸载
launchctl unload ~/Library/LaunchAgents/com.firefly.meting-cookie-refresh.plist
```

默认每天 **11:25**, **16:25** 和 **21:25** 自动刷新。日志保存在 `.cookie-refresh.log`。

### 手动刷新

```bash
# 交互模式（打开浏览器）
./scripts/refresh-cookie.sh

# 自动模式（无头）
./scripts/refresh-cookie.sh --auto

# 强制重新登录
./scripts/refresh-cookie.sh --force
```

### 检测 Cookie 是否有效

```bash
# 检测本地保存的 cookie
pnpm check-cookie

# 检测远程服务器的 cookie 状态
pnpm check-cookie:server <服务器URL>
```

## 工作原理

```
┌─────────────┐    每 12h    ┌──────────────┐    HTTP API   ┌─────────────┐
│  launchd /  │ ───────────→ │  Playwright  │ ────────────→ │  Railway /  │
│  cron       │              │  浏览器      │  更新环境变量 │  VPS        │
└─────────────┘              └──────────────┘               └─────────────┘
                                   │                              │
                                   │ QQ 登录态                    │ qqmusic_key
                                   │ (数周有效期)                 │ (2天有效期)
                                   ▼                              ▼
                             ┌──────────┐                ┌──────────────┐
                             │  y.qq.com│  ──签发新的──→ │ QQ Music CDN │
                             └──────────┘   qqmusic_key  └──────────────┘
```

## 部署

### Railway

1. Fork 此仓库
2. 在 Railway 创建新项目，连接仓库
3. 设置环境变量 `METING_TENCENT_COOKIE`
4. 部署！

### VPS

```bash
git clone <repo> && cd meting-server
pnpm install
METING_TENCENT_COOKIE="xxx" pnpm start
```
