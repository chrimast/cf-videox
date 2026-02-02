/**
 * 代理请求 API - 解决跨域问题
 */

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const fs = require('fs');

/**
 * 通用代理接口
 */
router.post('/', async (req, res) => {
    try {
        const { url, method = 'GET', headers = {}, body } = req.body;
        if (!url) return res.status(400).json({ success: false, error: '缺少 url 参数' });

        const fetchOptions = {
            method,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NavLink/1.0)', ...headers }
        };

        if (body && method !== 'GET') {
            fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            const data = await response.json();
            res.json({ success: true, data });
        } else {
            const text = await response.text();
            res.json({ success: true, data: text });
        }
    } catch (error) {
        console.error('[Proxy] Request failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const ImageCacheService = require('../services/ImageCacheService');

/**
 * 图片预览代理 (带本地缓存与压缩增强)
 */
router.get('/image', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('Missing url');

        // URL 解码与重新编码控制（解决 400/500 错误的核心：防止 # 丢失与双重编码）
        let safeUrl = url;
        try {
            let decoded = url;
            for (let i = 0; i < 3; i++) {
                const temp = decodeURIComponent(decoded);
                if (temp === decoded) break;
                decoded = temp;
            }
            // 核心修复：把路径中的 # 替换为 %23，防止 new URL() 将其识别为 Fragment 而丢弃
            const preparedUrl = decoded.replace(/#/g, '%23');
            safeUrl = new URL(preparedUrl).href;
        } catch (e) {
            // 极端情况下的兜底，如果已经有百分号编码则不轻易 encodeURI
            safeUrl = url.indexOf('%') !== -1 ? url : encodeURI(url).replace(/#/g, '%23');
        }

        // 优先使用后端缓存与压缩服务
        const cachePath = await ImageCacheService.getCachedImage(safeUrl);

        if (cachePath && fs.existsSync(cachePath)) {
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Content-Disposition', 'inline');
            res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30天
            return res.sendFile(cachePath);
        }

        // 降级：直接 Fetch 
        console.warn(`[ImageProxy] Cache failed for ${safeUrl.substring(0, 200)}, falling back to direct fetch.`);
        const response = await fetch(safeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });

        if (!response.ok) {
            return res.status(response.status).send('Fetch failed');
        }

        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=86400');

        response.body.pipe(res);
    } catch (error) {
        console.error(`[ImageProxy] Error: ${error.message}`);
        if (!res.headersSent) res.status(500).send(error.message);
    }
});

/**
 * HLS 代理 (m3u8/ts)
 * 核心功能：
 * 1. 代理 m3u8 文件，将其中的相对路径重写为代理 URL
 * 2. 代理 ts 分片文件
 * GET /api/proxy/hls?url=xxx
 */
router.get('/hls', async (req, res) => {
    let rawUrl = req.query.url;
    if (!rawUrl) return res.status(400).send('Missing url');

    // URL 解码修正
    let targetUrl = rawUrl;
    try {
        let decoded = rawUrl;
        for (let i = 0; i < 3; i++) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        }
        targetUrl = decoded;
    } catch (e) {
        targetUrl = rawUrl;
    }

    const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Referer': new URL(targetUrl).origin + '/'
    };

    try {
        // 跟随重定向获取最终 URL
        let currentUrl = targetUrl;
        let response;
        let redirectCount = 0;
        const maxRedirects = 10;

        while (redirectCount < maxRedirects) {
            response = await fetch(currentUrl, {
                headers: requestHeaders,
                redirect: 'manual',
                timeout: 30000
            });

            if ([301, 302, 303, 307, 308].includes(response.status)) {
                let location = response.headers.get('location');
                if (!location) break;
                if (!location.startsWith('http')) {
                    location = new URL(location, currentUrl).toString();
                }
                currentUrl = location;
                redirectCount++;
                continue;
            }
            break;
        }

        if (!response.ok) {
            return res.status(response.status).send(`Upstream error: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const content = await response.text();

        // 判断是否为 m3u8 文件
        const isM3u8 = contentType.includes('mpegurl') ||
            contentType.includes('m3u8') ||
            currentUrl.includes('.m3u8') ||
            content.trim().startsWith('#EXTM3U');

        if (isM3u8) {
            // 重写 m3u8 内容中的 URL
            const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1);
            const proxyBase = `/api/proxy/hls?url=`;

            const rewrittenContent = content.split('\n').map(line => {
                line = line.trim();
                // 跳过注释行和空行
                if (!line || line.startsWith('#')) {
                    // 但要处理 #EXT-X-KEY 等带 URI 的标签
                    if (line.includes('URI="')) {
                        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                            const fullUrl = uri.startsWith('http') ? uri : new URL(uri, baseUrl).toString();
                            return `URI="${proxyBase}${encodeURIComponent(fullUrl)}"`;
                        });
                    }
                    return line;
                }
                // 处理 URL 行
                const fullUrl = line.startsWith('http') ? line : new URL(line, baseUrl).toString();
                return `${proxyBase}${encodeURIComponent(fullUrl)}`;
            }).join('\n');

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(rewrittenContent);
        } else {
            // 非 m3u8 文件（如 ts 分片），直接转发
            res.setHeader('Content-Type', contentType || 'video/mp2t');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=3600');

            // 重新请求以获取二进制流
            const streamResponse = await fetch(currentUrl, {
                headers: requestHeaders,
                timeout: 30000
            });
            streamResponse.body.pipe(res);
        }
    } catch (error) {
        console.error('[HLS Proxy] Error:', error.message);
        if (!res.headersSent) res.status(500).send(error.message);
    }
});

/**
 * 视频流/二进制流透明代理 (核心修复版)
 * GET /api/proxy/stream?url=xxx
 */
router.get('/stream', async (req, res) => {
    let rawUrl = req.query.url;
    if (!rawUrl) return res.status(400).send('Missing url');

    // 1. URL 编码修正：回退到 decode-then-encode 策略，兼容 AList
    let targetUrl = rawUrl;
    try {
        let decoded = rawUrl;
        // 尝试解码多次，直到不再变化
        for (let i = 0; i < 3; i++) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        }
        // 对整条 URL 进行 encodeURI (保留 http:// 等)，并额外处理 # 号以防截断
        const parts = decoded.split('?');
        parts[0] = encodeURI(parts[0]).replace(/#/g, '%23');
        targetUrl = parts.join('?');
    } catch (e) {
        // Fallback
        targetUrl = encodeURI(decodeURIComponent(rawUrl)).replace(/#/g, '%23');
    }

    const maxRedirects = 10;
    let redirectCount = 0;
    let currentUrl = targetUrl;

    // 镜像请求头 (主要针对 Range)
    const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Accept-Encoding': 'identity'
    };
    if (req.headers.range) requestHeaders['Range'] = req.headers.range;

    try {
        let response;
        while (redirectCount < maxRedirects) {
            response = await fetch(currentUrl, {
                headers: requestHeaders,
                redirect: 'manual',
                timeout: 30000
            });

            if ([301, 302, 303, 307, 308].includes(response.status)) {
                let location = response.headers.get('location');
                if (!location) break;
                if (!location.startsWith('http')) {
                    location = new URL(location, currentUrl).toString();
                }
                currentUrl = location;
                redirectCount++;
                continue;
            }
            break;
        }

        // 转发所有关键响应头，实现透明代理
        res.status(response.status);

        const safeHeaders = [
            'content-type', 'content-length', 'content-range',
            'accept-ranges', 'last-modified', 'etag', 'cache-control'
        ];

        safeHeaders.forEach(h => {
            const v = response.headers.get(h);
            if (v) res.setHeader(h, v);
        });

        // 强行禁制下载：剥离 attachment，设为 inline
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // 补齐 Content-Type (如果缺失或为 octet-stream)
        let ct = res.getHeader('content-type') || '';
        if (!ct || ct.includes('octet-stream')) {
            const ext = currentUrl.split('?')[0].split('.').pop().toLowerCase();
            const mimeMap = { mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime' };
            res.setHeader('content-type', mimeMap[ext] || 'video/mp4');
        }

        response.body.pipe(res);

        req.on('close', () => {
            if (response.body.destroy) response.body.destroy();
        });
    } catch (error) {
        console.error('[Proxy] Final failure:', error.message);
        if (!res.headersSent) res.status(500).send(error.message);
    }
});

module.exports = router;
