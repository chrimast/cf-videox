const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const axios = require('axios');

class TranscodeService {
    constructor() {
        this.cacheDir = path.join(process.cwd(), 'data', 'transcode');
        this.activeSessions = new Map();
        this.segmentDuration = 10; // 10秒一个分片
        this.ffmpegPath = '';
        this.activePlaybacks = 0; // 当前活跃播放数 (用于后台任务避让)

        // 初始化
        this._init();
    }

    async _init() {
        if (!fsSync.existsSync(this.cacheDir)) {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } else {
            // 💡 启动时兜底：清空所有残留缓存
            try {
                const files = await fs.readdir(this.cacheDir);
                for (const file of files) {
                    await fs.rm(path.join(this.cacheDir, file), { recursive: true, force: true });
                }
                console.log('[Transcode] Startup cache cleared');
            } catch (e) {
                console.warn('[Transcode] Failed to clear startup cache:', e.message);
            }
        }
        await this.detectFFmpeg();

        // 🚨 启动时强制清除脏状态：重置播放计数和避让标志
        this.activePlaybacks = 0;
        const scanQueue = this.getScanQueueService();
        if (scanQueue && typeof scanQueue.setPausedByPlayback === 'function') {
            scanQueue.setPausedByPlayback(false);
            console.log('[Transcode] Startup: Force reset playback pause state');
        }

        // 启动定期清理
        setInterval(() => this.cleanup(), 60000);
    }

    /**
     * 获取 ScanQueueService 实例 (延迟加载以避免循环依赖)
     */
    getScanQueueService() {
        try {
            return require('./ScanQueueService').scanQueueService;
        } catch (e) {
            return null;
        }
    }

    async detectFFmpeg(customPath = '') {
        const pathsToTry = [
            customPath,
            process.env.FFMPEG_PATH,
            path.join(__dirname, '..', '..', 'data', 'bin', 'ffmpeg'), // 插件内置路径 (一键安装版) -> plugins/video/data/bin/ffmpeg
            'ffmpeg',
            '/usr/bin/ffmpeg',
            '/usr/local/bin/ffmpeg'
        ].filter(p => p);

        for (const p of pathsToTry) {
            try {
                const isAvail = await new Promise((resolve) => {
                    const proc = spawn(p, ['-version']);
                    proc.on('error', () => resolve(false));
                    proc.on('close', (code) => resolve(code === 0));
                });
                if (isAvail) {
                    this.ffmpegPath = p;
                    ffmpeg.setFfmpegPath(p);

                    // 🚀 同步设置 ffprobe 路径 (防止在某些环境下找不到 ffprobe)
                    // 逻辑：尝试在 ffmpeg 同级目录下找 ffprobe，或者直接用 'ffprobe'
                    const ffprobePath = p.replace(/ffmpeg$/, 'ffprobe');
                    try {
                        const isProbeAvail = await new Promise((resolve) => {
                            const proc = spawn(ffprobePath, ['-version']);
                            proc.on('error', () => resolve(false));
                            proc.on('close', (code) => resolve(code === 0));
                        });
                        if (isProbeAvail) {
                            ffmpeg.setFfprobePath(ffprobePath);
                            // console.log(`[Transcode] Using ffprobe: ${ffprobePath}`);
                        } else {
                            ffmpeg.setFfprobePath('ffprobe');
                        }
                    } catch (e) {
                        ffmpeg.setFfprobePath('ffprobe');
                    }

                    console.log(`[Transcode] Using FFmpeg: ${p}`);
                    return { available: true, path: p };
                }
            } catch (e) { }
        }
        return { available: false, error: 'FFmpeg not found' };
    }

    async detectHwAccel() {
        if (!this.ffmpegPath) return [];
        return new Promise((resolve) => {
            const proc = spawn(this.ffmpegPath, ['-hwaccels']);
            let output = '';
            proc.stdout.on('data', (data) => output += data);
            proc.on('close', () => {
                const accels = output.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.includes('Hardware acceleration methods:'));
                resolve(accels);
            });
        });
    }

    /**
     * 透明代理流 (模仿 Jellyfin Direct Stream/Proxy)
     */
    async proxyStream(inputUrl, reqHeaders, res) {
        console.log(`[Proxy] Start Request: ${inputUrl.substring(0, 100)}...`);
        console.log(`[Proxy] Incoming Range: ${reqHeaders.range || 'none'}`);

        try {
            const headers = {};
            if (reqHeaders.range) {
                headers['Range'] = reqHeaders.range;
            }
            headers['User-Agent'] = reqHeaders['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

            const response = await axios({
                method: 'get',
                url: inputUrl,
                headers,
                responseType: 'stream',
                timeout: 30000,
                validateStatus: null,
                maxRedirects: 5,
                decompress: false
            });

            if (response.status >= 400) {
                console.error(`[Proxy] Upstream Error: ${response.status} ${response.statusText}`);
                res.status(response.status).send(`Upstream server error: ${response.status}`);
                return;
            }

            res.status(response.status);
            const importantHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];
            importantHeaders.forEach(h => {
                if (response.headers[h]) res.setHeader(h, response.headers[h]);
            });

            if (!res.getHeader('Accept-Ranges')) {
                res.setHeader('Accept-Ranges', 'bytes');
            }

            response.data.pipe(res);
            res.on('close', () => {
                if (response.data && response.data.destroy) response.data.destroy();
            });
            response.data.on('error', (err) => {
                console.error('[Proxy] Stream data error:', err.message);
                res.end();
            });
        } catch (err) {
            console.error('[Proxy] Stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: '代理流访问失败' });
            }
        }
    }

    async getMediaInfo(url, headers = {}) {
        return new Promise((resolve, reject) => {
            ffmpeg(url)
                .inputOptions(Object.entries(headers).flatMap(([k, v]) => ['-headers', `${k}: ${v}`]))
                .ffprobe((err, data) => {
                    if (err) return reject(err);
                    const stream = data.streams.find(s => s.codec_type === 'video');
                    const audio = data.streams.find(s => s.codec_type === 'audio');
                    resolve({
                        duration: parseFloat(data.format.duration) || 0,
                        videoCodec: stream ? stream.codec_name : '',
                        audioCodec: audio ? audio.codec_name : '',
                        format: data.format.format_name,
                        width: stream ? stream.width : 0,
                        height: stream ? stream.height : 0
                    });
                });
        });
    }

    generateVodPlaylist(duration) {
        let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:12\n#EXT-X-PLAYLIST-TYPE:VOD\n';
        const count = Math.ceil(duration / this.segmentDuration);
        for (let i = 0; i < count; i++) {
            const actualDuration = (i === count - 1) ? (duration % this.segmentDuration || this.segmentDuration) : this.segmentDuration;
            playlist += `#EXTINF:${actualDuration.toFixed(3)},\nsegment${i}.ts\n`;
        }
        playlist += '#EXT-X-ENDLIST\n';
        return playlist;
    }

    async startTranscode(inputUrl, options = {}) {
        const { quality = 'medium', hwaccel = 'none', headers = {} } = options;
        const sessionId = crypto.createHash('md5').update(inputUrl + quality + hwaccel).digest('hex').slice(0, 12);

        if (this.activeSessions.has(sessionId)) {
            const session = this.activeSessions.get(sessionId);
            session.lastAccess = Date.now();
            return {
                sessionId,
                playMethod: session.playMethod,
                playUrl: session.playMethod === 'proxy'
                    ? `/api/transcode/${sessionId}/stream`
                    : `/api/transcode/${sessionId}/playlist.m3u8`,
                duration: session.videoDuration
            };
        }

        const outputDir = path.join(this.cacheDir, sessionId);
        if (fsSync.existsSync(outputDir)) {
            try { await fs.rm(outputDir, { recursive: true, force: true }); } catch (e) { }
        }
        await fs.mkdir(outputDir, { recursive: true });

        // 🚀 任务避让：进入播放流程，增加计数并尝试暂停后台扫描
        this.activePlaybacks++;
        const scanQueue = this.getScanQueueService();
        if (scanQueue && typeof scanQueue.setPausedByPlayback === 'function') {
            scanQueue.setPausedByPlayback(true);
        }

        let mediaInfo = options.mediaInfo;
        const mediaId = options.mediaId;
        const caps = options.caps || { canPlayH265: false }; // 接收前端传来的能力
        let probeFailed = false; // 标记探测是否失败

        if (!mediaInfo) {
            try {
                mediaInfo = await this.getMediaInfo(inputUrl, headers);

                // 💡 起播即存盘：如果探测到了新信息且有 mediaId，立即同步到数据库
                if (mediaId && mediaInfo) {
                    const { getDatabase } = require('../database');
                    const db = getDatabase();
                    if (db) {
                        const vCodec = (mediaInfo.videoCodec || '').toLowerCase();
                        const aCodec = (mediaInfo.audioCodec || '').toLowerCase();
                        const container = mediaInfo.format || '';
                        const duration = mediaInfo.duration || 0;

                        console.log(`[Transcode] Persisting probe results for media ID: ${mediaId}`);
                        db.run(
                            'UPDATE netdisk_media SET v_codec = ?, a_codec = ?, container = ?, duration = ?, probe_status = 1 WHERE id = ?',
                            [vCodec, aCodec, container, duration, mediaId]
                        );
                    }
                }
            } catch (err) {
                // 💡 探测失败：设置默认时长但不假设编码格式，标记为探测失败
                console.warn(`[Transcode] Probe failed for ${inputUrl.substring(0, 50)}...: ${err.message}`);
                mediaInfo = { duration: 7200, videoCodec: '', audioCodec: '', format: '' };
                probeFailed = true;
                // 不保存到数据库，让后台队列稍后重试探测
            }
        }

        const vCodec = (mediaInfo.videoCodec || '').toLowerCase();
        const aCodec = (mediaInfo.audioCodec || '').toLowerCase();
        const videoDuration = mediaInfo.duration;
        const segmentCount = Math.ceil(videoDuration / this.segmentDuration);

        let playMethod = 'hls';
        let strategy = 'transcode';

        // 💡 如果探测失败，强制走 transmux 模式（安全降级）
        if (probeFailed) {
            playMethod = 'hls';
            strategy = 'transmux'; // transmux 对 H.264 几乎无性能损失，对非 H.264 也能尝试播放
            console.log('[Transcode] Probe failed, falling back to transmux mode');
        } else {
            const isH264 = vCodec === 'h264' || vCodec === 'avc1';
            const isH265 = vCodec === 'hevc' || vCodec === 'h265';
            const isAudioCompatible = aCodec === 'aac' || aCodec === 'mp3' || !aCodec;
            const isMp4 = (mediaInfo.format || '').toLowerCase().includes('mp4') || inputUrl.toLowerCase().includes('.mp4');

            if (isH264 && isAudioCompatible && isMp4) {
                playMethod = 'proxy';
                strategy = 'none';
            } else if (isH264) {
                playMethod = 'hls';
                strategy = 'transmux';
            } else if (isH265 && caps.canPlayH265 && isAudioCompatible && isMp4) {
                // 🚀 核心优化：如果端侧支持 H265，且是 MP4，直接 Proxy 播放
                playMethod = 'proxy';
                strategy = 'none';
                console.log('[Transcode] Client supports H265, triggering Direct Play');
            } else if (isH265 && caps.canPlayH265) {
                // H265 支持但不是 MP4，仅 transmux
                playMethod = 'hls';
                strategy = 'transmux';
                console.log('[Transcode] Client supports H265, triggering Copy mode');
            } else {
                playMethod = 'hls';
                strategy = 'transcode';
            }
        }

        if (playMethod === 'hls') {
            const playlist = this.generateVodPlaylist(videoDuration);
            await fs.writeFile(path.join(outputDir, 'playlist.m3u8'), playlist);
        }

        this.activeSessions.set(sessionId, {
            outputDir, inputUrl, headers, videoDuration, mediaInfo, strategy, playMethod,
            segmentCount, startTime: Date.now(), lastAccess: Date.now(), quality, hwaccel,
            transcodeProc: null, transcodeStartSegment: -1, completedSegments: new Set(), pendingRequests: new Map()
        });

        return {
            sessionId, playMethod, duration: videoDuration,
            playUrl: playMethod === 'proxy'
                ? `/api/transcode/${sessionId}/stream`
                : `/api/transcode/${sessionId}/playlist.m3u8`
        };
    }

    async requestSegment(sessionId, segmentIndex) {
        const session = this.activeSessions.get(sessionId);
        if (!session) throw new Error('会话不存在');
        session.lastAccess = Date.now();
        const segmentPath = path.join(session.outputDir, `segment${segmentIndex}.ts`);

        console.log(`[Transcode] Segment ${segmentIndex} requested for session ${sessionId}`);

        try {
            await fs.access(segmentPath);
            if ((await fs.stat(segmentPath)).size > 0) {
                session.completedSegments.add(segmentIndex);
                console.log(`[Transcode] Segment ${segmentIndex} already exists, returning immediately`);
                return segmentPath;
            }
        } catch (e) { }

        if (session.pendingRequests.has(segmentIndex)) {
            console.log(`[Transcode] Segment ${segmentIndex} already pending, waiting...`);
            return session.pendingRequests.get(segmentIndex);
        }

        const currentProgress = session.transcodeStartSegment;
        const needNewTranscode = !session.transcodeProc || segmentIndex < currentProgress || segmentIndex > currentProgress + 15;

        console.log(`[Transcode] Segment ${segmentIndex}: currentProgress=${currentProgress}, needNewTranscode=${needNewTranscode}, hasProc=${!!session.transcodeProc}`);

        if (needNewTranscode) {
            this._stopTranscodeProcess(session);
            this._startContinuousTranscode(session, segmentIndex);
        }

        const waitPromise = this._waitForSegment(session, segmentIndex, segmentPath);
        session.pendingRequests.set(segmentIndex, waitPromise);
        return waitPromise;
    }

    _waitForSegment(session, index, filePath, timeout = 90000) {
        console.log(`[Transcode] Waiting for segment ${index} at ${filePath}...`);
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = setInterval(async () => {
                if (fsSync.existsSync(filePath) && (await fs.stat(filePath)).size > 0) {
                    clearInterval(check);
                    session.completedSegments.add(index);
                    console.log(`[Transcode] Segment ${index} ready after ${Date.now() - start}ms`);
                    resolve(filePath);
                } else if (Date.now() - start > timeout) {
                    clearInterval(check);
                    console.error(`[Transcode] Segment ${index} TIMEOUT after ${timeout}ms!`);
                    reject(new Error(`Segment ${index} timeout`));
                }
            }, 500);
        });
    }

    _startContinuousTranscode(session, startSegment) {
        const startTime = startSegment * this.segmentDuration;
        session.transcodeStartSegment = startSegment;

        const args = [
            '-analyzeduration', '100000000', // 100M
            '-probesize', '100000000',       // 100M
            '-ss', startTime.toString(),
            '-i', session.inputUrl,
            '-y'
        ];

        if (session.strategy === 'transmux') {
            args.push('-c', 'copy');
        } else {
            const hwaccel = session.hwaccel || 'none';
            const quality = session.quality || 'medium';

            // 基础视频参数
            const vArgs = ['-force_key_frames', `expr:gte(t,n_forced*${this.segmentDuration})`];

            // 根据硬件加速选择编码器和参数
            if (hwaccel === 'nvenc') {
                // NVIDIA GPU
                args.push('-hwaccel', 'cuda');
                vArgs.push('-c:v', 'h264_nvenc');

                // NVENC 质量控制
                if (quality === 'fast') vArgs.push('-preset', 'p2', '-cq', '30');       // 快速
                else if (quality === 'high') vArgs.push('-preset', 'p6', '-cq', '20');  // 高质量
                else vArgs.push('-preset', 'p4', '-cq', '26');                          // 平衡 (Default)

                // CBR/VBR 模式微调 (可选，这里使用 -cq 恒定质量模式)
            } else if (hwaccel === 'qsv') {
                // Intel QSV
                args.push('-hwaccel', 'qsv');
                vArgs.push('-c:v', 'h264_qsv');

                // QSV 质量控制
                if (quality === 'fast') vArgs.push('-preset', 'veryfast', '-global_quality', '28');
                else if (quality === 'high') vArgs.push('-preset', 'veryslow', '-global_quality', '20');
                else vArgs.push('-preset', 'medium', '-global_quality', '24');

            } else if (hwaccel === 'vaapi') {
                // VAAPI (AMD/Intel on Linux)
                args.push('-hwaccel', 'vaapi');
                args.push('-hwaccel_output_format', 'vaapi');
                args.push('-vaapi_device', '/dev/dri/renderD128'); // 默认设备
                vArgs.push('-c:v', 'h264_vaapi');

                // VAAPI 质量 (QP)
                if (quality === 'fast') vArgs.push('-qp', '30');
                else if (quality === 'high') vArgs.push('-qp', '22');
                else vArgs.push('-qp', '26');

            } else {
                // CPU (libx264) - 默认
                vArgs.push('-c:v', 'libx264');

                // CPU 质量控制
                if (quality === 'fast') vArgs.push('-preset', 'ultrafast', '-crf', '28');
                else if (quality === 'high') vArgs.push('-preset', 'fast', '-crf', '19');
                else vArgs.push('-preset', 'veryfast', '-crf', '23');
            }

            args.push(...vArgs);
            args.push('-c:a', 'aac', '-b:a', '128k');
        }

        args.push(
            '-f', 'segment',
            '-segment_time', this.segmentDuration.toString(),
            '-segment_time_delta', '0.5',  // 允许 0.5 秒偏差
            '-segment_start_number', startSegment.toString(),
            '-segment_format', 'mpegts',
            // 不使用 -reset_timestamps，让 PTS 保持连续
            path.join(session.outputDir, 'segment%d.ts')
        );

        console.log(`[Transcode] Starting FFmpeg: ${this.ffmpegPath} ${args.join(' ')}`);
        session.transcodeProc = spawn(this.ffmpegPath, args);
        session.transcodeProc.stderr.on('data', (data) => {
            // 可选：解析进度
        });
        session.transcodeProc.on('close', () => {
            session.transcodeProc = null;
        });
    }

    _stopTranscodeProcess(session) {
        if (session.transcodeProc) {
            session.transcodeProc.kill('SIGKILL');
            session.transcodeProc = null;
        }
    }

    async getFileAsync(sessionId, filename) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return null;
        const filePath = path.join(session.outputDir, filename);
        if (fsSync.existsSync(filePath)) return filePath;
        return null;
    }

    async stopSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            console.log(`[Transcode] Stopping session ${sessionId} and clearing cache...`);
            this._stopTranscodeProcess(session);

            // 🚀 任务避让恢复：减少计数，并在没有活跃播放时恢复后台扫描
            this.activePlaybacks = Math.max(0, this.activePlaybacks - 1);
            if (this.activePlaybacks === 0) {
                const scanQueue = this.getScanQueueService();
                if (scanQueue && typeof scanQueue.setPausedByPlayback === 'function') {
                    scanQueue.setPausedByPlayback(false);
                }
            }

            // 💡 物理删除对应的分片缓存目录
            const dir = session.outputDir;
            this.activeSessions.delete(sessionId);

            try {
                if (fsSync.existsSync(dir)) {
                    await fs.rm(dir, { recursive: true, force: true });
                    console.log(`[Transcode] Physics cache cleared for session: ${sessionId}`);
                }
            } catch (err) {
                console.warn(`[Transcode] Failed to delete cache dir ${dir}:`, err.message);
            }
        }
    }

    async cleanup() {
        const now = Date.now();
        const maxIdle = 120000; // 🚀 从 5 分钟缩短至 2 分钟，加快会话回收速度
        for (const [id, session] of this.activeSessions) {
            if (now - session.lastAccess > maxIdle) {
                console.log(`[Transcode] Session ${id} idle too long, cleaning up...`);
                this.stopSession(id);
            }
        }
        try {
            const dirs = await fs.readdir(this.cacheDir);
            for (const dir of dirs) {
                const dirPath = path.join(this.cacheDir, dir);
                const stat = await fs.stat(dirPath);
                if (stat.isDirectory() && now - stat.mtimeMs > 3600000) {
                    if (!this.activeSessions.has(dir)) await fs.rm(dirPath, { recursive: true, force: true });
                }
            }
        } catch (e) { }
    }

    getSessionStatus(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return null;

        // 💡 主动扫描磁盘上已生成的分片文件，更新 completedSegments
        this._scanCompletedSegments(session);

        return {
            playMethod: session.playMethod,
            strategy: session.strategy,
            videoDuration: session.videoDuration,
            segmentCount: session.segmentCount,
            completedSegments: Array.from(session.completedSegments).sort((a, b) => a - b),
            maxContinuousSegment: this._getMaxContinuousSegment(session)
        };
    }

    _scanCompletedSegments(session) {
        // 扫描输出目录中所有的 .ts 分片文件
        try {
            const files = fsSync.readdirSync(session.outputDir);
            for (const file of files) {
                const match = file.match(/^segment(\d+)\.ts$/);
                if (match) {
                    const segmentIndex = parseInt(match[1], 10);
                    const filePath = path.join(session.outputDir, file);
                    try {
                        const stat = fsSync.statSync(filePath);
                        if (stat.size > 0) {
                            session.completedSegments.add(segmentIndex);
                        }
                    } catch (e) { }
                }
            }
        } catch (e) {
            console.warn('[Transcode] Failed to scan segments:', e.message);
        }
    }

    _getMaxContinuousSegment(session) {
        const completed = Array.from(session.completedSegments).sort((a, b) => a - b);
        if (completed.length === 0) return -1;

        // 找到从 0 开始的最大连续分片索引
        let maxContinuous = -1;
        for (let i = 0; i < completed.length; i++) {
            if (completed[i] === i) {
                maxContinuous = i;
            } else {
                break;
            }
        }
        return maxContinuous;
    }
}

module.exports = new TranscodeService();
