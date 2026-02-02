
import { useEffect, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { apiGet } from '../utils/api';

interface LivePlayerProps {
    sourceId?: number;
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
}

export function LivePlayer({ sourceId, onNavigate }: LivePlayerProps) {
    const playerRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<Artplayer | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [playInfo, setPlayInfo] = useState<{ url: string, type: string } | null>(null);

    useEffect(() => {
        if (!sourceId) return;
        loadPlayUrl();
    }, [sourceId]);

    const loadPlayUrl = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiGet<any>(`/live/play-url/${sourceId}`);
            if (res.success && res.data) {
                setPlayInfo(res.data);
            } else {
                setError(res.message || '无法获取播放地址，可能未开播');
            }
        } catch (e) {
            setError('获取直播流失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!playInfo || !playerRef.current) return;

        // Cleanup previous player
        if (artRef.current) {
            artRef.current.destroy();
            artRef.current = null;
        }

        if (playInfo.type === 'iframe') {
            return; // Iframe will be rendered separately
        }

        // B站等直播流通常需要代理来绕过 CORS 和 Referer 限制
        const useProxy = true; // 默认使用代理以确保稳定性
        // Worker 模式需要完整的绝对 URL，不能使用相对路径
        const baseUrl = window.location.origin;
        const playUrl = useProxy
            ? (playInfo.type === 'm3u8'
                ? `${baseUrl}/api/proxy/hls?url=${encodeURIComponent(playInfo.url)}&proxy=1`
                : `${baseUrl}/api/proxy/stream?url=${encodeURIComponent(playInfo.url)}`)
            : playInfo.url;

        const player = new Artplayer({
            container: playerRef.current,
            url: playUrl,
            type: playInfo.type === 'm3u8' ? 'm3u8' : 'flv',
            isLive: true,
            autoplay: true,
            muted: true, // 必须静音才能在大多数浏览器自动播放
            autoSize: true,
            fullscreen: true,
            fullscreenWeb: true,
            setting: true,
            pip: true,
            theme: '#ef4444',
            customType: {
                m3u8: function (video: HTMLVideoElement, url: string, art: Artplayer) {
                    if (Hls.isSupported()) {
                        const hls = new Hls();
                        hls.loadSource(url);
                        hls.attachMedia(video);
                        (art as any).hls = hls;
                        art.on('destroy', () => hls.destroy());
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = url;
                    }
                },
                flv: function (video: HTMLVideoElement, url: string, art: Artplayer) {
                    if (mpegts.isSupported()) {
                        const mpegtsPlayer = mpegts.createPlayer({
                            type: 'flv',
                            isLive: true,
                            url: url,
                        }, {
                            enableWorker: true,
                            enableStashBuffer: false, // 禁用缓存以降低直播延迟
                            stashInitialSize: 128,
                        });
                        mpegtsPlayer.attachMediaElement(video);
                        mpegtsPlayer.load();

                        // 显式调用播放，处理自动播放限制
                        const playPromise = mpegtsPlayer.play();
                        if (playPromise && (playPromise as any).catch) {
                            (playPromise as any).catch((e: any) => {
                                console.warn('[LivePlayer] mpegts play failed, probably needs user interaction:', e);
                            });
                        }

                        // 错误处理
                        mpegtsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
                            console.error('[LivePlayer] mpegts error:', type, detail, info);
                            setError(`播放引擎错误: ${type} - ${detail}`);
                        });

                        (art as any).mpegts = mpegtsPlayer;
                        art.on('destroy', () => mpegtsPlayer.destroy());
                    }
                }
            }
        });

        artRef.current = player;

        return () => {
            if (artRef.current) {
                artRef.current.destroy(false);
                artRef.current = null;
            }
        };
    }, [playInfo]);

    if (!sourceId) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-secondary">
                <i className="fas fa-broadcast-tower text-6xl mb-4 opacity-30"></i>
                <p>请选择直播间开始观看</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-black text-primary">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500 mb-4 mx-auto"></div>
                    <p>正在解析直播流...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full bg-black text-primary p-6">
                <div className="text-center max-w-md">
                    <i className="fas fa-exclamation-triangle text-yellow-500 text-5xl mb-4"></i>
                    <p className="text-xl font-bold mb-2">出错了</p>
                    <p className="text-secondary mb-6">{error}</p>
                    <button
                        onClick={() => onNavigate('live')}
                        className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-full transition-colors"
                    >
                        返回列表
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-black relative">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-[100] transition-opacity flex justify-between items-center group-hover:opacity-100 opacity-100">
                <button
                    onClick={() => onNavigate('live')}
                    className="text-primary/80 hover:text-primary flex items-center gap-2"
                >
                    <i className="fas fa-arrow-left"></i>
                    <span>返回直播列表</span>
                </button>
            </div>

            <div className="flex-1 relative">
                {playInfo?.type === 'iframe' ? (
                    <iframe
                        src={playInfo.url}
                        className="w-full h-full border-0"
                        allowFullScreen
                        allow="autoplay; encrypted-media"
                    ></iframe>
                ) : (
                    <div ref={playerRef} className="w-full h-full"></div>
                )}
            </div>
        </div>
    );
}
