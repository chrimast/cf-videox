import { useState, useEffect, useCallback } from 'react';
import { Video } from '../types';

interface BannerProps {
    videos: Video[];
    onClick: (video: Video) => void;
}

export function Banner({ videos, onClick }: BannerProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);

    // 自动轮播
    useEffect(() => {
        if (!isAutoPlaying || videos.length <= 1) return;

        const timer = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % videos.length);
        }, 5000);

        return () => clearInterval(timer);
    }, [isAutoPlaying, videos.length]);

    const goTo = useCallback((index: number) => {
        setCurrentIndex(index);
        setIsAutoPlaying(false);
        // 5秒后恢复自动播放
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, []);

    const goPrev = useCallback(() => {
        goTo((currentIndex - 1 + videos.length) % videos.length);
    }, [currentIndex, videos.length, goTo]);

    const goNext = useCallback(() => {
        goTo((currentIndex + 1) % videos.length);
    }, [currentIndex, videos.length, goTo]);

    if (videos.length === 0) return null;

    const currentVideo = videos[currentIndex];

    return (
        <div className="banner-container relative aspect-[21/9] lg:aspect-[3/1] bg-secondary group">
            {/* 背景图 */}
            <div className="absolute inset-0">
                <img
                    src={currentVideo.vod_pic}
                    alt={currentVideo.vod_name}
                    className="w-full h-full object-cover"
                    loading="eager"
                />
                {/* 渐变遮罩 */}
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
            </div>

            {/* 内容 */}
            <div className="absolute inset-0 flex items-center">
                <div className="p-6 lg:p-10 max-w-xl">
                    <h2 className="text-2xl lg:text-4xl font-bold text-primary mb-2 line-clamp-2">
                        {currentVideo.vod_name}
                    </h2>
                    <div className="flex items-center gap-3 text-sm text-primary mb-4">
                        {currentVideo.vod_year && <span>{currentVideo.vod_year}</span>}
                        {currentVideo.vod_area && <span>{currentVideo.vod_area}</span>}
                        {currentVideo.vod_class && <span>{currentVideo.vod_class}</span>}
                        {currentVideo.vod_score && parseFloat(currentVideo.vod_score) > 0 && (
                            <span className="text-yellow-400">
                                <i className="fas fa-star mr-1"></i>
                                {currentVideo.vod_score}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => onClick(currentVideo)}
                        className="px-6 py-3 bg-red-500 text-primary rounded-lg font-medium
                                 hover:bg-red-600 transition-colors flex items-center gap-2"
                    >
                        <i className="fas fa-play"></i>
                        立即播放
                    </button>
                </div>
            </div>

            {/* 左右箭头 */}
            {videos.length > 1 && (
                <>
                    <button
                        onClick={goPrev}
                        className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 
                                 bg-black/50 text-primary rounded-full opacity-0 group-hover:opacity-100
                                 transition-opacity flex items-center justify-center hover:bg-black/70"
                    >
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <button
                        onClick={goNext}
                        className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 
                                 bg-black/50 text-primary rounded-full opacity-0 group-hover:opacity-100
                                 transition-opacity flex items-center justify-center hover:bg-black/70"
                    >
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </>
            )}

            {/* 指示器 */}
            {videos.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                    {videos.map((_, index) => (
                        <button
                            key={index}
                            onClick={() => goTo(index)}
                            className={`w-2 h-2 rounded-full transition-all ${index === currentIndex
                                ? 'w-6 bg-red-500'
                                : 'bg-white/50 hover:bg-white/80'
                                }`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
