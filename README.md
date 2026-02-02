# VideoX - 强大的聚合视频导航与播放平台

VideoX 是一款专为聚合视频源、电视直播及网盘媒体打造的独立应用。它集成了高性能的播放引擎、智能化的内容同步以及专业的安全加固机制。

## 🚀 核心特性

- **多源聚合**：支持视频站、电视直播 (IPTV)、全网搜片及云盘 (AList/WebDAV) 等多种资源类型。
- **全平台播放**：内置强悍的播放器，支持 HLS/M3U8、FLV、MP4 及各种网盘原画直接播放。
- **智能转码**：支持服务端智能转码，确保在不同带宽及设备环境下都能获得流畅的观看体验。
- **智能视频探测**：内置 FFmpeg 驱动的自动化探测机制，支持对视频流进行实时分析、编码识别。
- **安全加固**：支持“全站访问”与“管理员功能”双重密码锁定。
- **STRM 生态支持**：完美支持 `.strm` 格式文件。
- **智能元数据**：深度集成 TMDB API，具备灵活的媒体元数据解析能力，支持 NFO 文档、封面图自动匹配及多级分类管理。
- **扫描与性能控制**：支持自定义扫描并发数控制，内置高效的扫描队列管理，确保在海量资源下依然保持极低的系统负载。
- **轻量部署**：提供精简的 Docker 镜像，支持 amd64 与 arm64 (Apple Silicon) 多架构。

## 📦 快速部署 (Docker)

推荐使用 Docker 镜像进行部署，这是最简单且安全的方式。

### 直接运行 (推荐)
```bash
docker run -d \
  --name videox \
  -p 3100:3100 \
  -v ./videox-data:/app/backend/data \
  -v /你的本地视频目录:/media \
  ghcr.io/txwebroot/videox:latest
```

### Docker Compose
```yaml
version: '3.8'
services:
  videox:
    image: ghcr.io/txwebroot/videox:latest
    container_name: videox
    ports:
      - "3100:3100"
    volumes:
      - ./data:/app/backend/data  # 1. 数据库和配置文件
      - /你的本地视频目录:/media    # 2. 媒体资源目录（新加）
    restart: unless-stopped
```

## ⚙️ 初始设置

1. 启动后访问 `http://服务器IP:3100`。
2. 初始状态下无密码，您可以进入 **管理面板** -> **安全设置** 来配置：
   - **全站访问密码**：开启后，游客访问主页也需要身份验证。
   - **管理权限密码**：用于锁定管理后台、收藏及播放历史记录。

## 🛠️ 技术架构

- **前端**：React 18 + Vite + TailwindCSS + ArtPlayer
- **后端**：Node.js (Express) + JavaScript-Obfuscator 加固
- **数据库**：SQLite 3 (数据持久化在 `/app/backend/data` 目录下)


---

## 📄 License
[MIT License](LICENSE)

## 🔗 关联项目
源自 [Navlink-Releases](https://github.com/txwebroot/Navlink-Releases) 其中一个插件应用剥离成独立应用。
