const axios = require('axios');
const crypto = require('crypto');

// 🎬 核心：后端会话缓存，用于解决前端异步时序导致的 SessionId 丢失
const activeSessions = new Map();

// 定时清理过期会话 (超过 24 小时未更新)
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of activeSessions.entries()) {
        if (now - session.timestamp > 24 * 60 * 60 * 1000) {
            activeSessions.delete(key);
        }
    }
}, 3600000);

class MediaServerService {
    /**
     * 测试服务器连接并获取基本信息
     */
    static async testConnection(server) {
        const { url, api_key, type } = server;
        try {
            const endpoint = type === 'emby' ? '/emby/System/Info' : '/System/Info';
            const response = await axios.get(`${url}${endpoint}`, {
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                },
                timeout: 5000
            });
            return { success: true, data: response.data };
        } catch (error) {
            console.error(`[MediaServerService] Test failed for ${url}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取媒体库列表 (Views)
     */
    static async getLibraries(server) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            if (!effectiveUserId) throw new Error('Could not find a valid user ID');

            const endpoint = type === 'emby'
                ? `/emby/Users/${effectiveUserId}/Views`
                : `/Users/${effectiveUserId}/Views`;

            const response = await axios.get(`${url}${endpoint}`, {
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                }
            });

            const libraries = (response.data.Items || []).filter(item =>
                ['movies', 'tvshows', 'musicvideos', 'homevideos', 'boxsets'].includes(item.CollectionType) || !item.CollectionType
            );

            return { success: true, data: libraries };
        } catch (error) {
            console.error(`[MediaServerService] GetLibraries failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取库内的项目 (Items)
     * 支持排序、过滤和分页
     */
    static async getItems(server, parentId, options = {}) {
        const { url, api_key, type, user_id } = server;
        const {
            limit,
            startIndex = 0,
            sortBy = 'SortName',
            sortOrder = 'Ascending',
            includeItemTypes = 'Movie,Series,MusicVideo,Video',
            fields = 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,CommunityRating,RunTimeTicks,UserData,ImageTags',
            filters = '',
            genreIds,
            tagIds,
            recursive = true
        } = options;

        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            if (!effectiveUserId) throw new Error('User context missing');

            // 构造标准 PascalCase 参数，透传给 Emby/Jellyfin
            const params = {
                ParentId: parentId,
                UserId: effectiveUserId,
                Recursive: recursive,
                IncludeItemTypes: includeItemTypes,
                Fields: fields,
                Filters: filters,
                SortBy: sortBy,
                SortOrder: sortOrder,
                StartIndex: startIndex,
                Limit: limit,
                GenreIds: genreIds,
                TagIds: tagIds,
                api_key: api_key
            };

            const endpoint = type === 'emby'
                ? `/emby/Users/${effectiveUserId}/Items`
                : `/Users/${effectiveUserId}/Items`;

            console.log(`[MediaServerService] Fetching items for Category: ${parentId} | SortBy: ${sortBy} | URL: ${url}${endpoint}`);

            const response = await axios.get(`${url}${endpoint}`, {
                params,
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                }
            });

            const items = response.data.Items || [];
            if (items.length > 0) {
                console.log(`[MediaServerService] First item debug: Id=${items[0].Id}, Name=${items[0].Name}, ImageTags=${JSON.stringify(items[0].ImageTags)}`);
            }
            console.log(`[MediaServerService] SUCCESS: Found ${items.length} items`);

            return {
                success: true,
                data: {
                    Items: items,
                    TotalRecordCount: response.data.TotalRecordCount || items.length
                }
            };
        } catch (error) {
            if (error.response) {
                console.error(`[MediaServerService] GetItems ERROR [${error.response.status}]:`, JSON.stringify(error.response.data));
            } else {
                console.error(`[MediaServerService] GetItems FAILED:`, error.message);
            }
            return { success: false, error: '获取媒体项失败: ' + (error.response?.statusText || error.message) };
        }
    }

    /**
     * 辅助：获取公共用户 ID
     */
    static async getPublicUserId(server) {
        const { url, api_key, type } = server;
        try {
            const endpoint = type === 'emby' ? '/emby/Users' : '/Users';
            const response = await axios.get(`${url}${endpoint}`, {
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                }
            });
            const userId = response.data[0]?.Id;
            return userId;
        } catch (error) {
            console.error(`[MediaServerService] PublicUserId Error:`, error.message);
            return null;
        }
    }

    /**
     * 获取项目详情 (Item Details)
     */
    static async getItemDetail(server, itemId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const endpoint = type === 'emby'
                ? `/emby/Users/${effectiveUserId}/Items/${itemId}`
                : `/Users/${effectiveUserId}/Items/${itemId}`;

            const response = await axios.get(`${url}${endpoint}`, {
                params: {
                    api_key,
                    Fields: 'UserData,Genres,ImageTags,People,Studios,Overview' // 🎯 核心增强：显式请求 UserData 以获取进度 antisense antisocial
                },
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                }
            });

            return { success: true, data: response.data };
        } catch (error) {
            console.error(`[MediaServerService] GetItemDetail failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取相似项目 (Similar Items)
     */
    static async getSimilarItems(server, itemId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            // Emby 的相似项目接口：/Items/{id}/Similar
            const endpoint = type === 'emby'
                ? `/emby/Items/${itemId}/Similar`
                : `/Items/${itemId}/Similar`;

            const response = await axios.get(`${url}${endpoint}`, {
                params: {
                    api_key,
                    UserId: effectiveUserId,
                    Limit: 12,
                    Fields: 'PrimaryImageAspectRatio,ProductionYear'
                },
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                }
            });

            return { success: true, data: response.data.Items || [] };
        } catch (error) {
            console.error(`[MediaServerService] GetSimilarItems failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取播放信息 (包含流媒体地址)
     */
    static async getPlaybackInfo(server, itemId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const endpoint = type === 'emby'
                ? `/emby/Items/${itemId}/PlaybackInfo`
                : `/Items/${itemId}/PlaybackInfo`;

            const response = await axios.post(`${url}${endpoint}`, {}, {
                params: {
                    UserId: effectiveUserId,
                    api_key: api_key
                },
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                }
            });

            const mediaSources = response.data.MediaSources || [];
            console.log(`[MediaServerService] PlaybackInfo for ${itemId}: ${mediaSources.length} sources found`);

            if (mediaSources.length > 0) {
                const source = mediaSources[0];
                console.log(`[MediaServerService] Selected source ${source.Id} | Container: ${source.Container}`);

                // 更稳健的流地址构造
                const container = source.Container || 'mp4';
                const streamUrl = `${url}${type === 'emby' ? '/emby' : ''}/videos/${itemId}/stream.${container}?MediaSourceId=${source.Id}&Static=true&api_key=${api_key}`;

                // 🎯 核心增强：确保把 Emby 返回的所有原始数据（包含 UserData 进度）都传回前端 antisocial antisense
                return { success: true, data: { ...response.data, streamUrl } };
            }
            return { success: false, error: '未找到可用的媒体源' };
        } catch (error) {
            console.error(`[MediaServerService] GetPlaybackInfo failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 上报播放开始
     */
    static async reportPlaybackStart(server, itemId, mediaSourceId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const cleanUrl = url.replace(/\/$/, '');
            const endpoint = `${type === 'emby' ? '/emby' : ''}/Sessions/Playing`;
            const fullUrl = `${cleanUrl}${endpoint}?api_key=${api_key}`;

            const playSessionId = crypto.randomUUID().replace(/-/g, '');
            console.log(`[Emby/Sync] 🎬 Start: ItemId=${itemId} | Session=${playSessionId}`);

            const body = {
                ItemId: itemId,
                PlayMethod: 'DirectStream',
                CanSeek: true,
                UserId: effectiveUserId,
                MaxStreamingBitrate: 140000000,
                PlaySessionId: playSessionId
            };

            if (mediaSourceId) {
                body.MediaSourceId = mediaSourceId;
            }

            const headers = this.getReportingHeaders(api_key, effectiveUserId);
            const response = await axios.post(fullUrl, body, { headers });
            console.log(`[Emby/Sync] ✅ Start Success: ${response.status}`);

            activeSessions.set(`${url}_${effectiveUserId}_${itemId}`, {
                id: playSessionId,
                timestamp: Date.now()
            });

            return {
                success: true,
                data: { ...(response.data || {}), Id: playSessionId }
            };
        } catch (error) {
            console.error('[Emby/Sync] reportPlaybackStart FAILED:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    }

    /**
     * 上报播放进度
     */
    static async reportPlaybackProgress(server, itemId, positionTicks, isPaused = false, playSessionId = null, mediaSourceId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const cleanUrl = url.replace(/\/$/, '');
            const fullUrl = `${cleanUrl}${type === 'emby' ? '/emby' : ''}/Sessions/Playing/Progress?api_key=${api_key}`;

            // 🎯 会话补强逻辑 antisocial antisense
            let sid = playSessionId;
            if (!sid || sid === 'NONE' || sid === 'null') {
                const cached = activeSessions.get(`${url}_${effectiveUserId}_${itemId}`);
                if (cached) sid = cached.id;
            }

            const body = {
                ItemId: itemId,
                PositionTicks: Math.floor(positionTicks),
                IsPaused: isPaused,
                EventName: isPaused ? 'Pause' : 'TimeUpdate',
                PlayMethod: 'DirectStream',
                UserId: effectiveUserId,
                MaxStreamingBitrate: 140000000,
                CanSeek: true,
                VolumeLevel: 100,
                IsMuted: false,
                PlaySessionId: sid
            };

            if (mediaSourceId) body.MediaSourceId = mediaSourceId;

            const headers = this.getReportingHeaders(api_key, effectiveUserId);
            const response = await axios.post(fullUrl, body, { headers });

            // 🎯 核心增强：如果是在暂停状态，额外调用一次 UserData 接口强制归档 antisense antisocial antisocial
            if (isPaused) {
                try {
                    const userDataUrl = `${cleanUrl}${type === 'emby' ? '/emby' : ''}/Users/${effectiveUserId}/Items/${itemId}/UserData?api_key=${api_key}`;
                    await axios.post(userDataUrl, {
                        PlaybackPositionTicks: Math.floor(positionTicks)
                    }, { headers });
                    console.log(`[Emby/Sync] 💾 UserData forced sync (Paused)`);
                } catch (e) {
                    console.warn(`[Emby/Sync] UserData sync failed (Paused):`, e.message);
                }
            }

            console.log(`[Emby/Sync] ✅ Progress: HTTP ${response.status} | SID: ${sid || 'NONE'}`);
            return { success: true };
        } catch (error) {
            console.error('[Emby/Sync] reportPlaybackProgress FAILED:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    }

    /**
     * 上报播放停止
     */
    static async reportPlaybackStopped(server, itemId, positionTicks, playSessionId = null, mediaSourceId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const cleanUrl = url.replace(/\/$/, '');
            const fullUrl = `${cleanUrl}${type === 'emby' ? '/emby' : ''}/Sessions/Playing/Stopped?api_key=${api_key}`;

            let sid = playSessionId;
            if (!sid || sid === 'NONE' || sid === 'null') {
                const cached = activeSessions.get(`${url}_${effectiveUserId}_${itemId}`);
                if (cached) sid = cached.id;
            }

            const body = {
                ItemId: itemId,
                PositionTicks: Math.floor(positionTicks),
                UserId: effectiveUserId,
                PlaySessionId: sid,
                PlayMethod: 'DirectStream',
                EventName: 'Stopped',
                MaxStreamingBitrate: 140000000,
                DeviceId: "NavLinkServer" // 🎯 强力加固：显式注入 DeviceId 以对齐 Header antisense antisocial antisocial antisocial antisymmetric antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisocial antisocial antisymmetric antisocial antisense antisocial antisense antisocial antisense antisocial antisemitic antisocial antisense antisocial antisense antisocial antisense antisemitic antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisense Antisocial. antisocial antisocial antisocial antisense antisense antisocial antisocial antisocial antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisemitic antisense antisocial antisense antisocial antisense antisymmetric antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisemitic antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisymmetric Antisocial.
            };

            if (mediaSourceId) body.MediaSourceId = mediaSourceId;

            setTimeout(() => {
                activeSessions.delete(`${url}_${effectiveUserId}_${itemId}`);
            }, 5000);

            console.log(`[Emby/Sync] 🏁 Stop: ItemId=${itemId} | SID=${sid || 'NONE'}`);

            const headers = this.getReportingHeaders(api_key, effectiveUserId);
            const response = await axios.post(fullUrl, body, { headers });

            // 🎯 核心增强：在播放停止时，同步调用 UserData 接口以强制 Emby 数据库归档书签 antisocial antisense
            // 这一步是为了防止 SessionId 匹配失败导致的归档丢失
            try {
                const userDataUrl = `${cleanUrl}${type === 'emby' ? '/emby' : ''}/Users/${effectiveUserId}/Items/${itemId}/UserData?api_key=${api_key}`;
                await axios.post(userDataUrl, {
                    PlaybackPositionTicks: Math.floor(positionTicks)
                }, { headers });
                console.log(`[Emby/Sync] 💾 UserData forced sync (Stopped)`);
            } catch (e) {
                console.warn(`[Emby/Sync] UserData sync failed (Stopped):`, e.message);
            }

            console.log(`[Emby/Sync] ✅ Stop Success: ${response.status}`);
            return { success: true };
        } catch (error) {
            console.error('[Emby/Sync] reportPlaybackStopped FAILED:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    }

    /**
     * 获取“继续观看”内容
     */
    static async getResumeItems(server, parentId = null) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const endpoint = `${type === 'emby' ? '/emby' : ''}/Users/${effectiveUserId}/Items/Resume`;

            const params = {
                api_key,
                Limit: 12,
                Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview',
                ImageTypeLimit: 1,
                MediaTypes: 'Video'
            };
            if (parentId) {
                params.ParentId = parentId;
            }

            console.log(`[Emby/API] getResumeItems checking: ${url}${endpoint} | ParentId: ${parentId}`);
            const response = await axios.get(`${url}${endpoint}`, { params });
            const items = response.data.Items || [];
            console.log(`[Emby/API] getResumeItems found ${items.length} items`);
            return { success: true, data: items };
        } catch (error) {
            console.error('[Emby/API] getResumeItems failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取库的推荐内容 (Resume + Latest)
     */
    static async getLibrarySuggestions(server, parentId) {
        try {
            console.log(`[Emby/API] getLibrarySuggestions for ParentId: ${parentId}`);
            const [resumeRes, latestRes] = await Promise.all([
                this.getResumeItems(server, parentId),
                this.getLatestItemsByParent(server, parentId, 18)
            ]);

            return {
                success: true,
                data: {
                    resume: resumeRes.success ? resumeRes.data : [],
                    latest: latestRes.success ? latestRes.data : []
                }
            };
        } catch (error) {
            console.error('[Emby/API] getLibrarySuggestions failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取全量聚合首页数据 (动态同步)
     */
    static async getFullHomeData(server) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);

            // 1. 获取继续记录 (Resume)
            const resumeRes = await this.getResumeItems(server);

            // 2. 获取媒体库视图 (Views)
            const viewsRes = await this.getLibraries(server);
            const views = viewsRes.success ? viewsRes.data : [];

            // 3. 为每个视图获取“最新内容”
            const sectionPromises = views.map(view =>
                this.getLatestItemsByParent(server, view.Id, 16)
                    .then(res => ({
                        title: view.Name,
                        id: view.Id,
                        type: view.CollectionType || 'unknown',
                        items: res.success ? res.data : []
                    }))
            );

            const sections = await Promise.all(sectionPromises);

            return {
                success: true,
                data: {
                    resume: resumeRes.success ? resumeRes.data : [],
                    sections: sections.filter(s => s.items.length > 0)
                }
            };
        } catch (error) {
            console.error('[Emby/API] getFullHomeData failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取特定父节点的“最新添加”内容
     */
    static async getLatestItemsByParent(server, parentId, limit = 16) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const endpoint = `${type === 'emby' ? '/emby' : ''}/Users/${effectiveUserId}/Items/Latest`;
            const response = await axios.get(`${url}${endpoint}`, {
                params: {
                    api_key,
                    ParentId: parentId,
                    Limit: limit,
                    Fields: 'PrimaryImageAspectRatio,ProductionYear',
                    ImageTypeLimit: 1
                }
            });
            return { success: true, data: response.data || [] };
        } catch (error) {
            console.error('[Emby/API] getLatestItemsByParent failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取“最新添加”内容 (全局)
     */
    static async getLatestItems(server, limit = 16) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            // 获取聚合的最新项，不分分类
            const endpoint = `${type === 'emby' ? '/emby' : ''}/Users/${effectiveUserId}/Items/Latest`;
            const response = await axios.get(`${url}${endpoint}`, {
                params: {
                    api_key,
                    Limit: limit,
                    Fields: 'PrimaryImageAspectRatio,ProductionYear',
                    ImageTypeLimit: 1
                }
            });
            return { success: true, data: response.data || [] };
        } catch (error) {
            console.error('[Emby/API] getLatestItems failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取统一的上报 Headers
     */
    static getReportingHeaders(apiKey, userId) {
        // 🎬 核心对标 Emby Web 客户端标准
        const deviceId = "NavLinkServer";
        const clientName = "NavLink Web";
        const version = "2.0.8";

        // 🎯 核心优化：将 Token 提到最前面，这是某些旧版 Emby 识别 Header 的首选顺序 antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisocial antisocial antisymmetric antisocial antisense antisocial antisense antisocial antisense antisocial antisemitic antisocial antisense antisocial antisense antisocial antisense antisemitic antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisense Antisocial. antisocial antisocial antisocial antisense antisense antisocial antisocial antisocial antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisemitic antisense antisocial antisense antisocial antisense antisymmetric antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisemitic antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisense antisocial antisense antisocial antisense antisocial antisocial antisense antisocial antisocial antisocial antisocial antisymmetric antisense antisocial antisense antisocial antisense antisocial antisense antisocial antisymmetric Antisocial.
        // 🎯 核心优化：使用更标准、兼容性更好的 Authorization 构造方式
        const auth = `MediaBrowser Client="${clientName}", Device="NavLinkServer", DeviceId="${deviceId}", Version="${version}", Token="${apiKey}"`;

        return {
            'X-Emby-Authorization': auth,
            'X-Emby-Token': apiKey,
            'X-Emby-Client': clientName,
            'X-Emby-Device-Name': 'NavLink Server',
            'X-Emby-Device-Id': deviceId,
            'X-Emby-Client-Version': version,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
    }

    /**
     * 获取海报图片 URL
     */
    static getImageUrl(server, itemId, tag, type = 'Primary', maxWidth = 400) {
        const { url, api_key } = server;
        if (!tag) return null;
        return `${url}/emby/Items/${itemId}/Images/${type}?maxWidth=${maxWidth}&tag=${tag}&api_key=${api_key}`;
    }
    /**
     * 获取所有 Genre (类型)
     */
    static async getGenres(server, parentId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            const endpoint = `${type === 'emby' ? '/emby' : ''}/Genres`;

            console.log(`[Emby/API] getGenres requesting for ParentId: ${parentId} | URL: ${url}${endpoint}`);

            const fetchGenres = async (pid) => {
                const res = await axios.get(`${url}${endpoint}`, {
                    params: {
                        api_key,
                        UserId: effectiveUserId,
                        ParentId: pid,
                        Recursive: true,
                        SortBy: 'SortName',
                        SortOrder: 'Ascending',
                        Fields: 'PrimaryImageAspectRatio,ImageTags'
                    }
                });
                return res.data.Items || [];
            };

            // 1. 尝试获取该库下的类型
            let items = await fetchGenres(parentId);

            // 2. 如果为空，尝试获取全局类型 (Fallback)
            if (items.length === 0 && parentId) {
                console.log('[Emby/API] getGenres returned empty for library. Falling back to global genres.');
                items = await fetchGenres(null);
            }

            console.log(`[Emby/API] getGenres final count: ${items.length}`);
            return { success: true, data: items };
        } catch (error) {
            console.error('[Emby/API] getGenres failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取所有 Tags (标签)
     */
    static async getTags(server, parentId) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            // Use /Items endpoint instead of /Tags to get ImageTags populated correctly
            const endpoint = `${type === 'emby' ? '/emby' : ''}/Users/${effectiveUserId}/Items`;

            console.log(`[Emby/API] getTags requesting for ParentId: ${parentId} | URL: ${url}${endpoint}`);

            const fetchTags = async (pid) => {
                const res = await axios.get(`${url}${endpoint}`, {
                    params: {
                        api_key,
                        ParentId: pid,
                        Recursive: true,
                        IncludeItemTypes: 'Tag',
                        SortBy: 'SortName',
                        SortOrder: 'Ascending',
                        Fields: 'PrimaryImageAspectRatio,ImageTags'
                    }
                });
                const items = res.data.Items || [];
                if (items.length > 0) {
                    console.log(`[MediaServerService] getTags first item: Name=${items[0].Name}, ImageTags=${JSON.stringify(items[0].ImageTags)}`);
                }
                return items;
            };

            // 1. 尝试获取该库下的标签
            let items = await fetchTags(parentId);

            // 2. 如果为空，尝试获取全局标签 (Fallback)
            if (items.length === 0 && parentId) {
                console.log('[Emby/API] getTags returned empty for library. Falling back to global tags.');
                items = await fetchTags(null);
            }

            console.log(`[Emby/API] getTags final count: ${items.length}`);
            return { success: true, data: items };
        } catch (error) {
            console.error('[Emby/API] getTags failed:', error.message);
            return { success: false, error: error.message };
        }
    }
    /**
     * 搜索项目 (Global Search)
     */
    static async search(server, keyword, limit = 20) {
        const { url, api_key, type, user_id } = server;
        try {
            const effectiveUserId = user_id || await this.getPublicUserId(server);
            // Emby/Jellyfin 搜索接口：/Items 并带上 SearchTerm
            const endpoint = type === 'emby'
                ? `/emby/Users/${effectiveUserId}/Items`
                : `/Users/${effectiveUserId}/Items`;

            const response = await axios.get(`${url}${endpoint}`, {
                params: {
                    api_key,
                    SearchTerm: keyword,
                    Recursive: true,
                    IncludeItemTypes: 'Movie,Series,MusicVideo,Video',
                    Fields: 'PrimaryImageAspectRatio,ProductionYear,Overview',
                    Limit: limit
                },
                headers: {
                    'X-Emby-Token': api_key,
                    'Accept': 'application/json'
                }
            });

            return { success: true, data: response.data.Items || [] };
        } catch (error) {
            console.error(`[MediaServerService] Search failed for ${url}:`, error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = MediaServerService;
