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

## 方法一：通过 Cloudflare 官网部署 Worker

以下流程不需要在本地安装 Node.js、Wrangler，也不需要执行命令。适合直接在 Cloudflare 控制台完成部署。

### 1. 登录 Cloudflare 控制台

打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)，选择账户后进入 **Workers & Pages**。

### 2. 创建 D1 数据库

1. 在左侧进入 **Storage & databases → D1**；
2. 点击 **Create database**；
3. 数据库名称填写 `videox`；
4. 创建完成后记下数据库名称，后续绑定 Worker 时选择该数据库。

### 3. 创建 Worker

1. 进入 **Workers & Pages → Create application → Create Worker**；
2. 创建一个 Worker，名称建议使用 `videox`；
3. 创建后进入该 Worker 的 **Settings → Bindings**；
4. 添加 **D1 database binding**：变量名填写 `DB`，数据库选择前面创建的 `videox`。

### 4. 配置 Static Assets

当前仓库的 Worker 代码和前端构建产物需要一起部署。Cloudflare 控制台的在线编辑器不适合直接完成本项目的多文件构建，因此推荐在 **Workers & Pages → Create application → Import a repository** 中连接 GitHub 仓库 `chrimast/cf-videox`，再选择 Worker 部署方式。

在部署设置中填写：

- **Root directory**：仓库根目录；
- **Build command**：`npm --prefix frontend install && npm --prefix frontend run build`；
- **Build output directory**：`frontend/dist`；
- **Deploy command**：由 Cloudflare 的 Worker 部署流程执行；
- **D1 binding**：变量名必须为 `DB`。

如果当前 Cloudflare 账户界面没有提供 Worker 的 GitHub 构建入口，请先在 **Workers & Pages → Create application → Import a repository** 中创建连接，再在项目的 **Settings → Builds & deployments** 中填写上述构建配置。

### 5. 执行 D1 迁移

在 Worker 的 **D1 数据库 → Console** 中打开数据库控制台，将仓库 `worker/migrations/0001_initial.sql` 的内容复制进去并执行。执行成功后，数据库表会完成初始化。

### 6. 发布和验证

1. 在 Cloudflare 项目中点击 **Save and deploy**；
2. 打开 Cloudflare 分配的 `workers.dev` 地址；
3. 访问 `/api/health`，返回 `status: healthy` 即表示 Worker 已启动；
4. 进入后台添加 CMS 视频源，并在后台配置 TMDB API Key（如需使用 TMDB 正在热映）。

### 7. 后续更新

推送到 GitHub `main` 分支后，在 Cloudflare 项目的 **Deployments** 页面点击 **Redeploy**，或启用自动部署。数据库迁移仍需在 D1 Console 中按新增 migration 文件手动执行。

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

### 一键部署配置

将下面内容保存为 `docker-compose.yml`，然后执行 `docker compose up -d --build`：

```yaml
services:
  videox:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: videox
    ports:
      - "3100:3100"
    environment:
      NODE_ENV: production
      PORT: 3100
      VIDEOX_DATA_DIR: /app/data
    volumes:
      - videox-data:/app/data
    restart: unless-stopped

volumes:
  videox-data:
```

默认访问地址：`http://服务器IP:3100`。更新版本时重新获取项目文件后执行 `docker compose up -d --build`。不要删除 `videox-data` 数据卷，否则会丢失配置和数据。

## GitHub 自动构建 Docker 镜像

仓库已加入 GitHub Actions 工作流：`.github/workflows/docker-image.yml`。

- 推送到 `main`：自动构建并推送 `ghcr.io/chrimast/cf-videox:latest`；
- 推送形如 `v1.0.0` 的 Git tag：自动生成对应版本标签；
- 同时生成 Git SHA 标签；
- 使用 GitHub Actions 缓存，加快后续构建；
- 使用内置的 `GITHUB_TOKEN`，不需要额外保存 Docker Hub 密码。

### 在 GitHub 中启用和查看

1. 打开仓库的 **Settings → Actions → General**；
2. 确认允许 Actions 运行；
3. 在 **Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**，或确保工作流的 `packages: write` 权限可用；
4. 推送代码后进入仓库 **Actions** 页面查看构建结果；
5. 构建成功后进入仓库右侧 **Packages** 查看 GHCR 镜像。

### 使用 GHCR 镜像

如果镜像可公开访问，可以把 Compose 中的 `build` 替换为：

```yaml
image: ghcr.io/chrimast/cf-videox:latest
```

私有镜像需要先在服务器执行 `docker login ghcr.io`，再启动 Compose。生产环境建议使用版本 tag，而不是始终使用 `latest`。

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
