/**
 * FFmpeg 转码路由
 * 提供 STRM 视频的实时转码服务
 */
const express = require('express');
const router = express.Router();
const transcodeService = require('../services/TranscodeService');
const path = require('path');
const os = require('os');
const ffmpegInstaller = require('../services/FfmpegInstaller');

/**
 * 安装 FFmpeg (自动下载)
 * POST /install
 */
router.post('/install', async (req, res) => {
    try {
        // 异步开始安装，不阻塞响应
        ffmpegInstaller.install().catch(err => {
            console.error('[Transcode] Install error:', err);
        });
        res.json({ success: true, message: 'Installation started' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 获取安装进度
 * GET /install/status
 */
router.get('/install/status', (req, res) => {
    res.json({ success: true, data: ffmpegInstaller.getStatus() });
});

/**
 * 检测 FFmpeg 可用性
 * GET /detect?path=/custom/path/to/ffmpeg
 */
router.get('/detect', async (req, res) => {
    try {
        const { path: customPath } = req.query;
        const result = await transcodeService.detectFFmpeg(customPath);

        if (result.available) {
            const hwaccel = await transcodeService.detectHwAccel();
            result.hwaccel = hwaccel;
        }

        // 增加操作系统平台信息，方便前端判断是否显示安装按钮
        result.platform = os.platform(); // 'linux', 'darwin', 'win32' 等

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Transcode] Detect error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 启动转码会话
 * POST /start
 * Body: { url: string, quality?: 'fast'|'medium'|'high', hwaccel?: 'none'|'nvenc'|'qsv'|'vaapi' }
 */
router.post('/start', async (req, res) => {
    try {
        const { url, quality = 'medium', hwaccel = 'none', mediaId } = req.body;
        console.log(`[Transcode] Received start request for URL: ${url.substring(0, 80)}... (mediaId: ${mediaId || 'none'})`);
        const result = await transcodeService.startTranscode(url, { quality, hwaccel, mediaId });

        res.json({
            success: true,
            data: {
                sessionId: result.sessionId,
                playlistUrl: result.playUrl
            }
        });
    } catch (err) {
        console.error('[Transcode] Start failed:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 获取活跃的转码会话列表
 * GET /sessions
 */
router.get('/sessions', (req, res) => {
    try {
        const sessions = transcodeService.getActiveSessions();
        res.json({ success: true, data: sessions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 透明代理流接口 (Jellyfin 模式) 🚀 优先匹配
 * GET /:sessionId/stream
 */
router.get('/:sessionId/stream', async (req, res) => {
    const { sessionId } = req.params;
    const session = transcodeService.activeSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: '会话已过期或不存在' });
    }

    // 更新最后访问时间，防止播放中被 cleanup 清理
    session.lastAccess = Date.now();

    await transcodeService.proxyStream(session.inputUrl, req.headers, res);
});

/**
 * 停止转码会话
 * POST /:sessionId/stop
 */
router.post('/:sessionId/stop', async (req, res) => {
    const { sessionId } = req.params;
    try {
        await transcodeService.stopSession(sessionId);
        res.json({ success: true, message: '会话已停止' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 获取转码会话状态（进度）
 * GET /:sessionId/status
 */
router.get('/:sessionId/status', (req, res) => {
    const { sessionId } = req.params;
    try {
        const status = transcodeService.getSessionStatus(sessionId);
        if (!status) {
            return res.status(404).json({ success: false, error: '会话不存在' });
        }
        res.json({ success: true, data: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 获取转码文件 (m3u8 播放列表或 ts 分片)
 * GET /:sessionId/:filename
 */
router.get('/:sessionId/:filename', async (req, res) => {
    const { sessionId, filename } = req.params;

    // 安全检查：防止路径遍历
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ success: false, error: '非法文件名' });
    }

    // 处理 m3u8 播放列表请求
    if (filename === 'playlist.m3u8') {
        const filePath = await transcodeService.getFileAsync(sessionId, filename);
        if (!filePath) {
            return res.status(404).json({ success: false, error: '会话不存在或已过期' });
        }
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        return res.sendFile(filePath);
    }

    // 处理 ts 分片请求 - 按需转码
    const segmentMatch = filename.match(/^segment(\d+)\.ts$/);
    if (segmentMatch) {
        const segmentIndex = parseInt(segmentMatch[1], 10);
        try {
            const filePath = await transcodeService.requestSegment(sessionId, segmentIndex);
            res.setHeader('Content-Type', 'video/mp2t');
            res.setHeader('Cache-Control', 'max-age=3600');
            return res.sendFile(filePath);
        } catch (err) {
            console.error(`[Transcode] Segment ${segmentIndex} error:`, err.message);
            return res.status(503).json({ success: false, error: '分片转码中，请稍后重试' });
        }
    }

    // 其他文件类型
    const filePath = await transcodeService.getFileAsync(sessionId, filename);
    if (!filePath) {
        return res.status(404).json({ success: false, error: '文件不存在' });
    }
    res.sendFile(filePath);
});

/**
 * 手动清理过期会话
 * POST /cleanup
 */
router.post('/cleanup', (req, res) => {
    try {
        transcodeService.cleanup(req.body.maxAgeMs);
        res.json({ success: true, message: '清理完成' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Video 2.0: 播放决策 API
 * 前端传入客户端能力，后端返回最优播放策略
 * POST /play-decision
 * Body: { url: string, v_codec?: string, container?: string, clientCaps?: { canPlayH265?: boolean } }
 */
router.post('/play-decision', async (req, res) => {
    try {
        const { url, v_codec, container, clientCaps = {} } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: '缺少视频 URL' });
        }

        // 默认客户端能力
        const caps = {
            canPlayH265: clientCaps.canPlayH265 || false,
            canPlayMkv: clientCaps.canPlayMkv || false
        };

        const codec = (v_codec || '').toLowerCase();
        const cont = (container || '').toLowerCase();

        let decision = 'transcode'; // 默认转码
        let reason = '';

        // 决策逻辑
        if (codec === 'h264' || codec === 'avc1') {
            if (cont === 'mp4') {
                decision = 'direct';
                reason = 'H.264 + MP4 直接播放';
            } else if (cont === 'mkv') {
                if (caps.canPlayMkv) {
                    decision = 'direct';
                    reason = '客户端支持 MKV';
                } else {
                    decision = 'transmux';
                    reason = 'H.264 MKV 转封装为 MP4';
                }
            }
        } else if (codec === 'hevc' || codec === 'h265') {
            if (caps.canPlayH265) {
                if (cont === 'mp4') {
                    decision = 'direct';
                    reason = '客户端支持 H.265';
                } else {
                    decision = 'transmux';
                    reason = 'H.265 转封装为 MP4';
                }
            } else {
                decision = 'transcode';
                reason = '客户端不支持 H.265，需转码';
            }
        } else {
            decision = 'transcode';
            reason = '未知编码，需转码';
        }

        // 如果需要 transmux 或 transcode，启动会话
        let playUrl = url;
        let sessionId = null;

        if (decision !== 'direct') {
            const result = await transcodeService.startTranscode(url, {
                quality: 'medium',
                hwaccel: 'none',
                mediaId: req.body.mediaId,
                mediaInfo: v_codec ? { videoCodec: v_codec } : null
            });
            playUrl = result.playUrl;
            sessionId = result.sessionId;
        }

        res.json({
            success: true,
            data: {
                decision,
                reason,
                playUrl,
                sessionId
            }
        });
    } catch (err) {
        console.error('[Transcode] Play decision error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
