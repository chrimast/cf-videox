const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');
const MediaServerService = require('../services/media-server-service');

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
 * 获取所有服务器配置
 */
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');

        const authorized = isAuthorized(req, db);
        let servers = db.all('SELECT * FROM media_servers ORDER BY sort_order ASC, created_at DESC');

        // 如果密码保护开启且未授权，过滤掉隐藏的服务器
        if (!authorized) {
            servers = servers.filter(s => !s.hidden);
        }

        res.json({ success: true, data: servers });
    } catch (error) {
        console.error('[media-servers] GET / Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 添加服务器
 */
router.post('/', (req, res) => {
    try {
        const { name, url, type, api_key, user_id, enabled, hidden, remark, sort_order } = req.body;
        if (!name || !url) {
            return res.status(400).json({ success: false, error: '名称和地址不能为空' });
        }

        const db = getDatabase();
        if (!db) throw new Error('Database not initialized');
        const result = db.run(
            `INSERT INTO media_servers (name, url, type, api_key, user_id, enabled, hidden, remark, sort_order) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, url, type || 'emby', api_key, user_id, enabled === undefined ? 1 : enabled, hidden || 0, remark, sort_order || 0]
        );

        res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (error) {
        console.error('[media-servers] POST / Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 更新服务器
 */
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, url, type, api_key, user_id, enabled, hidden, remark, sort_order } = req.body;

        const db = getDatabase();
        const updates = [];
        const values = [];

        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (url !== undefined) { updates.push('url = ?'); values.push(url); }
        if (type !== undefined) { updates.push('type = ?'); values.push(type); }
        if (api_key !== undefined) { updates.push('api_key = ?'); values.push(api_key); }
        if (user_id !== undefined) { updates.push('user_id = ?'); values.push(user_id); }
        if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0); }
        if (hidden !== undefined) { updates.push('hidden = ?'); values.push(hidden ? 1 : 0); }
        if (remark !== undefined) { updates.push('remark = ?'); values.push(remark); }
        if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }

        if (updates.length > 0) {
            updates.push('updated_at = CURRENT_TIMESTAMP');
            db.run(`UPDATE media_servers SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 删除服务器
 */
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        db.run('DELETE FROM media_servers WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 测试连接 (真实测试)
 */
router.post('/:id/test', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);

        if (!server) {
            return res.status(404).json({ success: false, error: '服务器不存在' });
        }

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.testConnection(server);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取媒体库列表
 */
router.get('/:id/libraries', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);

        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查：如果服务器隐藏且未授权，则拒绝访问
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getLibraries(server);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取具体分类的项目列表
 */
router.get('/:id/items', async (req, res) => {
    try {
        const { id } = req.params;
        const { parentId, ...options } = req.query;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);

        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getItems(server, parentId, options);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取具体项目的详情
 */
router.get('/:id/items/:itemId', async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);

        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getItemDetail(server, itemId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取相似内容推荐
 */
router.get('/:id/items/:itemId/similar', async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);

        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getSimilarItems(server, itemId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取播放信息
 */
router.get('/:id/playback/:itemId', async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);

        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getPlaybackInfo(server, itemId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 上报播放开始
 */
router.post('/:id/playback/start', async (req, res) => {
    try {
        const { id } = req.params;
        const { itemId, mediaSourceId } = req.body;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        const result = await MediaServerService.reportPlaybackStart(server, itemId, mediaSourceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 上报播放进度
 */
router.post('/:id/playback/progress', async (req, res) => {
    try {
        const { id } = req.params;
        const { itemId, positionTicks, isPaused, playSessionId, mediaSourceId } = req.body;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        const result = await MediaServerService.reportPlaybackProgress(server, itemId, positionTicks, isPaused, playSessionId, mediaSourceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 上报播放停止
 */
router.post('/:id/playback/stop', async (req, res) => {
    try {
        const { id } = req.params;
        const { itemId, positionTicks, playSessionId, mediaSourceId } = req.body;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        const result = await MediaServerService.reportPlaybackStopped(server, itemId, positionTicks, playSessionId, mediaSourceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取全量首页聚合数据 (动态同步)
 */
router.get('/:id/home', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.json({ success: true, data: { resume: [], sections: [] } });
        }

        const result = await MediaServerService.getFullHomeData(server);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取“继续观看”列表
 */
router.get('/:id/resume', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.json({ success: true, data: [] });
        }

        const result = await MediaServerService.getResumeItems(server);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取“最新添加”列表
 */
router.get('/:id/latest', async (req, res) => {
    try {
        const { id } = req.params;
        const { limit } = req.query;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.json({ success: true, data: [] });
        }

        const result = await MediaServerService.getLatestItems(server, limit);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取库的推荐视图 (Resume + Latest)
 */
router.get('/:id/suggestions', async (req, res) => {
    try {
        const { id } = req.params;
        const { parentId } = req.query;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getLibrarySuggestions(server, parentId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取分类 (Genres)
 */
router.get('/:id/genres', async (req, res) => {
    try {
        const { id } = req.params;
        const { parentId } = req.query;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getGenres(server, parentId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取标签 (Tags)
 */
router.get('/:id/tags', async (req, res) => {
    try {
        const { id } = req.params;
        const { parentId } = req.query;
        const db = getDatabase();
        const server = db.get('SELECT * FROM media_servers WHERE id = ?', [id]);
        if (!server) return res.status(404).json({ success: false, error: '服务器不存在' });

        // 权限检查
        if (server.hidden && !isAuthorized(req, db)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await MediaServerService.getTags(server, parentId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
