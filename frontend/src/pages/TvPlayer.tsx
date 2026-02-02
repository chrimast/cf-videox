
import { useEffect, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';

interface TvPlayerProps {
    tvSourceId?: number;
    channelUrl?: string;
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
}

export function TvPlayer({ tvSourceId, channelUrl, onNavigate }: TvPlayerProps) {
    const playerRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<Artplayer | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [useProxy, setUseProxy] = useState(false);

    // Compute actual URL to play
    const playUrl = useProxy && channelUrl
        ? `/api/proxy/hls?url=${encodeURIComponent(channelUrl)}`
        : channelUrl;

    useEffect(() => {
        if (!playUrl) return;

        // Cleanup previous player
        if (artRef.current) {
            artRef.current.destroy();
            artRef.current = null;
        }

        setError(null);

        const initPlayer = () => {
            if (!playerRef.current) return;

            const player = new Artplayer({
                container: playerRef.current,
                url: playUrl,
                type: 'm3u8',
                isLive: true, // Identify as live stream
                autoplay: true,
                autoSize: true, // Adjust to container
                fullscreen: true,
                fullscreenWeb: true,
                flip: true,
                playbackRate: true,
                aspectRatio: true,
                setting: true,
                pip: true,
                mutex: true,
                theme: '#ef4444',
                customType: {
                    m3u8: function (video: HTMLVideoElement, url: string, art: Artplayer) {
                        if (Hls.isSupported()) {
                            if ((art as any).hls) (art as any).hls.destroy();
                            const hls = new Hls();
                            hls.loadSource(url);
                            hls.attachMedia(video);
                            (art as any).hls = hls;
                            art.on('destroy', () => hls.destroy());

                            hls.on(Hls.Events.ERROR, function (_event, data) {
                                if (data.fatal) {
                                    switch (data.type) {
                                        case Hls.ErrorTypes.NETWORK_ERROR:
                                            console.log('fatal network error encountered');
                                            if (!useProxy) {
                                                console.log('Auto-switching to proxy mode');
                                                art.notice.show = '连接失败，自动切换代理模式...';
                                                setUseProxy(true);
                                            } else {
                                                console.log('try to recover');
                                                hls.startLoad();
                                            }
                                            break;
                                        case Hls.ErrorTypes.MEDIA_ERROR:
                                            console.log('fatal media error encountered, try to recover');
                                            hls.recoverMediaError();
                                            break;
                                        default:
                                            hls.destroy();
                                            setError('播放发生致命错误，请尝试刷新或切换线路');
                                            break;
                                    }
                                }
                            });
                        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                            video.src = url;
                        } else {
                            art.notice.show = 'Unsupported playback format: m3u8';
                        }
                    }
                }
            });

            player.on('ready', () => {
                console.log('TV Player ready');
                player.play();
            });

            player.on('error', (error) => {
                console.error('TV Player error:', error);
                setError('播放出错了，请尝试切换频道或使用代理模式');
            });

            artRef.current = player;
        };

        // Small delay to ensure container is ready
        const timer = setTimeout(initPlayer, 100);

        return () => {
            clearTimeout(timer);
            if (artRef.current) {
                artRef.current.destroy(false);
                artRef.current = null;
            }
        };

    }, [playUrl]);

    if (!channelUrl) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-secondary">
                <i className="fas fa-tv text-6xl mb-4 opacity-30"></i>
                <p>请从左侧选择频道开始观看</p>
                {tvSourceId && <p className="text-xs mt-2 opacity-50">当前源ID: {tvSourceId}</p>}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-black relative group">
            {/* 顶部简单的返回/标题栏 (鼠标悬停显示) */}
            <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-[100] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex justify-between items-center">
                <button
                    onClick={() => onNavigate('home')}
                    className="pointer-events-auto text-primary/80 hover:text-primary flex items-center gap-2"
                >
                    <i className="fas fa-arrow-left"></i>
                    <span>返回</span>
                </button>
                <div className="ml-auto flex items-center gap-2 pointer-events-auto">
                    <button
                        onClick={() => {
                            console.log('Toggling proxy:', !useProxy);
                            setUseProxy(!useProxy);
                        }}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5
                            ${useProxy
                                ? 'bg-green-500/20 border-green-500/50 text-green-400'
                                : 'bg-white/10 border-white/20 text-primary hover:text-primary'
                            }`}
                        title={useProxy ? "当前使用代理播放 (解决跨域)" : "直接播放 (速度更快)"}
                    >
                        <i className={`fas ${useProxy ? 'fa-shield-alt' : 'fa-bolt'}`}></i>
                        {useProxy ? '代理模式' : '直连模式'}
                    </button>
                    {error && (
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-red-500/80 hover:bg-red-500 text-primary text-xs px-3 py-1.5 rounded-full"
                        >
                            <i className="fas fa-redo mr-1"></i>重试
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 relative overflow-hidden">
                <div ref={playerRef} className="w-full h-full absolute inset-0"></div>

                {error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                        <div className="text-center">
                            <i className="fas fa-exclamation-circle text-red-500 text-3xl mb-2"></i>
                            <p className="text-primary">{error}</p>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}
