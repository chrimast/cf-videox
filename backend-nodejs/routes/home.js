const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');
const homeService = require('../services/HomeService');

/**
 * GET /api/home
 * 获取首页所有缓存数据
 */
/**
 * GET /api/home
 * 获取首页所有缓存数据（支持流式增量更新）
 */
router.get('/', async (req, res) => {
    const { stream } = req.query;

    try {
        const db = getDatabase();
        const rows = db.prepare('SELECT key, data, updated_at FROM home_cache').all();

        const result = {};
        let lastUpdated = null;

        rows.forEach(row => {
            const key = row.key;
            let data = [];
            try { data = JSON.parse(row.data); } catch (e) { }

            if (key === 'home_hot') {
                result.hot = data;
            } else if (key.startsWith('home_')) {
                const parts = key.split('_');
                const section = parts[1];
                const sub = parts[2];
                if (!result[section]) result[section] = {};
                result[section][sub] = data;
            }

            // Track the earliest updated_at as lastUpdated
            if (row.updated_at && (!lastUpdated || row.updated_at < lastUpdated)) {
                lastUpdated = row.updated_at;
            }
        });

        if (stream === 'true' || stream === '1') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof res.flushHeaders === 'function') res.flushHeaders();

            // 1. 发送现有缓存内容
            res.write(`data: ${JSON.stringify({ type: 'cache', data: result })}\n\n`);
            if (typeof res.flush === 'function') res.flush();

            // 2. 触发刷新并流式推送更新
            homeService.refreshAll((section, sub, data) => {
                const update = { type: 'update', section, sub, data };
                res.write(`data: ${JSON.stringify(update)}\n\n`);
                if (typeof res.flush === 'function') res.flush();
            }).then(() => {
                res.write('data: [DONE]\n\n');
                if (typeof res.flush === 'function') res.flush();
                res.end();
            }).catch(err => {
                console.error('[Home/Stream] Refresh failed:', err);
                res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
                res.end();
            });
            return;
        }

        res.json({ success: true, data: result, lastUpdated });
    } catch (error) {
        console.error('[Home] Failed to get home data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/home/refresh
 * 手动触发刷新
 */
router.post('/refresh', async (req, res) => {
    try {
        // 异步执行，不阻塞响应
        homeService.refreshAll().catch(e => console.error(e));
        res.json({ success: true, message: 'Refresh started in background' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/home/refresh-section
 * 刷新指定板块
 * Body: { section: 'hot' | 'movie' | 'tv' | 'anime' | 'variety' }
 */
router.post('/refresh-section', async (req, res) => {
    try {
        const { section } = req.body;

        if (!section) {
            return res.status(400).json({ success: false, error: 'Section is required' });
        }

        const validSections = ['hot', 'movie', 'tv', 'anime', 'variety'];
        if (!validSections.includes(section)) {
            return res.status(400).json({
                success: false,
                error: `Invalid section. Must be one of: ${validSections.join(', ')}`
            });
        }

        const data = await homeService.refreshSingleSection(section);
        res.json({ success: true, data });
    } catch (error) {
        console.error(`[Home] Failed to refresh section ${req.body.section}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
