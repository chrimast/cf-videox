const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');
const fetch = require('node-fetch');
const { getSystemProxyAgent } = require('../utils/fetch-agent');

// ============================================
// 静态路由（必须放在动态路由 /:id 之前）
// ============================================

/**
 * 获取所有视频源
 * GET /api/sources
 * 如果启用了密码保护，未认证时过滤隐藏的视频源
 */
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        let sources = db.all('SELECT * FROM video_sources ORDER BY sort_order ASC');

        // 检查是否需要过滤隐藏的视频源
        const adminPassword = req.headers['x-admin-password'];
        const enabledSetting = db.get("SELECT value FROM settings WHERE key = 'admin_password_enabled'");
        const passwordSetting = db.get("SELECT value FROM settings WHERE key = 'admin_password'");

        const isPasswordEnabled = enabledSetting?.value === 'true' || enabledSetting?.value === true;
        const storedPassword = passwordSetting?.value || '';

        // 如果密码保护开启且密码不匹配，过滤掉隐藏的视频源
        if (isPasswordEnabled) {
            const isAuthorized = adminPassword === storedPassword;
            if (!isAuthorized) {
                sources = sources.filter(s => !s.hidden);
            }
        }

        // 🚀 防撞墙逻辑：验证数据真实性
        // 如果返回的数组中存在 vod_id 字段，说明发生了极其罕见的内容交叉（数据库连接池/游标污染）
        if (Array.isArray(sources) && sources.length > 0) {
            const firstRow = sources[0];
            if (firstRow.vod_id || !firstRow.url) {
                console.error('[sources] CRITICAL ERROR: Database returned video data instead of sources!');
                return res.status(500).json({
                    success: false,
                    error: '数据完整性异常，请刷新重试',
                    _debug_data_corrupted: true
                });
            }
        }

        res.json({ success: true, data: sources });
    } catch (error) {
        console.error('[sources] Failed to get sources:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 导出视频源
 * GET /api/sources/export
 */
router.get('/export', (req, res) => {
    try {
        const db = getDatabase();
        const sources = db.all('SELECT name, url, type, api_key, enabled, hidden, tags, remark, sort_order FROM video_sources ORDER BY sort_order ASC');

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=video_sources.json');
        res.json({ success: true, data: sources, exportedAt: new Date().toISOString() });
    } catch (error) {
        console.error('[sources] Failed to export sources:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 辅助函数：同步视频源分类
 * @param {object} db - 数据库实例
 * @param {object} source - 视频源对象
 * @param {Function} onProgress - 可选的回调函数，用于实时推送进度
 */
async function syncCategoriesForSource(db, source, onProgress = null) {
    // 动态导入 CMS API 解析器
    const { CmsApiParser } = require('../services/CmsApiParser');
    const agent = source.proxy_enabled ? getSystemProxyAgent() : null;
    const parser = new CmsApiParser(source.url, agent);

    if (onProgress) onProgress('正在获取全部分类...', 0, 100);
    const categories = await parser.getCategories();

    if (!categories || categories.length === 0) {
        return [];
    }

    // 清除旧分类
    db.run('DELETE FROM categories WHERE source_id = ?', [source.id]);

    // 插入新分类
    const stmt = db.prepare(`
        INSERT INTO categories (source_id, type_id, name, parent_id, sort_order, has_content)
        VALUES (?, ?, ?, ?, ?, 1)
    `);

    let sortOrder = 0;
    for (const cat of categories) {
        stmt.run([source.id, cat.type_id, cat.type_name, cat.type_pid || 0, sortOrder++]);
    }

    const savedCategories = db.all('SELECT * FROM categories WHERE source_id = ? ORDER BY sort_order', [source.id]);
    const topLevelCats = savedCategories.filter(c => !c.parent_id || c.parent_id === 0);
    const childCats = savedCategories.filter(c => c.parent_id && c.parent_id !== 0);

    const totalToCheck = childCats.length + topLevelCats.length;
    let checkedCount = 0;

    const contentStatus = new Map();

    // 先检查所有子分类是否有内容
    for (const cat of childCats) {
        checkedCount++;
        if (onProgress) onProgress(`正在检查子分类内容: ${cat.name}`, checkedCount, totalToCheck);
        try {
            const result = await parser.getVideos({ categoryId: cat.type_id, page: 1, limit: 1 });
            const hasContent = result && result.list && result.list.length > 0 ? 1 : 0;
            contentStatus.set(cat.type_id, hasContent);
            db.run('UPDATE categories SET has_content = ? WHERE id = ?', [hasContent, cat.id]);
        } catch (err) {
            contentStatus.set(cat.type_id, 1);
            console.warn(`[sources] Failed to check child category ${cat.name}: ${err.message}`);
        }
    }

    // 检查顶级分类是否有内容
    for (const cat of topLevelCats) {
        checkedCount++;
        if (onProgress) onProgress(`正在检查父分类内容: ${cat.name}`, checkedCount, totalToCheck);
        try {
            const result = await parser.getVideos({ categoryId: cat.type_id, page: 1, limit: 1 });
            let hasContent = result && result.list && result.list.length > 0 ? 1 : 0;

            if (!hasContent) {
                const children = childCats.filter(c =>
                    String(c.parent_id) === cat.type_id ||
                    c.parent_id === parseInt(cat.type_id)
                );
                for (const child of children) {
                    if (contentStatus.get(child.type_id) === 1) {
                        hasContent = 1;
                        break;
                    }
                }
            }

            contentStatus.set(cat.type_id, hasContent);
            db.run('UPDATE categories SET has_content = ? WHERE id = ?', [hasContent, cat.id]);
        } catch (err) {
            console.warn(`[sources] Failed to check category ${cat.name}: ${err.message}`);
        }
    }

    const finalCategories = db.all('SELECT * FROM categories WHERE source_id = ? ORDER BY sort_order', [source.id]);
    if (onProgress) onProgress('分类同步完成', totalToCheck, totalToCheck);
    return finalCategories;
}

/**
 * 添加视频源
 * POST /api/sources
 */
router.post('/', async (req, res) => {
    try {
        const { name, url, type = 'cms_api', api_key, enabled = true, hidden = false, tags = '', remark = '', sort_order = 0 } = req.body;

        if (!name || !url) {
            return res.status(400).json({ success: false, error: 'Name and URL are required' });
        }

        const db = getDatabase();
        const result = db.run(
            `INSERT INTO video_sources (name, url, type, api_key, enabled, hidden, proxy_enabled, tags, remark, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, url, type, api_key || null, enabled ? 1 : 0, hidden ? 1 : 0, req.body.proxy_enabled ? 1 : 0, tags, remark, sort_order]
        );

        const newSource = db.get('SELECT * FROM video_sources WHERE id = ?', [result.lastID]);

        // 自动同步分类
        try {
            await syncCategoriesForSource(db, newSource);
        } catch (syncError) {
            console.warn(`[sources] Failed to auto-sync categories for new source ${newSource.name}:`, syncError.message);
            // 不中断，仅记录错误
        }

        res.json({ success: true, data: newSource });
    } catch (error) {
        console.error('[sources] Failed to create source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ... (keep batch-test, batch-update, batch-delete, import routes as is)

/**
 * 批量测速
 * POST /api/sources/batch-test
 */
router.post('/batch-test', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'IDs are required' });
        }

        const db = getDatabase();
        const results = [];

        for (const id of ids) {
            const source = db.get('SELECT * FROM video_sources WHERE id = ?', [id]);
            if (!source) continue;

            const startTime = Date.now();
            try {
                const agent = source.proxy_enabled ? getSystemProxyAgent() : null;

                const targetUrl = new URL(source.url);
                targetUrl.searchParams.set('ac', 'list');
                targetUrl.searchParams.set('pg', '1');

                const response = await fetch(targetUrl.toString(), {
                    method: 'GET',
                    timeout: 10000,
                    agent
                });
                const responseTime = Date.now() - startTime;

                if (response.ok) {
                    db.run(
                        'UPDATE video_sources SET response_time = ?, last_test_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [responseTime, id]
                    );
                    results.push({ id, success: true, responseTime });
                } else {
                    results.push({ id, success: false, error: `HTTP ${response.status}`, responseTime });
                }
            } catch (fetchError) {
                const responseTime = Date.now() - startTime;
                results.push({ id, success: false, error: fetchError.message, responseTime });
            }
        }

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('[sources] Failed to batch test:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 批量更新状态
 * POST /api/sources/batch-update
 */
router.post('/batch-update', (req, res) => {
    try {
        const { ids, updates } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'IDs are required' });
        }

        const db = getDatabase();
        const updateFields = [];
        const params = [];

        if (updates.enabled !== undefined) { updateFields.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
        if (updates.hidden !== undefined) { updateFields.push('hidden = ?'); params.push(updates.hidden ? 1 : 0); }

        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, error: 'No updates provided' });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');

        for (const id of ids) {
            db.run(
                `UPDATE video_sources SET ${updateFields.join(', ')} WHERE id = ?`,
                [...params, id]
            );
        }

        const sources = db.all('SELECT * FROM video_sources ORDER BY sort_order ASC');
        res.json({ success: true, data: sources });
    } catch (error) {
        console.error('[sources] Failed to batch update:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 批量删除
 * POST /api/sources/batch-delete
 */
router.post('/batch-delete', (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'IDs are required' });
        }

        const db = getDatabase();
        const BATCH_SIZE = 50; // 每批最多删除 50 条
        let deletedCount = 0;

        // 分批处理，每批使用事务
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const batch = ids.slice(i, i + BATCH_SIZE);

            db.transaction(() => {
                for (const id of batch) {
                    db.run('DELETE FROM video_sources WHERE id = ?', [id]);
                    deletedCount++;
                }
            })();
        }

        res.json({ success: true, message: `Deleted ${deletedCount} sources` });
    } catch (error) {
        console.error('[sources] Failed to batch delete:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 导入视频源
 * POST /api/sources/import
 */
router.post('/import', (req, res) => {
    try {
        const { sources, mode = 'append' } = req.body;
        if (!sources || !Array.isArray(sources) || sources.length === 0) {
            return res.status(400).json({ success: false, error: 'Sources array is required' });
        }

        const db = getDatabase();

        // 如果是替换模式，先清空
        if (mode === 'replace') {
            db.run('DELETE FROM video_sources');
        }

        const stmt = db.prepare(`
            INSERT INTO video_sources (name, url, type, api_key, enabled, hidden, proxy_enabled, tags, remark, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let imported = 0;
        for (const source of sources) {
            try {
                stmt.run([
                    source.name,
                    source.url,
                    source.type || 'cms_api',
                    source.api_key || null,
                    source.enabled !== undefined ? (source.enabled ? 1 : 0) : 1,
                    source.hidden !== undefined ? (source.hidden ? 1 : 0) : 0,
                    source.proxy_enabled !== undefined ? (source.proxy_enabled ? 1 : 0) : 0,
                    source.tags || '',
                    source.remark || '',
                    source.sort_order || 0
                ]);
                imported++;
            } catch (err) {
                console.warn(`[sources] Failed to import source ${source.name}:`, err.message);
            }
        }

        const allSources = db.all('SELECT * FROM video_sources ORDER BY sort_order ASC');
        res.json({ success: true, data: allSources, imported });

        // 异步后台同步分类
        if (imported > 0) {
            (async () => {
                console.log(`[sources] Starting background category sync for ${imported} imported sources...`);
                // 获取所有刚导入的源（这里简单起见，重新获取所有启用的源进行检查，或者优化为只同步本次导入的）
                // 由于 SQLite 批量插入无法直接返回所有ID，最简单的方式是同步所有"分类为空"或者"刚刚更新"的源
                // 但为了准确性，我们可以在上面的循环中记录 url 或 name，然后查库

                // 更好的策略：遍历 sources 输入数组，根据 URL 查库获得 ID
                for (const src of sources) {
                    try {
                        const dbSource = db.get('SELECT * FROM video_sources WHERE url = ?', [src.url]);
                        if (dbSource) {
                            await syncCategoriesForSource(db, dbSource);
                            // 稍微延迟一下，避免并发过高
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    } catch (e) {
                        console.error(`[sources] Background sync failed for ${src.name}:`, e.message);
                    }
                }
                console.log('[sources] Background category sync completed.');
            })().catch(err => console.error('[sources] Background sync process error:', err));
        }

    } catch (error) {
        console.error('[sources] Failed to import sources:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 动态路由（使用 :id 参数，必须放在静态路由之后）
// ============================================

/**
 * 获取单个视频源
 * GET /api/sources/:id
 */
router.get('/:id', (req, res) => {
    try {
        const db = getDatabase();
        const source = db.get('SELECT * FROM video_sources WHERE id = ?', [req.params.id]);
        if (!source) {
            return res.status(404).json({ success: false, error: 'Source not found' });
        }
        res.json({ success: true, data: source });
    } catch (error) {
        console.error('[sources] Failed to get source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 更新视频源
 * PUT /api/sources/:id
 */
router.put('/:id', (req, res) => {
    try {
        const { name, url, type, api_key, enabled, hidden, proxy_enabled, tags, remark, sort_order, response_time, last_test_at } = req.body;
        const db = getDatabase();

        // 检查是否存在
        const existing = db.get('SELECT * FROM video_sources WHERE id = ?', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Source not found' });
        }

        // 构建更新语句
        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (url !== undefined) { updates.push('url = ?'); params.push(url); }
        if (type !== undefined) { updates.push('type = ?'); params.push(type); }
        if (api_key !== undefined) { updates.push('api_key = ?'); params.push(api_key); }
        if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
        if (hidden !== undefined) { updates.push('hidden = ?'); params.push(hidden ? 1 : 0); }
        if (proxy_enabled !== undefined) { updates.push('proxy_enabled = ?'); params.push(proxy_enabled ? 1 : 0); }
        if (tags !== undefined) { updates.push('tags = ?'); params.push(tags); }
        if (remark !== undefined) { updates.push('remark = ?'); params.push(remark); }
        if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
        if (response_time !== undefined) { updates.push('response_time = ?'); params.push(response_time); }
        if (last_test_at !== undefined) { updates.push('last_test_at = ?'); params.push(last_test_at); }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(req.params.id);

        db.run(
            `UPDATE video_sources SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        const updated = db.get('SELECT * FROM video_sources WHERE id = ?', [req.params.id]);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('[sources] Failed to update source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 删除视频源
 * DELETE /api/sources/:id
 */
router.delete('/:id', (req, res) => {
    try {
        const db = getDatabase();

        // 检查是否存在
        const existing = db.get('SELECT * FROM video_sources WHERE id = ?', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Source not found' });
        }

        db.run('DELETE FROM video_sources WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Source deleted' });
    } catch (error) {
        console.error('[sources] Failed to delete source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 测试单个视频源延迟
 * POST /api/sources/:id/test
 */
router.post('/:id/test', async (req, res) => {
    try {
        const db = getDatabase();
        const source = db.get('SELECT * FROM video_sources WHERE id = ?', [req.params.id]);
        if (!source) {
            return res.status(404).json({ success: false, error: 'Source not found' });
        }

        const startTime = Date.now();
        try {
            // 如果启用了代理，获取代理 Agent
            const agent = source.proxy_enabled ? getSystemProxyAgent() : null;

            const targetUrl = new URL(source.url);
            targetUrl.searchParams.set('ac', 'list');
            targetUrl.searchParams.set('pg', '1');

            const response = await fetch(targetUrl.toString(), {
                method: 'GET',
                timeout: 10000,
                agent
            });
            const responseTime = Date.now() - startTime;

            if (response.ok) {
                db.run(
                    'UPDATE video_sources SET response_time = ?, last_test_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [responseTime, source.id]
                );
                res.json({ success: true, responseTime });
            } else {
                res.status(500).json({ success: false, error: `HTTP ${response.status}`, responseTime });
            }
        } catch (fetchError) {
            const responseTime = Date.now() - startTime;
            res.status(500).json({ success: false, error: fetchError.message, responseTime });
        }
    } catch (error) {
        console.error('[sources] Failed to test source:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 同步视频源分类
 * POST /api/sources/:id/sync
 * 支持 stream=true 参数进行 SSE 流式推送进度
 */
router.post('/:id/sync', async (req, res) => {
    const { stream } = req.query;

    try {
        const db = getDatabase();
        const source = db.get('SELECT * FROM video_sources WHERE id = ?', [req.params.id]);

        if (!source) {
            return res.status(404).json({ success: false, error: 'Source not found' });
        }

        if (stream === 'true' || stream === '1') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof res.flushHeaders === 'function') res.flushHeaders();

            await syncCategoriesForSource(db, source, (message, current, total) => {
                res.write(`data: ${JSON.stringify({ type: 'progress', message, current, total })}\n\n`);
                if (typeof res.flush === 'function') res.flush();
            });

            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }

        const savedCategories = await syncCategoriesForSource(db, source);
        res.json({ success: true, data: savedCategories });
    } catch (error) {
        console.error('[sources] Failed to sync categories:', error);
        if (stream === 'true' || stream === '1') {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

/**
 * 后台异步同步资源站分类（添加到队列）
 * POST /api/sources/:id/background-sync
 */
router.post('/:id/background-sync', (req, res) => {
    try {
        const sourceId = parseInt(req.params.id);

        if (isNaN(sourceId)) {
            return res.status(400).json({ success: false, error: 'Invalid source ID' });
        }

        // 延迟导入避免循环依赖
        const { syncQueueService } = require('../services/SyncQueueService');
        const result = syncQueueService.addToQueue(sourceId);

        res.status(202).json({
            success: true,
            message: 'Sync request accepted',
            ...result
        });
    } catch (error) {
        console.error('[sources] Failed to queue background sync:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取同步队列状态
 * GET /api/sources/sync-queue/status
 */
router.get('/sync-queue/status', (req, res) => {
    try {
        const { syncQueueService } = require('../services/SyncQueueService');
        const status = syncQueueService.getStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 导出 router 和 syncCategoriesForSource 函数供其他模块使用
module.exports = router;
module.exports.syncCategoriesForSource = syncCategoriesForSource;
