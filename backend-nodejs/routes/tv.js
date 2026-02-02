const express = require('express');
const router = express.Router();
const tvService = require('../services/TvService');

// 获取所有源
router.get('/sources', (req, res) => {
    try {
        const sources = tvService.getAllSources();
        res.json({ success: true, data: sources });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 添加源
router.post('/sources', (req, res) => {
    try {
        const result = tvService.addSource(req.body);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 更新源
router.put('/sources/:id', (req, res) => {
    try {
        const result = tvService.updateSource(req.params.id, req.body);
        res.json({ success: true, changes: result.changes });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 删除源
router.delete('/sources/:id', (req, res) => {
    try {
        const result = tvService.deleteSource(req.params.id);
        res.json({ success: true, changes: result.changes });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 获取指定源的播放列表（解析后）
router.get('/playlist/:id', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === 'true';
        const channels = await tvService.getPlaylist(req.params.id, forceRefresh);
        res.json({ success: true, data: channels });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 批量更新源
router.post('/sources/batch-update', (req, res) => {
    try {
        const { ids, updates } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid ids' });
        }

        let totalChanges = 0;
        ids.forEach(id => {
            const result = tvService.updateSource(id, updates);
            totalChanges += result.changes;
        });

        res.json({ success: true, changes: totalChanges });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 批量删除源
router.post('/sources/batch-delete', (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid ids' });
        }

        const { getDatabase } = require('../database');
        const db = getDatabase();
        const BATCH_SIZE = 50;
        let totalChanges = 0;

        // 分批处理，每批使用事务
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const batch = ids.slice(i, i + BATCH_SIZE);

            db.transaction(() => {
                for (const id of batch) {
                    const result = tvService.deleteSource(id);
                    totalChanges += result.changes;
                }
            })();
        }

        res.json({ success: true, changes: totalChanges });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
