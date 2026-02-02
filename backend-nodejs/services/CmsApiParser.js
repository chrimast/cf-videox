const fetch = require('node-fetch');

/**
 * CMS API 解析器
 * 支持苹果 CMS V10 标准 API 格式
 */
class CmsApiParser {
    constructor(baseUrl, agent = null) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
        this.agent = agent;
    }

    /**
     * 发送 API 请求
     */
    async request(params = {}) {
        const url = new URL(this.baseUrl);

        // 添加默认参数
        params.ac = params.ac || 'list';

        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, String(value));
            }
        }

        console.log(`[CmsApiParser] Requesting: ${url.toString()} ${this.agent ? '(via proxy)' : ''}`);

        try {
            const response = await fetch(url.toString(), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                },
                timeout: 10000,
                agent: this.agent
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`[CmsApiParser] Request failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取分类列表
     */
    async getCategories() {
        try {
            const data = await this.request({ ac: 'list' });

            // 苹果 CMS V10 返回格式
            // { class: [{ type_id, type_name, type_pid }, ...] }
            const categories = data.class || [];

            console.log(`[CmsApiParser] Found ${categories.length} categories`);
            return categories;
        } catch (error) {
            console.error('[CmsApiParser] Failed to get categories:', error);
            throw error;
        }
    }

    /**
     * 获取视频列表
     * @param {Object} options
     * @param {number} options.categoryId - 分类ID
     * @param {number} options.page - 页码
     * @param {number} options.limit - 每页数量
     */
    async getVideos(options = {}) {
        try {
            const { categoryId, page = 1, limit = 20 } = options;

            const params = {
                ac: 'detail', // 使用 detail 获取更多信息
                pg: page
            };

            if (categoryId) {
                params.t = categoryId;
            }

            const data = await this.request(params);

            // 标准化返回格式
            return {
                list: (data.list || []).map(item => this.normalizeVideo(item)),
                page: data.page || page,
                pagecount: data.pagecount || 1,
                limit: data.limit || limit,
                total: data.total || 0
            };
        } catch (error) {
            console.error('[CmsApiParser] Failed to get videos:', error);
            throw error;
        }
    }

    /**
     * 获取视频详情
     * @param {string} vodId - 视频ID
     */
    async getVideoDetail(vodId) {
        try {
            const data = await this.request({
                ac: 'detail',
                ids: vodId
            });

            if (!data.list || data.list.length === 0) {
                return null;
            }

            return this.normalizeVideoDetail(data.list[0]);
        } catch (error) {
            console.error('[CmsApiParser] Failed to get video detail:', error);
            throw error;
        }
    }

    /**
     * 搜索视频
     * @param {string} keyword - 搜索关键词
     * @param {number} page - 页码
     * @param {number} limit - 每页数量
     */
    async search(keyword, page = 1, limit = 20) {
        try {
            const data = await this.request({
                ac: 'detail',
                wd: keyword,
                pg: page
            });

            // 增加过滤逻辑：部分资源站在无搜索结果时会返回“最新视频”，这里进行二次匹配确保关联度
            const rawList = (data.list || []).map(item => this.normalizeVideo(item));
            const filteredList = rawList.filter(item => {
                if (!keyword) return true;
                const lowerKeyword = keyword.toLowerCase();
                const lowerName = (item.vod_name || '').toLowerCase();
                return lowerName.includes(lowerKeyword);
            });

            console.log(`[CmsApiParser] Search Filter (${this.baseUrl}): keyword="${keyword}", original=${rawList.length}, filtered=${filteredList.length}`);

            return {
                list: filteredList,
                page: data.page || page,
                pagecount: data.pagecount || 1,
                limit: data.limit || limit,
                total: data.total || 0
            };
        } catch (error) {
            console.error('[CmsApiParser] Search failed:', error);
            throw error;
        }
    }

    /**
     * 标准化视频信息（列表）
     */
    normalizeVideo(item) {
        return {
            vod_id: item.vod_id,
            vod_name: item.vod_name,
            vod_pic: item.vod_pic,
            vod_year: item.vod_year,
            vod_area: item.vod_area,
            vod_lang: item.vod_lang,
            vod_class: item.vod_class,
            vod_remarks: item.vod_remarks, // 更新至第几集
            vod_time: item.vod_time,
            vod_score: item.vod_score || item.vod_douban_score,
            type_id: item.type_id,
            type_name: item.type_name,
            vod_actor: item.vod_actor
        };
    }

    /**
     * 标准化视频详情
     */
    normalizeVideoDetail(item) {
        const episodes = this.parseEpisodes(item.vod_play_url, item.vod_play_from);

        return {
            vod_id: item.vod_id,
            vod_name: item.vod_name,
            vod_pic: item.vod_pic,
            vod_year: item.vod_year,
            vod_area: item.vod_area,
            vod_lang: item.vod_lang,
            vod_class: item.vod_class,
            vod_remarks: item.vod_remarks,
            vod_time: item.vod_time,
            vod_score: item.vod_score || item.vod_douban_score,
            vod_content: this.stripHtml(item.vod_content || item.vod_blurb || ''),
            vod_actor: item.vod_actor,
            vod_director: item.vod_director,
            vod_writer: item.vod_writer,
            vod_duration: item.vod_duration,
            type_id: item.type_id,
            type_name: item.type_name,
            // 播放源和集数
            vod_play_from: item.vod_play_from,
            vod_play_url: item.vod_play_url,
            episodes: episodes
        };
    }

    /**
     * 检查 URL 是否为有效的直接视频流
     * 参考 MoonTV：只接受 m3u8, mp4, flv, mkv 等直接视频格式
     */
    isValidVideoUrl(url) {
        if (!url || typeof url !== 'string') return false;

        // 必须是 http/https URL
        if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

        // 有效的视频流格式
        const validExtensions = ['.m3u8', '.mp4', '.flv', '.mkv', '.webm', '.ts', '.avi'];
        const urlLower = url.toLowerCase();

        // 检查文件扩展名
        for (const ext of validExtensions) {
            if (urlLower.includes(ext)) return true;
        }

        // 检查常见的 HLS/流媒体路径标识
        const hlsIndicators = ['/hls/', '/m3u8/', 'type=m3u8', '.m3u8', '/live/', '/stream/'];
        for (const indicator of hlsIndicators) {
            if (urlLower.includes(indicator)) return true;
        }

        return false;
    }

    /**
     * 解析播放地址
     * vod_play_from: "线路1$$$线路2"
     * vod_play_url: "第1集$url1#第2集$url2$$$第1集$url3#第2集$url4"
     * 
     * 参考 MoonTV：过滤非直接视频流 URL
     */
    parseEpisodes(playUrl, playFrom) {
        if (!playUrl) return [];

        const sources = (playFrom || '').split('$$$');
        const urlGroups = playUrl.split('$$$');

        const episodes = [];

        for (let i = 0; i < urlGroups.length; i++) {
            const sourceName = sources[i] || `线路${i + 1}`;
            const episodeList = urlGroups[i].split('#').filter(Boolean);

            const sourceEpisodes = episodeList.map(ep => {
                const [name, url] = ep.split('$');
                return {
                    name: name || '播放',
                    url: url || '',
                    // 标记是否为有效的直接视频流
                    isValid: this.isValidVideoUrl(url)
                };
            }).filter(ep => ep.url); // 过滤掉无 URL 的项

            // 只添加有有效视频的播放源
            // 如果该源完全没有有效链接，则跳过
            const validEpisodes = sourceEpisodes.filter(ep => ep.isValid);

            if (validEpisodes.length > 0) {
                episodes.push({
                    source: sourceName,
                    list: validEpisodes.map(ep => ({
                        name: ep.name,
                        url: ep.url
                    }))
                });
            }
        }

        return episodes;
    }

    /**
     * 移除 HTML 标签
     */
    stripHtml(html) {
        return html.replace(/<[^>]*>/g, '').trim();
    }
}

module.exports = { CmsApiParser };
