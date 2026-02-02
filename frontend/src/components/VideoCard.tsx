import { memo } from 'react';
import { Video } from '../types';

interface VideoCardProps {
    video: Video;
    onClick: () => void;
    showSource?: boolean;
    sourceName?: string;
}

export const VideoCard = memo(({ video, onClick, showSource = false, sourceName }: VideoCardProps) => {
    // 优先使用外部传入的 sourceName，其次使用 video.source_name
    const displaySourceName = sourceName || video.source_name;

    return (
        <div
            onClick={onClick}
            className="video-card group relative bg-secondary rounded-xl overflow-hidden cursor-pointer transition-all duration-300 transform-gpu will-change-transform"
        >
            <div className="video-card-inner absolute inset-0 border border-transparent rounded-xl transition-colors duration-300 pointer-events-none z-10"></div>

            {/* 封面 - 固定比例防止抖动 */}
            <div className="relative aspect-[2/3] overflow-hidden bg-gray-800">
                <img
                    src={video.vod_pic}
                    alt=""
                    className="video-cover w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 ease-out"
                    loading="lazy"
                    onError={(e) => {
                        (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"%3E%3Crect fill="%2323272f" width="100" height="150"/%3E%3Ctext x="50" y="75" text-anchor="middle" dy=".3em" fill="%2364748b" font-size="12"%3E暂无图片%3C/text%3E%3C/svg%3E';
                    }}
                />

                {/* 悬停遮罩 */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 
                                transition-opacity flex items-center justify-center z-20">
                    <i className="fas fa-play-circle text-4xl text-primary/90 drop-shadow-lg"></i>
                </div>

                {/* 更新状态 */}
                {video.vod_remarks && !video.is_netdisk && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-red-500/90 
                                   text-[10px] font-bold text-white rounded-md backdrop-blur-sm z-20">
                        {video.vod_remarks}
                    </span>
                )}

                {/* 评分 */}
                {video.vod_score && parseFloat(video.vod_score) > 0 && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/40 
                                   text-[10px] font-bold text-yellow-400 rounded-md backdrop-blur-md border border-border-color flex items-center gap-1 z-20">
                        <i className="fas fa-star text-[8px]"></i>
                        {video.vod_score}
                    </span>
                )}

                {/* 视频源标签 */}
                {showSource && displaySourceName && (
                    <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-blue-500/90 
                                   text-[10px] text-white font-bold rounded-md backdrop-blur-sm z-20">
                        {displaySourceName}
                    </span>
                )}
            </div>

            {/* 信息 - 固定高度防止排版抖动 */}
            <div className="p-3 bg-secondary/30 backdrop-blur-sm relative z-20 h-[68px]">
                <h3 className="text-primary text-sm font-semibold line-clamp-1 group-hover:text-blue-400 transition-colors" title={video.vod_name}>
                    {video.vod_name}
                </h3>
                <div className="flex items-center justify-between mt-1.5">
                    <span className="text-secondary text-[11px] font-medium opacity-80">
                        {video.vod_year || video.type_name}
                    </span>
                    {video.vod_area && (
                        <span className="text-secondary text-[10px] px-1.5 py-0.5 bg-tertiary rounded-md border border-border-color">
                            {video.vod_area}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});
