const { getDatabase } = require('../database');
const { getSystemProxyAgent, getInsecureAgent } = require('../utils/fetch-agent');
const axios = require('axios');

// 内存缓存，减少频繁请求
// Key: source_${id}, Value: { data: [], timestamp: number }
const sourceCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 缓存30分钟

class TvService {
    /**
     * 获取解析后的频道列表
     * @param {number} sourceId 源ID
     * @param {boolean} forceRefresh 是否强制刷新
     */
    async getPlaylist(sourceId, forceRefresh = false) {
        // 1. 检查内存缓存
        const cacheKey = `source_${sourceId}`;
        const cached = sourceCache.get(cacheKey);
        if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            console.log(`[TvService] Serving source ${sourceId} from cache`);
            return cached.data;
        }

        // 2. 从数据库获取源配置
        const db = getDatabase();
        const source = db.get('SELECT * FROM tv_sources WHERE id = ?', sourceId);
        if (!source) {
            throw new Error('TV Source not found');
        }

        console.log(`[TvService] Fetching TV source: ${source.name} (${source.url})`);

        // 3. 获取远程内容
        let content = '';
        try {
            const agent = getSystemProxyAgent();
            console.log(`[TvService] Requesting URL: ${source.url}`);

            const res = await axios.get(source.url, {
                httpsAgent: agent,
                timeout: 15000,
                responseType: 'text',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Referer': source.url,
                    'Connection': 'keep-alive'
                },
                validateStatus: (status) => status < 500
            });

            console.log(`[TvService] Response Status: ${res.status} for ${source.name}`);

            if (res.status === 403) {
                console.warn(`[TvService] Warning: Source ${source.name} returned 403.`);
                throw new Error(`HTTP error 403`);
            }

            content = res.data;
            console.log(`[TvService] Received content length: ${content ? content.length : 0}`);
            if (content && typeof content === 'string' && content.length > 0) {
                console.log(`[TvService] Content preview (100 chars): ${content.substring(0, 100).replace(/\n/g, ' ')}`);
            } else if (content && typeof content !== 'string') {
                // 如果 axios 还是自动解析了 JSON
                content = JSON.stringify(content);
                console.log(`[TvService] Content was JSON, stringified.`);
            }
        } catch (e) {
            console.error(`[TvService] Failed to fetch source ${source.name}:`, e.message);
            throw e;
        }

        // 4. 解析内容
        let channels = [];
        try {
            if (source.type === 'json' || source.url.endsWith('.json')) {
                channels = this.parseJson(content);
            } else {
                channels = this.parseM3u(content);
            }
        } catch (e) {
            console.error(`[TvService] Failed to parse content for ${source.name}:`, e);
            throw new Error('Invalid format: ' + e.message);
        }

        // 5. 存入缓存
        console.log(`[TvService] Parsed ${channels.length} channels from ${source.name}`);
        sourceCache.set(cacheKey, { data: channels, timestamp: Date.now() });

        // 更新数据库最后检测时间
        db.prepare('UPDATE tv_sources SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sourceId);

        return channels;
    }

    /**
     * 解析 M3U 格式
     * 支持 #EXTINF:-1 tvg-id="" tvg-name="" tvg-logo="" group-title="",Channel Name
     * http://stream-url
     */
    parseM3u(content) {
        const lines = content.split(/\r?\n/);
        const channels = [];
        let currentChannel = {};

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (line.startsWith('#EXTINF:')) {
                // 解析元数据
                currentChannel = {};

                // 提取 group-title
                const groupMatch = line.match(/group-title="([^"]*)"/);
                if (groupMatch) currentChannel.group = groupMatch[1];
                else currentChannel.group = '其他';

                // 提取 logo
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                if (logoMatch) currentChannel.logo = logoMatch[1];

                // 提取名称 (在逗号后面)
                const nameParts = line.split(',');
                if (nameParts.length > 1) {
                    currentChannel.name = nameParts[nameParts.length - 1].trim();
                } else {
                    currentChannel.name = 'Unknown';
                }
            } else if (!line.startsWith('#')) {
                // 认为是 URL
                if (currentChannel.name) {
                    currentChannel.url = line;
                    channels.push({ ...currentChannel });
                    currentChannel = {}; // 重置
                }
            }
        }
        return channels;
    }

    /**
     * 解析 JSON 格式
     * 适配 iptv-api json 格式:
     * [{"name": "...", "url": "..." }, ...] 或
     * [{"group": "...", "channels": [...]}]
     */
    parseJson(content) {
        try {
            const data = JSON.parse(content);
            const channels = [];

            if (Array.isArray(data)) {
                // 递归查找所有带有 name 和 url 的对象
                const extractChannels = (items, groupName = '默认') => {
                    for (const item of items) {
                        if (item.url && item.name) {
                            channels.push({
                                name: item.name,
                                url: item.url,
                                group: item.group || groupName,
                                logo: item.logo || ''
                            });
                        } else if (item.channels && Array.isArray(item.channels)) {
                            // 嵌套分组
                            extractChannels(item.channels, item.group || item.name || groupName);
                        }
                    }
                };
                extractChannels(data);
            }
            return channels;
        } catch (e) {
            console.error('[TvService] JSON Parse Error:', e);
            return [];
        }
    }

    /**
     * 管理接口：获取源列表
     */
    getAllSources() {
        const db = getDatabase();
        return db.all('SELECT * FROM tv_sources ORDER BY sort_order ASC, id ASC');
    }

    addSource(source) {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO tv_sources (name, url, type, sort_order, enabled)
            VALUES (@name, @url, @type, @sort_order, @enabled)
        `);
        return stmt.run(source);
    }

    updateSource(id, source) {
        const db = getDatabase();
        const updates = [];
        const params = { id };

        ['name', 'url', 'type', 'sort_order', 'enabled'].forEach(key => {
            if (source[key] !== undefined) {
                updates.push(`${key} = @${key}`);
                params[key] = source[key];
            }
        });

        if (updates.length > 0) {
            const sql = `UPDATE tv_sources SET ${updates.join(', ')} WHERE id = @id`;
            return db.prepare(sql).run(params);
        }
        return { changes: 0 };
    }

    deleteSource(id) {
        const db = getDatabase();
        return db.prepare('DELETE FROM tv_sources WHERE id = ?').run(id);
    }
}

module.exports = new TvService();
