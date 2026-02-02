/**
 * 多视频源搜索路由
 * 实现跨源搜索和换源功能
 */
const express = require('express');
const router = express.Router();
const { CmsApiParser } = require('../services/CmsApiParser');
const { getSystemProxyAgent } = require('../utils/fetch-agent');

// 获取数据库实例
let db = null;
const getDb = () => {
    if (!db) {
        const Database = require('better-sqlite3');
        const path = require('path');
        const dbPath = process.env.VIDEO_DB_PATH || path.join(process.cwd(), 'data', 'video.db');
        db = new Database(dbPath);
    }
    return db;
};

/**
 * GET /search
 * 搜索同名视频的多个源
 * 
 * @param {string} title - 视频标题
 * @param {number} exclude_source_id - 排除的源ID（当前播放的源）
 * @param {number} episode_index - 当前播放的集数索引（可选，用于匹配）
 * @param {string} type_name - 视频类型名称（如"电影"、"电视剧"等，用于过滤）
 * @param {number} year - 年份（可选，用于精确匹配）
 */
router.get('/search', async (req, res) => {
    try {
        const { title, exclude_source_id, episode_index, type_name, year } = req.query;

        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: title'
            });
        }

        const excludeId = parseInt(exclude_source_id) || 0;
        const epIndex = parseInt(episode_index) || 0;
        const videoYear = year ? String(year) : null;

        // 判断是否为电影类型（电影通常只有1集）
        const isMovie = type_name && (
            type_name.includes('电影') ||
            type_name.includes('剧场') ||
            type_name.includes('动作片') ||
            type_name.includes('喜剧片') ||
            type_name.includes('恐怖片') ||
            type_name.includes('科幻片') ||
            type_name.includes('爱情片') ||
            type_name.includes('剧情片') ||
            type_name.includes('战争片') ||
            type_name.includes('纪录片')
        );

        console.log(`[MultiSource] Searching for "${title}", type="${type_name}", isMovie=${isMovie}, excluding source ${excludeId}`);

        // 获取所有启用的视频源
        const database = getDb();
        const sources = database.prepare(`
            SELECT id, name, url, proxy_enabled, response_time 
            FROM video_sources 
            WHERE enabled = 1 AND id != ?
        `).all(excludeId);

        console.log(`[MultiSource] Found ${sources.length} alternative sources to search`);

        const { stream } = req.query;

        // 如果开启流式搜索
        if (stream === 'true' || stream === '1') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof res.flushHeaders === 'function') res.flushHeaders();

            const searchPromises = sources.map(async (source) => {
                try {
                    const agent = source.proxy_enabled ? getSystemProxyAgent() : null;
                    const parser = new CmsApiParser(source.url, agent);
                    const searchResult = await parser.search(title, 1, 10);

                    const normalizedTitle = normalizeTitle(title);
                    const matchedVideo = searchResult.list.find(v => {
                        const videoTitle = normalizeTitle(v.vod_name);
                        return videoTitle === normalizedTitle ||
                            videoTitle.includes(normalizedTitle) ||
                            normalizedTitle.includes(videoTitle);
                    });

                    if (!matchedVideo) {
                        await trackSourceHealth(source.id, true); // 搜索成功但没发现匹配视频，也算源正常
                        return;
                    }

                    const detail = await parser.getVideoDetail(matchedVideo.vod_id);
                    if (!detail || !detail.episodes || detail.episodes.length === 0) {
                        await trackSourceHealth(source.id, false, '详情获取失败');
                        return;
                    }

                    // 记录成功
                    await trackSourceHealth(source.id, true);

                    const totalEpisodes = detail.episodes.reduce((sum, ep) => sum + (ep.list?.length || 0), 0);
                    const alt = {
                        source_id: source.id,
                        source_name: source.name,
                        response_time: source.response_time,
                        quality: extractQuality(detail.vod_remarks || matchedVideo.vod_remarks),
                        vod_id: matchedVideo.vod_id,
                        vod_name: detail.vod_name,
                        vod_pic: detail.vod_pic,
                        episodes: detail.episodes,
                        total_episodes: totalEpisodes,
                        current_episode_available: checkEpisodeAvailable(detail.episodes, epIndex)
                    };

                    res.write(`data: ${JSON.stringify(alt)}\n\n`);
                    if (typeof res.flush === 'function') res.flush();
                } catch (error) {
                    console.error(`[MultiSource/Stream] Error source ${source.name}:`, error.message);
                    await trackSourceHealth(source.id, false, error.message);
                }
            });

            await Promise.all(searchPromises);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }

        // 非流式搜索（原逻辑）
        const searchPromises = sources.map(async (source) => {
            try {
                // ... (原有搜索逻辑保持不变)
                const agent = source.proxy_enabled ? getSystemProxyAgent() : null;
                const parser = new CmsApiParser(source.url, agent);
                const searchResult = await parser.search(title, 1, 10);

                if (!searchResult.list || searchResult.list.length === 0) {
                    await trackSourceHealth(source.id, false, '搜索结果为空');
                    return null;
                }

                const normalizedTitle = normalizeTitle(title);
                const matchedVideo = searchResult.list.find(v => {
                    const videoTitle = normalizeTitle(v.vod_name);
                    return videoTitle === normalizedTitle ||
                        videoTitle.includes(normalizedTitle) ||
                        normalizedTitle.includes(videoTitle);
                });

                if (!matchedVideo) {
                    await trackSourceHealth(source.id, true); // 搜索成功但无对应资源
                    return null;
                }

                const detail = await parser.getVideoDetail(matchedVideo.vod_id);
                if (!detail || !detail.episodes || detail.episodes.length === 0) {
                    await trackSourceHealth(source.id, false, '获取详情失败');
                    return null;
                }

                await trackSourceHealth(source.id, true);
                return {
                    source_id: source.id,
                    source_name: source.name,
                    response_time: source.response_time,
                    quality: extractQuality(detail.vod_remarks || matchedVideo.vod_remarks),
                    vod_id: matchedVideo.vod_id,
                    vod_name: detail.vod_name,
                    vod_pic: detail.vod_pic,
                    episodes: detail.episodes,
                    total_episodes: detail.episodes.reduce((sum, ep) => sum + (ep.list?.length || 0), 0),
                    current_episode_available: checkEpisodeAvailable(detail.episodes, epIndex)
                };
            } catch (error) {
                await trackSourceHealth(source.id, false, error.message);
                return null;
            }
        });

        const results = await Promise.all(searchPromises);
        const alternatives = results.filter(r => r !== null);
        res.json({ success: true, data: alternatives });

    } catch (error) {
        console.error('[MultiSource] Search failed:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * 记录源的健康状态
 * @param {number} sourceId 源ID
 * @param {boolean} isSuccess 是否成功
 * @param {string} message 错误消息
 */
async function trackSourceHealth(sourceId, isSuccess, message = '') {
    try {
        const database = getDb();
        if (isSuccess) {
            database.prepare('UPDATE video_sources SET failure_count = 0, status_message = NULL WHERE id = ?').run(sourceId);
        } else {
            // 增加失败计数
            const source = database.prepare('SELECT failure_count, name FROM video_sources WHERE id = ?').get(sourceId);
            if (!source) return;

            const newCount = (source.failure_count || 0) + 1;
            let updateSql = 'UPDATE video_sources SET failure_count = ?, status_message = ?, updated_at = CURRENT_TIMESTAMP';

            // 如果连续失败达到阈值（如5次），自动隐藏
            if (newCount >= 5) {
                updateSql += ', hidden = 1';
                console.warn(`[MultiSource] Source "${source.name}" (ID: ${sourceId}) hidden due to ${newCount} consecutive failures.`);
            }

            updateSql += ' WHERE id = ?';
            database.prepare(updateSql).run(newCount, message, sourceId);
        }
    } catch (err) {
        console.error('[MultiSource] Failed to track source health:', err.message);
    }
}

/**
 * 标准化标题用于匹配
 * 移除特殊字符、空格、括号内容等
 */
function normalizeTitle(title) {
    if (!title) return '';
    return title
        .toLowerCase()
        .replace(/\s+/g, '')           // 移除空格
        .replace(/[（(].*?[)）]/g, '')  // 移除括号内容
        .replace(/[：:]/g, '')          // 移除冒号
        .replace(/[，,。.！!？?]/g, '') // 移除标点
        .replace(/\d+$/g, '')           // 移除末尾数字（如"xxx2"）
        .trim();
}

/**
 * 检查指定集数是否在剧集列表中可用
 */
function checkEpisodeAvailable(episodes, episodeIndex) {
    if (!episodes || episodes.length === 0) return false;

    // 检查第一个播放源的对应集数
    const firstSource = episodes[0];
    if (!firstSource || !firstSource.list) return false;

    return episodeIndex < firstSource.list.length;
}

/**
 * 从备注中提取清晰度信息
 */
function extractQuality(remarks) {
    if (!remarks) return '';
    const text = remarks.toUpperCase();
    if (text.includes('4K') || text.includes('2160P')) return '4K';
    if (text.includes('1080P')) return '1080P';
    if (text.includes('720P')) return '720P';
    if (text.includes('BD') || text.includes('蓝光')) return '蓝光';
    if (text.includes('HD') || text.includes('高清')) return 'HD';
    if (text.includes('TS') || text.includes('TC')) return '抢先版';
    return remarks.length > 8 ? remarks.substring(0, 8) + '...' : remarks;
}

module.exports = router;
