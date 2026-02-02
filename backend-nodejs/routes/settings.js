const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

/**
 * 获取所有设置
 * GET /api/settings
 */
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        const settings = db.all('SELECT * FROM settings');

        // 转换为对象格式
        const settingsObj = {};
        for (const setting of settings) {
            try {
                // 尝试解析 JSON 值
                settingsObj[setting.key] = JSON.parse(setting.value);
            } catch {
                settingsObj[setting.key] = setting.value;
            }
        }

        res.json({ success: true, data: settingsObj });
    } catch (error) {
        console.error('[settings] Failed to get settings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取单个设置
 * GET /api/settings/:key
 */
router.get('/:key', (req, res) => {
    try {
        const db = getDatabase();
        const setting = db.get('SELECT * FROM settings WHERE key = ?', [req.params.key]);

        if (!setting) {
            return res.status(404).json({ success: false, error: 'Setting not found' });
        }

        let value = setting.value;
        try {
            value = JSON.parse(setting.value);
        } catch {
            // 保持原值
        }

        res.json({ success: true, data: { key: setting.key, value } });
    } catch (error) {
        console.error('[settings] Failed to get setting:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 更新设置
 * PUT /api/settings/:key
 */
router.put('/:key', (req, res) => {
    try {
        const { value } = req.body;
        const db = getDatabase();

        // 将值转换为字符串存储
        const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

        db.run(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [req.params.key, strValue]
        );

        res.json({ success: true, data: { key: req.params.key, value } });
    } catch (error) {
        console.error('[settings] Failed to update setting:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 批量更新设置
 * PUT /api/settings
 */
router.put('/', (req, res) => {
    try {
        const settings = req.body;
        const db = getDatabase();

        if (typeof settings !== 'object' || settings === null) {
            return res.status(400).json({ success: false, error: 'Invalid settings format' });
        }

        for (const [key, value] of Object.entries(settings)) {
            const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            db.run(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                [key, strValue]
            );
        }

        res.json({ success: true, message: 'Settings updated' });
    } catch (error) {
        console.error('[settings] Failed to batch update settings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 验证管理密码
 * POST /api/settings/verify-password
 */
router.post('/verify-password', (req, res) => {
    try {
        const { password } = req.body;
        const db = getDatabase();

        // 获取密码设置
        const enabledSetting = db.get("SELECT value FROM settings WHERE key = 'admin_password_enabled'");
        const passwordSetting = db.get("SELECT value FROM settings WHERE key = 'admin_password'");

        const isEnabled = enabledSetting?.value === 'true';
        const storedPassword = passwordSetting?.value || '';

        if (!isEnabled) {
            // 密码未启用，直接验证通过
            return res.json({ success: true, valid: true, message: 'Password not enabled' });
        }

        if (!password) {
            return res.json({ success: true, valid: false, message: 'Password required' });
        }

        // 简单字符串比较（生产环境应使用加密比较）
        console.log('[settings] 密码验证: 输入=', password, '存储=', storedPassword, '匹配=', password === storedPassword);
        const valid = password === storedPassword;
        res.json({ success: true, valid, message: valid ? 'Password correct' : 'Password incorrect' });
    } catch (error) {
        console.error('[settings] Failed to verify password:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 验证全站访问密码
 * POST /api/settings/verify-site-password
 */
router.post('/verify-site-password', (req, res) => {
    try {
        const { password } = req.body;
        const db = getDatabase();

        const enabledSetting = db.get("SELECT value FROM settings WHERE key = 'site_password_enabled'");
        const passwordSetting = db.get("SELECT value FROM settings WHERE key = 'site_password'");

        // 兼容字符串和布尔值
        const isEnabled = String(enabledSetting?.value) === 'true';
        const storedPassword = passwordSetting?.value || '';

        console.log(`[Settings] Verifying site password. Enabled (Boolean): ${isEnabled}, Raw: ${enabledSetting?.value}`);

        if (!isEnabled) {
            return res.json({ success: true, valid: true });
        }

        const valid = password === storedPassword;
        console.log(`[Settings] Verification: Submitted [${password}], Stored [${storedPassword}], Match: ${valid}`);
        console.log(`[Settings] Site password result: ${valid ? 'SUCCESS' : 'FAILURE'}`);
        res.json({ success: true, valid });
    } catch (error) {
        console.error('[settings] Failed to verify site password:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 测试 TMDB API 连接
 * POST /api/settings/test-tmdb
 */
router.post('/test-tmdb', async (req, res) => {
    try {
        const { api_key } = req.body;

        if (!api_key) {
            return res.status(400).json({ success: false, error: 'API key required' });
        }

        // 测试 TMDB API
        const response = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${api_key}`);

        if (response.ok) {
            const data = await response.json();
            res.json({
                success: true,
                valid: true,
                message: 'TMDB API connection successful',
                images_base_url: data.images?.secure_base_url
            });
        } else {
            const error = await response.json().catch(() => ({}));
            res.json({
                success: true,
                valid: false,
                message: error.status_message || `HTTP ${response.status}`
            });
        }
    } catch (error) {
        console.error('[settings] Failed to test TMDB:', error);
        res.json({ success: true, valid: false, message: error.message });
    }
});

/**
 * 测试代理连接
 * POST /api/settings/test-proxy
 */
router.post('/test-proxy', async (req, res) => {
    try {
        const { proxy_type, proxy_host, proxy_port, proxy_auth_enabled, proxy_username, proxy_password } = req.body;

        if (!proxy_host || !proxy_port) {
            return res.status(400).json({ success: false, error: 'Proxy host and port required' });
        }

        // 简单测试：尝试通过代理访问一个测试 URL
        // 注意：Node.js 原生 fetch 不直接支持代理，这里只做连接测试
        const startTime = Date.now();

        try {
            // 使用 http/https 模块测试连接
            const net = require('net');
            const socket = new net.Socket();

            await new Promise((resolve, reject) => {
                socket.setTimeout(5000);
                socket.connect(parseInt(proxy_port), proxy_host, () => {
                    socket.destroy();
                    resolve();
                });
                socket.on('error', reject);
                socket.on('timeout', () => reject(new Error('Connection timeout')));
            });

            const responseTime = Date.now() - startTime;
            res.json({
                success: true,
                valid: true,
                message: `Proxy connection successful (${responseTime}ms)`,
                responseTime
            });
        } catch (connError) {
            res.json({
                success: true,
                valid: false,
                message: `Connection failed: ${connError.message}`
            });
        }
    } catch (error) {
        console.error('[settings] Failed to test proxy:', error);
        res.json({ success: true, valid: false, message: error.message });
    }
});

module.exports = router;
