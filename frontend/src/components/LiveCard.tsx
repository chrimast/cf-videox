import { LiveSource, LiveStatus } from '../types';

interface LiveCardProps {
    source: LiveSource;
    status?: LiveStatus;
    onClick?: () => void;
}

const PLATFORM_COLORS: Record<string, string> = {
    bilibili: 'bg-pink-500/20 text-pink-400',
    douyin: 'bg-red-500/20 text-red-400',
    douyu: 'bg-orange-500/20 text-orange-400',
    youtube: 'bg-red-600/20 text-red-500',
    yy: 'bg-yellow-500/20 text-yellow-400',
    huya: 'bg-orange-600/20 text-orange-500',
};

const PLATFORM_NAMES: Record<string, string> = {
    bilibili: 'B站',
    douyin: '抖音',
    douyu: '斗鱼',
    youtube: 'YouTube',
    yy: 'YY',
    huya: '虎牙',
};

function formatViewerCount(count: number): string {
    if (count >= 10000) {
        return `${(count / 10000).toFixed(1)}万`;
    }
    return count.toString();
}

export function LiveCard({ source, status, onClick }: LiveCardProps) {
    const isLive = status?.is_live === 1;

    return (
        <div
            className="relative rounded-lg overflow-hidden bg-secondary hover:scale-105 transition-all duration-200 cursor-pointer group"
            onClick={onClick}
        >
            {/* 封面 */}
            <div className="relative w-full aspect-[4/3] bg-secondary">
                {(status?.cover_url || source.cover_url) ? (
                    <img
                        src={status?.cover_url || source.cover_url}
                        alt={source.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <i className="fas fa-video text-4xl text-gray-700"></i>
                    </div>
                )}

                {/* 直播中标签 */}
                {isLive && (
                    <div className="absolute top-2 left-2 px-2 py-1 bg-red-500 text-primary text-xs rounded-md flex items-center gap-1">
                        <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                        直播中
                    </div>
                )}

                {/* 观看人数 */}
                {isLive && status.viewer_count && status.viewer_count > 0 && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/70 text-primary text-xs rounded-md flex items-center gap-1">
                        <i className="fas fa-eye"></i>
                        {formatViewerCount(status.viewer_count)}
                    </div>
                )}

                {/* 遮罩层 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>

            {/* 信息 */}
            <div className="p-3">
                <div className="flex items-center gap-2 mb-2">
                    {/* 主播头像 */}
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex-shrink-0 border border-gray-600">
                        {status?.avatar_url ? (
                            <img src={status.avatar_url} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <i className="fas fa-user text-xs text-secondary"></i>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-primary font-medium truncate text-sm leading-tight">
                            {source.streamer_name || source.name}
                        </h3>
                    </div>
                </div>

                {isLive && status.title && (
                    <p className="text-secondary text-xs truncate mb-2 leading-tight opacity-80">
                        {status.title}
                    </p>
                )}

                <div className="flex items-center justify-between mt-auto">
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded leading-none ${PLATFORM_COLORS[source.platform] || 'bg-gray-700/50 text-secondary'
                        }`}>
                        {PLATFORM_NAMES[source.platform] || source.platform}
                    </span>

                    {source.category && (
                        <span className="text-secondary text-[10px] truncate max-w-[60px]">{source.category}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
