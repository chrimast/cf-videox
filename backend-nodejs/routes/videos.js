const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');
const { getSystemProxyAgent } = require('../utils/fetch-agent');

/**
 * 获取视频列表
 * GET /api/videos
 * Query: source_id, category_id, page, limit
 */
router.get('/', async (req, res) => {
    try {
        const { source_id, category_id, page = 1, limit = 20 } = req.query;

        if (!source_id) {
            return res.status(400).json({ success: false, error: 'source_id is required' });
        }

        const db = getDatabase();
        const source = db.get('SELECT * FROM video_sources WHERE id = ?', [source_id]);

        if (!source) {
            return res.status(404).json({ success: false, error: 'Source not found' });
        }

        // 使用 CMS API 解析器获取视频列表
        const { CmsApiParser } = require('../services/CmsApiParser');
        // 获取代理设置
        const agent = source.proxy_enabled ? getSystemProxyAgent() : null;
        const parser = new CmsApiParser(source.url, agent);

        const result = await parser.getVideos({
            categoryId: category_id,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            data: result.list,
            pagination: {
                page: result.page,
                pagecount: result.pagecount,
                limit: result.limit,
                total: result.total
            }
        });
    } catch (error) {
        console.error('[videos] Failed to get videos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 搜索视频
 * GET /api/videos/search
 * Query: keyword, source_id (可选), page, limit
 * 
 * 注意：此路由必须在 /:id 之前定义，否则 'search' 会被当作 id
 */
router.get('/search', async (req, res) => {
    try {
        const { keyword, source_id, page = 1, limit = 20, stream } = req.query;

        if (!keyword) {
            return res.status(400).json({ success: false, error: 'keyword is required' });
        }

        const db = getDatabase();
        let sources = [];
        let isSpecificMediaServer = false;
        let isAllMediaServers = (req.query.is_media_server === 'true');

        // 🎯 逻辑增强：如果指定了 source_id，需要判断该 ID 是资源站还是影视库
        if (source_id) {
            const isMS = await db.get('SELECT id FROM media_servers WHERE id = ?', [source_id]);
            if (isMS) {
                isSpecificMediaServer = true;
            } else {
                // 如果不是影视库，则尝试作为资源站源
                const source = db.get('SELECT * FROM video_sources WHERE id = ? AND enabled = 1', [source_id]);
                if (source) sources.push(source);
            }
        } else if (!isAllMediaServers) {
            // 只有在非全影视库搜索模式下，才加载所有资源站
            sources = db.all('SELECT * FROM video_sources WHERE enabled = 1 ORDER BY sort_order');
        }

        // 如果既没搜到资源站，也不是影视库模式，才返回空
        if (sources.length === 0 && !isSpecificMediaServer && !isAllMediaServers) {
            return res.json({ success: true, data: [], message: 'No enabled sources' });
        }

        // 如果开启流式搜索
        if (stream === 'true' || stream === '1') {
            // 如果使用了 compression 中间件，立即刷新响应头
            if (typeof res.flushHeaders === 'function') res.flushHeaders();

            // 1. 媒体库搜索 (DB) - 仅在未指定 source_id 时显示（全局搜索模式）
            if (!source_id) {
                try {
                    const { MediaScanService } = require('../services/MediaScanService');
                    const adminPassword = req.headers['x-admin-password'];
                    const mediaResults = await MediaScanService.getMedia({
                        keyword,
                        limit: 20,
                        adminPassword // 传递密码用于权限过滤
                    });

                    if (mediaResults && mediaResults.length > 0) {
                        const mappedMedia = mediaResults.map(item => ({
                            vod_id: item.id.toString(),
                            vod_name: item.title,
                            vod_pic: item.poster_url || '',
                            vod_remarks: item.year ? `${item.year}` : '',
                            type_name: item.media_type === 'movie' ? '电影' : '剧集',
                            source_id: item.source_id,
                            is_netdisk: true
                        }));
                        res.write(`data: ${JSON.stringify({ type: 'results', source: '本地媒体库', data: mappedMedia })}\n\n`);
                        if (typeof res.flush === 'function') res.flush();
                    }
                } catch (err) {
                    console.error('[videos] DB Search failed:', err);
                }
            }

            // 2. 影视库搜索 (Emby/Jellyfin)
            // 逻辑：如果是全局搜索(!source_id && !isAllMediaServers)，或者显式搜索影视库
            if ((!source_id && !isAllMediaServers) || isSpecificMediaServer || isAllMediaServers) {
                try {
                    if (isSpecificMediaServer) {
                        mediaServers = await db.all('SELECT * FROM media_servers WHERE id = ? AND enabled = 1', [source_id]);
                    } else {
                        mediaServers = await db.all('SELECT * FROM media_servers WHERE enabled = 1');
                    }

                    // 权限检查：如果不是管理员，过滤掉隐藏的影视库
                    const authorized = isAuthorized(req, db);
                    if (!authorized) {
                        mediaServers = mediaServers.filter(ms => !ms.hidden);
                    }

                    if (mediaServers.length > 0) {
                        const MediaServerService = require('../services/media-server-service');
                        const serverPromises = mediaServers.map(async (ms) => {
                            try {
                                const msResult = await MediaServerService.search(ms, keyword);
                                if (msResult.success && msResult.data.length > 0) {
                                    const mapped = msResult.data.map(item => ({
                                        vod_id: item.Id,
                                        vod_name: item.Name,
                                        vod_pic: MediaServerService.getImageUrl(ms, item.Id, item.ImageTags?.Primary),
                                        vod_remarks: item.ProductionYear ? `${item.ProductionYear}` : '',
                                        type_name: item.Type === 'Movie' ? '电影' : '剧集',
                                        source_id: ms.id,
                                        source_name: ms.name,
                                        is_media_server: true
                                    }));
                                    res.write(`data: ${JSON.stringify({ type: 'results', source: ms.name, data: mapped })}\n\n`);
                                    if (typeof res.flush === 'function') res.flush();
                                }
                            } catch (e) {
                                console.warn(`[videos] Media server search failed for ${ms.name}:`, e.message);
                            }
                        });
                        await Promise.all(serverPromises);
                    }
                } catch (err) {
                    console.error('[videos] Media Server search initialization failed:', err);
                }
            }

            // 3. 资源站搜索 (CMS)
            // 逻辑：如果 sources 数组不为空且未开启专项影视库模式
            if (sources.length > 0 && !isAllMediaServers && !isSpecificMediaServer) {
                const { CmsApiParser } = require('../services/CmsApiParser');
                const concurrencyLimit = 10;
                const sourceChunks = [];
                // 如果指定了 CMS source_id，则 sources 数组里只会有一个元素，否则是全部
                for (let i = 0; i < sources.length; i += concurrencyLimit) {
                    sourceChunks.push(sources.slice(i, i + concurrencyLimit));
                }

                for (const chunk of sourceChunks) {
                    const chunkPromises = chunk.map(async (source) => {
                        try {
                            const agent = source.proxy_agent_enabled || source.proxy_enabled ? getSystemProxyAgent() : null;
                            const parser = new CmsApiParser(source.url, agent);
                            const result = await parser.search(keyword, parseInt(page), parseInt(limit));

                            const list = (result.list || []).map(item => ({
                                ...item,
                                source_id: source.id,
                                source_name: source.name,
                                vod_pic: item.vod_pic || item.pic || '' // 兼容性字段
                            }));

                            if (list.length > 0) {
                                res.write(`data: ${JSON.stringify({ type: 'results', source: source.name, data: list })}\n\n`);
                                if (typeof res.flush === 'function') res.flush();
                            }
                            return list;
                        } catch (err) {
                            console.warn(`[videos] Search failed for source ${source.name}:`, err.message);
                            res.write(`data: ${JSON.stringify({ type: 'error', source: source.name, error: err.message })}\n\n`);
                            if (typeof res.flush === 'function') res.flush();
                            return [];
                        }
                    });

                    await Promise.all(chunkPromises);
                }
            }

            console.log(`[videos/search] Stream search finished for: "${keyword}"`);
            res.write('data: [DONE]\n\n');
            if (typeof res.flush === 'function') res.flush();
            res.end();
            return;
        }



        // 非流式搜索（原逻辑，保持兼容）
        const { CmsApiParser } = require('../services/CmsApiParser');
        const results = [];
        const concurrencyLimit = 10;
        const sourceChunks = [];
        for (let i = 0; i < sources.length; i += concurrencyLimit) {
            sourceChunks.push(sources.slice(i, i + concurrencyLimit));
        }

        for (const chunk of sourceChunks) {
            const chunkPromises = chunk.map(async (source) => {
                try {
                    const agent = source.proxy_agent_enabled || source.proxy_enabled ? getSystemProxyAgent() : null;
                    const parser = new CmsApiParser(source.url, agent);
                    const result = await parser.search(keyword, parseInt(page), parseInt(limit));

                    return (result.list || []).map(item => ({
                        ...item,
                        source_id: source.id,
                        source_name: source.name
                    }));
                } catch (err) {
                    return [];
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            for (const list of chunkResults) {
                results.push(...list);
            }
        }

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('[videos] Failed to search videos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取 Banner 数据
 * GET /api/videos/banner
 * 
 * 注意：此路由必须在 /:id 之前定义
 */
router.get('/banner', async (req, res) => {
    try {
        const db = getDatabase();

        // 获取 Banner 设置
        const bannerCountSetting = db.get("SELECT value FROM settings WHERE key = 'banner_count'");
        const bannerSourcesSetting = db.get("SELECT value FROM settings WHERE key = 'banner_sources'");

        const bannerCount = parseInt(bannerCountSetting?.value || '6');
        let sourceIds = [];

        try {
            sourceIds = JSON.parse(bannerSourcesSetting?.value || '[]');
        } catch (e) {
            sourceIds = [];
        }

        // 如果没有指定源，使用所有启用的源
        let sources;
        if (sourceIds.length > 0) {
            sources = db.all(`SELECT * FROM video_sources WHERE id IN (${sourceIds.map(() => '?').join(',')}) AND enabled = 1`, sourceIds);
        } else {
            sources = db.all('SELECT * FROM video_sources WHERE enabled = 1 ORDER BY sort_order LIMIT 3');
        }

        if (sources.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { CmsApiParser } = require('../services/CmsApiParser');
        const bannerVideos = [];

        // 优化：并行获取所有源的热门视频
        const videosPerSource = Math.ceil(bannerCount / sources.length);
        const sourcePromises = sources.map(async (source) => {
            try {
                const agent = source.proxy_enabled ? getSystemProxyAgent() : null;
                const parser = new CmsApiParser(source.url, agent);
                const result = await parser.getVideos({ page: 1, limit: videosPerSource });

                return (result.list || []).map(video => ({
                    ...video,
                    source_id: source.id,
                    source_name: source.name
                }));
            } catch (err) {
                console.warn(`[videos] Banner fetch failed for source ${source.name}:`, err.message);
                return [];
            }
        });

        const resultsList = await Promise.all(sourcePromises);
        for (const list of resultsList) {
            for (const video of list) {
                if (bannerVideos.length >= bannerCount) break;
                bannerVideos.push(video);
            }
            if (bannerVideos.length >= bannerCount) break;
        }

        res.json({ success: true, data: bannerVideos });
    } catch (error) {
        console.error('[videos] Failed to get banner:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 辅助函数：检查是否已授权（管理员）
function isAuthorized(req, db) {
    const adminPassword = req.headers['x-admin-password'];
    const enabledSetting = db.get("SELECT value FROM settings WHERE key = 'admin_password_enabled'");
    const passwordSetting = db.get("SELECT value FROM settings WHERE key = 'admin_password'");

    const isPasswordEnabled = enabledSetting?.value === 'true' || enabledSetting?.value === true;
    if (!isPasswordEnabled) return true;

    const storedPassword = passwordSetting?.value || '';
    return adminPassword === storedPassword;
}

/**
 * 获取视频详情
 * GET /api/videos/:id
 * Query: source_id
 * 
 * 注意：此路由必须放在 /search 和 /banner 之后
 */
router.get('/:id', async (req, res) => {
    try {
        const { source_id } = req.query;

        if (!source_id) {
            return res.status(400).json({ success: false, error: 'source_id is required' });
        }

        const db = getDatabase();
        const source = db.get('SELECT * FROM video_sources WHERE id = ?', [source_id]);

        if (!source) {
            return res.status(404).json({ success: false, error: 'Source not found' });
        }

        const { CmsApiParser } = require('../services/CmsApiParser');
        const agent = source.proxy_enabled ? getSystemProxyAgent() : null;
        const parser = new CmsApiParser(source.url, agent);

        const video = await parser.getVideoDetail(req.params.id);

        if (!video) {
            return res.status(404).json({ success: false, error: 'Video not found' });
        }

        // 添加源信息
        video.source_id = source.id;
        video.source_name = source.name;
        video.source_proxy_enabled = !!source.proxy_enabled;

        res.json({ success: true, data: video });
    } catch (error) {
        console.error('[videos] Failed to get video detail:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取收藏列表
 * GET /api/videos/favorites
 */
router.get('/favorites', (req, res) => {
    try {
        const db = getDatabase();
        const favorites = db.all(`
            SELECT f.*, s.name as source_name 
            FROM favorites f
            LEFT JOIN video_sources s ON f.source_id = s.id
            ORDER BY f.created_at DESC
        `);
        res.json({ success: true, data: favorites });
    } catch (error) {
        console.error('[videos] Failed to get favorites:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 添加收藏
 * POST /api/videos/favorites
 */
router.post('/favorites', (req, res) => {
    try {
        const { source_id, vod_id, title, cover, year } = req.body;

        if (!source_id || !vod_id) {
            return res.status(400).json({ success: false, error: 'source_id and vod_id are required' });
        }

        const db = getDatabase();

        // 检查是否已收藏
        const existing = db.get(
            'SELECT * FROM favorites WHERE source_id = ? AND vod_id = ?',
            [source_id, vod_id]
        );

        if (existing) {
            return res.status(400).json({ success: false, error: 'Already in favorites' });
        }

        const result = db.run(
            'INSERT INTO favorites (source_id, vod_id, title, cover, year) VALUES (?, ?, ?, ?, ?)',
            [source_id, vod_id, title, cover, year]
        );

        const newFavorite = db.get('SELECT * FROM favorites WHERE id = ?', [result.lastID]);
        res.json({ success: true, data: newFavorite });
    } catch (error) {
        console.error('[videos] Failed to add favorite:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 删除收藏
 * DELETE /api/videos/favorites/:id
 */
router.delete('/favorites/:id', (req, res) => {
    try {
        const db = getDatabase();
        db.run('DELETE FROM favorites WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Favorite deleted' });
    } catch (error) {
        console.error('[videos] Failed to delete favorite:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 检查是否已收藏
 * GET /api/videos/favorites/check
 */
router.get('/favorites/check', (req, res) => {
    try {
        const { source_id, vod_id } = req.query;
        const db = getDatabase();

        // 处理 vod_id 可能的格式差异（如 "116810" vs "116810.0"）
        const vodIdStr = String(vod_id);
        const vodIdNum = parseFloat(vod_id);

        // 尝试多种格式匹配
        let favorite = db.get(
            'SELECT * FROM favorites WHERE source_id = ? AND (vod_id = ? OR vod_id = ? OR vod_id = ?)',
            [source_id, vodIdStr, vodIdNum, String(vodIdNum)]
        );

        console.log('[favorites/check] source_id:', source_id, 'vod_id:', vod_id, 'found:', !!favorite);

        res.json({ success: true, data: { isFavorite: !!favorite, favorite } });
    } catch (error) {
        console.error('[videos] Failed to check favorite:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取播放历史
 * GET /api/videos/history
 */
router.get('/history', (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const db = getDatabase();

        const history = db.all(`
            SELECT h.*, s.name as source_name 
            FROM play_history h
            LEFT JOIN video_sources s ON h.source_id = s.id
            ORDER BY h.updated_at DESC
            LIMIT ?
        `, [parseInt(limit)]);

        res.json({ success: true, data: history });
    } catch (error) {
        console.error('[videos] Failed to get history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 更新播放进度
 * POST /api/videos/history
 */
router.post('/history', (req, res) => {
    try {
        const { source_id, vod_id, title, cover, episode, episode_name, progress, duration } = req.body;

        if (!source_id || !vod_id) {
            return res.status(400).json({ success: false, error: 'source_id and vod_id are required' });
        }

        const db = getDatabase();

        // 尝试更新或插入
        const existing = db.get(
            'SELECT * FROM play_history WHERE source_id = ? AND vod_id = ?',
            [source_id, vod_id]
        );

        if (existing) {
            db.run(
                `UPDATE play_history 
                 SET title = ?, cover = ?, episode = ?, episode_name = ?, 
                     progress = ?, duration = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE source_id = ? AND vod_id = ?`,
                [title, cover, episode || 1, episode_name, progress || 0, duration || 0, source_id, vod_id]
            );
        } else {
            db.run(
                `INSERT INTO play_history (source_id, vod_id, title, cover, episode, episode_name, progress, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [source_id, vod_id, title, cover, episode || 1, episode_name, progress || 0, duration || 0]
            );
        }

        res.json({ success: true, message: 'History updated' });
    } catch (error) {
        console.error('[videos] Failed to update history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 清除播放历史
 * DELETE /api/videos/history
 */
router.delete('/history', (req, res) => {
    try {
        const db = getDatabase();
        db.run('DELETE FROM play_history');
        res.json({ success: true, message: 'History cleared' });
    } catch (error) {
        console.error('[videos] Failed to clear history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
