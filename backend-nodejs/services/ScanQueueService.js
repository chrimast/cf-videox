/**
 * 后台异步任务队列服务 (ScanQueueService)
 * Video 2.0 核心组件 - 负责视频探测及图片预缓存
 */

const { getDatabase } = require('../database');
const transcodeService = require('./TranscodeService');
const imageCacheService = require('./ImageCacheService');
const os = require('os');

// 并发及延迟配置
// 并发及延迟配置
const PROBE_CONCURRENCY = 3;
const IMAGE_CONCURRENCY = 5;
const BATCH_SIZE = 5;         // 降低并发以解决 SQLite 锁争用

// 🚀 v2.0.8 激进调度配置 (高性能模式)
const REFRESH_DELAY = 50;     // 元数据补齐极速模式
const PROBE_DELAY = 1000;
const IMAGE_DELAY = 200;
const IDLE_SLEEP = 10000;

// 初始默认并发 (之后会从数据库动态加载)
let CURRENT_PROBE_CONCURRENCY = 3;
let CURRENT_IMAGE_CONCURRENCY = 5;
let CURRENT_BATCH_SIZE = 5;

class ScanQueueService {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;
        this.processedCount = 0;
        this.failedCount = 0;
        this.lastActivity = null;
        this.isPausedByPlayback = false;
        this.pausedByPlaybackSince = null; // 🚀 记录避让开始时间，用于超时自愈

        // 内存中的临时即时重试队列 (高优先级)
        this.instantRetryUrls = [];
        // 缓存本次运行检查过的图片 URL，防止在海报缓存环节死循环
        this.checkedImageUrls = new Set();
    }

    /**
     * 启动后台服务
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[ScanQueue] Unified V2.0.8 background scan service started (High Performance Mode)');
        this._runLoop();
    }

    /**
     * 停止服务
     */
    stop() {
        this.isRunning = false;
        console.log('[ScanQueue] Unified background scan service stopped');
    }

    /**
     * 添加即时重试任务 (高优先级)
     */
    addInstantRetry(urls) {
        if (Array.isArray(urls)) {
            this.instantRetryUrls.push(...urls);
        } else {
            this.instantRetryUrls.push(urls);
        }
        if (!this.isRunning) this.start();
    }

    /**
     * 获取状态
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            isPausedByPlayback: this.isPausedByPlayback,
            processedCount: this.processedCount,
            failedCount: this.failedCount,
            lastActivity: this.lastActivity,
            instantRetryQueueLength: this.instantRetryUrls.length
        };
    }

    /**
     * 设置是否因播放而暂停 (由 TranscodeService 驱动)
     */
    setPausedByPlayback(paused) {
        if (this.isPausedByPlayback === paused) return;
        this.isPausedByPlayback = paused;
        if (paused) {
            this.pausedByPlaybackSince = Date.now(); // 🚀 记录避让开始时间
            console.log('[ScanQueue] 🚀 Active playback detected, background tasks entering silent mode...');
        } else {
            this.pausedByPlaybackSince = null;
            console.log('[ScanQueue] ✅ No active playback, background tasks resuming...');
        }
    }

    /**
     * 主循环 (🚀 v2.0.8 激进批处理逻辑)
     */
    async _runLoop() {
        while (this.isRunning) {
            // 0. 动态加载最新的并发配置
            this._loadConcurrencyConfig();

            // 1. 优先处理即时重试队列 (批量处理)
            if (this.instantRetryUrls.length > 0) {
                const batch = this.instantRetryUrls.splice(0, CURRENT_IMAGE_CONCURRENCY);
                await Promise.all(batch.map(url => imageCacheService.preCache(url)));
                continue;
            }

            // 2. 播放避让逻辑 (最高优先级) + 🚀 超时自愈机制
            if (this.isPausedByPlayback) {
                // 🚨 超时自愈：如果避让超过 10 分钟，强制恢复
                const MAX_PAUSE_DURATION = 10 * 60 * 1000; // 10 分钟
                if (this.pausedByPlaybackSince && (Date.now() - this.pausedByPlaybackSince) > MAX_PAUSE_DURATION) {
                    console.warn('[ScanQueue] ⚠️ Playback pause exceeded 10 minutes, force resuming background tasks!');
                    this.isPausedByPlayback = false;
                    this.pausedByPlaybackSince = null;
                } else {
                    await this._sleep(30000); // 播放中，保持避让
                    continue;
                }
            }

            // 3. 密集任务处理 (严格优先级：海报缓存 > 元数据信息 > 视频探测)
            let hasWork = false;

            // A. 图片缓存任务 (最优先级：确保用户能尽快看到封面)
            const imageItems = this._getPendingImageUrls(CURRENT_IMAGE_CONCURRENCY);
            if (imageItems.length > 0) {
                hasWork = true;
                await Promise.all(imageItems.map(url => {
                    this.checkedImageUrls.add(url);
                    return imageCacheService.preCache(url);
                }));
                // 💡 关键修复：不再使用 continue。即使有海报任务，也允许后续的元数据和探测任务运行。
                // 否则如果海报任务一直处于“已存在但未标记”状态，会阻塞整个队列。
                await this._sleep(IMAGE_DELAY);

                // 定期清理已检查名单（防止内存泄漏，每 2000 个清理一次）
                if (this.checkedImageUrls.size > 2000) {
                    this.checkedImageUrls.clear();
                }
            }

            // B. 元数据补完任务 (并发模式：加速 NFO 和系列信息识别)
            const refreshItems = this._getPendingRefreshItems(CURRENT_BATCH_SIZE);
            if (refreshItems.length > 0) {
                hasWork = true;
                // 🚀 将串行改为并发处理 (每批处理 BATCH_SIZE 个)
                await Promise.all(refreshItems.map(async (item, index) => {
                    try {
                        // 增加微小抖动 (0-100ms)，错开瞬间写入
                        await new Promise(r => setTimeout(r, index * 20));

                        const { mediaScanService } = require('./MediaScanService');
                        const db = getDatabase();
                        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [item.source_id]);
                        if (source) {
                            const { getNetdiskClient } = require('../routes/netdisk');
                            const client = await getNetdiskClient(source);
                            const folder = { path: item.path, name: item.title };
                            // skipProbe = true, 仅处理元数据
                            await mediaScanService.processMediaFolder(client, source, folder, true, true, true, true);
                            this.processedCount++;
                            console.log(`[ScanQueue] Metadata refresh (Parallel) completed: ${item.title}`);
                        }
                    } catch (err) {
                        const db = getDatabase();
                        db.run('UPDATE netdisk_media SET nfo_parsed = -1 WHERE id = ?', [item.id]);
                    }
                }));
                await this._sleep(50); // 极短延迟
                continue;
            }

            // C. 视频探测任务 (最低优先级：最后处理技术参数)
            const probeItems = this._getPendingProbeItems(CURRENT_PROBE_CONCURRENCY);
            if (probeItems.length > 0) {
                hasWork = true;
                await Promise.all(probeItems.map(item => this._probeItem(item)));
                await this._sleep(PROBE_DELAY);
                continue;
            }

            // 4. 如果本次循环没活，进入短休眠
            if (!hasWork) {
                this.lastActivity = new Date().toISOString();
                await this._sleep(IDLE_SLEEP);
            }
        }
    }

    /**
     * 从数据库动态加载并发配置
     */
    _loadConcurrencyConfig() {
        try {
            const db = getDatabase();
            const config = db.all("SELECT key, value FROM settings WHERE key IN ('image_concurrency', 'metadata_concurrency', 'probe_concurrency')");

            config.forEach(item => {
                const val = parseInt(item.value);
                if (isNaN(val)) return;

                if (item.key === 'image_concurrency') CURRENT_IMAGE_CONCURRENCY = val;
                if (item.key === 'metadata_concurrency') CURRENT_BATCH_SIZE = val;
                if (item.key === 'probe_concurrency') CURRENT_PROBE_CONCURRENCY = val;
            });
        } catch (e) {
            // 忽略错误，使用上次或默认值
        }
    }

    /**
     * 获取待补全元数据的媒体项
     */
    _getPendingRefreshItems(limit) {
        const db = getDatabase();
        try {
            return db.all(
                `SELECT id, source_id, path, title, video_files 
                 FROM netdisk_media 
                 WHERE nfo_parsed = 0 AND is_locked = 0
                 ORDER BY scanned_at DESC 
                 LIMIT ?`,
                [limit]
            );
        } catch (err) { return []; }
    }

    /**
     * 补全元数据实操 (读 NFO / TMDB)
     */
    async _refreshMetadata(item) {
        const { mediaScanService } = require('./MediaScanService');
        const db = getDatabase();
        try {
            console.log(`[ScanQueue] Background refreshing metadata for: ${item.title}`);
            const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [item.source_id]);
            if (!source) return;

            const { getNetdiskClient } = require('../routes/netdisk');
            const client = await getNetdiskClient(source);
            const folder = { path: item.path, name: item.title };

            // 💡 调用 MediaScanService 的 processMediaFolder，并设 force = true
            // 由于是后台单个处理，IO 压力受 REFRESH_DELAY 保护
            await mediaScanService.processMediaFolder(client, source, folder, true, true);
            this.processedCount++;
            console.log(`[ScanQueue] Metadata refresh completed for: ${item.title}`);
        } catch (err) {
            console.warn(`[ScanQueue] Failed to refresh metadata for ${item.title}:`, err.message);
            // 标记为已处理以避免死循环，或者增加错误计数
            db.run('UPDATE netdisk_media SET nfo_parsed = -1 WHERE id = ?', [item.id]);
        }
    }

    /**
     * 获取待探测的媒体项
     */
    _getPendingProbeItems(limit) {
        const db = getDatabase();
        try {
            return db.all(
                `SELECT id, source_id, path, title, video_files 
                 FROM netdisk_media 
                 WHERE probe_status = 0 
                 ORDER BY scanned_at DESC 
                 LIMIT ?`,
                [limit]
            );
        } catch (err) { return []; }
    }

    /**
     * 获取待预缓存的图片 URL
     */
    _getPendingImageUrls(limit) {
        const db = getDatabase();
        try {
            const port = process.env.PORT || 3100;
            const baseUrl = `http://127.0.0.1:${port}`;

            return db.all(
                `SELECT m.poster_url 
                 FROM netdisk_media m
                 JOIN netdisk_sources s ON m.source_id = s.id
                 WHERE m.poster_url IS NOT NULL 
                   AND m.poster_url != ''
                   AND s.type IN ('alist', 'webdav')
                   AND m.poster_url NOT IN (SELECT url FROM failed_images WHERE fail_count >= 3)
                   AND m.poster_url NOT LIKE 'http://127.0.0.1%'
                 ORDER BY m.scanned_at DESC 
                 LIMIT ?`,
                [limit * 2]
            ).map(row => {
                let url = row.poster_url;
                if (url.startsWith('/')) {
                    url = baseUrl + url;
                }
                return url;
            }).filter(url => !this.checkedImageUrls.has(url))
                .slice(0, limit);
        } catch (err) { return []; }
    }

    /**
     * 探测单个媒体项
     */
    async _probeItem(item) {
        const db = getDatabase();
        try {
            const videoFiles = JSON.parse(item.video_files || '[]');
            if (videoFiles.length === 0) {
                this._markStatus(item.id, -1);
                return;
            }

            const firstVideo = videoFiles[0];
            let probeUrl = '';

            if (firstVideo.includes('|')) {
                probeUrl = firstVideo.split('|')[1];
            } else {
                const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [item.source_id]);
                if (!source) {
                    this._markStatus(item.id, -1);
                    return;
                }
                const port = process.env.PORT || 3100;
                probeUrl = `http://127.0.0.1:${port}/api/netdisk/stream?sourceId=${source.id}&path=${encodeURIComponent(item.path + '/' + firstVideo)}`;
            }

            console.log(`[ScanQueue] Probing in background: ${item.title}`);
            const mediaInfo = await transcodeService.getMediaInfo(probeUrl, {});

            if (mediaInfo && mediaInfo.videoCodec) {
                db.run(
                    `UPDATE netdisk_media 
                     SET v_codec = ?, a_codec = ?, duration = ?, container = ?, probe_status = 1 
                     WHERE id = ?`,
                    [mediaInfo.videoCodec, mediaInfo.audioCodec || null, mediaInfo.duration || 0, (mediaInfo.format || '').split(',')[0], item.id]
                );
                this.processedCount++;
                console.log(`[ScanQueue] Probe completed for: ${item.title}`);
            } else {
                this._markStatus(item.id, -1);
                this.failedCount++;
            }
        } catch (err) {
            console.warn(`[ScanQueue] Failed to probe ${item.title}:`, err.message);
            this._markStatus(item.id, -1);
            this.failedCount++;
        }
    }

    _markStatus(id, status) {
        const db = getDatabase();
        try {
            db.run('UPDATE netdisk_media SET probe_status = ? WHERE id = ?', [status, id]);
        } catch (err) { }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const scanQueueService = new ScanQueueService();
module.exports = { ScanQueueService, scanQueueService };
