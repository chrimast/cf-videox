/**
 * 视频播放器组件 - 封装 ArtPlayer
 */

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

export interface VideoPlayerProps {
    url: string;
    poster?: string;
    onTimeUpdate?: (currentTime: number, duration: number) => void;
    onEnded?: () => void;
    onError?: (error: Error) => void;
    autoplay?: boolean;
}

export interface VideoPlayerRef {
    play: () => void;
    pause: () => void;
    seek: (time: number) => void;
    getCurrentTime: () => number;
    getDuration: () => number;
    destroy: () => void;
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
    ({ url, poster, onTimeUpdate, onEnded, onError, autoplay = true }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const playerRef = useRef<any>(null);
        const progressSaveInterval = useRef<NodeJS.Timeout | null>(null);

        useImperativeHandle(ref, () => ({
            play: () => playerRef.current?.play(),
            pause: () => playerRef.current?.pause(),
            seek: (time: number) => {
                if (playerRef.current) {
                    playerRef.current.currentTime = time;
                }
            },
            getCurrentTime: () => playerRef.current?.currentTime || 0,
            getDuration: () => playerRef.current?.duration || 0,
            destroy: () => {
                if (progressSaveInterval.current) {
                    clearInterval(progressSaveInterval.current);
                }
                playerRef.current?.destroy();
            }
        }));

        useEffect(() => {
            if (!containerRef.current || !url) return;

            const initPlayer = async () => {
                try {
                    // 清除旧播放器
                    if (playerRef.current) {
                        playerRef.current.destroy();
                    }

                    const Artplayer = (await import('artplayer')).default;

                    // 判断是否是 m3u8
                    const isHls = url.includes('.m3u8') || url.includes('m3u8');

                    const art = new Artplayer({
                        container: containerRef.current!,
                        url,
                        poster,
                        autoplay,
                        autoSize: true,
                        aspectRatio: true,
                        fullscreen: true,
                        fullscreenWeb: true,
                        setting: true,
                        playbackRate: true,
                        pip: true,
                        mutex: true,
                        theme: '#ef4444',
                        volume: 0.7,
                        moreVideoAttr: {
                            crossOrigin: 'anonymous',
                        },
                        customType: isHls ? {
                            m3u8: async (video: HTMLVideoElement, videoUrl: string) => {
                                const Hls = (await import('hls.js')).default;
                                if (Hls.isSupported()) {
                                    const hls = new Hls({
                                        enableWorker: true,
                                        lowLatencyMode: true,
                                    });
                                    hls.loadSource(videoUrl);
                                    hls.attachMedia(video);
                                    hls.on(Hls.Events.ERROR, (_event, data) => {
                                        if (data.fatal) {
                                            onError?.(new Error(`HLS Error: ${data.type}`));
                                        }
                                    });
                                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                                    video.src = videoUrl;
                                }
                            },
                        } : undefined,
                    });

                    // 进度更新事件
                    art.on('video:timeupdate', () => {
                        onTimeUpdate?.(art.currentTime, art.duration);
                    });

                    // 播放结束事件
                    art.on('video:ended', () => {
                        onEnded?.();
                    });

                    // 错误事件
                    art.on('error', (error: Error) => {
                        console.error('[VideoPlayer] Error:', error);
                        onError?.(error);
                    });

                    playerRef.current = art;
                } catch (error) {
                    console.error('[VideoPlayer] Failed to initialize:', error);
                    onError?.(error as Error);
                }
            };

            initPlayer();

            return () => {
                if (progressSaveInterval.current) {
                    clearInterval(progressSaveInterval.current);
                }
                if (playerRef.current) {
                    playerRef.current.destroy();
                    playerRef.current = null;
                }
            };
        }, [url]);

        return (
            <div
                ref={containerRef}
                className="w-full aspect-video bg-black rounded-lg overflow-hidden"
            />
        );
    }
);

VideoPlayer.displayName = 'VideoPlayer';
