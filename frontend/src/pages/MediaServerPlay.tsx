import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost, apiDelete } from '../utils/api';

interface MediaServerPlayProps {
    mediaServerId: number;
    vodId: string;
    title: string;
    streamUrl: string;
    cover: string;
    onGoBack: () => void;
}

interface MediaItemDetail {
    Id: string;
    Name: string;
    OriginalTitle?: string;
    ProductionYear?: number;
    Overview?: string;
    CommunityRating?: number;
    OfficialRating?: number;
    RunTimeTicks?: number;
    Genres?: string[];
    Type: string;
    ImageTags: {
        Primary: string;
    };
    People?: Array<{ Name: string; Role: string; Type: string }>;
    Studios?: Array<{ Name: string }>;
    UserData?: {
        PlaybackPositionTicks: number;
        Played: boolean;
    };
}

interface SimilarItem {
    Id: string;
    Name: string;
    Type: string;
    ProductionYear?: number;
    ImageTags: {
        Primary: string;
    };
}

export function MediaServerPlay({ mediaServerId, vodId, title: initialTitle, streamUrl: initialStreamUrl, cover: initialCover, onGoBack }: MediaServerPlayProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<any>(null);
    const sessionRef = useRef<string | null>(null);

    // 状态管理
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [mediaDetail, setMediaDetail] = useState<MediaItemDetail | null>(null);
    const [similarItems, setSimilarItems] = useState<SimilarItem[]>([]);
    const [similarLoading, setSimilarLoading] = useState(false);
    const [isFavorite, setIsFavorite] = useState(false);

    // 3. 🚀 关键：本地克隆播放参数，支持“点击推荐切换”
    const [currentVodId, setCurrentVodId] = useState(vodId);
    const [currentTitle, setCurrentTitle] = useState(initialTitle);
    const [currentPlayUrl, setCurrentPlayUrl] = useState(initialStreamUrl);
    const [currentCover, setCurrentCover] = useState(initialCover);

    // 1. 统一初始化逻辑：加载媒体详情 & 相似内容 & 收藏状态 & 启动播放器
    useEffect(() => {
        let isMounted = true;

        const bootstrap = async () => {
            setLoading(true);
            setDetailLoading(true);
            setLoadError(null);

            try {
                // 并行获取详情、相似内容和收藏状态
                const [detailRes, similarRes] = await Promise.all([
                    apiGet<MediaItemDetail>(`/media-servers/${mediaServerId}/items/${currentVodId}`),
                    apiGet<SimilarItem[]>(`/media-servers/${mediaServerId}/items/${currentVodId}/similar`),
                    checkFavoriteStatus(currentVodId)
                ]);

                if (!isMounted) return;

                if (detailRes.success && detailRes.data) {
                    setMediaDetail(detailRes.data);
                    // 🎬 核心：详情获取成功后立即上报记录
                    savePlayHistory(detailRes.data);
                }
                if (similarRes.success && similarRes.data) setSimilarItems(similarRes.data);

                // 🚀 核心关键：检查并获取播放地址
                let targetUrl = currentPlayUrl;
                let currentMediaSourceId = '';
                let startTime = 0; // 🎯 这里的 startTime 将作为最终播放起点 antisocial antisense

                const playRes = await apiGet<any>(`/media-servers/${mediaServerId}/playback/${currentVodId}`);
                if (playRes.success && playRes.data.streamUrl) {
                    targetUrl = playRes.data.streamUrl;
                    setCurrentPlayUrl(targetUrl);

                    // 1. 尝试从 MediaSources 提取 ID
                    if (playRes.data.MediaSources && playRes.data.MediaSources.length > 0) {
                        currentMediaSourceId = playRes.data.MediaSources[0].Id;
                    }

                    // 2. 🎯 核心修复：优先从详情接口加载进度 (因为详情接口通过 Fields=UserData 已被加固) antisocial antisense
                    if (detailRes.success && detailRes.data?.UserData?.PlaybackPositionTicks) {
                        startTime = detailRes.data.UserData.PlaybackPositionTicks / 10000000;
                        console.log(`[MediaServerPlay] Found resume ticks from Detail: ${startTime}s`);
                    }
                    // 3. 兜底：从 PlaybackInfo 接口获取 Ticks antisocial antisense
                    else if (playRes.success && playRes.data.MediaSources?.[0]?.UserData?.PlaybackPositionTicks) {
                        startTime = playRes.data.MediaSources[0].UserData.PlaybackPositionTicks / 10000000;
                        console.log(`[MediaServerPlay] Found resume ticks from PlaybackInfo: ${startTime}s`);
                    }
                } else {
                    throw new Error(playRes.error || '无法解析播放地址');
                }

                // 启动播放器内核
                if (isMounted) await initPlayer(targetUrl, startTime, currentMediaSourceId);

            } catch (err: any) {
                if (isMounted) {
                    setLoadError(err.message);
                    setLoading(false);
                }
            } finally {
                if (isMounted) {
                    setDetailLoading(false);
                    // 🎬 核心：详情加载完成后，尝试上报一次历史记录 (针对初次进入)
                    // 注意：这里需要确保 mediaDetail 已经通过 detailRes 赋值成功
                    // 但由于 setState 是异步的，我们直接在 bootstrap 逻辑中拿到数据后立即上报更靠谱
                }
            }
        };

        bootstrap();

        return () => {
            isMounted = false;
            if (artRef.current) {
                artRef.current.destroy(true);
                artRef.current = null;
            }
        };
    }, [mediaServerId, currentVodId]);

    const checkFavoriteStatus = async (id: string) => {
        try {
            const res = await apiGet<{ isFavorite: boolean }>('/favorites/check', {
                source_id: mediaServerId,
                vod_id: id,
                source_type: 'media_server'
            });
            if (res.success && res.data) {
                setIsFavorite(res.data.isFavorite);
            }
        } catch (err) {
            console.error('Failed to check favorite status:', err);
        }
    };

    const toggleFavorite = async () => {
        if (!mediaDetail) return;
        try {
            if (isFavorite) {
                const res = await apiDelete('/favorites', {
                    source_id: mediaServerId,
                    vod_id: currentVodId,
                    source_type: 'media_server'
                });
                if (res.success) setIsFavorite(false);
            } else {
                const res = await apiPost('/favorites', {
                    source_id: mediaServerId,
                    source_type: 'media_server',
                    vod_id: currentVodId,
                    title: mediaDetail.Name,
                    cover: currentCover,
                    year: mediaDetail.ProductionYear?.toString()
                });
                if (res.success) setIsFavorite(true);
            }
        } catch (err) {
            console.error('Toggle favorite failed:', err);
        }
    };

    const loadSimilarItems = async (id: string) => {
        setSimilarLoading(true);
        try {
            const res = await apiGet<SimilarItem[]>(`/media-servers/${mediaServerId}/items/${id}/similar`);
            if (res.success && res.data) {
                setSimilarItems(res.data);
            }
        } catch (err) {
            console.error('[MediaServerPlay] Failed to load similar items:', err);
        } finally {
            setSimilarLoading(false);
        }
    };

    const handleRefresh = async () => {
        // 直接触发当前 currentVodId 的重新加载
        const id = currentVodId;
        setLoading(true);
        setDetailLoading(true);

        try {
            const [detailRes] = await Promise.all([
                apiGet<MediaItemDetail>(`/media-servers/${mediaServerId}/items/${id}`),
                loadSimilarItems(id), // 🚀 直接调用以复用逻辑并解决 warning
                checkFavoriteStatus(id)
            ]);

            if (detailRes.success && detailRes.data) setMediaDetail(detailRes.data);
            // similarRes 由 loadSimilarItems 内部处理了

            // 重新请求播放地址
            const playRes = await apiGet<any>(`/media-servers/${mediaServerId}/playback/${id}`);
            if (playRes.success && playRes.data.streamUrl) {
                setCurrentPlayUrl(playRes.data.streamUrl);
                // 刷新时也要考虑续播
                let startTime = 0;
                if (detailRes.success && detailRes.data?.UserData?.PlaybackPositionTicks) {
                    startTime = detailRes.data.UserData.PlaybackPositionTicks / 10000000;
                }
                await initPlayer(playRes.data.streamUrl, startTime, playRes.data.MediaSources?.[0]?.Id);
            }
        } catch (err) {
            console.error('Refresh failed:', err);
        } finally {
            setLoading(false);
            setDetailLoading(false);
        }
    };

    // 独立出播放器初始化引擎
    const initPlayer = async (url: string, startTime = 0, mediaSourceId?: string) => {
        if (!wrapperRef.current) return;

        // 物理隔离清理
        if (artRef.current) {
            try { artRef.current.destroy(true); } catch (e) { }
            artRef.current = null;
        }
        wrapperRef.current.innerHTML = '';

        const mountPoint = document.createElement('div');
        mountPoint.style.width = '100%';
        mountPoint.style.height = '100%';
        wrapperRef.current.appendChild(mountPoint);

        await new Promise(r => setTimeout(r, 100));

        const isM3U8 = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('master');

        const [ArtplayerModule, HlsModule] = await Promise.all([
            import('artplayer'),
            import('hls.js')
        ]);
        const Artplayer = ArtplayerModule.default;
        const Hls = HlsModule.default;

        const playerConfig: any = {
            container: mountPoint,
            url: url,
            seek: startTime, // 断点续播
            autoplay: true,
            autoMini: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            mutex: true,
            theme: '#3B82F6',
            moreVideoAttr: {
                crossOrigin: 'anonymous',
                playsInline: true,
                preload: 'auto',
                'webkit-playsinline': true,
                'x5-video-player-type': 'h5-page',
                'disableRemotePlayback': false,
            },
        };

        if (isM3U8) {
            playerConfig.type = 'm3u8';
            playerConfig.customType = {
                m3u8: (video: HTMLVideoElement, url: string) => {
                    if (Hls.isSupported()) {
                        const hls = new Hls({ enableWorker: true, manifestLoadingTimeOut: 30000 });
                        hls.loadSource(url);
                        hls.attachMedia(video);
                        (video as any).hls = hls;
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = url;
                    }
                }
            }
        }

        const art = new Artplayer(playerConfig);
        artRef.current = art;

        // 🚀 核心优化：增强静态流的缓冲区保护和自动恢复功能 antisocial antisense
        art.on('ready', async () => {
            setLoading(false);
            if (startTime > 0) {
                console.log(`[ArtPlayer] Seeking to start: ${startTime}s`);
                art.seek = startTime;
            }
            savePlayHistory();
            sessionRef.current = null;

            try {
                const r = await apiPost<any>(`/media-servers/${mediaServerId}/playback/start`, {
                    itemId: currentVodId,
                    mediaSourceId: mediaSourceId
                });
                const data = (r.data || r) as any;
                if (data && data.Id) {
                    sessionRef.current = data.Id;
                }
            } catch (e) {
                console.error('[DEBUG] Playback Start Failed:', e);
            }
        });

        // 🎬 监听缓冲状态：防止“快进”感 antisense antisocial
        // 如果数据不足，主动暂停，等缓冲充裕后再自动恢复
        art.on('video:waiting', () => {
            console.warn('[ArtPlayer] Buffer underrun detected, waiting...');
            art.notice.show = '正在预载数据以确保顺滑播放...';
        });

        art.on('video:canplay', () => {
            if (art.video.paused && !art.video.ended && art.loading.show) {
                console.log('[ArtPlayer] Buffer sufficient, resuming playback.');
                art.play();
            }
        });

        // 🎬 自动错误恢复逻辑 antisocial antisense
        art.on('video:error', () => {
            const currentTime = art.video.currentTime;
            if (currentTime > 0 && art.video.error?.code !== 4) { // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
                console.log('[ArtPlayer] Attempting soft recovery at', currentTime);
                art.notice.show = '网络抖动，正在恢复播放...';
                setTimeout(() => {
                    art.video.load();
                    art.video.currentTime = currentTime;
                    art.video.play().catch(e => console.warn('Recovery play failed:', e));
                }, 1500);
                return;
            }
            setLoadError(`播放器错误: ${art.video.error?.code || '未知'}`);
            setLoading(false);
        });

        // 🎬 监控“跳帧”现象：解决快进感 antisocial antisense
        let lastRealTime = 0;
        art.on('video:timeupdate', () => {
            const currentTime = art.video.currentTime;
            const diff = Math.abs(currentTime - lastRealTime);

            // 如果检测到非操作性的时间大幅度跳跃（跳帧），给出提示或强制同步
            if (diff > 1.5 && !art.video.seeking) {
                console.warn(`[ArtPlayer] Playback skip detected: ${diff.toFixed(2)}s`);
            }
            lastRealTime = currentTime;
        });

        // 🎬 核心：监听缓冲状态，在数据不足时主动介入 antisense antisocial
        art.on('video:waiting', () => {
            console.log('[ArtPlayer] Buffer underrun, active management enabled.');
        });

        art.on('video:canplay', () => {
            if (art.video.paused && !art.video.ended && art.video.readyState >= 3) {
                art.play().catch(() => { });
            }
        });

        // 定时上报进度给 Emby (每 15 秒)
        const HEARTBEAT_INTERVAL = 15000;
        let lastReportTime = 0;

        art.on('video:timeupdate', () => {
            const now = Date.now();
            if (now - lastReportTime > HEARTBEAT_INTERVAL) {
                lastReportTime = now;

                // 🎯 核心修复：通过 useRef 实时获取最新的 SessionId
                if (!sessionRef.current) {
                    console.warn('[DEBUG] Skipping heartbeat: sessionRef.current not yet captured.');
                    return;
                }

                const currentTime = art.video.currentTime;
                const positionTicks = Math.floor(currentTime * 10000000);
                console.log(`[DEBUG] Syncing progress: ${currentTime}s | Session: ${sessionRef.current}`);
                apiPost(`/media-servers/${mediaServerId}/playback/progress`, {
                    itemId: currentVodId,
                    positionTicks: isNaN(positionTicks) ? 0 : positionTicks,
                    isPaused: art.video.paused,
                    playSessionId: sessionRef.current,
                    mediaSourceId: mediaSourceId
                }).then(r => console.log('[DEBUG] Progress Response:', r));
            }
        });

        art.on('video:ended', () => {
            if (!sessionRef.current) return;
            const positionTicks = Math.floor(art.video.currentTime * 10000000);
            console.log(`[DEBUG] Video ended. Reporting Stop.`);
            apiPost(`/media-servers/${mediaServerId}/playback/stop`, {
                itemId: currentVodId,
                positionTicks: isNaN(positionTicks) ? 0 : positionTicks,
                playSessionId: sessionRef.current,
                mediaSourceId: mediaSourceId
            }).then(r => console.log('[DEBUG] Stop Response (Ended):', r));
        });

        // 监听暂停和播放事件，立即上报
        art.on('video:pause', () => {
            if (!sessionRef.current) return;
            const positionTicks = Math.floor(art.video.currentTime * 10000000);
            console.log(`[DEBUG] Paused at: ${art.video.currentTime}s | Reporting Stop/Pause to Emby`);
            // 🎬 核心：暂停时同时发送进度，且标记为 IsPaused
            apiPost(`/media-servers/${mediaServerId}/playback/progress`, {
                itemId: currentVodId,
                positionTicks: isNaN(positionTicks) ? 0 : positionTicks,
                isPaused: true,
                playSessionId: sessionRef.current,
                mediaSourceId: mediaSourceId
            }).then(r => console.log('[DEBUG] Pause Response:', r));
        });

        art.on('video:play', () => {
            if (!sessionRef.current) return;
            const positionTicks = Math.floor(art.video.currentTime * 10000000);
            apiPost(`/media-servers/${mediaServerId}/playback/progress`, {
                itemId: currentVodId,
                positionTicks: isNaN(positionTicks) ? 0 : positionTicks,
                isPaused: false,
                playSessionId: sessionRef.current,
                mediaSourceId: mediaSourceId
            });
        });

        art.on('destroy', () => {
            if (art.video && sessionRef.current) {
                const positionTicks = Math.floor(art.video.currentTime * 10000000);
                console.log(`[DEBUG] Player destroying. Final reporting Stop. Session: ${sessionRef.current}`);
                // 🎬 核心：退出前最后一次点击/返回，必须带上 SessionId，否则记录无法归档
                apiPost(`/media-servers/${mediaServerId}/playback/stop`, {
                    itemId: currentVodId,
                    positionTicks: isNaN(positionTicks) ? 0 : positionTicks,
                    playSessionId: sessionRef.current,
                    mediaSourceId: mediaSourceId
                });
            }
        });

        art.on('video:canplay', () => setLoading(false));
        art.on('video:error', () => {
            setLoadError(`播放器错误: ${art.video.error?.code || '未知'}`);
            setLoading(false);
        });
    };

    const savePlayHistory = async (detail?: MediaItemDetail) => {
        const targetDetail = detail || mediaDetail;
        if (!targetDetail) return;
        try {
            await apiPost('/history', {
                source_id: mediaServerId,
                source_type: 'media_server',
                vod_id: currentVodId,
                title: targetDetail.Name,
                cover: currentCover,
                year: targetDetail.ProductionYear?.toString(),
                progress: 0,
                duration: 0
            });
        } catch (err) {
            console.error('[History] Failed to save history:', err);
        }
    };

    // 处理切换推荐内容
    const handleSwitchItem = async (item: SimilarItem) => {
        setLoading(true);
        setLoadError(null);
        try {
            // 需要先获取该项目的播放地址
            const playRes = await apiGet<any>(`/media-servers/${mediaServerId}/playback/${item.Id}`);
            if (playRes.success && playRes.data.streamUrl) {
                setCurrentVodId(item.Id);
                setCurrentTitle(item.Name);
                setCurrentPlayUrl(playRes.data.streamUrl);

                // 获取海报地址
                const serverRes = await apiGet<any[]>('/media-servers');
                const server = serverRes.data?.find(s => s.id === mediaServerId);
                if (server && item.ImageTags.Primary) {
                    const poster = `${server.url}/emby/Items/${item.Id}/Images/Primary?maxWidth=300&tag=${item.ImageTags.Primary}&api_key=${server.api_key}`;
                    setCurrentCover(poster);
                }

                // 🎬 切换时也上报历史记录
                // 获取新详情以确保数据最新
                const detailRes = await apiGet<MediaItemDetail>(`/media-servers/${mediaServerId}/items/${item.Id}`);
                if (detailRes.success && detailRes.data) {
                    savePlayHistory(detailRes.data);
                }
            } else {
                alert('获取推荐内容播放地址失败');
            }
        } catch (err) {
            console.error('Failed to switch item:', err);
        }
    };

    const formatDuration = (ticks?: number) => {
        if (!ticks) return '';
        const minutes = Math.floor(ticks / 10000000 / 60);
        return `${minutes} 分钟`;
    };

    return (
        <div className="p-4 lg:p-6 space-y-4 bg-primary min-h-full overflow-y-auto custom-scrollbar">
            <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-200px)] lg:min-h-[500px]">
                {/* 左侧：播放器区域 (固定高度或按比例) */}
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="relative flex-1 bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 min-h-[300px]">
                        <div className="w-full h-full" ref={wrapperRef}></div>

                        {loading && !loadError && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 backdrop-blur-sm">
                                <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                                <div className="text-white/40 text-[10px] uppercase tracking-widest font-black">Connecting...</div>
                            </div>
                        )}

                        {loadError && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20 p-6 text-center">
                                <i className="fas fa-exclamation-triangle text-red-500 text-3xl mb-4"></i>
                                <h3 className="text-white font-bold mb-2">流媒体载入异常</h3>
                                <p className="text-white/40 text-xs mb-6">{loadError}</p>
                                <button onClick={() => window.location.reload()} className="px-6 py-2 bg-red-500 text-white rounded-full text-xs font-bold">重试</button>
                            </div>
                        )}
                    </div>

                    <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-3 flex-wrap">
                            <button
                                onClick={onGoBack}
                                className="px-3 py-1.5 bg-secondary text-secondary hover:text-primary rounded-lg text-xs transition-colors flex items-center gap-2 border border-border-color shadow-sm"
                            >
                                <i className="fas fa-arrow-left"></i>
                                <span>返回</span>
                            </button>
                            <div className="text-secondary text-sm flex-1 min-w-0">
                                <span className="text-primary font-bold">{mediaDetail?.Name || currentTitle}</span>
                                {mediaDetail?.ProductionYear && (
                                    <span className="ml-2 text-xs opacity-40">({mediaDetail.ProductionYear})</span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={toggleFavorite}
                                className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs transition-all flex items-center justify-center gap-2 font-bold ${isFavorite
                                    ? 'bg-red-500 text-white shadow-lg'
                                    : 'bg-secondary text-secondary hover:text-primary border border-border-color shadow-sm'
                                    }`}
                            >
                                <i className="fas fa-heart"></i>
                                {isFavorite ? '已收藏' : '收藏'}
                            </button>
                            <button
                                onClick={handleRefresh}
                                className="flex-1 sm:flex-none px-4 py-1.5 bg-secondary text-secondary hover:text-primary rounded-lg text-xs transition-all flex items-center justify-center gap-2 border border-border-color shadow-sm"
                            >
                                <i className="fas fa-sync-alt"></i>
                                刷新
                            </button>
                        </div>
                    </div>
                </div>

                {/* 右侧：相似内容推荐 (对标网盘布局) */}
                <div className="lg:w-72 xl:w-80 flex-shrink-0 flex flex-col">
                    <div className="bg-secondary rounded-xl p-4 h-full flex flex-col border border-border-color shadow-xl overflow-hidden">
                        <h3 className="text-primary font-bold mb-3 flex items-center justify-between">
                            <span>
                                <i className="fas fa-magic mr-2 text-blue-500"></i>
                                其它类似
                            </span>
                        </h3>

                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {similarLoading ? (
                                <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>
                            ) : similarItems.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2 p-1">
                                    {similarItems.map((item) => (
                                        <button
                                            key={item.Id}
                                            onClick={() => handleSwitchItem(item)}
                                            className="group flex flex-col bg-white/5 hover:bg-white/10 rounded-lg overflow-hidden transition-all border border-white/5 text-left"
                                        >
                                            <div className="aspect-[2/3] relative overflow-hidden bg-black">
                                                {item.ImageTags.Primary ? (
                                                    <img
                                                        src={`${initialCover.split('/emby/Items/')[0]}/emby/Items/${item.Id}/Images/Primary?maxWidth=200&tag=${item.ImageTags.Primary}&api_key=${initialCover.split('api_key=')[1]}`}
                                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                        alt={item.Name}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center opacity-20"><i className="fas fa-film text-xl"></i></div>
                                                )}
                                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                                                    <span className="text-[9px] text-blue-400 font-black uppercase tracking-tighter">Play Now</span>
                                                </div>
                                            </div>
                                            <div className="p-2 min-w-0">
                                                <div className="text-primary font-bold text-[10px] truncate leading-tight group-hover:text-blue-400 transition-colors">{item.Name}</div>
                                                <div className="text-white/30 text-[9px] mt-0.5 flex justify-between items-center">
                                                    <span>{item.ProductionYear}</span>
                                                    <span className="px-1 bg-white/5 rounded text-[8px]">{item.Type === 'Movie' ? '电影' : item.Type}</span>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-10 text-white/20 text-xs italic">暂无推荐内容</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 下方：媒体详情 (全宽) */}
            <div className="grid grid-cols-1 gap-4">
                <div className="space-y-4">
                    <div className="bg-secondary rounded-xl p-5 border border-border-color shadow-sm flex flex-col md:flex-row gap-6">
                        <div className="flex-1 space-y-4">
                            <h3 className="text-primary font-bold flex items-center gap-2 border-b border-border-color pb-2">
                                <i className="fas fa-info-circle text-blue-400"></i>
                                媒体详情
                            </h3>

                            {detailLoading ? (
                                <div className="py-10 flex justify-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-6 text-sm">
                                    <div className="flex items-start gap-2 py-1.5 border-b border-white/[0.05]">
                                        <span className="text-secondary w-20 flex-shrink-0 text-xs font-semibold">影片名称:</span>
                                        <div className="text-primary text-xs sm:text-sm font-bold">{mediaDetail?.Name}</div>
                                    </div>
                                    <div className="flex items-start gap-2 py-1.5 border-b border-white/[0.05]">
                                        <span className="text-secondary w-20 flex-shrink-0 text-xs font-semibold">发行年份:</span>
                                        <div className="text-primary text-xs sm:text-sm">{mediaDetail?.ProductionYear}</div>
                                    </div>
                                    <div className="flex items-start gap-2 py-1.5 border-b border-white/[0.05]">
                                        <span className="text-secondary w-20 flex-shrink-0 text-xs font-semibold">分级:</span>
                                        <div className="text-primary text-xs sm:text-sm">{mediaDetail?.OfficialRating || '无'}</div>
                                    </div>
                                    <div className="flex items-start gap-2 py-1.5 border-b border-white/[0.05]">
                                        <span className="text-secondary w-20 flex-shrink-0 text-xs font-semibold">时长:</span>
                                        <div className="text-primary text-xs sm:text-sm">{formatDuration(mediaDetail?.RunTimeTicks)}</div>
                                    </div>
                                    <div className="flex items-start gap-2 py-1.5 border-b border-white/[0.05]">
                                        <span className="text-secondary w-20 flex-shrink-0 text-xs font-semibold">类型:</span>
                                        <div className="flex flex-wrap gap-1">
                                            {mediaDetail?.Genres?.map(g => (
                                                <span key={g} className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px] font-medium border border-blue-500/20">#{g}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2 py-1.5 border-b border-white/[0.05]">
                                        <span className="text-secondary w-20 flex-shrink-0 text-xs font-semibold">评分:</span>
                                        <div className="text-yellow-500 font-bold">★ {mediaDetail?.CommunityRating || '0'}</div>
                                    </div>
                                </div>
                            )}

                            {!detailLoading && mediaDetail?.People && (
                                <div className="pt-4 border-t border-border-color">
                                    <div className="text-secondary mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-60">
                                        <i className="fas fa-users text-blue-500"></i>
                                        主演阵容
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        {mediaDetail.People.slice(0, 10).map((person, idx) => (
                                            <div key={idx} className="flex flex-col">
                                                <span className="text-primary text-xs font-bold">{person.Name}</span>
                                                <span className="text-white/30 text-[9px] uppercase">{person.Role || person.Type}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 🚀 封面图：内置到详情卡片右侧 */}
                        {!detailLoading && (
                            <div className="w-full md:w-48 lg:w-56 flex-shrink-0">
                                <div className="rounded-lg overflow-hidden shadow-2xl border border-white/10">
                                    <img
                                        src={currentCover}
                                        alt={currentTitle}
                                        className="w-full h-auto object-cover"
                                        onError={e => (e.target as HTMLImageElement).src = '/poster-fallback.png'}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {!detailLoading && mediaDetail?.Overview && (
                        <div className="bg-secondary rounded-xl p-5 border border-border-color shadow-sm">
                            <h3 className="text-primary font-bold mb-3 flex items-center gap-2">
                                <i className="fas fa-align-left text-green-400"></i>
                                剧情简介
                            </h3>
                            <p className="text-secondary text-sm leading-relaxed whitespace-pre-wrap opacity-80">
                                {mediaDetail.Overview}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div
                className="fixed inset-0 -z-10 opacity-[0.03] blur-[150px] scale-150 pointer-events-none"
                style={{ backgroundImage: `url(${currentCover})`, backgroundSize: 'cover' }}
            ></div>
        </div>
    );
}
