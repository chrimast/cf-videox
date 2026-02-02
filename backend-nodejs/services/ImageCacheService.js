const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');

// 缓存目录配置 - 存放在主程序的 data 目录下
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache', 'video_covers');

// Video 2.0: 失败名单配置
const FAIL_THRESHOLD = 3;           // 失败次数阈值
const FAIL_COOLDOWN = 24 * 60 * 60 * 1000; // 24 小时冷却期

class ImageCacheService {
    constructor() {
        this.ensureCacheDir();
    }

    ensureCacheDir() {
        if (!fs.existsSync(CACHE_DIR)) {
            try {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
                console.log(`[ImageCache] Created cache directory: ${CACHE_DIR}`);
            } catch (err) {
                console.error(`[ImageCache] Failed to create cache dir:`, err.message);
            }
        }
    }

    /**
     * Video 2.0: 检查 URL 是否在失败名单中 (数据库持久化版)
     */
    _isInDeathList(url) {
        const { getDatabase } = require('../database');
        const db = getDatabase();
        if (!db) return false;

        try {
            const record = db.get('SELECT fail_count, last_fail_at FROM failed_images WHERE url = ?', [url]);
            if (!record) return false;

            // 检查冷却期
            const lastFailAt = new Date(record.last_fail_at).getTime();
            if (Date.now() - lastFailAt > FAIL_COOLDOWN) {
                db.run('DELETE FROM failed_images WHERE url = ?', [url]);
                return false;
            }

            return record.fail_count >= FAIL_THRESHOLD;
        } catch (err) {
            return false;
        }
    }

    /**
     * Video 2.0: 记录失败 (数据库持久化版)
     */
    _recordFailure(url) {
        const { getDatabase } = require('../database');
        const db = getDatabase();
        if (!db) return;

        try {
            const record = db.get('SELECT fail_count FROM failed_images WHERE url = ?', [url]);
            if (!record) {
                db.run('INSERT INTO failed_images (url, fail_count, last_fail_at) VALUES (?, 1, CURRENT_TIMESTAMP)', [url]);
            } else {
                db.run(
                    'UPDATE failed_images SET fail_count = fail_count + 1, last_fail_at = CURRENT_TIMESTAMP WHERE url = ?',
                    [url]
                );
            }
        } catch (err) {
            console.error(`[ImageCache] Failed to record failure to DB:`, err.message);
        }
    }

    /**
     * 获取缓存后的图片路径
     * @param {string} imageUrl 原始图片 URL 或网盘路径
     * @param {object} headers 请求原始图片所需的 Headers
     */
    async getCachedImage(imageUrl, headers = {}) {
        if (!imageUrl) return null;

        // Video 2.0: 检查失败名单
        if (this._isInDeathList(imageUrl)) {
            return null;
        }

        // 1. 生成唯一的 Cache Key (MD5)
        const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
        const cachePath = path.join(CACHE_DIR, `${hash}.webp`);

        // 2. 检查缓存命中
        if (fs.existsSync(cachePath)) {
            const stats = fs.statSync(cachePath);
            if (stats.size > 0) {
                // Video 2.0: 增加 WebP 格式校验 (检查文件头部 Magic Number)
                try {
                    const fd = fs.openSync(cachePath, 'r');
                    const buffer = Buffer.alloc(12);
                    fs.readSync(fd, buffer, 0, 12, 0);
                    fs.closeSync(fd);
                    // WebP 格式: RIFF....WEBP
                    const isValidWebP = buffer.toString('ascii', 0, 4) === 'RIFF' &&
                        buffer.toString('ascii', 8, 12) === 'WEBP';
                    if (isValidWebP) {
                        return cachePath;
                    } else {
                        // 文件损坏，删除后重新下载
                        console.warn(`[ImageCache] Corrupted cache file detected, re-downloading: ${cachePath}`);
                        fs.unlinkSync(cachePath);
                    }
                } catch (e) {
                    // 校验失败，尝试删除并重下
                    try { fs.unlinkSync(cachePath); } catch (e2) { }
                }
            }
        }

        // 3. 缓存未命中，下载并处理
        try {
            // 还原为稳健的 URL 处理：不再进行激进解码，直接使用经过 netdisk.js 编码后的 URL。
            // 仅处理未转义的 # 号（如果存在），防止被 axios/fetch 识别为 hash 丢弃。
            let safeUrl = imageUrl;
            if (imageUrl.includes('#') && !imageUrl.includes('%23')) {
                safeUrl = imageUrl.replace(/#/g, '%23');
            }

            console.log(`[ImageCache] Cache miss: ${safeUrl.substring(0, 150)}...`);
            const response = await axios({
                url: safeUrl,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    ...headers
                },
                timeout: 10000
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}`);
            }

            // 4. 使用 Sharp 进行压缩与并转换为 WebP
            // 设定最大宽度 480px (兼容高分屏)，质量 85，平衡清晰度与体积
            const processedBuffer = await sharp(response.data)
                .resize({ width: 480, withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();

            // 5. Video 2.0: 原子化写入 (先写临时文件再重命名)
            const tempPath = cachePath + '.tmp';
            fs.writeFileSync(tempPath, processedBuffer);
            fs.renameSync(tempPath, cachePath);

            return cachePath;
        } catch (err) {
            console.error(`[ImageCache] Error processing ${imageUrl.substring(0, 200)}:`, err.message);
            // Video 2.0: 记录失败
            this._recordFailure(imageUrl);
            return null;
        }
    }

    /**
     * Video 2.0: 预缓存图片 (供后台队列调用)
     */
    async preCache(imageUrl, headers = {}) {
        return await this.getCachedImage(imageUrl, headers);
    }

    /**
     * 清理所有缓存文件
     */
    async clearAllCache() {
        if (fs.existsSync(CACHE_DIR)) {
            try {
                const files = fs.readdirSync(CACHE_DIR);
                for (const file of files) {
                    fs.unlinkSync(path.join(CACHE_DIR, file));
                }
                console.log(`[ImageCache] Cleared ${files.length} cache files.`);
            } catch (err) {
                console.error(`[ImageCache] Failed to clear cache:`, err.message);
            }
        }
    }
}

module.exports = new ImageCacheService();
