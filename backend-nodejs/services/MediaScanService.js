/**
 * 媒体库扫描服务
 * 扫描网盘目录，解析 NFO 文件，获取封面图片，回退 TMDB 匹配
 */

const { getDatabase } = require('../database');
const { TmdbService } = require('./TmdbService');
const { AlistService } = require('./AlistService');
const { WebdavService } = require('./WebdavService');
const { LocalService } = require('./LocalService');
const fetch = require('node-fetch');

// 并发控制配置 (由数据库 settings 表驱动)
let DIR_SCAN_LIMIT = 5;  // 目录递归并发限制 (默认值)

// NFO 常见文件名
const NFO_FILES = ['movie.nfo', 'info.nfo', 'tvshow.nfo'];
// 封面图片常见文件名 (增加 thumb.jpg 优先级)
const POSTER_FILES = ['poster.jpg', 'poster.png', 'folder.jpg', 'cover.jpg', 'cover.png', 'thumb.jpg'];
// fanart 文件名
const FANART_FILES = ['fanart.jpg', 'fanart.png', 'backdrop.jpg', 'background.jpg'];
// 视频扩展名
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m3u8', '.ts', '.webm', '.rmvb', '.rm', '.strm'];
// 排除的文件夹名称（花絮、预告、元数据等）
const EXCLUDE_FOLDERS = [
    'behind the scenes', 'trailers', 'extras', 'metadata', '.actors', 'sample', 'proof',
    'backdrops', '.discovery', 'advs', 'others', 'featurettes', 'scenes', 'shorts'
];

class MediaScanService {
    constructor() {
        this.tmdbService = new TmdbService();
        this.scanningStatus = {}; // sourceId -> { scanning: boolean, progress: number, total: number }
    }

    /**
     * 获取网盘客户端工厂
     */
    async getNetdiskClient(source) {
        let client;
        if (source.type === 'webdav') {
            client = new WebdavService(source.url, source.username, source.password);
        } else if (source.type === 'local') {
            client = new LocalService(source.root_path);
        } else {
            // 默认 alist
            client = new AlistService(source.url, source.password);
            client.username = source.username || 'admin';
            // Alist 通常需要登录获取 Token
            await client.login();
        }
        return client;
    }

    /**
     * 获取扫描状态
     */
    getScanStatus(sourceId) {
        return this.scanningStatus[sourceId] || { scanning: false, progress: 0, total: 0, paths: {} };
    }

    /**
     * 扫描指定网盘源
     * @param {number} sourceId - 网盘源 ID
     * @param {number} maxDepth - 最大扫描深度
     * @param {string} specificPath - 可选，指定扫描的子路径
     * @param {boolean} force - 是否强制刷新（用于完整重建索引）
     */
    async scanSource(sourceId, maxDepth = 5, specificPath = null, force = false) {
        // 🚀 防止重复扫描
        if (this.scanningStatus[sourceId]?.scanning && !force) {
            console.log(`[MediaScan] Source ${sourceId} is already scanning, skipping...`);
            return { success: true, message: '已经在扫描中' };
        }

        console.log(`[MediaScan] Starting scan for source ${sourceId}, maxDepth=${maxDepth}, specificPath=${specificPath}, force=${force}`);
        const db = getDatabase();

        // 获取网盘源信息
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [sourceId]);
        if (!source) {
            console.error('[MediaScan] Source not found:', sourceId);
            throw new Error('网盘源不存在');
        }

        // 获取 TMDB API Key 及并发设置
        const tmdbSetting = db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'");
        if (tmdbSetting?.value) {
            this.tmdbService.setApiKey(tmdbSetting.value);
        }

        const scanConcurrencySetting = db.get("SELECT value FROM settings WHERE key = 'scan_concurrency'");
        if (scanConcurrencySetting?.value) {
            try {
                DIR_SCAN_LIMIT = parseInt(scanConcurrencySetting.value) || 5;
            } catch (e) {
                DIR_SCAN_LIMIT = 5;
            }
        }

        // 创建网盘客户端
        const client = await this.getNetdiskClient(source);

        // 初始化扫描状态
        if (!this.scanningStatus[sourceId]) {
            this.scanningStatus[sourceId] = { scanning: false, paths: {} };
        }

        const status = this.scanningStatus[sourceId];
        status.scanning = true;
        status.mode = force ? 'full' : 'incremental';
        status.progress = 0;
        status.total = 0;
        status.message = '正在准备扫描...';
        status.added = 0;
        status.deleted = 0;
        status.skipped = 0;

        try {
            // 解析扫描路径
            let foldersToScan = [];
            if (source.scan_paths) {
                try {
                    const parsed = JSON.parse(source.scan_paths);
                    if (Array.isArray(parsed)) {
                        foldersToScan = parsed.map(item =>
                            typeof item === 'string' ? { name: item, path: item } : item
                        );
                    }
                } catch (e) {
                    console.error('[MediaScan] Failed to parse scan_paths:', e);
                }
            }

            // 如果没有配置扫描路径，使用 root_path
            if (foldersToScan.length === 0) {
                foldersToScan = [{ name: '全部', path: source.root_path || '/' }];
            }

            // 如果指定了 specificPath，则只扫描该路径
            if (specificPath) {
                const found = foldersToScan.find(f => f.path === specificPath);
                foldersToScan = [found || { name: '指定目录', path: specificPath }];
            }

            // 初始化各路径状态
            foldersToScan.forEach(f => {
                status.paths[f.path] = { scanning: true, progress: 0, total: 0, message: '排队中...' };
            });

            console.log(`[MediaScan] Folders to scan: ${foldersToScan.length}`);

            // 1. 递归查找所有包含视频的媒体文件夹
            for (const folderEntry of foldersToScan) {
                const tmdbEnabled = folderEntry.tmdb_enabled !== false;
                status.paths[folderEntry.path].message = '正在检索目录结构...';
                console.log(`[MediaScan] Finding media in: ${folderEntry.path}, tmdbEnabled=${tmdbEnabled}, force=${force}`);
                const mediaFolders = await this.findMediaFolders(client, folderEntry.path, maxDepth, 0, force);

                // 🚀 v2.1.8+ 增量同步：DIFF 对比逻辑
                const discoveredPaths = new Set(mediaFolders.map(f => f.path));

                // 查询数据库中该扫描路径下的所有记录
                const existingRecords = db.all(
                    'SELECT id, path FROM netdisk_media WHERE source_id = ? AND (path = ? OR path LIKE ?)',
                    [sourceId, folderEntry.path, folderEntry.path.endsWith('/') ? `${folderEntry.path}%` : `${folderEntry.path}/%`]
                );
                const existingPaths = new Set(existingRecords.map(r => r.path));

                // 计算 DIFF
                const newFolders = mediaFolders.filter(f => !existingPaths.has(f.path));
                const deletedPaths = [...existingPaths].filter(p => !discoveredPaths.has(p));
                const unchangedCount = mediaFolders.length - newFolders.length;

                console.log(`[MediaScan] Incremental sync: +${newFolders.length} new, -${deletedPaths.length} deleted, ${unchangedCount} unchanged`);

                // 🛡️ 安全阈值检查：如果待删除数量超过已有数量的 50%，跳过自动删除
                let skipAutoDelete = false;
                if (existingRecords.length > 0 && deletedPaths.length > existingRecords.length * 0.5) {
                    console.warn(`[MediaScan] ⚠️ Safety threshold triggered: ${deletedPaths.length}/${existingRecords.length} records would be deleted, skipping auto-cleanup`);
                    skipAutoDelete = true;
                    status.paths[folderEntry.path].message = `⚠️ 检测到大量删除 (${deletedPaths.length}条)，已跳过自动清理`;
                }

                // 执行删除（仅在非强制模式且未触发安全阈值时）
                if (!force && !skipAutoDelete && deletedPaths.length > 0) {
                    const deleteRecords = existingRecords.filter(r => deletedPaths.includes(r.path));
                    if (deleteRecords.length > 0) {
                        const ids = deleteRecords.map(r => r.id);
                        const placeholders = ids.map(() => '?').join(',');
                        db.run(`DELETE FROM netdisk_media WHERE id IN (${placeholders})`, ids);
                        status.deleted += ids.length;
                        console.log(`[MediaScan] Deleted ${ids.length} orphan records`);
                    }
                }

                // 决定要处理的文件夹列表
                const foldersToProcess = force ? mediaFolders : newFolders;
                status.skipped += unchangedCount;

                status.paths[folderEntry.path].total = foldersToProcess.length;
                status.paths[folderEntry.path].message = force
                    ? `发现 ${foldersToProcess.length} 个媒体文件夹，准备处理...`
                    : `发现 ${newFolders.length} 个新增，${deletedPaths.length} 个删除，${unchangedCount} 个不变`;
                status.total += foldersToProcess.length;

                console.log(`[MediaScan] Processing ${foldersToProcess.length} folders for ${folderEntry.path}...`);

                // 2. 处理文件夹 (并行处理，限制并发)
                const concurrency = DIR_SCAN_LIMIT;
                for (let i = 0; i < foldersToProcess.length; i += concurrency) {
                    const chunk = foldersToProcess.slice(i, i + concurrency);
                    await Promise.all(chunk.map(async (folder, index) => {
                        const localIndex = i + index + 1;
                        status.paths[folderEntry.path].progress = localIndex;
                        status.paths[folderEntry.path].message = `正在解析 (${localIndex}/${foldersToProcess.length}): ${folder.name}`;

                        // 全局进度更新
                        status.progress++;
                        status.message = `正在扫描 (${status.progress}/${status.total})`;

                        try {
                            await this.processMediaFolder(client, source, folder, tmdbEnabled, force);
                            status.added++;
                        } catch (err) {
                            console.error(`[MediaScan] Failed to process ${folder.path}:`, err.message);
                        }
                    }));
                }
                status.paths[folderEntry.path].scanning = false;
                status.paths[folderEntry.path].message = '扫描完成';
            }

            status.message = force
                ? '全量扫描完成'
                : `增量同步完成：新增 ${status.added}，删除 ${status.deleted}，跳过 ${status.skipped}`;
        } catch (err) {
            console.error(`[MediaScan] Error:`, err);
            status.message = `发生错误: ${err.message}`;
        } finally {
            status.scanning = false;
        }

        return { success: true, count: status.progress, added: status.added, deleted: status.deleted, skipped: status.skipped };
    }


    /**
     * 清理索引
     */
    async clearIndex(sourceId, specificPath = null) {
        const db = getDatabase();
        if (specificPath) {
            db.run('DELETE FROM netdisk_media WHERE source_id = ? AND (path = ? OR path LIKE ?)', [
                sourceId,
                specificPath,
                specificPath.endsWith('/') ? `${specificPath}%` : `${specificPath}/%`
            ]);
            console.log(`[MediaScan] Cleared path: ${specificPath}`);
        } else {
            db.run('DELETE FROM netdisk_media WHERE source_id = ?', [sourceId]);
            console.log(`[MediaScan] Cleared all for source: ${sourceId}`);
        }
        return { success: true };
    }

    /**
     * 🧹 清理孤儿记录（已从源目录删除但仍在数据库的记录）
     * @param {number} sourceId - 网盘源 ID
     * @param {string} specificPath - 可选，指定子目录
     * @param {boolean} preview - true=仅预览不删除，false=执行删除
     */
    async cleanupOrphans(sourceId, specificPath = null, preview = true) {
        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [sourceId]);
        if (!source) {
            throw new Error('网盘源不存在');
        }

        // 创建网盘客户端
        const client = await this.getNetdiskClient(source);

        // 查询该路径下所有数据库记录
        let records;
        if (specificPath) {
            records = db.all('SELECT id, path, title FROM netdisk_media WHERE source_id = ? AND (path = ? OR path LIKE ?)', [
                sourceId,
                specificPath,
                specificPath.endsWith('/') ? `${specificPath}%` : `${specificPath}/%`
            ]);
        } else {
            records = db.all('SELECT id, path, title FROM netdisk_media WHERE source_id = ?', [sourceId]);
        }

        console.log(`[MediaScan/Cleanup] Checking ${records.length} records for source ${sourceId}...`);

        // 筛选孤儿记录（并发检查，限制并发数）
        const orphans = [];
        const concurrency = 5;
        for (let i = 0; i < records.length; i += concurrency) {
            const chunk = records.slice(i, i + concurrency);
            const results = await Promise.all(chunk.map(async (record) => {
                try {
                    // 尝试获取目录内容
                    const items = await client.list(record.path);

                    // 🚀 改进检测：检查目录是否为空或不包含视频文件
                    if (!items || items.length === 0) {
                        console.log(`[MediaScan/Cleanup] Orphan detected (empty): ${record.path}`);
                        return record;
                    }

                    // 检查是否有视频文件
                    const hasVideo = items.some(f => !f.is_dir && this.isVideoFile(f.name));
                    if (!hasVideo) {
                        console.log(`[MediaScan/Cleanup] Orphan detected (no video): ${record.path}`);
                        return record;
                    }

                    return null; // 存在且有视频
                } catch (err) {
                    // 目录不存在或无权访问
                    console.log(`[MediaScan/Cleanup] Orphan detected (error): ${record.path} - ${err.message}`);
                    return record;
                }
            }));
            orphans.push(...results.filter(Boolean));
        }

        console.log(`[MediaScan/Cleanup] Found ${orphans.length} orphan records`);

        // 如果是预览模式，直接返回
        if (preview) {
            return { success: true, orphans, deletedCount: 0 };
        }

        // 执行删除
        if (orphans.length > 0) {
            const ids = orphans.map(o => o.id);
            const placeholders = ids.map(() => '?').join(',');
            db.run(`DELETE FROM netdisk_media WHERE id IN (${placeholders})`, ids);
            console.log(`[MediaScan/Cleanup] Deleted ${ids.length} orphan records`);
        }

        return { success: true, orphans, deletedCount: orphans.length };
    }

    /**
     * 递归查找媒体文件夹 (💡 优化：支持 mtime 指纹对比，没变动则跳过)
     */
    async findMediaFolders(client, path, maxDepth, currentDepth = 0, force = false) {
        if (currentDepth > maxDepth) return [];

        const db = getDatabase();
        const result = [];
        try {
            // 1. 获取目录信息与文件列表
            const items = await client.list(path);

            // 💡 关键性能优化：mtime 指纹检查 (仅对本地或支持 mtime 的网盘有效)
            // 如果不是强制重扫，且数据库中已有该路径，且 mtime 没变，则直接跳过深度递归
            if (!force) {
                try {
                    const info = await client.getFileInfo(path).catch(() => null);
                    if (info && info.mtime) {
                        const mtimeStr = new Date(info.mtime).toISOString();
                        const existing = db.get('SELECT id FROM netdisk_media WHERE path = ? AND scanned_at >= ?', [path, mtimeStr]);
                        if (existing) {
                            // 🚀 命中缓存指纹：此目录及其子目录均无变化，直接跳过整个分支
                            // console.log(`[MediaScan] Skip unchanged folder branch: ${path}`);
                            return [];
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            const videos = items.filter(f => !f.is_dir && this.isVideoFile(f.name));

            // 找出有效的子目录（排除干扰项）
            const dirs = items.filter(f =>
                f.is_dir &&
                !EXCLUDE_FOLDERS.includes(f.name.toLowerCase()) &&
                !f.name.startsWith('.')
            );

            // 如果有视频且没有有效子目录 -> 这是一个完整的媒体节点
            if (videos.length > 0 && dirs.length === 0) {
                result.push({
                    path,
                    name: path.split('/').filter(Boolean).pop() || path,
                    videos,
                    items,
                    isLeaf: true
                });
                return result;
            }

            if (videos.length > 0) {
                result.push({
                    path,
                    name: path.split('/').filter(Boolean).pop() || path,
                    videos,
                    items
                });
            }

            // 💡 优化：回归受控并发递归，显著提升 SMB/Local 检索效率
            const subFoldersResults = await Promise.all(dirs.map(dir => {
                const subPath = (path + '/' + dir.name).replace(/\/+/g, '/');
                return this.findMediaFolders(client, subPath, maxDepth, currentDepth + 1, force);
            }));

            for (const subFolders of subFoldersResults) {
                result.push(...subFolders);
            }
        } catch (err) {
            console.error(`[MediaScan] List ${path} failed:`, err.message);
        }
        return result;
    }

    /**
     * 处理媒体文件夹
     */
    async processMediaFolder(client, source, folder, tmdbEnabled = true, force = false, isBackground = false, skipProbe = false) {
        const db = getDatabase();

        // 1. 基础资源发现
        const items = folder.items || await client.list(folder.path);

        // 如果扫描结果完全为空（这通常是因为网络抖动或权限变化），直接退出并保护数据库原有内容
        if (!items || items.length === 0) {
            console.warn(`[MediaScan] Skip processing empty folder: ${folder.path}`);
            return;
        }

        // 查找 NFO 和视频
        let nfoFile = items.find(f => !f.is_dir && NFO_FILES.includes(f.name.toLowerCase()));
        if (!nfoFile) nfoFile = items.find(f => !f.is_dir && f.name.toLowerCase().endsWith('.nfo'));

        const rawVideoFiles = items.filter(f => !f.is_dir && this.isVideoFile(f.name));
        const videoFiles = [];

        // 处理视频文件列表，如果是 .strm 则解析内容
        for (const file of rawVideoFiles) {
            if (file.name.toLowerCase().endsWith('.strm')) {
                try {
                    console.log(`[STRM-DEBUG-V1] Parsing .strm file: ${file.name}`);
                    const strmPath = (folder.path + '/' + file.name).replace(/\/+/g, '/');
                    const info = await client.getFileInfo(strmPath);
                    // 仅处理 2KB 以内的 strm 文件，避免意外读取大文件
                    if (info && info.raw_url && (!info.size || info.size < 2048)) {
                        const headers = client.getHeaders ? client.getHeaders() : {};
                        const content = await this.fetchNfoContent(info.raw_url, headers);
                        const url = content.split('\n').map(line => line.trim()).find(line => line.startsWith('http'));
                        if (url) {
                            videoFiles.push(`${file.name}|${url}`);
                            continue;
                        }
                    }
                } catch (err) {
                    console.error(`[Netdisk] Failed to parse .strm file: ${file.name}`, err.message);
                }
            }
            videoFiles.push(file.name);
        }

        // 查找图片
        const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

        // 1. 优先查找标准封面文件（poster, folder, cover）
        let posterFile = items.find(f => !f.is_dir && POSTER_FILES.includes(f.name.toLowerCase()));
        let fanartFile = items.find(f => !f.is_dir && FANART_FILES.includes(f.name.toLowerCase()));

        // 2. 如果没找到标准文件名，尝试查找文件名中包含 'poster' 关键字的图片
        if (!posterFile) {
            posterFile = items.find(f => {
                const name = f.name.toLowerCase();
                return !f.is_dir && IMG_EXTS.some(ext => name.endsWith(ext)) && name.includes('poster');
            });
        }

        // 3. 尝试查找视频同名且带 'poster' 关键字的海报 (如 movie-poster.jpg)
        if (!posterFile && videoFiles.length > 0) {
            const mainVideoRaw = videoFiles[0];
            const mainVideo = (mainVideoRaw.includes('|') ? mainVideoRaw.split('|')[0] : mainVideoRaw).replace(/\.[^/.]+$/, "").toLowerCase();

            posterFile = items.find(f => {
                const name = f.name.toLowerCase();
                return !f.is_dir && name.startsWith(mainVideo) &&
                    IMG_EXTS.some(ext => name.endsWith(ext)) && name.includes('poster');
            });

            // 4. 尝试查找视频同名且带 'thumb' 或 'cover' 的图片 (作为次选)
            if (!posterFile) {
                posterFile = items.find(f => {
                    const name = f.name.toLowerCase();
                    return !f.is_dir && name.startsWith(mainVideo) &&
                        IMG_EXTS.some(ext => name.endsWith(ext)) &&
                        (name.includes('thumb') || name.includes('cover'));
                });
            }
        }

        // 5. 最后回退：查找文件夹内任何图片文件
        if (!posterFile) {
            posterFile = items.find(f => !f.is_dir && IMG_EXTS.some(ext => f.name.toLowerCase().endsWith(ext)));
        }


        let metadata = {
            title: this.parseTitle(folder.name),
            year: this.parseYear(folder.name),
            media_type: videoFiles.length > 2 ? 'tvshow' : 'movie', // 初步判定分类
            nfo_parsed: 0,
            extra_metadata: {}
        };

        // � 优先：如果文件夹下有明确的海报文件，它是最高优先级
        let localPosterUrl = null;
        if (posterFile) {
            const posterPath = (folder.path + '/' + posterFile.name).replace(/\/+/g, '/');
            localPosterUrl = `/api/netdisk/image-proxy?sourceId=${source.id}&path=${encodeURIComponent(posterPath)}`;
        }

        // 🚀 v2.0.7 影子扫描模式：处理 NFO 与 TMDB
        if (force) {
            // 1. 解析 NFO (仅在强制刷新或单项刷新时执行)
            if (nfoFile) {
                try {
                    const nfoPath = (folder.path + '/' + nfoFile.name).replace(/\/+/g, '/');
                    const info = await client.getFileInfo(nfoPath);
                    if (info && info.raw_url) {
                        const headers = client.getHeaders ? client.getHeaders() : {};
                        const content = await this.fetchNfoContent(info.raw_url, headers);
                        const parsed = this.parseNfo(content, metadata.title);
                        if (parsed) metadata = { ...metadata, ...parsed, nfo_parsed: 1 };
                    }
                } catch (err) { /* ignore */ }
            }

            // 2. 覆盖逻辑：如果本地有海报，则强制使用本地海报（覆盖 NFO 中的远程链接）
            if (localPosterUrl) {
                metadata.poster_url = localPosterUrl;
            }

            // 3. 获取剧照路径
            if (fanartFile && !metadata.fanart_url) {
                const fanartPath = (folder.path + '/' + fanartFile.name).replace(/\/+/g, '/');
                metadata.fanart_url = `/api/netdisk/image-proxy?sourceId=${source.id}&path=${encodeURIComponent(fanartPath)}`;
            }

            // 4. TMDB 回退
            if (tmdbEnabled && (!metadata.poster_url)) {
                try {
                    const match = await this.tmdbService.match(metadata.title, metadata.year);
                    if (match) {
                        if (!metadata.overview) metadata.overview = match.overview;
                        if (!metadata.poster_url) metadata.poster_url = match.poster;
                        if (!metadata.fanart_url) metadata.fanart_url = match.backdrop;
                        metadata.tmdb_id = match.tmdb_id;
                        if (!metadata.year) metadata.year = parseInt(match.year);
                    }
                } catch (err) { /* ignore */ }
            }

            // 💡 关键修复：只要是强制刷新（包含后台补全任务），都标记为已解析，防止重复进入队列
            metadata.nfo_parsed = 1;
        } else {
            // 💡 极速模式：优先使用本地识别的海报
            if (localPosterUrl) {
                metadata.poster_url = localPosterUrl;
            }
        }

        // 4. 视频编码探测 (🚀 性能优化：全量扫描跳过探测，单项刷新模式才进行探测)
        if (videoFiles.length > 0 && force && !skipProbe) {
            try {
                const firstVideoRaw = videoFiles[0];
                let probeUrl = "";
                let probeHeaders = {};

                if (firstVideoRaw.includes('|')) {
                    probeUrl = firstVideoRaw.split('|')[1];
                } else {
                    const videoPath = (folder.path + '/' + firstVideoRaw).replace(/\/+/g, '/');
                    const info = await client.getFileInfo(videoPath);
                    if (info) {
                        probeUrl = info.raw_url;
                        probeHeaders = client.getHeaders ? client.getHeaders() : {};
                    }
                }

                if (probeUrl) {
                    // ⚡️ 即时同步探测：仅在刷新或手动操作时触发
                    const transcodeService = require('./TranscodeService');
                    const mediaInfo = await transcodeService.getMediaInfo(probeUrl, probeHeaders);
                    if (mediaInfo) {
                        metadata.v_codec = mediaInfo.videoCodec;
                        metadata.a_codec = mediaInfo.audioCodec;
                        metadata.duration = mediaInfo.duration;
                        metadata.container = (mediaInfo.format || '').split(',')[0];
                    }
                }
                metadata.probe_status = 1; // 标记已探测
            } catch (err) {
                console.warn(`[MediaScan] Probe failed for ${metadata.title}:`, err.message);
                metadata.probe_status = 0;
            }
        } else if (skipProbe) {
            metadata.probe_status = 0; // 确保显式标记为待探测
        } else if (videoFiles.length > 0) {
            // 全量扫描模式：标记待探测，交给异步队列处理
            metadata.probe_status = 0;
        }

        // 写入数据库 - 使用 UPDATE 或 INSERT 以保持已有记录的 ID 不变
        const existingRecord = db.get('SELECT id, poster_url, tmdb_id, is_locked, video_files, probe_status, nfo_parsed, v_codec FROM netdisk_media WHERE source_id = ? AND path = ?', [source.id, folder.path]);

        if (existingRecord) {
            // 💡 保护逻辑 1：如果扫描出的视频列表为空，但数据库里已有视频，则保留原有视频列表（防止 404）
            const finalVideoFiles = (videoFiles.length === 0 && existingRecord.video_files)
                ? JSON.parse(existingRecord.video_files)
                : videoFiles;

            // 💡 保护逻辑 2：如果已锁定，保留原有海报与 TMDB ID
            const isLocked = existingRecord.is_locked === 1;
            const finalPoster = (isLocked && existingRecord.poster_url) ? existingRecord.poster_url : metadata.poster_url;
            const finalFanart = (isLocked && existingRecord.fanart_url) ? existingRecord.fanart_url : metadata.fanart_url;
            const finalTmdbId = (isLocked && existingRecord.tmdb_id) ? existingRecord.tmdb_id : metadata.tmdb_id;

            // 🚀 v2.1.8+ 保护逻辑 3：非强制模式下保留原有的探测和解析状态
            const finalProbeStatus = force ? (metadata.probe_status || 0) : (existingRecord.probe_status || 0);
            const finalNfoParsed = force ? (metadata.nfo_parsed || 0) : (existingRecord.nfo_parsed || 0);

            // 已存在，使用 UPDATE 保持 ID 不变
            db.run(`
                UPDATE netdisk_media SET 
                    title = ?, original_title = ?, year = ?, overview = ?,
                    poster_url = ?, fanart_url = ?, rating = ?, genres = ?,
                    media_type = ?, tmdb_id = ?, video_files = ?, nfo_parsed = ?,
                    director = ?, actor = ?, area = ?, tagline = ?, studio = ?,
                    extra_metadata = ?, v_codec = ?, a_codec = ?, duration = ?,
                    container = ?, probe_status = ?, series = ?, tags = ?,
                    scanned_at = datetime('now')
                WHERE id = ?
            `, [
                metadata.title, metadata.original_title || null, metadata.year,
                metadata.overview, finalPoster, finalFanart, metadata.rating, metadata.genres || null,
                metadata.media_type, finalTmdbId, JSON.stringify(finalVideoFiles), finalNfoParsed,
                metadata.director, metadata.actor, metadata.area, metadata.tagline, metadata.studio,
                metadata.extra_metadata ? JSON.stringify(metadata.extra_metadata) : null,
                metadata.v_codec || null, metadata.a_codec || null, metadata.duration || 0,
                metadata.container || null, finalProbeStatus,
                metadata.series || null, metadata.tags || null,
                existingRecord.id
            ]);
        } else {

            // 不存在，使用 INSERT (scanned_at 和 created_at 默认 datetime('now'))
            db.run(`
                INSERT INTO netdisk_media 
                (source_id, path, title, original_title, year, overview, poster_url, fanart_url, rating, genres, media_type, tmdb_id, video_files, nfo_parsed, director, actor, area, tagline, studio, extra_metadata, v_codec, a_codec, duration, container, probe_status, series, tags, is_locked, scanned_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `, [
                source.id, folder.path, metadata.title, metadata.original_title || null, metadata.year,
                metadata.overview, metadata.poster_url, metadata.fanart_url, metadata.rating, metadata.genres || null,
                metadata.media_type, metadata.tmdb_id, JSON.stringify(videoFiles), metadata.nfo_parsed,
                metadata.director, metadata.actor, metadata.area, metadata.tagline, metadata.studio,
                metadata.extra_metadata ? JSON.stringify(metadata.extra_metadata) : null,
                metadata.v_codec || null, metadata.a_codec || null, metadata.duration || 0,
                metadata.container || null, metadata.probe_status || 0,
                metadata.series || null, metadata.tags || null,
                0  // is_locked 默认 0
            ]);
        }
    }

    parseTitle(name) {
        return name.replace(/[（(]\d{4}[)）]/g, '').replace(/\.\d{4}\./g, ' ').replace(/\./g, ' ').trim() || name;
    }

    parseYear(name) {
        const match = name.match(/[（(](\d{4})[)）]/) || name.match(/\.(\d{4})\./);
        return match ? parseInt(match[1]) : null;
    }

    isVideoFile(name) {
        const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
        return VIDEO_EXTENSIONS.includes(ext);
    }

    async fetchNfoContent(url, headers = {}) {
        if (url.startsWith('file://')) {
            const fs = require('fs/promises');
            const filePath = url.replace('file://', '');
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        }
        const res = await fetch(url, { headers, timeout: 10000 });
        return await res.text();
    }

    parseNfo(content, fallbackTitle) {
        try {
            let xmlBody = content.replace(/<\?xml[\s\S]*?\?>/i, '').trim();
            const rootMatch = xmlBody.match(/<(movie|tvshow|video|musicvideo)[^>]*>([\s\S]*?)<\/\1>/i);
            if (rootMatch) xmlBody = rootMatch[2].trim();

            const extra = {};
            const tagRegex = /<([a-zA-Z0-9_]+)[^>]*>([\s\S]*?)<\/\1>/gi;
            let match;

            while ((match = tagRegex.exec(xmlBody)) !== null) {
                const tag = match[1].toLowerCase();
                let value = match[2].trim();
                if (!value) continue;

                if (value.includes('<')) {
                    if (tag === 'actor') {
                        const name = value.match(/<name[^>]*>([\s\S]*?)<\/name>/i)?.[1].trim();
                        if (name) (extra['actor'] = extra['actor'] || []).push(name);
                    } else if (tag === 'ratings' || tag === 'rating') {
                        const val = value.match(/<value[^>]*>([\s\S]*?)<\/value>/i)?.[1].trim();
                        if (val) extra['rating'] = val;
                    } else if (tag === 'genre') {
                        (extra['genre'] = extra['genre'] || []).push(value.replace(/<[^>]+>/g, '').trim());
                    } else if (tag === 'tag') {
                        (extra['tag'] = extra['tag'] || []).push(value.replace(/<[^>]+>/g, '').trim());
                    } else if (tag === 'set') {
                        const setName = value.match(/<name[^>]*>([\s\S]*?)<\/name>/i)?.[1].trim();
                        if (setName) extra['set'] = setName;
                    }
                } else {
                    if (extra[tag]) {
                        if (!Array.isArray(extra[tag])) extra[tag] = [extra[tag]];
                        extra[tag].push(value);
                    } else {
                        extra[tag] = value;
                    }
                }
            }

            const arrayFields = ['genre', 'director', 'actor', 'tag'];
            arrayFields.forEach(f => {
                if (Array.isArray(extra[f])) {
                    let flat = [];
                    extra[f].forEach(v => {
                        if (typeof v === 'string' && (v.includes(',') || v.includes('，'))) {
                            flat.push(...v.split(/[,，]/).map(s => s.trim()));
                        } else {
                            flat.push(v);
                        }
                    });
                    extra[f] = [...new Set(flat.filter(Boolean))].join(', ');
                } else if (typeof extra[f] === 'string' && (extra[f].includes(',') || extra[f].includes('，'))) {
                    const split = extra[f].split(/[,，]/).map(s => s.trim()).filter(Boolean);
                    extra[f] = [...new Set(split)].join(', ');
                }
            });

            // 🚀 v2.1.0: 系列解析
            const seriesName = extra.set || extra.series;

            return {
                title: extra.title || fallbackTitle,
                original_title: extra.originaltitle || extra.original_title,
                year: parseInt(extra.year || extra.premiered) || null,
                overview: (extra.plot || extra.outline || extra.summary || '').replace(/<[^>]+>/g, '').trim(),
                rating: parseFloat(extra.rating) || null,
                genres: extra.genre,
                director: extra.director,
                actor: extra.actor,
                area: extra.country || extra.region,
                tagline: extra.tagline,
                studio: extra.studio,
                series: extra.set || extra.series,
                tags: extra.tag,
                media_type: content.includes('<tvshow>') ? 'tvshow' : 'movie',
                extra_metadata: extra
            };
        } catch (err) {
            return null;
        }
    }

    /**
     * 获取已索引的媒体列表
     */
    getMedia(sourceId, options = {}) {
        const db = getDatabase();
        let sql = 'SELECT * FROM netdisk_media WHERE source_id = ?';
        const params = [sourceId];



        if (options.type && options.type !== 'all') {
            sql += ' AND media_type = ?';
            params.push(options.type);
        }

        // 🚀 全文关键字搜索 (标题或原名)
        if (options.keyword) {
            sql += ' AND (title LIKE ? OR original_title LIKE ?)';
            params.push('%' + options.keyword + '%');
            params.push('%' + options.keyword + '%');
        }

        // 按路径前缀筛选 (忽略根路径，防止干扰全局过滤)
        if (options.path && options.path !== '/' && options.path !== '') {
            sql += ' AND path LIKE ?';
            params.push(options.path + '%');
        }

        // NFO 筛选条件
        // 🚀 分类和标签在数据库中是逗号分隔的字符串，必须用 LIKE %...%
        if (options.genres) {
            sql += ' AND genres LIKE ?';
            params.push('%' + options.genres + '%');
        }
        if (options.year) {
            sql += ' AND year = ?';
            params.push(parseInt(options.year));
        }
        if (options.area) {
            sql += ' AND area LIKE ?';
            params.push('%' + options.area + '%');
        }
        if (options.rating) {
            sql += ' AND rating >= ?';
            params.push(parseFloat(options.rating));
        }
        if (options.actor) {
            sql += ' AND actor LIKE ?';
            params.push('%' + options.actor + '%');
        }
        if (options.studio) {
            sql += ' AND studio LIKE ?';
            params.push('%' + options.studio + '%');
        }
        if (options.series) {
            sql += ' AND series = ?';
            params.push(options.series);
        }
        if (options.tags) {
            sql += ' AND tags LIKE ?';
            params.push('%' + options.tags + '%');
        }
        if (options.date) {
            sql += " AND strftime('%Y-%m-%d', created_at) = ?";
            params.push(options.date);
        }

        // 排序逻辑
        switch (options.sort) {
            case 'year':
                sql += ' ORDER BY year DESC, created_at DESC';
                break;
            case 'title':
                sql += ' ORDER BY title COLLATE NOCASE ASC';
                break;
            case 'rating':
                sql += ' ORDER BY COALESCE(rating, 0) DESC, created_at DESC';
                break;
            case 'resolution':
                // 根据 video_files 中的分辨率排序（简化处理：用 title 中可能包含的分辨率关键字）
                sql += " ORDER BY CASE WHEN title LIKE '%4K%' OR title LIKE '%2160%' THEN 1 WHEN title LIKE '%1080%' THEN 2 WHEN title LIKE '%720%' THEN 3 ELSE 4 END, created_at DESC";
                break;
            case 'latest':
            default:
                sql += ' ORDER BY created_at DESC';
                break;
        }
        if (options.limit) { sql += ' LIMIT ?'; params.push(parseInt(options.limit)); }
        if (options.offset) { sql += ' OFFSET ?'; params.push(parseInt(options.offset)); }



        return db.all(sql, params).map(item => ({
            ...item,
            video_files: item.video_files ? JSON.parse(item.video_files) : [],
            genres: item.genres ? item.genres.split(', ') : [],
            extra_metadata: item.extra_metadata ? JSON.parse(item.extra_metadata) : {}
        }));
    }

    /**
     * 获取媒体总数（用于分页）
     */
    getMediaCount(sourceId, options = {}) {
        const db = getDatabase();
        let sql = 'SELECT COUNT(*) as count FROM netdisk_media WHERE source_id = ?';
        const params = [sourceId];

        if (options.type && options.type !== 'all') {
            sql += ' AND media_type = ?';
            params.push(options.type);
        }

        // 🚀 全文关键字搜索 (标题或原名)
        if (options.keyword) {
            sql += ' AND (title LIKE ? OR original_title LIKE ?)';
            params.push('%' + options.keyword + '%');
            params.push('%' + options.keyword + '%');
        }

        if (options.path) {
            sql += ' AND path LIKE ?';
            params.push(options.path + '%');
        }

        // NFO 筛选条件
        if (options.genres) {
            sql += ' AND genres LIKE ?';
            params.push('%' + options.genres + '%');
        }
        if (options.year) {
            sql += ' AND year = ?';
            params.push(parseInt(options.year));
        }
        if (options.area) {
            sql += ' AND area LIKE ?';
            params.push('%' + options.area + '%');
        }
        if (options.rating) {
            sql += ' AND rating >= ?';
            params.push(parseFloat(options.rating));
        }
        if (options.actor) {
            sql += ' AND actor LIKE ?';
            params.push('%' + options.actor + '%');
        }
        if (options.studio) {
            sql += ' AND studio LIKE ?';
            params.push('%' + options.studio + '%');
        }
        if (options.series) {
            sql += ' AND series = ?';
            params.push(options.series);
        }
        if (options.tags) {
            sql += ' AND tags LIKE ?';
            params.push('%' + options.tags + '%');
        }
        if (options.date) {
            sql += " AND strftime('%Y-%m-%d', created_at) = ?";
            params.push(options.date);
        }

        const result = db.get(sql, params);
        return result ? result.count : 0;
    }

    /**
     * 清除指定源的媒体索引
     */
    clearMedia(sourceId) {
        const db = getDatabase();
        db.run('DELETE FROM netdisk_media WHERE source_id = ?', [sourceId]);
    }

    getMediaById(id) {
        const db = getDatabase();
        const item = db.get('SELECT * FROM netdisk_media WHERE id = ?', [id]);
        if (!item) return null;
        return {
            ...item,
            video_files: item.video_files ? JSON.parse(item.video_files) : [],
            genres: item.genres ? item.genres.split(', ') : [],
            extra_metadata: item.extra_metadata ? JSON.parse(item.extra_metadata) : {}
        };
    }

    /**
     * 获取筛选选项（聚合统计）
     * @param {number} sourceId - 网盘源 ID
     * @param {string} path - 可选，按路径前缀筛选
     * @returns {Object} 筛选选项及其数量
     */
    getFilters(sourceId, path = null) {
        const db = getDatabase();
        const baseCondition = path
            ? 'WHERE source_id = ? AND path LIKE ?'
            : 'WHERE source_id = ?';
        const baseParams = path ? [sourceId, path + '%'] : [sourceId];

        // 获取所有媒体的原始数据用于聚合
        const allMedia = db.all(
            `SELECT genres, year, area, actor, studio FROM netdisk_media ${baseCondition}`,
            baseParams
        );

        // 聚合各类型
        const genresMap = new Map();
        const yearsMap = new Map();
        const areasMap = new Map();
        const actorsMap = new Map();
        const studiosMap = new Map();

        for (const item of allMedia) {
            // 处理 genres（逗号分隔）
            if (item.genres) {
                const genreList = item.genres.split(',').map(g => g.trim()).filter(Boolean);
                for (const genre of genreList) {
                    genresMap.set(genre, (genresMap.get(genre) || 0) + 1);
                }
            }

            // 处理年份
            if (item.year) {
                yearsMap.set(item.year, (yearsMap.get(item.year) || 0) + 1);
            }

            // 处理地区（可能是逗号分隔）
            if (item.area) {
                const areaList = item.area.split(/[,，/]/).map(a => a.trim()).filter(Boolean);
                for (const area of areaList) {
                    areasMap.set(area, (areasMap.get(area) || 0) + 1);
                }
            }

            // 处理演员（逗号分隔）
            if (item.actor) {
                const actorList = item.actor.split(/[,，]/).map(a => a.trim()).filter(Boolean);
                for (const actor of actorList) {
                    actorsMap.set(actor, (actorsMap.get(actor) || 0) + 1);
                }
            }

            // 处理制片厂（逗号分隔）
            if (item.studio) {
                const studioList = item.studio.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                for (const studio of studioList) {
                    studiosMap.set(studio, (studiosMap.get(studio) || 0) + 1);
                }
            }
        }

        // 转换为数组并排序
        const sortByCount = (a, b) => b.count - a.count;

        return {
            genres: Array.from(genresMap.entries())
                .map(([value, count]) => ({ value, count }))
                .sort(sortByCount),
            years: Array.from(yearsMap.entries())
                .map(([value, count]) => ({ value, count }))
                .sort((a, b) => b.value - a.value),  // 年份降序
            areas: Array.from(areasMap.entries())
                .map(([value, count]) => ({ value, count }))
                .sort(sortByCount),
            actors: Array.from(actorsMap.entries())
                .map(([value, count]) => ({ value, count }))
                .sort(sortByCount),
            studios: Array.from(studiosMap.entries())
                .map(([value, count]) => ({ value, count }))
                .sort(sortByCount)
        };
    }

    /**
     * 获取媒体分组（用于聚合视图）
     */
    getMediaGroups(sourceId, type = 'date', options = {}) {
        const db = getDatabase();
        let sql = '';
        const params = [sourceId];

        // 基础过滤条件
        let where = 'WHERE source_id = ?';
        if (options.path) {
            where += ' AND path LIKE ?';
            params.push(options.path + '%');
        }

        if (type === 'date') {
            // 按发行年份聚合
            where += " AND year IS NOT NULL AND year > 0";
            sql = `
                SELECT 
                    CAST(year AS TEXT) as key,
                    CAST(year AS TEXT) || '年' as name,
                    GROUP_CONCAT(poster_url) as covers,
                    COUNT(*) as count
                FROM netdisk_media
                ${where}
                GROUP BY year
                ORDER BY year DESC
            `;
        } else if (type === 'collection') {
            // 按系列/合集聚合
            where += " AND series IS NOT NULL AND series != ''";
            sql = `
                SELECT 
                    series as key,
                    series as name,
                    GROUP_CONCAT(poster_url) as covers,
                    COUNT(*) as count
                FROM netdisk_media
                ${where}
                GROUP BY series
                ORDER BY count DESC
            `;
        } else if (type === 'category' || type === 'tag') {
            // 按标签或分类聚合
            const field = type === 'category' ? 'genres' : 'tags';
            const all = db.all(`SELECT ${field}, poster_url FROM netdisk_media ${where} AND ${field} IS NOT NULL AND ${field} != ''`, params);

            const groupMap = new Map();
            for (const item of all) {
                const values = item[field].split(',').map(v => v.trim()).filter(Boolean);
                for (const val of values) {
                    if (!groupMap.has(val)) {
                        groupMap.set(val, { key: val, name: val, covers: [], count: 0 });
                    }
                    const group = groupMap.get(val);
                    if (group.covers.length < 4 && item.poster_url) {
                        group.covers.push(item.poster_url);
                    }
                    group.count++;
                }
            }
            return Array.from(groupMap.values()).sort((a, b) => b.count - a.count);
        }

        if (!sql) return [];
        // 转换 covers 字符串为数组，最多取4个
        return db.all(sql, params).map(row => ({
            ...row,
            covers: row.covers ? row.covers.split(',').slice(0, 4) : []
        }));
    }
}

const mediaScanService = new MediaScanService();
module.exports = { MediaScanService, mediaScanService };
