# 🎵 Firefly Meting API

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen)](https://nodejs.org/)

自定义 [Meting API](https://github.com/metowolf/Meting) 服务器，支持 **QQ 音乐 VIP 歌曲**播放。

与标准 Meting API 不同，本服务器会携带你的 QQ 音乐 Cookie 调用官方 API 获取带签名的音频链接，从而解锁 VIP 歌曲和付费歌曲的播放。

---

## 为什么需要这个？

标准 Meting API 返回的 QQ 音乐链接缺少 `vkey` 签名参数，导致 VIP 歌曲鉴权失败（403）。

```
❌ ws.stream.qqmusic.qq.com/...?fromtag=38       → 永远 403
✅ aqqmusic.tc.qq.com/...?vkey=A82D...&guid=...  → 正常播放
```

本服务器直接调用 QQ 音乐的 `CgiGetVkey` API，用你的 cookie 换取带签名的播放链接，然后流式代理给前端。

---

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `METING_TENCENT_COOKIE` | 是 | QQ 音乐 Cookie 字符串 |
| `METING_NETEASE_COOKIE` | 否 | 网易云音乐 Cookie |
| `METING_KUGOU_COOKIE` | 否 | 酷狗音乐 Cookie |
| `PORT` | 否 | 端口号（默认 3000） |

---

## API 端点

| 路径 | 说明 |
|---|---|
| `GET /` | 服务状态 |
| `GET /api?server=tencent&type=playlist&id=xxx` | 获取歌单 |
| `GET /api?server=tencent&type=song&id=xxx` | 获取单曲 |
| `GET /api?server=tencent&type=album&id=xxx` | 获取专辑 |
| `GET /api?server=tencent&type=search&id=xxx` | 搜索歌曲 |
| `GET /api?server=tencent&type=url&id=xxx` | 代理音频流 |
| `GET /api?server=tencent&type=pic&id=xxx` | 代理封面图 |
| `GET /api?server=tencent&type=lrc&id=xxx` | 代理歌词 |
| `GET /api/health` | Cookie 有效性检测 |

---

## 部署

### 方式一：Railway（推荐，免费）

Railway 免费额度每月 $5，足够个人使用。

#### 1. Fork 仓库

点击右上角 Fork 本仓库到你的 GitHub。

#### 2. 在 Railway 创建项目

1. 打开 [Railway](https://railway.app)，登录 GitHub 账号
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择刚才 Fork 的仓库
4. Railway 会自动检测 `package.json` 中的 `start` 脚本并部署

#### 3. 获取 QQ Music Cookie

1. 在浏览器打开 [y.qq.com](https://y.qq.com) 并登录你的 QQ 音乐账号（需要 VIP 会员）
2. 按 `F12` 打开开发者工具 → **Application**（应用程序）标签
3. 左侧选择 **Cookies** → `https://y.qq.com`
4. 将以下关键 cookie 拼接成字符串，格式为 `key1=value1; key2=value2; ...`

**必需字段：**

| Cookie 名 | 说明 |
|---|---|
| `uin` | 你的 QQ 号 |
| `qqmusic_key` | 音乐播放鉴权 key |
| `qm_keyst` | QQ 登录态 key（WX 登录时有） |
| `skey` | QQ 登录态相关 |
| `p_skey` | 同上 |
| `p_uin` | 同上 |
| `pt4_token` | 同上 |
| `p_luin` | 同上 |

> 💡 最省事的办法：在开发者工具 Console 中执行 `document.cookie`，整段复制即可（QQ 登录相关的 cookie 通常都是 y.qq.com 域下的，全选也没关系）。

#### 4. 设置环境变量

1. 在 Railway 项目面板中点击 **Variables**
2. 点击 **New Variable**，输入：
   - Key: `METING_TENCENT_COOKIE`
   - Value: 刚才复制的 Cookie 字符串
3. Railway 会自动重新部署

#### 5. 获取部署域名

部署完成后，Railway 会分配一个域名，格式类似 `xxx.up.railway.app`。这就是你的 Meting API 地址。

#### 6. 配置前端

在你的博客/音乐播放器中，将 Meting API 地址改为 Railway 域名：

```
https://你的项目名.up.railway.app/api?server=:server&type=:type&id=:id&r=:r
```

---

### 方式二：VPS / 自托管

```bash
git clone https://github.com/<你的用户名>/meting-server.git
cd meting-server
pnpm install

# 设置环境变量并启动
export METING_TENCENT_COOKIE="你的cookie字符串"
pnpm start
```

可以用 `pm2` 或 `systemd` 保持进程运行。

---

### 方式三：Docker（自行构建）

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["pnpm", "start"]
```

---

## 🔄 Cookie 自动刷新

QQ 音乐 Cookie 有效期约 **2 天**。本工具通过 Playwright 维护持久浏览器登录态实现自动刷新。

> ⚠️ 注意：自动刷新依赖你在**本地电脑**上运行。QQ 登录态（uin、skey 等）的有效期通常为数周到数月，期间 Playwright 可以无头自动续签 `qqmusic_key`。登录态过期后需重新扫码。

### 第一步：安装浏览器

```bash
pnpm install
npx playwright install chromium
```

### 第二步：首次登录（必须手动运行）

```bash
# 交互模式 —— 会打开浏览器窗口
./scripts/refresh-cookie.sh
```

1. 脚本会打开 Chromium 浏览器访问 y.qq.com
2. 如果已有保存的登录态则自动完成
3. 否则请扫码或输入账号密码登录
4. 登录成功后 cookie 自动保存到 `.tencent-cookie` 文件
5. 浏览器登录态保存在 `.browser-profile/` 目录（**不要删除**）

### 第三步：推送到远程服务器

```bash
# 运行刷新并自动更新 Railway 环境变量
./scripts/refresh-cookie.sh --auto
```

如果 Railway CLI 未安装，脚本会更新本地 `.env` 文件，你需要手动去 Railway Dashboard → Variables 更新：

1. 打开 `.tencent-cookie` 复制全部内容
2. 进入 Railway 项目 → Variables
3. 更新 `METING_TENCENT_COOKIE` 的值
4. Railway 自动重新部署

### 第四步：配置定时任务（macOS）

```bash
# 安装 plist 到 LaunchAgents（⚠️ 先修改 plist 中的路径！）
# 打开 scripts/com.firefly.meting-cookie-refresh.plist
# 将所有 /Users/a1-6/Firefly/meting-server 替换为你本机的实际路径

cp scripts/com.firefly.meting-cookie-refresh.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.firefly.meting-cookie-refresh.plist

# 查看状态
launchctl list | grep meting

# 卸载
launchctl unload ~/Library/LaunchAgents/com.firefly.meting-cookie-refresh.plist
```

默认每天 **11:25**、**16:25** 和 **21:25** 各执行一次（避开整点高峰）。日志在 `.cookie-refresh.log`。

### Linux cron 替代方案

```cron
25 11,16,21 * * * cd /path/to/meting-server && ./scripts/refresh-cookie.sh --auto >> .cookie-refresh.log 2>&1
```

### 手动命令速查

```bash
./scripts/refresh-cookie.sh            # 交互模式（打开浏览器）
./scripts/refresh-cookie.sh --auto     # 无头自动模式（需已有登录态）
./scripts/refresh-cookie.sh --force    # 强制重新扫码登录
pnpm check-cookie                      # 测试本地 cookie 是否有效
pnpm check-cookie:server <服务器URL>   # 测试远程服务器 cookie 是否有效
```

---

## 工作原理

```
┌──────────────┐   定时任务   ┌──────────────┐   HTTP API    ┌─────────────┐
│  launchd /   │ ───────────→ │  Playwright  │ ────────────→ │  Railway /  │
│  cron        │              │  无头浏览器  │  更新环境变量 │  VPS        │
└──────────────┘              └──────────────┘               └─────────────┘
                                    │                              │
                                    │ QQ 登录态                    │ qqmusic_key
                                    │ (数周/数月有效)              │ (~2 天有效)
                                    ▼                              ▼
                              ┌──────────┐                 ┌──────────────┐
                              │ y.qq.com │ ──签发新 key──→ │ QQ Music CDN │
                              └──────────┘                 └──────────────┘

                             ┌───────────────────┐
  GET /api?type=url&id=xxx   │   Meting Server   │
  ──────────────────────────→│                   │
                             │  ① CgiGetVkey     │
                             │     (cookie 鉴权) │
                             │  ② 获取签名 URL   │
                             │  ③ 流式代理音频   │
                             └───────────────────┘
```

---

## 本地开发

```bash
pnpm install
npx playwright install chromium

# 创建 .env 文件，写入 cookie
echo 'METING_TENCENT_COOKIE=你的cookie' > .env

pnpm start
# 服务运行在 http://localhost:3000

# 测试
curl "http://localhost:3000/api?server=tencent&type=playlist&id=9722345987"
curl "http://localhost:3000/api/health"
```

---

## 常见问题

**Q: Cookie 多久过期？**
A: `qqmusic_key` 约 2 天，但配置了定时刷新就无需担心。QQ 登录态本身约数周到数月过期，届时需要重新手动扫码。

**Q: Railway 部署后 403 怎么办？**
A: 大概率是 cookie 过期了。访问 `https://你的域名/api/health` 查看 cookie 状态，然后运行 `./scripts/refresh-cookie.sh --auto` 更新。

**Q: 没有 QQ 音乐 VIP 能用吗？**
A: 可以获取歌单和专辑信息，但 VIP 歌曲只有 30 秒试听片段。

**Q: 支持其他平台吗？**
A: 理论支持所有 `@meting/core` 支持的平台（网易云、酷狗等），只需要设置对应的环境变量即可。但 cookie 自动刷新目前只实现了 QQ 音乐。

---

## 许可

[MIT](./LICENSE)
