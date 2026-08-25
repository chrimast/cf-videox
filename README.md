# CF-VideoX

VideoX 的 Cloudflare Worker + Docker Compose 双部署改造版。

本版本定位为**在线视频源聚合与播放平台**：保留资源站聚合、CMS 搜索、分类、剧集、电视直播、热门直播、首页、收藏、播放历史、密码设置和在线播放器；播放源使用远程 `MP4`、`M3U8/HLS`、直播地址，不再依赖本地媒体目录或服务器端 FFmpeg。

## 已取消的功能

为支持 Cloudflare Worker 部署，本版本明确移除：

- WebDAV 播放和扫描；
- AList/OpenList 播放和扫描；
- 本地媒体目录和本地文件播放；
- STRM 本地媒体扫描；
- FFmpeg 自动安装、探测、转码和转封装；
- Emby/Jellyfin 等外部媒体服务器模块。

视频源必须由源站提供浏览器可播放的在线视频地址。浏览器不支持的编码不会在本项目中自动转码。

## 主要功能

- CMS 视频源管理和多源聚合；
- 视频搜索、分类、详情和剧集播放；
- MP4、M3U8/HLS 在线播放；
- IPTV/M3U/JSON 电视源管理和播放列表解析；
- 热门直播源管理；
- 首页、收藏、播放历史；
- 管理密码和站点设置；
- Worker 播放代理和 CORS 处理；
- Cloudflare D1 数据库；
- Docker Compose + SQLite 服务器部署。

## 项目结构

```text
frontend/                 React + Vite 前端
worker/                   Cloudflare Worker、D1 schema、测试
worker/migrations/        D1 初始化迁移
docker/                   Docker 在线源后端
docker-compose.yml        Docker Compose 部署文件
```

## 方法一：Cloudflare Worker 部署

### 前置条件

- Cloudflare 账户；
- 已安装 Node.js 22 或更高版本；
- 已安装并登录 Wrangler：

```bash
npm install -g wrangler
wrangler login
```

### 1. 获取代码

```bash
git clone https://github.com/chrimast/cf-videox.git
cd cf-videox
```

### 2. 安装前端依赖并构建

```bash
cd frontend
npm install
npm run build
cd ..
```

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create videox
```

命令会输出 `database_id`。编辑 `worker/wrangler.toml`，将占位的：

```toml
database_id = "00000000-0000-0000-0000-000000000000"
```

替换为真实的 D1 `database_id`。

### 4. 执行 D1 迁移

首次部署：

```bash
npx wrangler d1 migrations apply videox --remote --config worker/wrangler.toml
```

本地测试：

```bash
npx wrangler d1 migrations apply videox --local --config worker/wrangler.toml
```

### 5. 部署 Worker

```bash
npx wrangler deploy --config worker/wrangler.toml
```

部署成功后访问 Wrangler 输出的 `workers.dev` 地址。

### 6. 后续更新

```bash
cd frontend
npm install
npm run build
cd ..
npx wrangler d1 migrations apply videox --remote --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

### Cloudflare 部署说明

- 前端静态文件由 Worker Static Assets 提供；
- 结构化数据保存在 D1；
- Worker 不运行 Node.js 子进程；
- Worker 不访问本地文件系统；
- Worker 不运行 FFmpeg；
- MP4 可以直连或通过 `/api/proxy/video` 播放；
- M3U8/HLS 可以由播放器直连或通过 Worker 代理；
- 第三方播放源必须允许当前播放器访问，防盗链、过期签名和源站不可用不由 Worker 自动修复。

## 方法二：Docker Compose 部署到服务器

### 前置条件

- Linux 服务器；
- Docker Engine；
- Docker Compose Plugin。

### 1. 获取代码

```bash
git clone https://github.com/chrimast/cf-videox.git
cd cf-videox
```

### 2. 构建并启动

```bash
docker compose up -d --build
```

默认访问地址：

```text
http://服务器IP:3100
```

### 3. 查看状态和日志

```bash
docker compose ps
docker compose logs -f videox
```

### 4. 更新版本

```bash
git pull
docker compose up -d --build
```

### 5. 停止服务

```bash
docker compose stop
```

如需删除容器但保留数据卷：

```bash
docker compose down
```

### Docker 数据持久化

`docker-compose.yml` 使用命名卷：

```text
videox-data:/app/data
```

SQLite 数据和配置会保存在该卷中。不要删除 `videox-data`，否则会丢失服务器端配置和数据。

### Docker 部署说明

- Docker 版使用 Node.js + Express + SQLite；
- Docker 版与 Worker 版使用同一产品边界；
- Docker 版不挂载 `/media`；
- Docker 版不安装 FFmpeg；
- Docker 版同样只播放远程在线 MP4/M3U8/直播源；
- 服务器部署不要求 Cloudflare 账户。

## API 主要接口

```text
GET    /api/health
GET    /api/settings
PUT    /api/settings
POST   /api/settings/verify-password
POST   /api/settings/verify-site-password
POST   /api/settings/test-tmdb
POST   /api/settings/test-proxy
GET    /api/sources
POST   /api/sources
PUT    /api/sources/:id
DELETE /api/sources/:id
POST   /api/sources/batch-update
POST   /api/sources/batch-delete
POST   /api/sources/batch-test
GET    /api/sources/export
POST   /api/sources/import
POST   /api/sources/:id/background-sync
GET    /api/tv/sources
POST   /api/tv/sources
PUT    /api/tv/sources/:id
DELETE /api/tv/sources/:id
GET    /api/tv/playlist/:id
GET    /api/live/sources
POST   /api/live/sources
PUT    /api/live/sources/:id
DELETE /api/live/sources/:id
GET    /api/live/status
POST   /api/live/refresh/:id
POST   /api/live/refresh-all
GET    /api/home
POST   /api/home/refresh
POST   /api/home/refresh-section
GET    /api/categories
GET    /api/videos
GET    /api/videos/search
GET    /api/videos/:id
GET    /api/favorites
POST   /api/favorites
DELETE /api/favorites
DELETE /api/favorites/:id
GET    /api/history
POST   /api/history
DELETE /api/history
DELETE /api/history/:id
GET    /api/proxy/hls?url=...
```

接口在 Docker 和 Cloudflare Worker 中保持相同的产品边界；Worker 使用 D1，Docker 使用 SQLite。

以下接口在本版本明确停用并返回 `404`：

```text
/api/netdisk/*
/api/transcode/*
/api/media-servers/*
```

## 本地验证

```bash
npm --prefix worker test
npm --prefix frontend run build
node --check docker/server.js
npx wrangler deploy --config worker/wrangler.toml --dry-run
```

Docker 镜像验证：

```bash
docker compose build
```

## 许可证

MIT License。

项目源自 [txwebroot/VideoX](https://github.com/txwebroot/VideoX)，本仓库为 Cloudflare Worker + Docker Compose 改造版本。
