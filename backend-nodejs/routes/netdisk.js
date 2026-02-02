/**
 * 网盘路由 - Alist/OpenList 集成
 */
const express = require('express');
const router = require('express').Router(); // Correcting router init if needed, though former was fine
const fs = require('fs');
const path = require('path');
const { getDatabase } = require('../database');
const { AlistService } = require('../services/AlistService');
const { WebdavService } = require('../services/WebdavService');
const { LocalService } = require('../services/LocalService');
const { mediaScanService } = require('../services/MediaScanService');
const transcodeService = require('../services/TranscodeService');
const imageCacheService = require('../services/ImageCacheService');

// Client 缓存 (sourceId -> { client, expireAt })
const clientCache = new Map();

/**
 * 获取网盘客户端示例（带缓存）
 */
async function getNetdiskClient(source) {
    // 检查缓存
    const cached = clientCache.get(source.id);
    if (cached && cached.expireAt > Date.now()) {
        return cached.client;
    }

    let client;
    if (source.type === 'webdav') {
        client = new WebdavService(source.url, source.username, source.password);
    } else if (source.type === 'local') {
        client = new LocalService(source.root_path);
    } else {
        // 默认 alist
        client = new AlistService(source.url, source.password);
        client.username = source.username || 'admin';
        await client.login();
    }

    // 缓存（47 小时）
    clientCache.set(source.id, {
        client,
        expireAt: Date.now() + 47 * 60 * 60 * 1000
    });

    return client;
}

// ==========================================================================
// 网盘源管理 API
// ==========================================================================

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
 * 获取所有网盘源
 */
router.get('/sources', (req, res) => {
    try {
        const db = getDatabase();
        const authorized = isAuthorized(req, db);
        const adminPassword = req.headers['x-admin-password'];
        console.log(`[Netdisk/Sources] Authorized: ${authorized}, Header: ${adminPassword ? 'PRESENT' : 'MISSING'}`);

        let sources = db.all(`
            SELECT id, name, type, url, username, root_path, scan_paths, enabled, proxy_enabled, hidden, sort_order, remark, created_at, updated_at
            FROM netdisk_sources
            ORDER BY sort_order ASC, id ASC
        `);

        // 解析并过滤 scan_paths
        const parsed = sources.map(s => {
            let scanPaths = [];
            try {
                scanPaths = s.scan_paths ? JSON.parse(s.scan_paths) : [];
            } catch (e) {
                console.error(`[netdisk/sources] Failed to parse scan_paths for source ${s.id}:`, e);
            }

            // 权限策略优化：
            // 如果已授权，全部返回
            if (authorized) {
                return { ...s, scan_paths: scanPaths };
            }

            // 未授权情况：过滤掉隐藏内容
            // 如果 Source 被标记为隐藏且未授权，则不返回任何路径
            if (s.hidden) {
                scanPaths = [];
            } else {
                scanPaths = scanPaths.filter(p => !p.hidden);
            }

            return {
                ...s,
                scan_paths: scanPaths
            };
        });

        // 最终过滤：如果是管理员，返回全部；如果是非管理员，仅返回非隐藏源且有可见路径的源
        const finalData = authorized ? parsed : parsed.filter(s => !s.hidden || s.scan_paths.length > 0);

        // 不返回密码
        console.log(`[Netdisk/Sources] Returning ${finalData.length} sources to client`);
        res.json({ success: true, data: finalData });
    } catch (error) {
        console.error('[Netdisk] Failed to get sources:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 添加网盘源
 */
router.post('/sources', (req, res) => {
    try {
        const { name, type, url, username, password, root_path, scan_paths, enabled, proxy_enabled, hidden, remark } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: '名称不能为空' });
        }

        // 本地目录不需要地址(url)，但 alist 和 webdav 需要
        if (type !== 'local' && !url) {
            return res.status(400).json({ success: false, error: '地址不能为空' });
        }

        const db = getDatabase();
        const result = db.run(`
            INSERT INTO netdisk_sources (name, type, url, username, password, root_path, scan_paths, enabled, proxy_enabled, hidden, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            name,
            type || 'alist',
            (url || '').replace(/\/$/, ''),
            username || '',
            password || '',
            root_path || '/',
            scan_paths || null,
            enabled !== undefined ? (enabled ? 1 : 0) : 1,
            proxy_enabled !== undefined ? (proxy_enabled ? 1 : 0) : 0,
            hidden !== undefined ? (hidden ? 1 : 0) : 0,
            remark || ''
        ]);

        res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (error) {
        console.error('[Netdisk] Failed to add source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 更新网盘源
 */
router.put('/sources/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, type, url, username, password, root_path, scan_paths, enabled, proxy_enabled, hidden, remark } = req.body;

        const db = getDatabase();
        const updates = [];
        const values = [];

        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (type !== undefined) { updates.push('type = ?'); values.push(type); }
        if (url !== undefined) {
            updates.push('url = ?');
            values.push((url || '').replace(/\/$/, ''));
        }
        if (username !== undefined) { updates.push('username = ?'); values.push(username); }
        // 修复：如果密码为空字符串且是更新操作，则视为不修改密码，实现“留空保持不变”
        if (password !== undefined && password !== '') {
            updates.push('password = ?');
            values.push(password);
        }
        if (root_path !== undefined) { updates.push('root_path = ?'); values.push(root_path); }
        if (scan_paths !== undefined) { updates.push('scan_paths = ?'); values.push(typeof scan_paths === 'string' ? scan_paths : JSON.stringify(scan_paths)); }
        if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0); }
        if (proxy_enabled !== undefined) { updates.push('proxy_enabled = ?'); values.push(proxy_enabled ? 1 : 0); }
        if (hidden !== undefined) { updates.push('hidden = ?'); values.push(hidden ? 1 : 0); }
        if (remark !== undefined) { updates.push('remark = ?'); values.push(remark); }

        if (updates.length === 0) return res.json({ success: true });

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        db.run(`UPDATE netdisk_sources SET ${updates.join(', ')} WHERE id = ?`, values);

        // 如果修改了扫描路径且源已启用，自动触发一次增量扫描
        // 优化：仅当路径 (path) 发生变化或新增路径时才触发扫描，单纯修改名称 (name) 不再触发
        if (scan_paths !== undefined && (enabled === undefined || enabled)) {
            try {
                const oldSource = db.get('SELECT scan_paths FROM netdisk_sources WHERE id = ?', [id]);
                const oldPaths = JSON.parse(oldSource?.scan_paths || '[]');
                const newPaths = typeof scan_paths === 'string' ? JSON.parse(scan_paths) : scan_paths;

                const hasPathChange = newPaths.some((np) => !oldPaths.some((op) => op.path === np.path));

                if (hasPathChange) {
                    console.log(`[Netdisk] Critical scan paths updated for source ${id}, triggering auto-scan...`);
                    mediaScanService.scanSource(parseInt(id), 5).catch(err => {
                        console.error('[Netdisk] Auto-scan failed:', err);
                    });
                }
            } catch (e) {
                // 解析失败则默认不触发，避免崩溃
                console.error('[Netdisk] Failed to compare scan paths:', e);
            }
        }

        // 清除缓存
        clientCache.delete(parseInt(id));

        res.json({ success: true });
    } catch (error) {
        console.error('[Netdisk] Failed to update source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 删除网盘源
 */
router.delete('/sources/:id', (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();

        db.run('DELETE FROM netdisk_sources WHERE id = ?', [id]);
        clientCache.delete(parseInt(id));

        res.json({ success: true });
    } catch (error) {
        console.error('[Netdisk] Failed to delete source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 测试网盘源连接
 */
router.post('/sources/:id/test', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [id]);

        if (!source) {
            return res.status(404).json({ success: false, error: '网盘源不存在' });
        }

        const client = await getNetdiskClient(source);
        const items = await client.list(source.root_path || '/');

        res.json({
            success: true,
            data: {
                connected: true,
                itemCount: items.length
            }
        });
    } catch (error) {
        console.error('[Netdisk] Connection test failed:', error);
        res.json({
            success: true,
            data: {
                connected: false,
                error: error.message
            }
        });
    }
});

// ==========================================================================
// 文件浏览 API
// ==========================================================================

/**
 * 浏览目录
 */
router.post('/list', async (req, res) => {
    try {
        const { sourceId, path = '/' } = req.body;
        console.log(`[Netdisk API] [DEBUG] /list called: sourceId=${sourceId}, path="${path}"`);

        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ? AND enabled = 1', [sourceId]);

        if (!source) {
            console.error(`[Netdisk API] [ERROR] Source not found or disabled. ID: ${sourceId}`);
            return res.status(404).json({ success: false, error: 'Source not found' });
        }

        console.log(`[Netdisk API] [DEBUG] Source Type: ${source.type}, Root Path: "${source.root_path}"`);

        const client = await getNetdiskClient(source);
        if (!client) {
            console.error(`[Netdisk API] [ERROR] Failed to init client for ${source.type}`);
            return res.status(500).json({ success: false, error: 'Failed to initialize client' });
        }

        let targetPath = path;
        if (path === '/' || !path) {
            targetPath = source.root_path || '/';
        } else if (source.root_path && source.root_path !== '/' && !path.startsWith(source.root_path)) {
            targetPath = (source.root_path + '/' + path).replace(/\/+/g, '/');
        }

        console.log(`[Netdisk API] [DEBUG] Calling client.list with: "${targetPath}"`);
        const items = await client.list(targetPath);
        console.log(`[Netdisk API] [DEBUG] Client returned ${items.length} items`);

        // 标记视频文件并构建完整路径
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m3u8', '.ts', '.webm'];
        const processedItems = items.map(item => {
            const ext = item.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
            // 构建完整路径用于下一次导航（绝对路径）
            const itemPath = item.path || (targetPath + '/' + item.name).replace(/\/+/g, '/');
            return {
                ...item,
                path: itemPath,
                isVideo: !item.is_dir && videoExtensions.includes(ext),
                ext
            };
        });

        // 计算展示路径（相对于 root_path）
        let displayPath = targetPath;
        if (source.root_path && targetPath.startsWith(source.root_path)) {
            displayPath = targetPath.substring(source.root_path.length) || '/';
        }
        if (!displayPath.startsWith('/')) displayPath = '/' + displayPath;

        res.json({
            success: true,
            data: {
                path: displayPath,
                fullPath: targetPath,
                sourceType: source.type,
                items: processedItems
            }
        });
    } catch (error) {
        console.error('[Netdisk] List failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取文件详情（含播放链接）
 */
router.post('/get', async (req, res) => {
    try {
        const { sourceId, path } = req.body;

        if (!sourceId || !path) {
            return res.status(400).json({ success: false, error: '缺少 sourceId 或 path' });
        }

        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ? AND enabled = 1', [sourceId]);

        if (!source) {
            return res.status(404).json({ success: false, error: '网盘源不存在或已禁用' });
        }

        const client = await getNetdiskClient(source);
        const fileInfo = await client.getFileInfo(path);

        if (!fileInfo) {
            return res.status(404).json({ success: false, error: '文件不存在' });
        }

        res.json({
            success: true,
            data: {
                ...fileInfo,
                playUrl: fileInfo.raw_url || `${source.url}/d${path}`
            }
        });
    } catch (error) {
        console.error('[Netdisk] Get file failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 搜索文件
 */
router.post('/search', async (req, res) => {
    try {
        const { sourceId, keyword, path = '/' } = req.body;

        if (!sourceId || !keyword) {
            return res.status(400).json({ success: false, error: '缺少 sourceId 或 keyword' });
        }

        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ? AND enabled = 1', [sourceId]);

        if (!source) {
            return res.status(404).json({ success: false, error: '网盘源不存在或已禁用' });
        }

        const client = await getNetdiskClient(source);

        // Client 搜索 (如果支持)
        let items = [];
        if (client.search) {
            items = await client.search(keyword, (source.root_path + '/' + path).replace(/\/+/g, '/'));
        } else {
            // 回退到模拟搜索或 alist 原始搜索
            // ...
        }

        if (result.code === 200 && result.data) {
            res.json({
                success: true,
                data: result.data.content || []
            });
        } else {
            res.json({
                success: true,
                data: [],
                message: result.message
            });
        }
    } catch (error) {
        console.error('[Netdisk] Search failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================================================
// 媒体库 API (Emby 风格)
// ==========================================================================

/**
 * 触发媒体库扫描
 */
router.post('/scan/:sourceId', async (req, res) => {
    try {
        const { sourceId } = req.params;
        const { force = false, maxDepth = 3 } = req.body;
        // 异步执行扫描，立即返回
        mediaScanService.scanSource(parseInt(sourceId), maxDepth, null, force).catch(err => {
            console.error('[Netdisk] Scan failed:', err);
        });

        res.json({ success: true, message: '扫描已开始' });
    } catch (error) {
        console.error('[Netdisk] Failed to start scan:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取扫描状态
 */
router.get('/scan/:sourceId/status', (req, res) => {
    try {
        const { sourceId } = req.params;
        const status = mediaScanService.getScanStatus(parseInt(sourceId));
        res.json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Video 2.0: 获取后台探测队列状态
 */
router.get('/probe/status', (req, res) => {
    try {
        const { scanQueueService } = require('../services/ScanQueueService');
        const status = scanQueueService.getStatus();

        // 获取待探测/已探测/失败的数量
        const db = getDatabase();
        const pending = db.get('SELECT COUNT(*) as count FROM netdisk_media WHERE probe_status = 0')?.count || 0;
        const success = db.get('SELECT COUNT(*) as count FROM netdisk_media WHERE probe_status = 1')?.count || 0;
        const failed = db.get('SELECT COUNT(*) as count FROM netdisk_media WHERE probe_status = -1')?.count || 0;
        const locked = db.get('SELECT COUNT(*) as count FROM netdisk_media WHERE is_locked = 1')?.count || 0;
        const pendingNfo = db.get('SELECT COUNT(*) as count FROM netdisk_media WHERE nfo_parsed = 0')?.count || 0;

        res.json({
            success: true,
            data: {
                ...status,
                pending,      // 待探测
                success,      // 已探测
                failed,       // 探测失败
                locked,       // 已锁定 (不更新)
                pendingNfo    // 待补全元数据
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * 获取已索引的媒体列表
 */
router.get('/media', (req, res) => {
    try {
        const db = getDatabase();
        const authorized = isAuthorized(req, db);
        const { sourceId, type = 'all', limit = 20, offset = 0, path, genres, year, area, rating, actor, studio } = req.query;

        // 如果没有提供 sourceId，则执行全局媒体库搜索
        if (!sourceId) {
            let sources = db.all('SELECT id, name, hidden, scan_paths FROM netdisk_sources WHERE enabled = 1');
            if (!authorized) {
                sources = sources.filter(s => !s.hidden);
            }

            let allMedia = [];
            let totalCount = 0;

            for (const source of sources) {
                const filterOptions = {
                    type,
                    keyword: req.query.keyword || undefined,
                    limit: 1000, // 全局搜索时先取较多，由网关层汇总
                    offset: 0,
                    path: path || undefined,
                    genres: genres || undefined,
                    year: year || undefined,
                    area: area || undefined,
                    rating: rating || undefined,
                    actor: actor || undefined,
                    studio: studio || undefined,
                    series: req.query.series || undefined,
                    tags: req.query.tags || undefined,
                    date: req.query.date || undefined,
                    sort: req.query.sort || undefined
                };

                let media = mediaScanService.getMedia(source.id, filterOptions);

                // 权限过滤：处理隐藏路径
                if (!authorized && source.scan_paths) {
                    try {
                        const scanPaths = JSON.parse(source.scan_paths);
                        const hiddenPaths = Array.isArray(scanPaths) ? scanPaths.filter(p => p.hidden).map(p => p.path) : [];
                        if (hiddenPaths.length > 0) {
                            media = media.filter(m => !hiddenPaths.some(hp => m.path.startsWith(hp)));
                        }
                    } catch (e) { }
                }

                allMedia.push(...media);
            }

            // 按最新排序或相关度（此处暂按原顺序汇总）
            totalCount = allMedia.length;
            const paginatedMedia = allMedia.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

            return res.json({ success: true, data: paginatedMedia, total: totalCount });
        }

        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [sourceId]);
        if (!source) {
            return res.status(404).json({ success: false, error: '源不存在' });
        }

        // 如果未授权且源被隐藏，不返回数据
        if (!authorized && source.hidden) {
            return res.json({ success: true, data: [], total: 0 });
        }

        // 构建筛选选项
        const filterOptions = {
            type,
            keyword: req.query.keyword || undefined,
            limit: parseInt(limit),
            offset: parseInt(offset),
            path: path || undefined,
            genres: genres || undefined,
            year: year || undefined,
            area: area || undefined,
            rating: rating || undefined,
            actor: actor || undefined,
            studio: studio || undefined,
            series: req.query.series || undefined,
            tags: req.query.tags || undefined,
            date: req.query.date || undefined,
            sort: req.query.sort || undefined
        };

        let media = mediaScanService.getMedia(parseInt(sourceId), filterOptions);

        // 过滤由于路径隐藏而不可见的媒体
        if (!authorized && source.scan_paths) {
            try {
                const scanPaths = JSON.parse(source.scan_paths);
                const hiddenPaths = Array.isArray(scanPaths) ? scanPaths.filter(p => p.hidden).map(p => p.path) : [];
                if (hiddenPaths.length > 0) {
                    media = media.filter(m => !hiddenPaths.some(hp => m.path.startsWith(hp)));
                }
            } catch (e) {
                console.error('[Netdisk] Filter hidden paths failed:', e);
            }
        }

        // 获取总数（用于分页）
        const total = mediaScanService.getMediaCount(parseInt(sourceId), filterOptions);

        res.json({ success: true, data: media, total });
    } catch (error) {
        console.error('[Netdisk] Failed to get media:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取筛选选项（聚合统计）
 */
router.get('/media/filters', (req, res) => {
    try {
        const { sourceId, path } = req.query;

        if (!sourceId) {
            return res.status(400).json({ success: false, error: '缺少 sourceId' });
        }

        const filters = mediaScanService.getFilters(parseInt(sourceId), path || null);
        res.json({ success: true, data: filters });
    } catch (error) {
        console.error('[Netdisk] Failed to get filters:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 按扫描目录分组获取媒体（概览页用）
 */
router.get('/media/grouped', (req, res) => {
    try {
        const { sourceId, limit = 12, genres, year, area, actor, studio } = req.query;

        if (!sourceId) {
            return res.status(400).json({ success: false, error: '缺少 sourceId' });
        }

        const db = getDatabase();
        const authorized = isAuthorized(req, db);

        const source = db.get('SELECT hidden, scan_paths FROM netdisk_sources WHERE id = ?', [sourceId]);
        if (!source) {
            return res.status(404).json({ success: false, error: '源不存在' });
        }

        if (!authorized && source.hidden) {
            return res.json({ success: true, data: { groups: [] } });
        }

        // 构建筛选选项
        const filterOptions = {
            limit: parseInt(limit),
            genres: genres || undefined,
            year: year || undefined,
            area: area || undefined,
            actor: actor || undefined,
            studio: studio || undefined,
            series: req.query.series || undefined,
            tags: req.query.tags || undefined,
            date: req.query.date || undefined
        };

        // 解析扫描路径
        let scanPaths = [];
        try {
            scanPaths = source.scan_paths ? JSON.parse(source.scan_paths) : [];
            if (!authorized) {
                scanPaths = scanPaths.filter(p => !p.hidden);
            }
        } catch (e) {
            console.error('[Netdisk] Parse scan_paths failed:', e);
        }

        // 如果没有配置扫描路径，返回全部媒体作为一个组
        if (scanPaths.length === 0) {
            const allMedia = mediaScanService.getMedia(parseInt(sourceId), filterOptions);
            const total = mediaScanService.getMediaCount(parseInt(sourceId), filterOptions);
            return res.json({
                success: true,
                data: {
                    groups: [{
                        name: '全部媒体',
                        path: '/',
                        items: allMedia,
                        total
                    }]
                }
            });
        }

        // 按扫描目录分组
        const groups = scanPaths.map(sp => {
            const pathPrefix = sp.path;
            const items = mediaScanService.getMedia(parseInt(sourceId), {
                ...filterOptions,
                path: pathPrefix
            });
            const total = mediaScanService.getMediaCount(parseInt(sourceId), {
                ...filterOptions,
                path: pathPrefix
            });

            return {
                name: sp.name || pathPrefix.split('/').filter(Boolean).pop() || '未命名',
                path: pathPrefix,
                items,
                total
            };
        });

        // 过滤掉没有内容的分组
        const nonEmptyGroups = groups.filter(g => g.total > 0);

        res.json({ success: true, data: { groups: nonEmptyGroups } });
    } catch (error) {
        console.error('[Netdisk] Failed to get grouped media:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取媒体分组聚合 (新: 日期、合集、分类、标签)
 */
router.get('/media/groups', (req, res) => {
    try {
        const { sourceId, viewType = 'date', path } = req.query;

        if (!sourceId) {
            return res.status(400).json({ success: false, error: '缺少 sourceId' });
        }

        const groups = mediaScanService.getMediaGroups(parseInt(sourceId), viewType, { path });
        res.json({ success: true, data: groups });
    } catch (error) {
        console.error('[Netdisk] Failed to get media groups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取所有网盘源的媒体列表
 */
router.get('/media/all', (req, res) => {
    try {
        const { type = 'all', limit = 100 } = req.query;
        const db = getDatabase();
        const authorized = isAuthorized(req, db);

        // 获取所有启用的网盘源
        let sources = db.all('SELECT id, hidden, scan_paths FROM netdisk_sources WHERE enabled = 1');

        // 未授权时过滤隐藏的源
        if (!authorized) {
            sources = sources.filter(s => !s.hidden);
        }

        let allMedia = [];
        for (const source of sources) {
            let media = mediaScanService.getMedia(source.id, { type, limit: parseInt(limit) });

            // 过滤隐藏路径
            if (!authorized && source.scan_paths) {
                try {
                    const scanPaths = JSON.parse(source.scan_paths);
                    const hiddenPaths = Array.isArray(scanPaths) ? scanPaths.filter(p => p.hidden).map(p => p.path) : [];
                    if (hiddenPaths.length > 0) {
                        media = media.filter(m => !hiddenPaths.some(hp => m.path.startsWith(hp)));
                    }
                } catch (e) {
                    console.error('[Netdisk] Filter hidden paths failed for source:', source.id, e);
                }
            }

            allMedia.push(...media);
        }

        // 按标题排序
        allMedia.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));

        res.json({ success: true, data: allMedia.slice(0, parseInt(limit)) });
    } catch (error) {
        console.error('[Netdisk] Failed to get all media:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取单个媒体详情
 */
router.get('/media/:id', (req, res) => {
    try {
        const { id } = req.params;
        const media = mediaScanService.getMediaById(parseInt(id));

        if (!media) {
            return res.status(404).json({ success: false, error: '媒体不存在' });
        }

        res.json({ success: true, data: media });
    } catch (error) {
        console.error('[Netdisk] Failed to get media detail:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Video 2.0: 单片元数据编辑 API
 * 支持修改标题、海报 URL、简介等，并自动锁定防止扫描覆盖
 */
router.patch('/media/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { title, poster_url, fanart_url, overview, year, genres, tmdb_id } = req.body;

        const db = getDatabase();
        const media = db.get('SELECT id FROM netdisk_media WHERE id = ?', [id]);

        if (!media) {
            return res.status(404).json({ success: false, error: '媒体不存在' });
        }

        const updates = [];
        const values = [];

        if (title !== undefined) { updates.push('title = ?'); values.push(title); }
        if (poster_url !== undefined) { updates.push('poster_url = ?'); values.push(poster_url); }
        if (fanart_url !== undefined) { updates.push('fanart_url = ?'); values.push(fanart_url); }
        if (overview !== undefined) { updates.push('overview = ?'); values.push(overview); }
        if (year !== undefined) { updates.push('year = ?'); values.push(year); }
        if (genres !== undefined) { updates.push('genres = ?'); values.push(genres); }
        if (tmdb_id !== undefined) { updates.push('tmdb_id = ?'); values.push(tmdb_id); }

        if (updates.length === 0) {
            return res.json({ success: true, message: '无修改内容' });
        }

        // 自动锁定：手动修改过的媒体不再被扫描覆盖
        updates.push('is_locked = 1');
        values.push(id);

        db.run(`UPDATE netdisk_media SET ${updates.join(', ')} WHERE id = ?`, values);
        console.log(`[Netdisk] Media ${id} updated and locked`);

        res.json({ success: true, message: '已保存并锁定' });
    } catch (error) {
        console.error('[Netdisk] Failed to update media:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Video 2.0: 刷新单项媒体元数据
 * 强制重新扫描文件夹中的 NFO 和图片，并尝试补全 TMDB
 */
router.post('/media/:id/refresh', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();

        const media = db.get('SELECT source_id, path FROM netdisk_media WHERE id = ?', [id]);
        if (!media) return res.status(404).json({ success: false, error: '媒体不存在' });

        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [media.source_id]);
        if (!source) return res.status(404).json({ success: false, error: '网盘源不存在' });

        const client = await getNetdiskClient(source);
        const apiKey = db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'")?.value;
        const tmdbEnabled = !!apiKey;

        // 调用扫描服务（force=true 绕过锁定检查）
        const folderName = media.path.split('/').filter(Boolean).pop() || media.path;
        await mediaScanService.processMediaFolder(client, source, { path: media.path, name: folderName }, tmdbEnabled, true);

        // 返回更新后的数据（使用 getMediaById 获取格式化后的数据）
        const updated = mediaScanService.getMediaById(parseInt(id));
        res.json({ success: true, data: updated, message: '元数据已刷新' });
    } catch (error) {
        console.error('[Netdisk] Media refresh failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Video 2.0: 恢复自动识别 (解锁)
 * 将 is_locked 设为 0，并立即触发一次自动扫描识别
 */
router.post('/media/:id/unlock', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();

        const media = db.get('SELECT source_id, path FROM netdisk_media WHERE id = ?', [id]);
        if (!media) return res.status(404).json({ success: false, error: '媒体不存在' });

        // 1. 解锁
        db.run('UPDATE netdisk_media SET is_locked = 0 WHERE id = ?', [id]);

        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [media.source_id]);
        const client = await getNetdiskClient(source);
        const apiKey = db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'")?.value;
        const tmdbEnabled = !!apiKey;

        // 2. 立即触发一次自动扫描识别 (不带 force，这样会应用标准的识别优先级)
        const folderName = media.path.split('/').filter(Boolean).pop() || media.path;
        await mediaScanService.processMediaFolder(client, source, { path: media.path, name: folderName }, tmdbEnabled, false);

        const updated = mediaScanService.getMediaById(parseInt(id));
        res.json({ success: true, data: updated, message: '已解锁并恢复自动识别' });
    } catch (error) {
        console.error('[Netdisk] Media unlock failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Video 2.0: TMDB 搜索纠偏 API
 * 允许用户手动搜索 TMDB 并应用到媒体
 */
router.post('/media/:id/tmdb-search', async (req, res) => {
    try {
        const { id } = req.params;
        const { query, year } = req.body;

        if (!query) {
            return res.status(400).json({ success: false, error: '请输入搜索关键词' });
        }

        const db = getDatabase();
        const apiKey = db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'")?.value;

        if (!apiKey) {
            return res.status(400).json({ success: false, error: '请先配置 TMDB API Key' });
        }

        const { TmdbService } = require('../services/TmdbService');
        const tmdb = new TmdbService(apiKey);
        const results = await tmdb.searchMulti(query, year);

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('[Netdisk] TMDB search failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Video 2.0: 应用 TMDB 元数据
 * 从 TMDB 获取详情并更新到本地媒体
 */
router.post('/media/:id/tmdb-apply', async (req, res) => {
    try {
        const { id } = req.params;
        const { tmdb_id, media_type } = req.body;

        if (!tmdb_id || !media_type) {
            return res.status(400).json({ success: false, error: '缺少 TMDB ID 或类型' });
        }

        const db = getDatabase();
        const apiKey = db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'")?.value;

        if (!apiKey) {
            return res.status(400).json({ success: false, error: '请先配置 TMDB API Key' });
        }

        const { TmdbService } = require('../services/TmdbService');
        const tmdb = new TmdbService(apiKey);

        let detail;
        if (media_type === 'movie') {
            detail = await tmdb.getMovieDetail(tmdb_id);
        } else {
            detail = await tmdb.getTVDetail(tmdb_id);
        }

        if (!detail) {
            return res.status(404).json({ success: false, error: 'TMDB 资源不存在' });
        }

        // 更新本地媒体
        db.run(`
            UPDATE netdisk_media SET 
                title = ?, original_title = ?, year = ?, overview = ?,
                poster_url = ?, fanart_url = ?, rating = ?, genres = ?,
                tmdb_id = ?, is_locked = 1
            WHERE id = ?
        `, [
            detail.title, detail.original_title, detail.year, detail.overview,
            detail.poster, detail.backdrop, detail.rating, detail.genres,
            tmdb_id, id
        ]);

        console.log(`[Netdisk] Media ${id} updated from TMDB ${tmdb_id} and locked`);
        res.json({ success: true, data: detail, message: '已应用 TMDB 元数据并锁定' });
    } catch (error) {
        console.error('[Netdisk] TMDB apply failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取媒体播放链接
 */
router.post('/media/:id/play', async (req, res) => {
    try {
        const { id } = req.params;
        const { videoIndex = 0, caps } = req.body;

        const media = mediaScanService.getMediaById(parseInt(id));
        if (!media) {
            return res.status(404).json({ success: false, error: '媒体不存在' });
        }

        if (!media.video_files || media.video_files.length === 0) {
            return res.status(404).json({ success: false, error: '没有可播放的视频文件' });
        }

        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [media.source_id]);
        if (!source) {
            return res.status(404).json({ success: false, error: '网盘源不存在' });
        }

        const client = await getNetdiskClient(source);
        const videoFile = media.video_files[videoIndex] || media.video_files[0];
        let playUrl;
        let isStrm = false;
        let strmRawUrl = null;
        let sessionId = null;

        let playMethod = 'direct'; // 默认为 direct

        // 1. 获取视频文件的原始 URL (无论是否为 STRM)
        let rawUrl = '';          // 用于转码服务内部 (127.0.0.1)
        let externalPlayUrl = ''; // 用于前端直接播放 (相对路径)

        if (videoFile && videoFile.includes('|')) {
            isStrm = true;
            rawUrl = videoFile.split('|')[1];
            externalPlayUrl = rawUrl; // STRM 直接使用外部 URL
        } else {
            const videoPath = (media.path + '/' + videoFile).replace(/\/+/g, '/');
            if (source.type === 'local') {
                // 💡 转码服务需要 127.0.0.1 内部地址
                const serverPort = process.env.PORT || 3100;
                rawUrl = `http://127.0.0.1:${serverPort}/api/netdisk/local-stream?path=${encodeURIComponent(videoPath)}`;
                // 💡 前端使用相对路径（通过 Vite 代理或 Nginx 代理）
                externalPlayUrl = `/api/netdisk/local-stream?path=${encodeURIComponent(videoPath)}`;
            } else if (source.type === 'webdav' || source.type === 'alist' || source.type === 'openlist') {
                // 统一获取网盘直链/代理前置链接
                if (source.type === 'webdav') {
                    // WebDAV 链路：需要认证代理
                    const serverPort = process.env.PORT || 3100;
                    rawUrl = `http://127.0.0.1:${serverPort}/api/netdisk/stream?sourceId=${source.id}&path=${encodeURIComponent(videoPath)}`;
                    externalPlayUrl = `/api/netdisk/stream?sourceId=${source.id}&path=${encodeURIComponent(videoPath)}`;
                } else {
                    const fileInfo = await client.getFileInfo(videoPath).catch(() => null);
                    rawUrl = fileInfo?.raw_url || `${source.url}/d${videoPath}`;
                    externalPlayUrl = rawUrl; // AList/OpenList 可以直接使用外部 URL
                }
            } else {
                // 兜底
                rawUrl = videoPath;
                externalPlayUrl = videoPath;
            }
        }
        // 2. ⚡️ 即时探测补偿 (Video 2.0.6 Performance Hack)
        // 如果扫描时跳过了探测，或者它是刚通过全量加速入库的，在这里进行即时补偿
        if (media.probe_status === 0) {
            console.log(`[Netdisk] On-demand probing for ${media.title} before playback...`);
            try {
                const headers = client.getHeaders ? client.getHeaders() : {};
                const mediaInfo = await transcodeService.getMediaInfo(rawUrl, headers);
                if (mediaInfo) {
                    db.run(
                        `UPDATE netdisk_media SET v_codec = ?, a_codec = ?, duration = ?, container = ?, probe_status = 1 WHERE id = ?`,
                        [mediaInfo.videoCodec, mediaInfo.audioCodec || null, mediaInfo.duration || 0, (mediaInfo.format || '').split(',')[0], media.id]
                    );
                    // 更新当前内存中的对象，避免后续转码判断使用旧数据
                    media.v_codec = mediaInfo.videoCodec;
                    media.a_codec = mediaInfo.audioCodec;
                    media.duration = mediaInfo.duration;
                    media.container = (mediaInfo.format || '').split(',')[0];
                }
            } catch (err) {
                console.warn(`[Netdisk] On-demand probe failed:`, err.message);
            }
        }

        // 2. 核心：统一播放决策 (从此不再区分 strm 与原生文件)
        const transcodeSettingsRow = db.get("SELECT value FROM settings WHERE key = 'strm_transcode_enabled'");
        const transcodeEnabled = transcodeSettingsRow?.value === 'true' || transcodeSettingsRow?.value === '1';

        // 如果开启了转码，且我们有 URL，则统一走 TranscodeService 下发逻辑
        if (transcodeEnabled && rawUrl) {
            try {
                const qualitySettings = db.get("SELECT value FROM settings WHERE key = 'ffmpeg_quality'");
                const hwaccelSettings = db.get("SELECT value FROM settings WHERE key = 'ffmpeg_hwaccel'");

                const quality = qualitySettings?.value || 'medium';
                const hwaccel = hwaccelSettings?.value || 'none';
                const transcodeHeaders = { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0' };

                // 统一分流逻辑：TranscodeService 内部会根据 mediaInfo 自动决定是否 Direct Play
                const result = await transcodeService.startTranscode(rawUrl, {
                    quality,
                    hwaccel,
                    mediaId: media.id,
                    headers: transcodeHeaders,
                    caps: caps, // 透传协商参数
                    mediaInfo: media.v_codec ? {
                        videoCodec: media.v_codec,
                        audioCodec: media.a_codec,
                        duration: media.duration,
                        format: media.container
                    } : null
                });

                playUrl = result.playUrl;
                sessionId = result.sessionId;
                playMethod = result.playMethod;
                console.log(`[Netdisk] Unified Play Method: ${playMethod} (Type: ${isStrm ? 'STRM' : 'Native'}, Probed: ${!!media.v_codec})`);
            } catch (err) {
                console.error('[Netdisk] Unified start transcode failed:', err.message);
                // 降级：如果转码服务炸了，使用外部可访问的 URL
                playUrl = externalPlayUrl;
                playMethod = 'direct';
            }
        } else {
            // 未开启转码：使用外部可访问的 URL（不是内部 127.0.0.1）
            playUrl = externalPlayUrl;
            playMethod = 'direct';
        }

        // 🚀 预热缓存：如果是代理模式，提前触发重定向解析
        if (playUrl && playUrl.includes('/api/netdisk/stream')) {
            try {
                // 构造初始 URL，逻辑与 stream 路由一致
                const rootUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
                const videoPath = (media.path + '/' + videoFile).replace(/\/+/g, '/');
                let initialUrl;
                if (source.type === 'webdav') {
                    initialUrl = rootUrl + videoPath.split('/').map(s => encodeURIComponent(s)).join('/');
                } else if (source.type === 'alist') {
                    initialUrl = rootUrl + '/d' + videoPath.split('/').map(s => encodeURIComponent(s)).join('/');
                }

                if (initialUrl) {
                    const headers = { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0' };
                    if (source.type === 'webdav' && (source.username || source.password)) {
                        const auth = Buffer.from(`${source.username || ''}:${source.password || ''}`).toString('base64');
                        headers['Authorization'] = `Basic ${auth}`;
                    }
                    // 异步触发，不阻塞响应
                    resolveRealUrl(initialUrl, headers).catch(() => { });
                }
            } catch (e) { /* ignore pre-warm error */ }
        }

        const transcodeSettingsCheck = db.get("SELECT value FROM settings WHERE key = 'strm_transcode_enabled'");
        const transcodeAvailable = isStrm && (transcodeSettingsCheck?.value === 'true' || transcodeSettingsCheck?.value === '1');

        res.json({
            success: true,
            data: {
                playUrl,
                playMethod,
                fileName: videoFile,
                videoFiles: media.video_files,
                isStrm,
                strmRawUrl: isStrm ? strmRawUrl : undefined,
                transcodeAvailable,
                sessionId,
                metadata: {
                    vCodec: media.v_codec,
                    aCodec: media.a_codec,
                    duration: media.duration
                }
            }
        });


    } catch (error) {
        console.error('[Netdisk] Failed to get play URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 清除媒体索引
 */
router.delete('/media/source/:sourceId', (req, res) => {
    try {
        const { sourceId } = req.params;
        mediaScanService.clearMedia(parseInt(sourceId));
        res.json({ success: true, message: '索引已清除' });
    } catch (error) {
        console.error('[Netdisk] Failed to clear media:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 新增：单目录扫描
router.post('/scan', async (req, res) => {
    try {
        const { sourceId, path, force = false } = req.body;
        mediaScanService.scanSource(parseInt(sourceId), 5, path, force).catch(err => {
            console.error('[Netdisk] Single scan failed:', err);
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 新增：单目录清理
router.post('/clear-index', async (req, res) => {
    try {
        const { sourceId, path, clearImages } = req.body;
        await mediaScanService.clearIndex(parseInt(sourceId), path);

        // 只有在用户明确勾选且是清理整个源（或根目录）时才清空物理缓存
        if (clearImages && (!path || path === '/')) {
            const ImageCacheService = require('../services/ImageCacheService');
            try {
                await ImageCacheService.clearAllCache();
            } catch (e) {
                console.error('[Netdisk] Failed to clear image cache:', e.message);
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🧹 新增：清理孤儿记录（已从源目录删除但仍在数据库的记录）
router.post('/cleanup-orphans', async (req, res) => {
    try {
        const { sourceId, path, preview = true } = req.body;
        const result = await mediaScanService.cleanupOrphans(parseInt(sourceId), path, preview);
        res.json(result);
    } catch (error) {
        console.error('[Netdisk] Cleanup orphans failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 本地文件流代理
router.get('/local-stream', async (req, res) => {
    try {
        const { path: filePath } = req.query;
        if (!filePath) return res.status(400).send('Path required');

        const fs = require('fs');
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (error) {
        console.error('[LocalStream] Error:', error.message, 'Path:', req.query.path);
        res.status(500).send(error.message);
    }
});

// 简单的并发控制器
class RequestQueue {
    constructor(concurrency) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    process() {
        if (this.running >= this.concurrency || this.queue.length === 0) return;
        this.running++;
        const { fn, resolve, reject } = this.queue.shift();
        fn().then(resolve).catch(reject).finally(() => {
            this.running--;
            this.process();
        });
    }
}

// 全局请求队列，限制并发数为 10（从5提高，减少排队等待导致的超时）
const globalRequestQueue = new RequestQueue(10);

// WebDAV 图片代理 - 用于解决需要认证的图片访问
router.get('/image-proxy', async (req, res) => {
    try {
        const { sourceId, path: imagePath, url: externalUrl } = req.query;
        if (!externalUrl && (!sourceId || !imagePath)) {
            return res.status(400).send('Missing params');
        }

        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [sourceId]);
        if (!source) {
            return res.status(404).send('Source not found');
        }

        // 构建带认证的 URL 与 Headers
        let imageUrl;
        const rootUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
        // 设置强缓存：图片通常不会改变，设置 1 年缓存 (Immutable)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Disposition', 'inline');

        // 直接使用 imagePath（Express 已经解码一次），与视频流代理保持一致
        const cleanPath = imagePath.startsWith('/') ? imagePath : '/' + imagePath;
        const authHeaders = {};

        if (source.type === 'webdav') {
            imageUrl = rootUrl + cleanPath.split('/').map(s => encodeURIComponent(s)).join('/');
            if (source.username || source.password) {
                authHeaders['Authorization'] = `Basic ${Buffer.from(`${source.username || ''}:${source.password || ''}`).toString('base64')}`;
            }
        } else if (source.type === 'alist') {
            imageUrl = rootUrl + '/d' + cleanPath.split('/').map(s => encodeURIComponent(s)).join('/');

            // 获取 Alist 令牌 (带缓存)
            const client = await getNetdiskClient(source);
            if (client && client.token) {
                authHeaders['Authorization'] = client.token;
            }
        } else {
            // 本地文件直接返回
            let fullPath = imagePath;
            if (!path.isAbsolute(imagePath)) {
                fullPath = path.join(source.root_path, imagePath);
            }
            if (fs.existsSync(fullPath)) {
                return res.sendFile(path.resolve(fullPath));
            }
            return res.status(404).send('File not found');
        }

        let targetUrl = externalUrl || imageUrl;

        // 🚀 v2.0.9: 增加直链解析逻辑 (针对 PikPak 等需要重定向的海报源)
        if (source.type === 'alist' || source.type === 'webdav') {
            try {
                const resolvedUrl = await resolveRealUrl(targetUrl, authHeaders);
                if (resolvedUrl && resolvedUrl !== targetUrl) {
                    console.log(`[ImageProxy] Resolved real URL: ${resolvedUrl.substring(0, 100)}...`);
                    // 如果 Host 变了，剥离认证头防止 400
                    try {
                        const u = new URL(resolvedUrl);
                        const o = new URL(targetUrl);
                        if (u.host !== o.host) {
                            delete authHeaders['Authorization'];
                        }
                    } catch (e) { }
                    targetUrl = resolvedUrl;
                }
            } catch (err) {
                console.warn(`[ImageProxy] Failed to resolve real URL:`, err.message);
            }
        }

        // 🚀 使用 ImageCacheService 进行持久化缓存并转换为 WebP
        const cachedPath = await imageCacheService.getCachedImage(targetUrl, authHeaders);
        if (cachedPath && fs.existsSync(cachedPath)) {
            return res.sendFile(path.resolve(cachedPath));
        }

        console.log(`[ImageProxy] Streaming fallback: ${targetUrl.substring(0, 100)}`);
        const fetch = require('node-fetch');
        try {
            const response = await fetch(targetUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'image/*,*/*',
                    ...authHeaders
                },
                redirect: 'follow',
                timeout: 30000
            });

            if (!response.ok) {
                console.error(`[ImageProxy] Fetch failed: ${response.status} for ${targetUrl.substring(0, 100)}`);
                return res.status(response.status).send(`Fetch failed: ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || 'image/jpeg';
            res.setHeader('Content-Type', contentType);
            response.body.pipe(res);
        } catch (fetchError) {
            res.status(500).send(fetchError.message);
        }
    } catch (error) {
        console.error('[ImageProxy] critical error:', error.message);
        if (!res.headersSent) res.status(500).send(error.message);
    }
});

// WebDAV 视频流代理
// 直链解析缓存 (initialUrl -> { realUrl, expireAt })
const resolveCache = new Map();
// 并发解析锁 (initialUrl -> Promise)
const resolvingPromises = new Map();

// 辅助函数：解析最终直链 (Resolve Redirects)
async function resolveRealUrl(initialUrl, headers, maxRedirects = 5) {
    // 1. 检查缓存 (有效期 30 分钟)
    const cached = resolveCache.get(initialUrl);
    if (cached && cached.expireAt > Date.now()) {
        return cached.realUrl;
    }

    // 2. 请求合并 (Single-flight): 如果已有解析任务，直接等待
    if (resolvingPromises.has(initialUrl)) {
        return resolvingPromises.get(initialUrl);
    }

    const resolveTask = (async () => {
        let currentUrl = initialUrl;
        let currentHeaders = { ...headers };

        console.log(`[ResolveUrl] Starting resolution for: ${initialUrl}`);

        for (let i = 0; i < maxRedirects; i++) {
            try {
                // 智能剥离认证头
                if (i > 0) {
                    try {
                        const u = new URL(currentUrl);
                        const original = new URL(initialUrl);
                        if (u.host !== original.host || u.search) {
                            delete currentHeaders['Authorization'];
                        }
                    } catch (e) {
                        delete currentHeaders['Authorization'];
                    }
                }

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000); // 压缩超时时间

                // 优先使用 HEAD，HEAD 最快
                let res;
                try {
                    res = await fetch(currentUrl, {
                        method: 'HEAD',
                        headers: currentHeaders,
                        redirect: 'manual',
                        signal: controller.signal
                    });
                } catch (e) {
                    // 如果 HEAD 不支持或超时，尝试 GET + Range
                    res = await fetch(currentUrl, {
                        method: 'GET',
                        headers: { ...currentHeaders, 'Range': 'bytes=0-0' },
                        redirect: 'manual',
                        signal: controller.signal
                    });
                }
                clearTimeout(timeout);

                // 显式释放响应体
                if (res.body && res.body.destroy) res.body.destroy();

                if ([301, 302, 303, 307, 308].includes(res.status)) {
                    const location = res.headers.get('location');
                    if (location) {
                        currentUrl = new URL(location, currentUrl).toString();
                        continue;
                    }
                }

                // 成功解析
                resolveCache.set(initialUrl, {
                    realUrl: currentUrl,
                    expireAt: Date.now() + 30 * 60 * 1000
                });
                return currentUrl;

            } catch (error) {
                console.warn(`[ResolveUrl] Step ${i} failed: ${error.message}`);
                return currentUrl;
            }
        }
        return currentUrl;
    })().finally(() => {
        // 完成后移除任务锁
        resolvingPromises.delete(initialUrl);
    });

    resolvingPromises.set(initialUrl, resolveTask);
    return resolveTask;
}

// WebDAV/AList 视频流代理 (支持认证的流式代理)
router.get('/stream', async (req, res) => {
    try {
        const { sourceId, path: videoPath } = req.query;
        if (!sourceId || !videoPath) {
            return res.status(400).send('Missing sourceId or path');
        }

        const db = getDatabase();
        const source = db.get('SELECT * FROM netdisk_sources WHERE id = ?', [sourceId]);
        if (!source) {
            return res.status(404).send('Source not found');
        }

        // 1. 本地文件处理 (保持不变)
        if (source.type === 'local') {
            const fs = require('fs');
            const path = require('path');
            let fullPath = videoPath;
            if (!path.isAbsolute(videoPath)) {
                fullPath = path.join(source.root_path, videoPath);
            }
            if (fs.existsSync(fullPath)) {
                return res.sendFile(path.resolve(fullPath), {
                    headers: { 'Content-Disposition': 'inline' }
                });
            }
            return res.status(404).send('File not found');
        }

        // 2. 构建初始请求信息
        let initialVideoUrl;
        const rootUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
        const cleanPath = videoPath.startsWith('/') ? videoPath : '/' + videoPath;

        if (source.type === 'webdav') {
            initialVideoUrl = rootUrl + cleanPath.split('/').map(s => encodeURIComponent(s)).join('/');
        } else if (source.type === 'alist') {
            initialVideoUrl = rootUrl + '/d' + cleanPath.split('/').map(s => encodeURIComponent(s)).join('/');
        } else {
            return res.status(400).send('Unsupported source type');
        }

        const headers = {
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity'
        };

        // WebDAV 添加认证
        if (source.type === 'webdav' && (source.username || source.password)) {
            const auth = Buffer.from(`${source.username || ''}:${source.password || ''}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
        }

        // 3. 预解析最终直链并处理认证剥离 (针对 PikPak 等重定向源)
        // 注意：resolveRealUrl 内部已处理 Host 变化时的 Auth 剥离
        console.log(`[StreamProxy] Resolving real URL for: ${initialVideoUrl}`);
        const realVideoUrl = await resolveRealUrl(initialVideoUrl, headers);

        const finalHeaders = { ...headers };
        try {
            const u = new URL(realVideoUrl);
            const o = new URL(initialVideoUrl);
            if (u.host !== o.host) {
                console.log(`[StreamProxy] Host changed to ${u.host}, stripping Authorization header`);
                delete finalHeaders['Authorization'];
            }
        } catch (e) { /* ignore */ }

        // 转发客户端的 Range 请求头
        if (req.headers.range) {
            finalHeaders['Range'] = req.headers.range;
        }

        console.log(`[StreamProxy] Final Fetching: ${realVideoUrl}`);

        const fetch = require('node-fetch');
        const response = await fetch(realVideoUrl, {
            headers: finalHeaders,
            redirect: 'follow', // 冗余跟随
            timeout: 60000
        });

        if (!response.ok && response.status !== 206) {
            console.error(`[StreamProxy] Fetch failed: ${response.status} for ${realVideoUrl}`);
            return res.status(response.status).send(`Video fetch failed: ${response.status}`);
        }

        // 转发响应状态和头部
        res.status(response.status);

        const safeHeaders = [
            'content-type', 'content-length', 'content-range',
            'accept-ranges', 'last-modified', 'etag'
        ];

        safeHeaders.forEach(h => {
            const v = response.headers.get(h);
            if (v) res.setHeader(h, v);
        });

        // 强制预览模式，添加 CORS 头
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // 补齐 Content-Type
        let ct = res.getHeader('content-type') || '';
        if (!ct || ct.includes('octet-stream')) {
            const ext = videoUrl.split('?')[0].split('.').pop().toLowerCase();
            const mimeMap = { mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo' };
            res.setHeader('content-type', mimeMap[ext] || 'video/mp4');
        }

        // 流式转发
        response.body.pipe(res);

        // 清理
        req.on('close', () => {
            if (response.body.destroy) response.body.destroy();
        });

    } catch (error) {
        console.error('[StreamProxy] Critical error:', error);
        if (!res.headersSent) res.status(500).send('Internal Server Error');
    }
});

/**
 * 获取媒体海报列表 (TMDB)
 */
router.get('/media/:id/posters', async (req, res) => {
    try {
        const db = getDatabase();
        const media = db.get('SELECT tmdb_id, media_type FROM netdisk_media WHERE id = ?', [req.params.id]);
        if (!media || !media.tmdb_id) {
            return res.json({ success: true, data: [] });
        }

        const { TmdbService } = require('../services/TmdbService');
        const tmdbApiKey = db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'")?.value;
        const tmdbService = new TmdbService(tmdbApiKey);

        const posters = await tmdbService.getPosters(media.tmdb_id, media.media_type === 'tvshow' ? 'tv' : 'movie');
        res.json({ success: true, data: posters });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 手动更新封面 (从远程 URL 下载并锁定)
 */
router.post('/media/:id/update-poster', async (req, res) => {
    try {
        const { posterUrl } = req.body;
        if (!posterUrl) return res.status(400).json({ success: false, error: '未提供海报 URL' });

        const db = getDatabase();
        const media = db.get('SELECT poster_url FROM netdisk_media WHERE id = ?', [req.params.id]);
        if (!media) return res.status(404).json({ success: false, error: '媒体不存在' });

        const imageCacheService = require('../services/ImageCacheService');
        const crypto = require('crypto');
        const CACHE_DIR = path.join(process.cwd(), 'data', 'cache', 'video_covers');

        // 1. 如果有旧缓存，尝试物理删除
        if (media.poster_url) {
            const oldHash = crypto.createHash('md5').update(media.poster_url).digest('hex');
            const oldPath = path.join(CACHE_DIR, `${oldHash}.webp`);
            if (fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch (e) { }
            }
        }

        // 2. 更新数据库并锁定
        db.run('UPDATE netdisk_media SET poster_url = ?, is_locked = 1 WHERE id = ?', [posterUrl, req.params.id]);

        // 3. 触发立即下载
        await imageCacheService.preCache(posterUrl);

        res.json({ success: true, message: '封面已更新并锁定' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 手动上传封面 (处理、保存并锁定)
 */
router.post('/media/:id/upload-poster', async (req, res) => {
    try {
        const multiparty = require('multiparty');
        const form = new multiparty.Form();

        form.parse(req, async (err, fields, files) => {
            if (err || !files.file || !files.file[0]) {
                return res.status(400).json({ success: false, error: '文件上传失败' });
            }

            const file = files.file[0];
            const db = getDatabase();
            const media = db.get('SELECT poster_url FROM netdisk_media WHERE id = ?', [req.params.id]);
            if (!media) return res.status(404).json({ success: false, error: '媒体不存在' });

            const sharp = require('sharp');
            const crypto = require('crypto');
            const CACHE_DIR = path.join(process.cwd(), 'data', 'cache', 'video_covers');

            // 1. 清理旧缓存
            if (media.poster_url) {
                const oldHash = crypto.createHash('md5').update(media.poster_url).digest('hex');
                const oldPath = path.join(CACHE_DIR, `${oldHash}.webp`);
                if (fs.existsSync(oldPath)) {
                    try { fs.unlinkSync(oldPath); } catch (e) { }
                }
            }

            // 2. 处理新文件
            // 使用文件大小/名称生成伪 URL 的 MD5 作为存储名，确保路径的一致性
            // 这里我们生成一个基于媒体 ID 的特殊路径前缀
            const uploadPseudoUrl = `local_upload_${req.params.id}_${Date.now()}`;
            const newHash = crypto.createHash('md5').update(uploadPseudoUrl).digest('hex');
            const newPath = path.join(CACHE_DIR, `${newHash}.webp`);

            await sharp(file.path)
                .resize({ width: 480, withoutEnlargement: true })
                .webp({ quality: 85 })
                .toFile(newPath);

            // 3. 更新数据库并锁定
            // 存入伪 URL 以确保前端能通过 proxy 获取
            db.run('UPDATE netdisk_media SET poster_url = ?, is_locked = 1 WHERE id = ?', [uploadPseudoUrl, req.params.id]);

            // 清理临时文件
            try { fs.unlinkSync(file.path); } catch (e) { }

            res.json({ success: true, message: '封面上传成功并锁定' });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 重新尝试下载失败的封面图片 (高优先级)
 */
router.post('/retry-failed-images', async (req, res) => {
    try {
        const { scanQueueService } = require('../services/ScanQueueService');
        const db = getDatabase();

        // 获取失败超过 1 次的 URL (因为 1 次可能是临时网络波动，3 次以上是被持久化排除的)
        // 我们尝试拉取所有在 failed_images 表中的 URL 重新推进 instantRetry 队列
        const failedUrls = db.all('SELECT url FROM failed_images').map(row => row.url);

        if (failedUrls.length === 0) {
            return res.json({ success: true, message: '没有需要重试的图片' });
        }

        // 清空数据库中的失败记录，给它们一次重生的机会
        db.run('DELETE FROM failed_images');

        // 推入高优先级队列
        scanQueueService.addInstantRetry(failedUrls);

        res.json({
            success: true,
            message: `已将 ${failedUrls.length} 张失败图片加入高优先级重试队列`
        });
    } catch (error) {
        console.error('[Netdisk] Failed to retry images:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 导出工具函数供其他服务使用
router.getNetdiskClient = getNetdiskClient;

module.exports = router;

