const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { getDatabase } = require('../database');
const https = require('https');

/**
 * 根据系统设置获取代理 Agent
 * @returns {http.Agent|null}
 */
function getSystemProxyAgent() {
    try {
        const db = getDatabase();
        if (!db) return null;

        // 获取代理相关设置
        const settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'proxy_%'").all();
        const config = settings.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});

        // 检查是否启用
        if (config.proxy_enabled !== 'true') return null;
        if (!config.proxy_host || !config.proxy_port) return null;

        // 构建认证信息
        const auth = (config.proxy_auth_enabled === 'true' && config.proxy_username && config.proxy_password)
            ? `${encodeURIComponent(config.proxy_username)}:${encodeURIComponent(config.proxy_password)}@`
            : '';

        // 构建代理 URL
        const protocol = config.proxy_type === 'socks5' ? 'socks5' : 'http';
        const proxyUrl = `${protocol}://${auth}${config.proxy_host}:${config.proxy_port}`;

        console.log('[Proxy Agent] Creating agent for:', `${protocol}://${config.proxy_host}:${config.proxy_port}`);

        if (config.proxy_type === 'socks5') {
            return new SocksProxyAgent(proxyUrl);
        } else {
            return new HttpsProxyAgent(proxyUrl);
        }
    } catch (e) {
        console.error('[Proxy Agent] Failed to create proxy agent:', e);
        return null;
    }
}

/**
 * 获取一个忽略 SSL 错误的 https Agent
 * 用于处理证书配置有误但内容正常的资源站
 */
function getInsecureAgent() {
    return new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true
    });
}

module.exports = { getSystemProxyAgent, getInsecureAgent };
