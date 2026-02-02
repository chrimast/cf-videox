import { useState, useEffect, useMemo } from 'react';
import { Favorite, VideoSource, NetdiskSource } from '../types';
import { apiGet, apiDelete } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

interface FavoritesProps {
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
    sources: VideoSource[];
    netdiskSources: NetdiskSource[];
}

export function Favorites({ onNavigate, sources, netdiskSources }: FavoritesProps) {
    const { isAuthenticated } = useAuth();
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadFavorites();
    }, []);

    const loadFavorites = async () => {
        setLoading(true);
        const res = await apiGet<Favorite[]>('/favorites');
        if (res.success && res.data) {
            setFavorites(res.data);
        }
        setLoading(false);
    };

    // 过滤收藏夹内容：未登录时隐藏来自“隐藏源”的内容
    const filteredFavorites = useMemo(() => {
        if (isAuthenticated) return favorites;

        // 获取所有隐藏源的 ID
        const hiddenCmsIds = new Set(sources.filter(s => s.hidden).map(s => s.id));
        const hiddenNetdiskIds = new Set(netdiskSources.filter(s => s.hidden).map(s => s.id));

        return favorites.filter(fav => {
            if (fav.source_type === 'netdisk') {
                return !hiddenNetdiskIds.has(fav.source_id);
            }
            // 默认为 cms 资源站
            return !hiddenCmsIds.has(fav.source_id);
        });
    }, [favorites, isAuthenticated, sources, netdiskSources]);

    const handleRemove = async (id: number) => {
        const res = await apiDelete(`/favorites/${id}`);
        if (res.success) {
            setFavorites(prev => prev.filter(f => f.id !== id));
        }
    };

    const handleClick = (fav: Favorite) => {
        if (fav.source_type === 'netdisk') {
            onNavigate('netdisk_play', {
                sourceId: fav.source_id,
                mediaId: parseInt(fav.vod_id)
            });
        } else if (fav.source_type === 'media_server') {
            onNavigate('media_server_play', {
                mediaServerId: fav.source_id,
                vodId: fav.vod_id,
                title: fav.title,
                url: '',
                cover: fav.cover
            });
        } else {
            onNavigate('play', {
                sourceId: fav.source_id,
                vodId: fav.vod_id
            });
        }
    };

    if (loading) {
        return (
            <div className="p-6 animate-pulse">
                <div className="h-8 bg-secondary rounded w-32 mb-6"></div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                    {[...Array(16)].map((_, i) => (
                        <div key={i} className="aspect-[2/3] bg-secondary rounded-lg"></div>
                    ))}
                </div>
            </div>
        );
    }

    // 未登录硬拦截（如果产品决定直接拦截页面）
    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-secondary">
                <div className="w-20 h-20 bg-secondary/50 rounded-full flex items-center justify-center mb-6">
                    <i className="fas fa-lock text-3xl"></i>
                </div>
                <h2 className="text-xl font-bold text-primary mb-2">访问受限</h2>
                <p className="mb-6">请先登录管理员账号以查看收藏记录</p>
                <button
                    onClick={() => onNavigate('home')}
                    className="px-6 py-2 bg-blue-600 text-primary rounded-lg hover:bg-blue-700 transition-colors"
                >
                    返回首页
                </button>
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-6 space-y-6">
            <h1 className="text-2xl font-bold text-primary">我的收藏</h1>

            {filteredFavorites.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                    {filteredFavorites.map(fav => (
                        <div
                            key={fav.id}
                            className="video-card bg-secondary rounded-lg overflow-hidden cursor-pointer group"
                        >
                            <div
                                className="relative"
                                onClick={() => handleClick(fav)}
                            >
                                <img
                                    src={fav.cover}
                                    alt={fav.title}
                                    className="video-cover w-full"
                                    loading="lazy"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,...';
                                    }}
                                />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 
                                              transition-opacity flex items-center justify-center">
                                    <i className="fas fa-play text-3xl text-primary"></i>
                                </div>
                                {fav.source_name && (
                                    <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-blue-500/90 
                                                   text-[10px] text-white font-bold rounded-md backdrop-blur-sm z-20">
                                        {fav.source_name}
                                    </span>
                                )}
                            </div>
                            <div className="p-3">
                                <h3 className="text-primary text-sm font-medium line-clamp-1">
                                    {fav.title}
                                </h3>
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-secondary text-xs">{fav.year}</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemove(fav.id);
                                        }}
                                        className="text-secondary hover:text-red-400 transition-colors"
                                    >
                                        <i className="fas fa-trash text-sm"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-12 text-secondary">
                    <i className="fas fa-heart text-4xl mb-4 opacity-50"></i>
                    <p>暂无收藏</p>
                    <p className="text-sm mt-2">浏览视频时点击爱心图标添加收藏</p>
                </div>
            )}
        </div>
    );
}
