import { useState, useEffect } from 'react';
import { apiPost } from '../utils/api';

interface TmdbResult {
    tmdb_id: number;
    title: string;
    original_title: string;
    media_type: 'movie' | 'tv';
    release_date?: string;
    first_air_date?: string;
    poster?: string;
    overview: string;
    vote_average: number;
}

interface TmdbCorrectModalProps {
    mediaId: number;
    initialQuery: string;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function TmdbCorrectModal({ mediaId, initialQuery, isOpen, onClose, onSuccess }: TmdbCorrectModalProps) {
    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState<TmdbResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState<number | null>(null);

    const handleSearch = async () => {
        if (!query.trim()) return;
        setLoading(true);
        try {
            const res = await apiPost<TmdbResult[]>(`/netdisk/media/${mediaId}/tmdb-search`, { query });
            if (res.success && res.data) {
                setResults(res.data);
            }
        } catch (err) {
            console.error('Search failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleApply = async (tmdbId: number, type: string) => {
        setApplying(tmdbId);
        try {
            const res = await apiPost(`/netdisk/media/${mediaId}/tmdb-apply`, {
                tmdb_id: tmdbId,
                media_type: type
            });
            if (res.success) {
                onSuccess();
                onClose();
            } else {
                alert('应用失败: ' + res.error);
            }
        } catch (err) {
            alert('请求异常');
        } finally {
            setApplying(null);
        }
    };

    useEffect(() => {
        if (isOpen && initialQuery) {
            setQuery(initialQuery);
            handleSearch();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-300">
            <div className="bg-secondary border border-border-color rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                {/* 头部 */}
                <div className="px-6 py-4 border-b border-border-color flex items-center justify-between bg-white/[0.03] dark:bg-white/[0.03] light:bg-black/[0.03]">
                    <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                        <i className="fas fa-magic text-blue-400"></i>
                        识别修正
                    </h2>
                    <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
                        <i className="fas fa-times text-lg"></i>
                    </button>
                </div>

                {/* 搜索栏 */}
                <div className="p-6 pb-2">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-secondary/50"></i>
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder="输入影视名称进行搜索..."
                                className="w-full pl-12 pr-4 py-3 bg-white/5 text-primary rounded-xl border border-border-color 
                                         focus:border-blue-500/50 focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all placeholder:text-secondary/30"
                            />
                        </div>
                        <button
                            onClick={handleSearch}
                            disabled={loading}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20 active:scale-95"
                        >
                            {loading ? <i className="fas fa-spinner fa-spin"></i> : '搜 索'}
                        </button>
                    </div>
                    <p className="mt-3 text-[10px] text-secondary/60 flex items-center gap-1.5 px-1 font-medium italic">
                        <i className="fas fa-info-circle text-blue-400/70"></i>
                        提示：修正后系统将自动加锁，人工修正过的数据不会被后续扫描覆盖
                    </p>
                </div>

                {/* 结果列表 */}
                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-3 custom-scrollbar">
                    {results.length === 0 && !loading && (
                        <div className="py-20 text-center text-secondary opacity-30">
                            <i className="fas fa-search text-5xl mb-4"></i>
                            <p className="text-sm">输入关键词开始重新匹配</p>
                        </div>
                    )}

                    {results.map((item) => (
                        <div
                            key={`${item.media_type}-${item.tmdb_id}`}
                            className="group flex gap-4 p-4 bg-tertiary/20 hover:bg-tertiary/50 border border-border-color rounded-2xl transition-all duration-300 cursor-default"
                        >
                            <div className="w-20 sm:w-24 aspect-[2/3] rounded-lg overflow-hidden flex-shrink-0 bg-secondary shadow-lg border border-border-color">
                                {item.poster ? (
                                    <img
                                        src={item.poster}
                                        alt={item.title}
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-secondary/30">
                                        <i className="fas fa-image text-3xl"></i>
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                                <div>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <h3 className="text-primary font-bold truncate text-base sm:text-lg tracking-tight" title={item.title}>
                                            {item.title || item.original_title}
                                        </h3>
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${item.media_type === 'movie' ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'}`}>
                                            {item.media_type === 'movie' ? '电影' : '剧集'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 mb-2.5">
                                        <span className="text-secondary/80 text-[11px] font-bold bg-secondary px-2 py-0.5 rounded">
                                            {(item.release_date || item.first_air_date || '未知年份').split('-')[0]}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-yellow-500 font-bold text-[11px]">
                                            <i className="fas fa-star text-[10px]"></i>
                                            {item.vote_average.toFixed(1)}
                                        </span>
                                    </div>
                                    <p className="text-secondary/70 text-xs line-clamp-2 leading-relaxed font-medium">
                                        {item.overview || '暂无内容简介...'}
                                    </p>
                                </div>
                                <div className="mt-4 flex justify-end">
                                    <button
                                        onClick={() => handleApply(item.tmdb_id, item.media_type)}
                                        disabled={applying !== null}
                                        className={`px-5 py-2 rounded-xl text-xs font-black transition-all shadow-sm
                                                  ${applying === item.tmdb_id
                                                ? 'bg-blue-600/50 text-white animate-pulse'
                                                : 'bg-blue-600/10 text-blue-500 hover:bg-blue-600 hover:text-white hover:shadow-blue-600/30'}`}
                                    >
                                        {applying === item.tmdb_id ? (
                                            <><i className="fas fa-circle-notch fa-spin mr-2"></i>处理中...</>
                                        ) : (
                                            <><i className="fas fa-check-circle mr-1.5"></i>应用匹配</>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
