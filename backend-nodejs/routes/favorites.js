/**
 * 收藏管理 API
 * GET /api/favorites - 获取收藏列表
 * POST /api/favorites - 添加收藏
 * DELETE /api/favorites/:id - 删除收藏
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

/**
 * 获取收藏列表
 */
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const userId = req.headers['x-nav-user-id'] || '0';

        const favorites = db.prepare(`
            SELECT f.*, 
                   CASE 
                       WHEN f.source_type = 'netdisk' THEN ns.name 
                       WHEN f.source_type = 'media_server' THEN ms.name
                       ELSE vs.name 
                   END as source_name
            FROM favorites f
            LEFT JOIN video_sources vs ON f.source_id = vs.id AND (f.source_type = 'cms' OR f.source_type IS NULL)
            LEFT JOIN netdisk_sources ns ON f.source_id = ns.id AND f.source_type = 'netdisk'
            LEFT JOIN media_servers ms ON f.source_id = ms.id AND f.source_type = 'media_server'
            WHERE f.user_id = ?
            ORDER BY f.created_at DESC
        `).all(userId);

        res.json({ success: true, data: favorites });
    } catch (error) {
        console.error('[Favorites] Get list failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 检查是否已收藏
 */
router.get('/check', (req, res) => {
    try {
        const { source_id, vod_id, source_type = 'cms' } = req.query;
        const db = getDb();
        const userId = req.headers['x-nav-user-id'] || '0';

        const favorite = db.prepare(`
            SELECT id FROM favorites 
            WHERE user_id = ? AND source_id = ? AND vod_id = ? AND (source_type = ? OR (source_type IS NULL AND ? = 'cms'))
        `).get(userId, source_id, vod_id, source_type, source_type);

        res.json({ success: true, data: { isFavorite: !!favorite } });
    } catch (error) {
        console.error('[Favorites] Check failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 添加收藏
 */
router.post('/', (req, res) => {
    try {
        const { source_id, vod_id, title, cover, year, source_type = 'cms' } = req.body;
        const db = getDb();
        const userId = req.headers['x-nav-user-id'] || '0';

        // 检查是否已存在
        const existing = db.prepare(`
            SELECT id FROM favorites 
            WHERE user_id = ? AND source_id = ? AND vod_id = ? AND (source_type = ? OR (source_type IS NULL AND ? = 'cms'))
        `).get(userId, source_id, vod_id, source_type, source_type);

        if (existing) {
            return res.json({ success: true, data: { id: existing.id }, message: '已收藏' });
        }

        const result = db.prepare(`
            INSERT INTO favorites (user_id, source_id, source_type, vod_id, title, cover, year)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(userId, source_id, source_type, vod_id, title, cover, year);

        res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (error) {
        console.error('[Favorites] Add failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 删除收藏
 */
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();
        const userId = req.headers['x-nav-user-id'] || '0';

        db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(id, userId);

        res.json({ success: true });
    } catch (error) {
        console.error('[Favorites] Delete failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 按 source_id 和 vod_id 删除收藏
 */
router.delete('/', (req, res) => {
    try {
        const { source_id, vod_id, source_type = 'cms' } = req.query;
        const db = getDb();
        const userId = req.headers['x-nav-user-id'] || '0';

        db.prepare(`
            DELETE FROM favorites 
            WHERE user_id = ? AND source_id = ? AND vod_id = ? AND (source_type = ? OR (source_type IS NULL AND ? = 'cms'))
        `).run(userId, source_id, vod_id, source_type, source_type);

        res.json({ success: true });
    } catch (error) {
        console.error('[Favorites] Delete by vod_id failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
