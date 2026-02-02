const express = require('express');
const router = express.Router();
const liveService = require('../services/LiveService');

// 获取所有直播源
router.get('/sources', (req, res) => {
    try {
        const sources = liveService.getAllSources();
        res.json({ success: true, data: sources });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 添加直播源
router.post('/sources', (req, res) => {
    try {
        const result = liveService.addSource(req.body);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 更新直播源
router.put('/sources/:id', (req, res) => {
    try {
        const result = liveService.updateSource(req.params.id, req.body);
        res.json({ success: true, changes: result.changes });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 删除直播源
router.delete('/sources/:id', (req, res) => {
    try {
        const result = liveService.deleteSource(req.params.id);
        res.json({ success: true, changes: result.changes });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 批量更新直播源
router.post('/sources/batch-update', (req, res) => {
    try {
        const { ids, updates } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid ids' });
        }

        let totalChanges = 0;
        ids.forEach(id => {
            const result = liveService.updateSource(id, updates);
            totalChanges += result.changes;
        });

        res.json({ success: true, changes: totalChanges });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 批量删除直播源
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
                    const result = liveService.deleteSource(id);
                    totalChanges += result.changes;
                }
            })();
        }

        res.json({ success: true, changes: totalChanges });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 获取所有直播状态
router.get('/status', (req, res) => {
    try {
        const status = liveService.getAllStatus();
        res.json({ success: true, data: status });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 获取指定直播源的状态
router.get('/status/:id', (req, res) => {
    try {
        const status = liveService.getStatus(req.params.id);
        res.json({ success: true, data: status });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 获取真实播放地址
router.get('/play-url/:id', async (req, res) => {
    try {
        const result = await liveService.getPlayUrl(req.params.id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Stream not found or not live' });
        }
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 手动刷新指定直播源的状态
router.post('/refresh/:id', async (req, res) => {
    try {
        const source = liveService.getAllSources().find(s => s.id == req.params.id);
        if (!source) {
            return res.status(404).json({ success: false, message: 'Source not found' });
        }

        const status = await liveService.checkLiveStatus(source);
        res.json({ success: true, data: status });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 批量刷新所有直播状态
router.post('/refresh-all', async (req, res) => {
    try {
        const results = await liveService.refreshAllStatus();
        res.json({ success: true, data: results });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
