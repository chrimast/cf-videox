const { getDatabase } = require('../database');
const fetch = require('node-fetch');

class LiveService {
    /**
     * 获取所有直播源
     */
    getAllSources() {
        const db = getDatabase();
        return db.all('SELECT * FROM live_sources ORDER BY sort_order ASC, id ASC');
    }

    /**
     * 添加直播源
     */
    addSource(data) {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO live_sources (name, platform, channel_id, streamer_name, category, cover_url, enabled, sort_order, tags, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        return stmt.run([
            data.name,
            data.platform,
            data.channel_id,
            data.streamer_name || null,
            data.category || null,
            data.cover_url || null,
            data.enabled !== undefined ? data.enabled : 1,
            data.sort_order || 0,
            data.tags || null,
            data.remark || null
        ]);
    }

    /**
     * 更新直播源
     */
    updateSource(id, data) {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (data.name !== undefined) {
            fields.push('name = ?');
            values.push(data.name);
        }
        if (data.platform !== undefined) {
            fields.push('platform = ?');
            values.push(data.platform);
        }
        if (data.channel_id !== undefined) {
            fields.push('channel_id = ?');
            values.push(data.channel_id);
        }
        if (data.streamer_name !== undefined) {
            fields.push('streamer_name = ?');
            values.push(data.streamer_name);
        }
        if (data.category !== undefined) {
            fields.push('category = ?');
            values.push(data.category);
        }
        if (data.cover_url !== undefined) {
            fields.push('cover_url = ?');
            values.push(data.cover_url);
        }
        if (data.enabled !== undefined) {
            fields.push('enabled = ?');
            values.push(data.enabled);
        }
        if (data.sort_order !== undefined) {
            fields.push('sort_order = ?');
            values.push(data.sort_order);
        }
        if (data.tags !== undefined) {
            fields.push('tags = ?');
            values.push(data.tags);
        }
        if (data.remark !== undefined) {
            fields.push('remark = ?');
            values.push(data.remark);
        }

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        const stmt = db.prepare(`UPDATE live_sources SET ${fields.join(', ')} WHERE id = ?`);
        return stmt.run(values);
    }

    /**
     * 删除直播源
     */
    deleteSource(id) {
        const db = getDatabase();
        const stmt = db.prepare('DELETE FROM live_sources WHERE id = ?');
        return stmt.run([id]);
    }

    /**
     * 获取所有直播状态
     */
    getAllStatus() {
        const db = getDatabase();
        return db.all(`
            SELECT ls.*, lsc.is_live, lsc.title, lsc.viewer_count, lsc.stream_url, lsc.cover_url as current_cover, lsc.avatar_url as current_avatar, lsc.updated_at as status_updated_at
            FROM live_sources ls
            LEFT JOIN live_status_cache lsc ON ls.id = lsc.source_id
            WHERE ls.enabled = 1
            ORDER BY ls.sort_order ASC, ls.id ASC
        `);
    }

    /**
     * 获取指定直播源的状态
     */
    getStatus(sourceId) {
        const db = getDatabase();
        return db.get(`
            SELECT ls.*, lsc.is_live, lsc.title, lsc.viewer_count, lsc.stream_url, lsc.cover_url as current_cover, lsc.avatar_url as current_avatar, lsc.updated_at as status_updated_at
            FROM live_sources ls
            LEFT JOIN live_status_cache lsc ON ls.id = lsc.source_id
            WHERE ls.id = ?
        `, [sourceId]);
    }

    /**
     * 更新直播状态缓存
     */
    updateStatusCache(sourceId, status) {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO live_status_cache (source_id, is_live, title, viewer_count, stream_url, cover_url, avatar_url, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        return stmt.run([
            sourceId,
            status.is_live ? 1 : 0,
            status.title || null,
            status.viewer_count || null,
            status.stream_url || null,
            status.cover_url || null,
            status.avatar_url || null
        ]);
    }

    /**
     * 检查直播状态（根据平台）
     */
    async checkLiveStatus(source) {
        try {
            let status = null;

            switch (source.platform) {
                case 'bilibili':
                    status = await this.checkBilibiliLive(source.channel_id);
                    break;
                case 'douyin':
                    status = await this.checkDouyinLive(source.channel_id);
                    break;
                case 'douyu':
                    status = await this.checkDouyuLive(source.channel_id);
                    break;
                case 'huya':
                    status = await this.checkHuyaLive(source.channel_id);
                    break;
                // 其他平台暂未实现
                default:
                    console.log(`[LiveService] Platform ${source.platform} not supported yet`);
                    return null;
            }

            if (status) {
                this.updateStatusCache(source.id, status);

                // 如果获取到封面且当前没有封面，自动更新
                if (status.cover_url && !source.cover_url) {
                    console.log(`[LiveService] Auto-updating cover for ${source.name}: ${status.cover_url}`);
                    this.updateSource(source.id, { cover_url: status.cover_url });
                }
            }

            return status;
        } catch (error) {
            console.error(`[LiveService] Error checking live status for ${source.name}:`, error);
            return null;
        }
    }

    /**
     * B站直播状态检测
     */
    async checkBilibiliLive(roomId) {
        try {
            // 1. 获取房间基本信息 (标题、封面、在线人数)
            const roomUrl = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`;
            const roomResponse = await fetch(roomUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const roomData = await roomResponse.json();

            // 2. 获取主播基本信息 (头像)
            const userUrl = `https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${roomId}`;
            const userResponse = await fetch(userUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const userData = await userResponse.json();

            if (roomData.code === 0 && roomData.data) {
                return {
                    is_live: roomData.data.live_status === 1,
                    title: roomData.data.title || '',
                    viewer_count: roomData.data.online || 0,
                    stream_url: `https://live.bilibili.com/${roomId}`,
                    platform: 'bilibili',
                    channel_id: roomId,
                    cover_url: roomData.data.keyframe || roomData.data.user_cover || null,
                    avatar_url: userData?.data?.info?.face || null
                };
            }
            return null;
        } catch (error) {
            console.error(`[LiveService] Bilibili API error for room ${roomId}:`, error);
            return null;
        }
    }

    /**
     * 抖音直播状态检测
     * 通过访问直播页面获取状态信息和直播流地址
     */
    async checkDouyinLive(roomId) {
        try {
            // 访问抖音直播页面获取信息
            const url = `https://live.douyin.com/${roomId}`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            const html = await response.text();

            // 提取直播流地址 - 采用更通俗的全局匹配策略
            let streamUrl = null;
            let hlsUrl = null;

            console.log(`[LiveService] Douyin ${roomId}: Parsing HTML (length: ${html.length})...`);

            // 匹配所有可能是直播流的链接
            const allUrls = html.match(/https?[:\/\\]+[^"&'<>]+(\.flv|\.m3u8)[^"&'<> ]*/g) || [];

            for (let rawUrl of allUrls) {
                // 解码各种可能的转义
                let decodedUrl = rawUrl
                    .replace(/\\u0026/g, '&')
                    .replace(/&amp;/g, '&')
                    .replace(/\\/g, '');

                if (decodedUrl.includes('douyincdn.com')) {
                    if (decodedUrl.includes('.flv') && !streamUrl) {
                        streamUrl = decodedUrl;
                    } else if (decodedUrl.includes('.m3u8') && !hlsUrl) {
                        hlsUrl = decodedUrl;
                    }
                }
            }

            if (streamUrl) console.log(`[LiveService] Douyin ${roomId}: Found FLV URL`);
            if (hlsUrl) console.log(`[LiveService] Douyin ${roomId}: Found HLS URL`);

            // 判断是否正在直播 - 如果有流地址就是在播
            const isLive = !!streamUrl || !!hlsUrl;

            // 提取主播名称
            let title = '';
            const titleMatch = html.match(/"nickname":"([^"]+)"/);
            if (titleMatch) {
                title = titleMatch[1];
            }

            // 提取直播间标题
            let roomTitle = '';
            const roomTitleMatch = html.match(/"title":"([^"]+)"/);
            if (roomTitleMatch) {
                roomTitle = roomTitleMatch[1];
            }

            // 提取封面和头像 (从 data-config 或 data-anchor-info)
            let coverUrl = null;
            let avatarUrl = null;

            // 1. 尝试从 data-config 提取 (最高优先，信息最全)
            const configMatch = html.match(/data-config="([^"]+)"/);
            if (configMatch) {
                try {
                    const configStr = configMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                    const config = JSON.parse(configStr);
                    // 封面：poster 字段
                    if (config.poster) coverUrl = config.poster.replace(/&amp;/g, '&');
                    if (!coverUrl && config.basicPlayerProps?.poster) {
                        coverUrl = config.basicPlayerProps.poster.replace(/&amp;/g, '&');
                    }

                    // 头像：anchorInfo 字段
                    if (config.anchorInfo?.avatar) avatarUrl = config.anchorInfo.avatar.replace(/&amp;/g, '&');
                    if (!avatarUrl && config.playerAction?.anchorInfo?.avatar) {
                        avatarUrl = config.playerAction.anchorInfo.avatar.replace(/&amp;/g, '&');
                    }
                } catch (e) { }
            }

            // 2. 尝试从 data-anchor-info 提取头像
            if (!avatarUrl) {
                const anchorMatch = html.match(/data-anchor-info="([^"]+)"/);
                if (anchorMatch) {
                    try {
                        const anchorInfo = JSON.parse(anchorMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
                        avatarUrl = anchorInfo.avatar;
                        if (avatarUrl) avatarUrl = avatarUrl.replace(/&amp;/g, '&');
                    } catch (e) { }
                }
            }

            // 3. 兜底正则提取封面 (匹配包含 resize:0:0 的任何链接)
            if (!coverUrl) {
                const coverRegex = html.match(/"(https?[:\/\\]+[^"&'<>]+resize:0:0[^"&'<>]*)"/);
                if (coverRegex) {
                    coverUrl = coverRegex[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                }
            }

            // 4. 兜底正则提取头像 (匹配包含 resize:100:100 的任何链接)
            if (!avatarUrl) {
                const avatarRegex = html.match(/"(https?[:\/\\]+[^"&'<>]+resize:100:100[^"&'<>]*)"/);
                if (avatarRegex) {
                    avatarUrl = avatarRegex[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                }
            }

            // 提取观看人数
            let viewerCount = 0;
            const viewerMatch = html.match(/"user_count_str":"([^"]+)"/);
            if (viewerMatch) {
                const countStr = viewerMatch[1];
                if (countStr.includes('万')) {
                    viewerCount = parseFloat(countStr) * 10000;
                } else {
                    viewerCount = parseInt(countStr) || 0;
                }
            }

            console.log(`[LiveService] Douyin ${roomId}: isLive=${isLive}, streamUrl=${streamUrl ? 'found' : 'not found'}`);

            console.log(`[LiveService] Douyin ${roomId}: Scraping result - isLive: ${isLive}, Title: ${roomTitle || title}, Avatar: ${avatarUrl ? 'Found' : 'Not found'}, Cover: ${coverUrl ? 'Found' : 'Not found'}`);

            return {
                is_live: isLive,
                title: roomTitle || title,
                viewer_count: viewerCount,
                stream_url: streamUrl || hlsUrl || url,
                hls_url: hlsUrl,
                flv_url: streamUrl,
                platform: 'douyin',
                channel_id: roomId,
                cover_url: coverUrl,
                avatar_url: avatarUrl
            };
        } catch (error) {
            console.error(`[LiveService] Douyin check error for room ${roomId}:`, error);
            return null;
        }
    }

    /**
     * 斗鱼直播状态检测
     */
    async checkDouyuLive(roomId) {
        try {
            // 1. 获取基本信息 (API方式)
            const apiUrl = `https://open.douyucdn.cn/api/RoomApi/room/${roomId}`;
            const apiRes = await fetch(apiUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const apiData = await apiRes.json();

            let status = {
                is_live: false,
                title: '',
                viewer_count: 0,
                stream_url: `https://www.douyu.com/${roomId}`,
                platform: 'douyu',
                channel_id: roomId,
                cover_url: null,
                avatar_url: null
            };

            if (apiData.error === 0 && apiData.data) {
                status.is_live = apiData.data.room_status === '1';
                status.title = apiData.data.room_name || '';
                status.viewer_count = parseInt(apiData.data.online || 0);
                status.cover_url = apiData.data.room_thumb || null;
                status.avatar_url = apiData.data.avatar || null;
            }

            // 2. 尝试获取直播流 (移动端解析模式)
            // 斗鱼直播流提取较为复杂，这里尝试通过分享页获取简单的 HLS 流
            if (status.is_live) {
                try {
                    const shareUrl = `https://m.douyu.com/${roomId}`;
                    const shareRes = await fetch(shareUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
                        }
                    });
                    const html = await shareRes.text();

                    // 尝试匹配 HLS 地址
                    const hlsMatch = html.match(/\"hls_url\":\"([^\"]+)\"/);
                    if (hlsMatch) {
                        status.hls_url = hlsMatch[1].replace(/\\/g, '');
                    }
                } catch (e) {
                    console.warn(`[LiveService] Douyu stream parse failed for ${roomId}:`, e.message);
                }
            }

            return status;
        } catch (error) {
            console.error(`[LiveService] Douyu API error for room ${roomId}:`, error);
            return null;
        }
    }

    /**
     * 虎牙直播状态检测（简化版，实际可能需要更复杂的解析）
     */
    async checkHuyaLive(roomId) {
        try {
            // 虎牙没有公开API，这里提供一个基本框架
            // 实际使用可能需要爬虫或第三方服务
            console.log(`[LiveService] Huya live check for ${roomId} - not fully implemented`);
            return {
                is_live: false,
                title: '',
                viewer_count: 0,
                stream_url: `https://www.huya.com/${roomId}`
            };
        } catch (error) {
            console.error(`[LiveService] Huya check error for room ${roomId}:`, error);
            return null;
        }
    }

    /**
     * 获取真实播放地址
     */
    async getPlayUrl(sourceId) {
        const source = await this.getStatus(sourceId);
        if (!source) return null;

        const platform = (source.platform || '').toLowerCase();

        // 如果是抖音，尝试实时提取最新流地址
        if (platform === 'douyin') {
            const status = await this.checkDouyinLive(source.channel_id);
            if (status && status.is_live) {
                if (status.flv_url) return { url: status.flv_url, type: 'flv', is_live: true };
                if (status.hls_url) return { url: status.hls_url, type: 'm3u8', is_live: true };
            }
            return { url: `https://live.douyin.com/${source.channel_id}`, type: 'iframe' };
        }

        // 如果是斗鱼，直接使用专用的 H5 播放页面
        if (platform === 'douyu') {
            return {
                url: `https://www.douyu.com/topic/h5show?room_id=${source.channel_id}`,
                type: 'iframe'
            };
        }

        // B站处理
        if (platform === 'bilibili') {
            if (!source.is_live) return null;
            return await this.getBilibiliStreamUrl(source.channel_id);
        }

        // 默认处理
        if (!source.is_live) return null;
        return { url: source.stream_url, type: 'link' };
    }

    /**
     * B站真实流地址解析
     */
    async getBilibiliStreamUrl(roomId) {
        try {
            // 首先通过 room_id 获取真实 room_id (避免短号)
            const roomInfoUrl = `https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`;
            const roomInfoRes = await fetch(roomInfoUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://live.bilibili.com/'
                }
            });
            const roomInfo = await roomInfoRes.json();

            if (roomInfo.code !== 0 || !roomInfo.data) {
                console.error(`[LiveService] Bilibili room_init failed for ${roomId}:`, roomInfo.message);
                return null;
            }

            const realRoomId = roomInfo.data.room_id;

            // 获取播放地址 - 使用更稳定的 v1 API
            const url = `https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${realRoomId}&qn=10000&platform=web`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': `https://live.bilibili.com/${realRoomId}`
                }
            });
            const data = await response.json();

            if (data.code === 0 && data.data && data.data.durl && data.data.durl.length > 0) {
                const finalUrl = data.data.durl[0].url;
                return {
                    url: finalUrl,
                    type: finalUrl.includes('.m3u8') ? 'm3u8' : 'flv',
                    is_live: true
                };
            }

            console.error(`[LiveService] Bilibili playUrl API error for ${realRoomId}:`, data.message);
            return null;
        } catch (error) {
            console.error(`[LiveService] Bilibili stream parse error for room ${roomId}:`, error);
            return null;
        }
    }

    /**
     * 批量刷新所有直播状态
     */
    async refreshAllStatus() {
        const sources = await this.getAllSources();
        const enabledSources = sources.filter(s => s.enabled === 1);
        const results = [];

        for (const source of enabledSources) {
            const status = await this.checkLiveStatus(source);
            results.push({ source_id: source.id, status });
        }

        return results;
    }
}

module.exports = new LiveService();
