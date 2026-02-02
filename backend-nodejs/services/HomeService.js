/**
 * 首页聚合服务
 * 负责从多源聚合数据、去重、并缓存到数据库
 */
const { getDatabase } = require('../database');
const { CmsApiParser } = require('./CmsApiParser');
const { getSystemProxyAgent } = require('../utils/fetch-agent');

class HomeService {
    constructor() {
        this.cacheKeys = {
            HOT: 'home_hot',
            MOVIE_LATEST: 'home_movie_latest',
            TV_LATEST: 'home_tv_latest',
            ANIME_LATEST: 'home_anime_latest',
            VARIETY_LATEST: 'home_variety_latest'
        };

        // 核心板块配置
        this.sections = {
            movie: {
                base: ['电影', '片'],
                // 排除关键词：防止匹配到剧集、动漫等
                excludes: ['电视剧', '连续剧', '动漫', '综艺', '锦集', '剧集'],
                subs: {
                    action: ['动作'],
                    romance: ['爱情'],
                    comedy: ['喜剧'],
                    scifi: ['科幻'],
                    horror: ['恐怖'],
                    drama: ['剧情'],
                    war: ['战争'],
                    documentary: ['纪录'],
                    animation: ['动画电影'], // 特殊：动画电影不排斥“动画”字眼，需单独处理？暂且保留“动画”在excludes，但这里specific key match priority? 
                    // 修正：如果 excludes 包含“动画”，那么“动画电影”会被过滤吗？
                    // 会。所以 Movie 的 excludes 不能包含“动画”。
                    // 但这样“科幻动漫”会被“科幻”匹配到。
                    // 解决方案：动态 excludes。
                    crime: ['犯罪'],
                    fantasy: ['奇幻'],
                    suspense: ['悬疑'],
                    disaster: ['灾难']
                }
            },
            tv: {
                base: ['连续剧', '电视剧', '剧集'],
                excludes: ['片', '电影', '动漫', '动画', '综艺', '微电影'],
                subs: {
                    western: ['欧美', '美剧', '英剧'],
                    hk: ['香港', '港剧'],
                    kr: ['韩剧', '韩国'],
                    jp: ['日剧', '日本'],
                    sea: ['马泰', '泰剧'],
                    cn: ['国产', '内地', '大陆'],
                    tw: ['台湾', '台剧']
                }
            },
            anime: {
                base: ['动漫', '动画'],
                excludes: ['剧', '片', '电影', '综艺'],
                subs: {
                    cn: ['国漫', '国产动漫', '中国动漫'],
                    jp: ['日漫', '日本动漫'],
                    western: ['欧美动漫']
                }
            },
            variety: {
                base: ['综艺'],
                excludes: ['剧', '片', '电影', '动漫', '动画'],
                subs: {
                    cn: ['大陆综艺', '国产综艺'],
                    jp_kr: ['日韩综艺'],
                    hk_tw: ['港台综艺'],
                    western: ['欧美综艺']
                }
            }
        };
    }

    /**
     * 并发控制辅助函数
     */
    async limitConcurrent(tasks, limit) {
        const results = [];
        const executing = [];
        for (const task of tasks) {
            const p = Promise.resolve().then(() => task());
            results.push(p);
            if (limit <= tasks.length) {
                const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                executing.push(e);
                if (executing.length >= limit) {
                    await Promise.race(executing);
                }
            }
        }
        return Promise.all(results);
    }

    /**
     * 触发全量刷新
     * @param {Function} onUpdate 可选的回调函数，用于实时推送完成的板块
     */
    async refreshAll(onUpdate = null) {
        if (this.isRefreshing && !onUpdate) {
            console.log('[HomeService] Refresh already in progress, skipping background trigger...');
            return;
        }

        this.isRefreshing = true;
        const start = Date.now();

        try {
            console.log('[HomeService] Starting full refresh...');
            const db = getDatabase();

            // 获取所有启用且未隐藏的资源站
            let sources = db.all('SELECT * FROM video_sources WHERE enabled = 1 AND hidden = 0');

            // 检查是否有白名单设置
            const homeSourcesSetting = db.get("SELECT value FROM settings WHERE key = 'home_source_ids'");
            if (homeSourcesSetting && homeSourcesSetting.value) {
                try {
                    const whitelistIds = JSON.parse(homeSourcesSetting.value);
                    if (Array.isArray(whitelistIds) && whitelistIds.length > 0) {
                        const originalCount = sources.length;
                        sources = sources.filter(s => whitelistIds.includes(s.id));
                        console.log(`[HomeService] Applied whitelist: ${sources.length}/${originalCount} sources selected`);
                    }
                } catch (e) {
                    console.warn('[HomeService] Failed to parse home_source_ids:', e.message);
                }
            }

            if (sources.length === 0) {
                console.log('[HomeService] No enabled sources');
                return;
            }

            // --- 性能优化：预加载所有相关分类到内存 ---
            console.log('[HomeService] Preloading categories to memory...');
            const allCategories = db.all('SELECT * FROM categories WHERE source_id IN (' + sources.map(() => '?').join(',') + ')', sources.map(s => s.id));
            // 按 source_id 分组
            const categoryMap = new Map();
            allCategories.forEach(cat => {
                if (!categoryMap.has(cat.source_id)) {
                    categoryMap.set(cat.source_id, []);
                }
                categoryMap.get(cat.source_id).push(cat);
            });
            this.ctx = { categoryMap }; // 挂载到上下文中供子方法使用

            // 1. 刷新“正在热映” (通常最慢，优先开始)
            const hotPromise = this.refreshHot(sources, db).then(hot => {
                if (onUpdate) onUpdate('hot', null, hot);
                return hot;
            });

            // 2. 并行刷新其他四大板块
            const sectionPromises = [
                this.refreshSection('movie', sources, db, onUpdate),
                this.refreshSection('tv', sources, db, onUpdate),
                this.refreshSection('anime', sources, db, onUpdate),
                this.refreshSection('variety', sources, db, onUpdate)
            ];

            await Promise.all([hotPromise, ...sectionPromises]);

            this.ctx = null; // 清理上下文
            console.log(`[HomeService] Full refresh completed in ${(Date.now() - start) / 1000}s`);
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * 刷新“正在热映”
     */
    async refreshHot(sources, db) {
        console.log('[HomeService] Refreshing Hot...');
        const allVideos = [];

        // 使用并发控制请求所有源的最新数据
        const tasks = sources.map((source) => async () => {
            try {
                const agent = source.proxy_agent_enabled || source.proxy_enabled ? getSystemProxyAgent() : null;
                const parser = new CmsApiParser(source.url, agent);
                const result = await parser.getVideos({ page: 1, limit: 20 }); // 多抓一点用于去重
                if (result.list) {
                    return result.list.map(v => ({ ...v, source_id: source.id, source_name: source.name }));
                }
            } catch (e) {
                console.warn(`[HomeService] Failed to fetch hot from ${source.name}: ${e.message}`);
            }
            return [];
        });

        const results = await this.limitConcurrent(tasks, 10); // 限制 10 个并发源请求
        const movieConfig = this.sections.movie;

        results.forEach(list => {
            if (list) {
                // 应用电影板块的过滤逻辑
                const filtered = list.filter(v => {
                    const typeName = v.type_name || '';
                    // 必须包含“电影”相关关键词
                    const matchKw = movieConfig.base.some(k => typeName.includes(k));
                    if (!matchKw) return false;

                    // 不能包含排除词（如电视剧、综艺等）
                    const hasExclude = movieConfig.excludes.some(e => typeName.includes(e));
                    if (hasExclude) return false;

                    return true;
                });
                allVideos.push(...filtered);
            }
        });

        // 去重并排序
        const finalVideos = this.deduplicateAndSort(allVideos, 16);

        // 存入缓存
        this.saveCache(db, this.cacheKeys.HOT, finalVideos);
        return finalVideos;
    }

    /**
     * 刷新通用板块（电影/电视/动漫/综艺）及其子分类
     */
    async refreshSection(sectionKey, sources, db, onUpdate = null) {
        console.log(`[HomeService] Refreshing ${sectionKey}...`);
        const config = this.sections[sectionKey];
        if (!config) return;

        // 默认排除词
        let defaultExcludes = config.excludes || [];

        // 1. 刷新该板块的“最新” (LATEST)
        const latest = await this.refreshCategory(sources, db, `home_${sectionKey}_latest`, [...config.base], 16, defaultExcludes);
        if (onUpdate) onUpdate(sectionKey, 'latest', latest);

        // 2. 刷新所有子分类
        for (const [subKey, keywords] of Object.entries(config.subs)) {
            let currentExcludes = [...defaultExcludes];

            // 特殊处理：电影->动画电影 (animation)
            if (sectionKey === 'movie' && subKey === 'animation') {
                currentExcludes = currentExcludes.filter(e => e !== '动画');
            }

            const subData = await this.refreshCategory(sources, db, `home_${sectionKey}_${subKey}`, keywords, 16, currentExcludes);
            if (onUpdate) onUpdate(sectionKey, subKey, subData);
        }
    }

    /**
     * 刷新特定分类聚合
     * @param {string} cacheKey 缓存键名
     * @param {string[]} keywords 匹配分类的关键词数组 (只要匹配其中一个即可)
     * @param {number} limit
     * @param {string[]} excludes 排除关键词数组 (如果包含任意一个则排除)
     */
    async refreshCategory(sources, db, cacheKey, keywords, limit, excludes = []) {
        const allVideos = [];

        const tasks = sources.map((source) => async () => {
            try {
                // 1. 使用预加载的内存缓存查找匹配的分类ID列表
                const cats = (this.ctx && this.ctx.categoryMap)
                    ? (this.ctx.categoryMap.get(source.id) || [])
                    : db.all('SELECT type_id, name FROM categories WHERE source_id = ?', [source.id]);

                // 匹配逻辑：包含关键词之一 AND 不包含任何排除词
                const targetCatIds = cats
                    .filter(c => {
                        const name = c.name;
                        const matchKw = keywords.some(k => name.includes(k));
                        if (!matchKw) return false;

                        // 检查排除词
                        if (excludes.length > 0) {
                            const hasExclude = excludes.some(e => name.includes(e));
                            if (hasExclude) return false;
                        }

                        return true;
                    })
                    .map(c => c.type_id);

                if (targetCatIds.length === 0) return [];

                // 2. 并行抓取匹配分类的视频 (也加入并发控制)
                const catTasks = targetCatIds.map((tid) => async () => {
                    const agent = source.proxy_agent_enabled || source.proxy_enabled ? getSystemProxyAgent() : null;
                    const parser = new CmsApiParser(source.url, agent);
                    const res = await parser.getVideos({ categoryId: tid, page: 1, limit: 12 });
                    if (res.list) {
                        return res.list.map(v => ({ ...v, source_id: source.id, source_name: source.name }));
                    }
                    return [];
                });

                const catResults = await this.limitConcurrent(catTasks, 10);
                let videos = catResults.flat();

                // 二次过滤
                videos = videos.filter(v => {
                    const typeName = v.type_name || '';
                    const matchKw = keywords.some(k => typeName.includes(k));
                    if (!matchKw) return false;
                    if (excludes.length > 0) {
                        const hasExclude = excludes.some(e => typeName.includes(e));
                        if (hasExclude) return false;
                    }
                    return true;
                });

                return videos;

            } catch (e) {
                console.warn(`[HomeService] Failed to fetch ${cacheKey} from ${source.name}: ${e.message}`);
            }
            return [];
        });

        const results = await this.limitConcurrent(tasks, 10);
        results.forEach(list => { if (list) allVideos.push(...list); });

        // 去重
        const finalVideos = this.deduplicateAndSort(allVideos, limit);

        // 存缓存
        this.saveCache(db, cacheKey, finalVideos);
        return finalVideos;
    }

    /**
     * 去重与排序核心逻辑
     * 规则：
     * 1. 归一化标题（去标点、去括号、小写）
     * 2. 同一归一化标题，保留更新时间最新的
     * 3. 最终结果按更新时间倒序
     */
    deduplicateAndSort(videos, limit) {
        if (!videos || videos.length === 0) return [];

        // 1. 过滤掉没有封面的视频
        const withCover = videos.filter(v => v.vod_pic && v.vod_pic.trim() !== '');

        const map = new Map();

        for (const v of withCover) {
            const normalizedTitle = this.normalizeTitle(v.vod_name);
            const dateStr = v.vod_time || '2000-01-01 00:00:00';

            // 如果已存在，比较时间
            if (map.has(normalizedTitle)) {
                const existing = map.get(normalizedTitle);
                if (dateStr > (existing.vod_time || '')) {
                    map.set(normalizedTitle, v);
                }
            } else {
                map.set(normalizedTitle, v);
            }
        }

        const uniqueList = Array.from(map.values());

        // 排序
        uniqueList.sort((a, b) => {
            const ta = a.vod_time || '2000-01-01';
            const tb = b.vod_time || '2000-01-01';
            return tb.localeCompare(ta);
        });

        return uniqueList.slice(0, limit);
    }

    /**
     * 智能标题归一化
     * 移除语言、清晰度、年份等后缀，使相似标题能够去重
     * 例如：纵横四海国语4K 和 纵横四海粤语4K 归一化后相同
     */
    normalizeTitle(title) {
        if (!title) return '';
        let t = title;

        // 1. 移除清晰度标签
        t = t.replace(/(4K|1080[Pp]?|720[Pp]?|HD|BD|TC|TS|CAM|DVDRip|BluRay|蓝光|超清|高清|标清)/gi, '');

        // 2. 移除语言标签
        t = t.replace(/(国语|粤语|英语|日语|韩语|普通话|国配|原声|配音|中字|字幕|双语)/gi, '');

        // 3. 移除年份后缀（仅当在末尾时）
        t = t.replace(/(20\d{2}|19\d{2})$/g, '');

        // 4. 移除版本后缀
        t = t.replace(/(修复版|完整版|加长版|导演剪辑版|重制版|未删减版|删减版|院线版)/gi, '');

        // 5. 移除括号及其内容
        t = t.replace(/[（(].*?[)）]/g, '');
        t = t.replace(/[\[【].*?[\]】]/g, '');

        // 6. 移除标点和空格
        t = t.replace(/[：:，,。.！!？?·\-_\s]+/g, '');

        // 7. 转小写
        t = t.toLowerCase();

        return t.trim();
    }


    saveCache(db, key, data) {
        const json = JSON.stringify(data);
        db.prepare(`
            INSERT INTO home_cache (key, data, updated_at) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET 
                data = excluded.data, 
                updated_at = CURRENT_TIMESTAMP
        `).run(key, json);
    }

    /**
     * 刷新单个板块
     * @param {string} section - 'hot' | 'movie' | 'tv' | 'anime' | 'variety'
     * @returns {Promise<any>} - 刷新后的板块数据
     */
    async refreshSingleSection(section) {
        const db = getDatabase();

        // 获取所有启用且未隐藏的资源站
        let sources = db.all('SELECT * FROM video_sources WHERE enabled = 1 AND hidden = 0');

        // 检查是否有白名单设置
        const homeSourcesSetting = db.get("SELECT value FROM settings WHERE key = 'home_source_ids'");
        if (homeSourcesSetting && homeSourcesSetting.value) {
            try {
                const whitelistIds = JSON.parse(homeSourcesSetting.value);
                if (Array.isArray(whitelistIds) && whitelistIds.length > 0) {
                    sources = sources.filter(s => whitelistIds.includes(s.id));
                }
            } catch (e) {
                console.warn('[HomeService] Failed to parse home_source_ids:', e.message);
            }
        }

        if (sources.length === 0) {
            throw new Error('No enabled sources');
        }

        // 预加载分类
        const allCategories = db.all('SELECT * FROM categories WHERE source_id IN (' + sources.map(() => '?').join(',') + ')', sources.map(s => s.id));
        const categoryMap = new Map();
        allCategories.forEach(cat => {
            if (!categoryMap.has(cat.source_id)) {
                categoryMap.set(cat.source_id, []);
            }
            categoryMap.get(cat.source_id).push(cat);
        });
        this.ctx = { categoryMap };

        let result;

        try {
            if (section === 'hot') {
                result = await this.refreshHot(sources, db);
            } else {
                await this.refreshSection(section, sources, db);

                // 返回该板块的所有数据
                const config = this.sections[section];
                if (!config) {
                    throw new Error(`Invalid section: ${section}`);
                }

                result = {};
                // 读取最新数据
                const latestKey = `home_${section}_latest`;
                const latestRow = db.get('SELECT data FROM home_cache WHERE key = ?', [latestKey]);
                if (latestRow) {
                    try {
                        result.latest = JSON.parse(latestRow.data);
                    } catch (e) { }
                }

                // 读取所有子分类数据
                for (const subKey of Object.keys(config.subs)) {
                    const key = `home_${section}_${subKey}`;
                    const row = db.get('SELECT data FROM home_cache WHERE key = ?', [key]);
                    if (row) {
                        try {
                            result[subKey] = JSON.parse(row.data);
                        } catch (e) { }
                    }
                }
            }
        } finally {
            this.ctx = null;
        }

        return result;
    }
}

module.exports = new HomeService();
