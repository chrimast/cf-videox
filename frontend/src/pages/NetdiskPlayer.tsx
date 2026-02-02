import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost, apiDelete } from '../utils/api';
import { TmdbCorrectModal } from '../components/TmdbCorrectModal';

interface MediaItem {
    id: number;
    source_id: number;
    path: string;
    title: string;
    original_title?: string;
    year?: number;
    overview?: string;
    poster_url?: string;
    fanart_url?: string;
    rating?: number;
    genres: string[];
    media_type: string;
    tmdb_id?: number;
    video_files: string[];
    nfo_parsed: number;
    director?: string;
    actor?: string;
    area?: string;
    tagline?: string;
    studio?: string;
    extra_metadata?: Record<string, any>;
}

interface NetdiskPlayerProps {
    mediaId: number;
    sourceId: number;
    initialVideoIndex?: number;
    onNavigate: (view: any, params?: any) => void;
    onGoBack?: () => void;
}

const METADATA_LABELS: Record<string, string> = {
    original_title: '原始标题',
    originaltitle: '原始标题',
    director: '导演',
    area: '国家/地区',
    country: '国家/地区',
    year: '发行年份',
    premiered: '首播日期',
    studio: '制作公司',
    tagline: '看点',
    mpaa: '分级',
    runtime: '片长',
    status: '状态',
    set: '系列',
    budget: '预算',
    revenue: '营收',
    trailer: '预告片',
    website: '官网',
    imdbid: 'IMDB ID',
    tmdbid: 'TMDB ID',
    tmbdid: 'TMDB ID',
    tvdbid: 'TVDB ID',
    writer: '编剧',
    producer: '制片',
    musicby: '配乐',
    maker: '片商',
    label: '发行商',
    publisher: '出版商',
    series: '系列',
    number: '番号/编号',
    code: '特征码',
    user_rating: '个人评分',
    outline: '大纲',
    plot: '详情'
};

export function NetdiskPlayer({ mediaId, sourceId, initialVideoIndex = 0, onNavigate, onGoBack }: NetdiskPlayerProps) {
    const [media, setMedia] = useState<MediaItem | null>(null);
    const [selectedVideoIndex, setSelectedVideoIndex] = useState(initialVideoIndex);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [playUrl, setPlayUrl] = useState<string | null>(null);
    const [playMethod, setPlayMethod] = useState<'hls' | 'proxy' | 'direct'>('hls');
    const [isFavorite, setIsFavorite] = useState(false);
    const [isTranscoding, setIsTranscoding] = useState(false);
    const [metaData, setMetaData] = useState<{ vCodec?: string, duration?: number }>({});
    const [isCorrectModalOpen, setIsCorrectModalOpen] = useState(false);

    // 💡 状态追踪 (使用 useRef 避免闭包陷阱!!)
    const maxCompletedIdxRef = useRef<number>(-1);
    const lastValidTimeRef = useRef<number>(0);

    const playerRef = useRef<HTMLDivElement>(null);
    const artPlayerRef = useRef<any>(null);
    const progressTimerRef = useRef<any>(null);
    const pollTimerRef = useRef<any>(null);
    const loadingTimeoutRef = useRef<any>(null);
    const transcodingSessionIdRef = useRef<string | null>(null);
    const hlsRef = useRef<any>(null);
    const isFirstFragLoadedRef = useRef(false);

    useEffect(() => {
        loadMediaDetail();
        checkFavoriteStatus();
        return () => {
            // 💡 关键修复：组件卸载（如点击返回按钮）时，通知后端停止转码
            if (transcodingSessionIdRef.current) {
                apiPost(`/transcode/${transcodingSessionIdRef.current}/stop`, {}).catch(() => { });
                transcodingSessionIdRef.current = null;
            }
            cleanupPlayer();
            if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, [mediaId, sourceId]);

    const cleanupPlayer = () => {
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (artPlayerRef.current) {
            artPlayerRef.current.destroy();
            artPlayerRef.current = null;
        }
        if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
        }
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
        isFirstFragLoadedRef.current = false;
        if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
        maxCompletedIdxRef.current = -1;
        lastValidTimeRef.current = 0;
    };

    useEffect(() => {
        if (media) {
            getPlayUrl(selectedVideoIndex);
        }
    }, [media, selectedVideoIndex]);

    useEffect(() => {
        if (playUrl) {
            initPlayer();
        }
    }, [playUrl, playMethod]);

    // 💡 每秒获取一次转码进度 (增加频率，让体验更实时)
    useEffect(() => {
        if (isTranscoding && transcodingSessionIdRef.current && playMethod === 'hls') {
            const poll = async () => {
                try {
                    const res = await apiGet<{ maxContinuousSegment: number }>(`/transcode/${transcodingSessionIdRef.current}/status`);
                    if (res.success && res.data) {
                        maxCompletedIdxRef.current = res.data.maxContinuousSegment;
                        console.log(`[Transcode Poll] maxCompletedIdx updated to: ${res.data.maxContinuousSegment}`);
                    }
                } catch (e) { }
            };
            pollTimerRef.current = setInterval(poll, 2000);
            return () => clearInterval(pollTimerRef.current);
        }
    }, [isTranscoding, playMethod, transcodingSessionIdRef.current]);

    useEffect(() => {
        const stopTranscoding = () => {
            if (transcodingSessionIdRef.current) {
                const url = `/api/transcode/${transcodingSessionIdRef.current}/stop`;
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(url, new Blob(['{}'], { type: 'application/json' }));
                } else {
                    apiPost(`/transcode/${transcodingSessionIdRef.current}/stop`, {}).catch(() => { });
                }
            }
        };

        window.addEventListener('beforeunload', stopTranscoding);
        return () => {
            stopTranscoding();
            window.removeEventListener('beforeunload', stopTranscoding);
        };
    }, []);

    const loadMediaDetail = async () => {
        setLoading(true);
        try {
            const res = await apiGet<MediaItem>(`/netdisk/media/${mediaId}`);
            if (res.success && res.data) {
                setMedia(res.data);
            } else {
                setError(res.error || '获取媒体详情失败');
            }
        } catch (err) {
            setError('网络错误');
        } finally {
            setLoading(false);
        }
    };

    const checkFavoriteStatus = async () => {
        try {
            const res = await apiGet<{ isFavorite: boolean }>('/favorites/check', {
                source_id: sourceId,
                vod_id: mediaId.toString(),
                source_type: 'netdisk'
            });
            if (res.success && res.data) {
                setIsFavorite(res.data.isFavorite);
            }
        } catch (err) {
            console.error('Failed to check favorite status:', err);
        }
    };

    const handleRefresh = async () => {
        setLoading(true);
        try {
            const res = await apiPost<MediaItem>(`/netdisk/media/${mediaId}/refresh`);
            if (res.success && res.data) {
                setMedia(res.data);
            } else {
                alert('刷新失败: ' + (res.error || '未知错误'));
            }
        } catch (err) {
            console.error('Refresh failed:', err);
            alert('刷新失败，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const handleUnlockMedia = async () => {
        setLoading(true);
        try {
            const res = await apiPost<MediaItem>(`/netdisk/media/${mediaId}/unlock`);
            if (res.success && res.data) {
                // 直接使用返回的数据更新状态，因为 unlock 会触发重新扫描，可能改变 ID
                setMedia(res.data);
                alert('已恢复自动识别，媒体信息已刷新');
            } else {
                alert('操作失败: ' + (res.error || '未知错误'));
            }
        } catch (err) {
            console.error('Unlock failed:', err);
            alert('操作失败，请刷新页面重试');
        } finally {
            setLoading(false);
        }
    };

    const checkBrowserCaps = () => {
        const caps = {
            canPlayH265: false
        };
        try {
            // 简单的 H265 探测逻辑
            const video = document.createElement('video');
            const canPlay = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
                video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"');
            caps.canPlayH265 = canPlay === 'probably' || canPlay === 'maybe';
            console.log(`[BrowserCaps] H265 Support: ${caps.canPlayH265}`);
        } catch (e) {
            console.warn('[BrowserCaps] Detect failed:', e);
        }
        return caps;
    };

    const getPlayUrl = async (index: number) => {
        if (transcodingSessionIdRef.current) {
            apiPost(`/transcode/${transcodingSessionIdRef.current}/stop`, {}).catch(() => { });
            transcodingSessionIdRef.current = null;
        }

        cleanupPlayer();
        setIsTranscoding(true);
        setPlayUrl(null);

        if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = setTimeout(() => {
            setIsTranscoding(false);
        }, 12000);

        try {
            const caps = checkBrowserCaps();
            const res = await apiPost<{ playUrl: string, sessionId?: string, playMethod?: any, metadata?: any }>(
                `/netdisk/media/${mediaId}/play`,
                { videoIndex: index, caps }
            );
            if (res.success && res.data) {
                if (res.data.sessionId) {
                    transcodingSessionIdRef.current = res.data.sessionId;
                }
                setPlayMethod(res.data.playMethod || 'hls');
                setMetaData(res.data.metadata || {});
                setPlayUrl(res.data.playUrl);

                if (res.data.playMethod === 'proxy' || res.data.playMethod === 'direct') {
                    setIsTranscoding(false);
                    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
                }
            } else {
                setIsTranscoding(false);
                setError(res.error || '无法获取播放地址');
            }
        } catch (err) {
            console.error('Failed to get play URL:', err);
            setIsTranscoding(false);
            setError('获取播放地址网络请求失败');
        }
    };

    const saveHistory = async (player: any) => {
        if (!media || !player) return;
        const currentTime = player.currentTime;
        const duration = player.duration;
        if (currentTime <= 0) return;

        try {
            await apiPost('/history', {
                source_id: sourceId,
                source_type: 'netdisk',
                vod_id: mediaId.toString(),
                title: media.title,
                cover: media.poster_url,
                episode: selectedVideoIndex + 1,
                episode_name: media.video_files[selectedVideoIndex],
                progress: currentTime,
                duration: duration
            });
        } catch (err) {
            console.error('Failed to save history:', err);
        }
    };

    const initPlayer = async () => {
        if (!playerRef.current || !playUrl || !media) return;

        cleanupPlayer();

        try {
            const [ArtplayerModule, HlsModule] = await Promise.all([
                import('artplayer'),
                import('hls.js')
            ]);
            const Artplayer = ArtplayerModule.default;
            const Hls = HlsModule.default;

            const playerConfig: any = {
                container: playerRef.current,
                url: playUrl,
                autoplay: true,
                fullscreen: true,
                fullscreenWeb: true,
                setting: true,
                playbackRate: true,
                aspectRatio: true,
                pip: true,
                theme: '#ef4444',
                moreVideoAttr: {
                    crossOrigin: 'anonymous',
                    playsInline: true,
                },
                control: (playMethod === 'proxy' && metaData.vCodec && !['h264', 'avc1'].includes(metaData.vCodec.toLowerCase())) ? false : true,
            };

            if (metaData.duration) {
                playerConfig.duration = metaData.duration;
            }

            if (playMethod === 'hls') {
                playerConfig.type = 'm3u8';
                playerConfig.customType = {
                    m3u8: function (video: any, url: any) {
                        if (Hls.isSupported()) {
                            const hls = new Hls({
                                maxBufferLength: 60,  // 增加缓冲区
                                maxMaxBufferLength: 120,
                                enableWorker: true,
                                fragLoadingMaxRetry: 10,  // 增加重试次数
                                fragLoadingRetryDelay: 2000,  // 增加重试延迟
                                fragLoadingMaxRetryTimeout: 60000,  // 最大重试超时
                                manifestLoadingMaxRetry: 5,
                                levelLoadingMaxRetry: 5,
                                startLevel: 0,
                                // 💡 关键：增加分片加载超时，适应慢速转码
                                fragLoadingTimeOut: 60000,  // 60 秒超时
                                levelLoadingTimeOut: 30000,
                            });
                            hlsRef.current = hls;
                            hls.loadSource(url);
                            hls.attachMedia(video);
                            hls.on(Hls.Events.FRAG_LOADED, () => {
                                if (!isFirstFragLoadedRef.current) {
                                    isFirstFragLoadedRef.current = true;
                                    setIsTranscoding(false);
                                }
                            });
                            // 注意：不再在 FRAG_LOADING 阶段拦截，因为会干扰正常的预加载
                            // 只通过 Artplayer 的 seek 事件拦截用户主动的拖动操作
                        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                            video.src = url;
                        }
                    }
                };
            }

            const player = new Artplayer(playerConfig);
            artPlayerRef.current = player;

            // 💡 监听播放进度，记录有效时间
            player.on('video:timeupdate', () => {
                const currentTime = player.currentTime;
                const targetIdx = Math.floor(currentTime / 10);
                const maxIdx = maxCompletedIdxRef.current;

                // 只有在已转码范围内，才更新有效位置
                if (maxIdx === -1) {
                    if (targetIdx === 0) lastValidTimeRef.current = currentTime;
                } else if (targetIdx <= maxIdx) {
                    lastValidTimeRef.current = currentTime;
                }
            });

            // 💡 简化策略：只在用户拖动到未转码区域时显示提示，不主动回弹
            // 让 HLS.js 自然处理（等待分片或超时），避免误触发导致的异常行为
            player.on('seeking', () => {
                if (playMethod === 'hls' && transcodingSessionIdRef.current) {
                    const currentTime = player.currentTime;
                    const targetIdx = Math.floor(currentTime / 10);
                    const maxIdx = maxCompletedIdxRef.current;
                    // 只显示提示，不回弹
                    if (maxIdx !== -1 && targetIdx > maxIdx + 2) {
                        player.notice.show = `⏳ 正在等待转码... (已就绪: ${(maxIdx + 1) * 10}s)`;
                    }
                }
            });

            player.on('video:canplay', () => {
                setIsTranscoding(false);
                if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
            });

            player.on('ready', () => {
                if (playMethod !== 'hls') {
                    setIsTranscoding(false);
                    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
                }
            });

            if (progressTimerRef.current) clearInterval(progressTimerRef.current);
            progressTimerRef.current = setInterval(() => {
                saveHistory(player);
            }, 30000);

            player.on('destroy', () => {
                if (progressTimerRef.current) clearInterval(progressTimerRef.current);
            });

        } catch (err) {
            console.error('Failed to init Artplayer:', err);
            setIsTranscoding(false);
        }
    };

    const toggleFavorite = async () => {
        if (!media) return;
        try {
            if (isFavorite) {
                const res = await apiDelete('/favorites', {
                    source_id: sourceId,
                    vod_id: mediaId.toString(),
                    source_type: 'netdisk'
                });
                if (res.success) setIsFavorite(false);
            } else {
                const res = await apiPost('/favorites', {
                    source_id: sourceId,
                    source_type: 'netdisk',
                    vod_id: mediaId.toString(),
                    title: media.title,
                    cover: media.poster_url,
                    year: media.year?.toString()
                });
                if (res.success) setIsFavorite(true);
            }
        } catch (err) {
            console.error('Failed to toggle favorite:', err);
        }
    };

    const renderMetadataRows = () => {
        if (!media) return null;
        const extraData = media.extra_metadata || {};
        const rows: { label: string, value: any, key: string }[] = [];

        // 1. 收集所有可能的元数据键 (合并 extra_metadata 和 media 顶层属性)
        const allKeys = new Set([
            ...Object.keys(METADATA_LABELS),
            ...Object.keys(extraData),
            'director', 'year', 'area', 'studio', 'rating', 'genre', 'originaltitle'
        ]);

        allKeys.forEach(key => {
            const label = METADATA_LABELS[key] || key; // 如果没有中文标签，展示原始键名
            let value = extraData[key] || (media as any)[key];

            // 过滤无效或重复展示的值
            if (value === undefined || value === null || value === '' || value === 0 || value === '0') return;
            if (key === 'overview' || key === 'title' || key === 'poster_url' || key === 'fanart_url' || key === 'video_files') return;
            if (rows.some(r => r.label === label)) return;

            let displayVal = value;
            // 针对特定字段进行格式化
            if (key === 'genre' || key === 'tag' || label === '类型') {
                const genres = typeof value === 'string' ? value.split(/[,，]\s*/) : value;
                displayVal = (
                    <div className="flex flex-wrap gap-1">
                        {Array.isArray(genres) ? genres.map(g => (
                            <span key={g} className="text-primary bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium border border-blue-500/20">#{g}</span>
                        )) : <span className="text-primary bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium border border-blue-500/20">#{value}</span>}
                    </div>
                );
            } else if (key === 'rating') {
                displayVal = <span className="text-yellow-500 font-bold">★ {value}</span>;
            } else if (typeof value === 'string' && (value.startsWith('http'))) {
                displayVal = <a href={value} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline break-all">{value}</a>;
            }

            rows.push({ label, value: displayVal, key });
        });

        return rows.map((row, idx) => (
            <div key={idx} className="flex items-start gap-2 py-1.5 border-b border-white/[0.05] last:border-0">
                <span className="text-secondary w-24 flex-shrink-0 text-xs font-semibold">{row.label}:</span>
                <div className="text-primary break-words flex-1 min-w-0 text-xs sm:text-sm">{row.value}</div>
            </div>
        ));
    };

    if (loading) return <div className="p-6 text-primary text-center">加载中...</div>;
    if (error || !media) return (
        <div className="p-6 text-red-500 text-center space-y-4">
            <p>{error || '加载失败'}</p>
            <button onClick={() => onNavigate('netdisk')} className="px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color">
                返回
            </button>
        </div>
    );

    return (
        <div className="p-4 lg:p-6 space-y-4 bg-primary min-h-full overflow-y-auto custom-scrollbar">
            {/* 顶部区域：播放器 + 剧集面板 */}
            <div className="flex flex-col lg:flex-row gap-4">
                {/* 左侧：播放器 */}
                <div className="flex-1 min-w-0">
                    <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                        <div className="w-full h-full" ref={playerRef}></div>

                        {/* 转码加载层 */}
                        {isTranscoding && (
                            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10">
                                <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                                <p className="text-white font-medium">正在建立智能极速播放链路...</p>
                                <p className="text-gray-400 text-sm mt-2">
                                    {playMethod === 'hls' ? '服务器正在准备转推流数据' : '正在解析远程加速地址'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 控制条 - 补全收藏、刷新、返回动作 */}
                    <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-3 flex-wrap">
                            <button
                                onClick={() => onGoBack ? onGoBack() : onNavigate('netdisk')}
                                className="px-3 py-2 sm:py-1.5 bg-secondary text-secondary hover:text-primary rounded-lg text-sm transition-colors flex items-center gap-2 border border-border-color shadow-sm"
                            >
                                <i className="fas fa-arrow-left"></i>
                                <span className="hidden sm:inline">返回</span>
                            </button>
                            <div className="text-secondary text-sm flex-1 min-w-0">
                                <span className="hidden sm:inline">正在播放：</span>
                                <span className="text-primary font-medium">{media.title}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={toggleFavorite}
                                className={`flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 ${isFavorite
                                    ? 'bg-red-500 text-white shadow-lg'
                                    : 'bg-secondary text-secondary hover:text-primary border border-border-color shadow-sm'
                                    }`}
                            >
                                <i className="fas fa-heart"></i>
                                {isFavorite ? '已收藏' : '收藏'}
                            </button>
                            <button
                                onClick={handleRefresh}
                                className="flex-1 sm:flex-none px-4 py-2 sm:py-1.5 bg-secondary text-secondary hover:text-primary rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-border-color shadow-sm"
                            >
                                <i className="fas fa-sync-alt"></i>
                                刷新
                            </button>
                        </div>
                    </div>
                </div>

                {/* 右侧：剧集网格面板 */}
                <div className="lg:w-72 xl:w-80 flex-shrink-0">
                    <div className="bg-secondary rounded-xl p-4 h-full max-h-[400px] lg:max-h-[calc(56.25vw*0.5+80px)] flex flex-col border border-border-color shadow-xl transition-all duration-300">
                        <h3 className="text-primary font-medium mb-3 flex items-center justify-between">
                            <span>
                                <i className="fas fa-list-ol mr-2 text-red-500"></i>
                                选集 ({media.video_files.length})
                            </span>
                        </h3>

                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                                {media.video_files.map((file, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            setSelectedVideoIndex(idx);
                                            setIsTranscoding(true);
                                        }}
                                        className={`px-2 py-2.5 rounded text-sm transition-colors truncate ${selectedVideoIndex === idx
                                            ? 'bg-red-500 text-white font-medium shadow-lg'
                                            : 'bg-secondary/50 text-secondary hover:bg-secondary hover:text-primary border border-border-color'
                                            }`}
                                        title={file}
                                    >
                                        P{idx + 1}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 下方：NFO 信息 (全宽) */}
            <div className="grid grid-cols-1 gap-4">
                <div className="space-y-4">
                    <div className="bg-secondary rounded-xl p-5 border border-border-color shadow-sm flex flex-col md:flex-row gap-6">
                        <div className="flex-1 space-y-4">
                            <h3 className="text-primary font-bold flex items-center justify-between border-b border-border-color pb-2">
                                <div className="flex items-center gap-2">
                                    <i className="fas fa-info-circle text-blue-400"></i>
                                    媒体详情
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setIsCorrectModalOpen(true)}
                                        className="px-3 py-1 bg-blue-500/20 hover:bg-blue-500 text-blue-400 hover:text-white rounded flex items-center gap-1.5 text-xs transition-all duration-300"
                                    >
                                        <i className="fas fa-magic"></i>
                                        识别修正
                                    </button>
                                    <button
                                        onClick={handleUnlockMedia}
                                        className="px-3 py-1 bg-secondary hover:bg-secondary-hover text-secondary hover:text-primary rounded flex items-center gap-1.5 text-xs transition-all duration-300 border border-border-color"
                                        title="解锁手动修正，恢复系统自动识别"
                                    >
                                        <i className="fas fa-undo"></i>
                                        恢复自动识别
                                    </button>
                                </div>
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-6 text-sm">
                                {renderMetadataRows()}
                            </div>

                            {media.actor && (
                                <div className="pt-4 border-t border-border-color">
                                    <div className="text-secondary mb-2 flex items-center gap-2">
                                        <i className="fas fa-users text-xs"></i>
                                        主演阵容:
                                    </div>
                                    <p className="text-primary leading-relaxed text-sm">{media.actor}</p>
                                </div>
                            )}
                        </div>

                        {/* 🚀 封面图：内置到详情卡片右侧，宽度与上方侧边栏同步以实现垂直对齐 */}
                        <div className="w-full md:w-56 lg:w-72 xl:w-80 flex-shrink-0">
                            <div className="rounded-lg overflow-hidden shadow-2xl border border-white/10">
                                {media.poster_url ? (
                                    <img
                                        src={media.poster_url.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(media.poster_url)}` : media.poster_url}
                                        alt={media.title}
                                        className="w-full h-auto object-cover filter brightness-95 hover:brightness-100 transition-all duration-500"
                                        onError={e => (e.target as HTMLImageElement).src = '/poster-fallback.png'}
                                    />
                                ) : (
                                    <div className="aspect-[2/3] bg-tertiary rounded-lg flex items-center justify-center text-secondary">
                                        <i className="fas fa-film text-6xl opacity-20"></i>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {media.overview && (
                        <div className="bg-secondary rounded-xl p-5 border border-border-color shadow-sm">
                            <h3 className="text-primary font-bold mb-3 flex items-center gap-2">
                                <i className="fas fa-align-left text-green-400"></i>
                                剧情简介
                            </h3>
                            <p className="text-secondary text-sm leading-relaxed whitespace-pre-wrap">
                                {media.overview}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* 纠偏弹窗 */}
            {media && (
                <TmdbCorrectModal
                    isOpen={isCorrectModalOpen}
                    mediaId={media.id}
                    initialQuery={media.title}
                    onClose={() => setIsCorrectModalOpen(false)}
                    onSuccess={() => {
                        loadMediaDetail(); // 重新加载详情以显示更正后的信息
                    }}
                />
            )}
        </div>
    );
}
