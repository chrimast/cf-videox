import { useState, useEffect } from 'react';
import { LiveSource, LiveStatus } from '../types';
import { apiGet, apiPost } from '../utils/api';
import { LiveCard } from '../components/LiveCard';

const PLATFORMS = [
    { value: 'all', label: '全部平台' },
    { value: 'bilibili', label: 'B站' },
    { value: 'douyin', label: '抖音' },
];

interface LiveProps {
    platform?: string;
    onPlay?: (sourceId: number) => void;
}

export function Live({ platform, onPlay }: LiveProps) {
    const [sources, setSources] = useState<LiveSource[]>([]);
    const [statusMap, setStatusMap] = useState<Record<number, LiveStatus>>({});
    const [loading, setLoading] = useState(true);
    const [selectedPlatform, setSelectedPlatform] = useState<string>(platform || 'all');
    const [showLiveOnly, setShowLiveOnly] = useState(false);

    useEffect(() => {
        if (platform) {
            setSelectedPlatform(platform);
        }
    }, [platform]);

    useEffect(() => {
        loadData();
    }, []);

    // 监听全局导航参数（如果 App.tsx 用了 Provider，这里可以用 context）
    // 但目前 App.tsx 直接渲染组件，我们需要在 App.tsx 层面传 props。

    const loadData = async (forceRefresh = false) => {
        setLoading(true);
        try {
            // 如果是强制刷新，先调用后端刷新所有直播状态
            if (forceRefresh) {
                console.log('[Live] Refreshing all live status...');
                await apiPost('/live/refresh-all');
            }

            // 获取直播源
            const sourcesRes = await apiGet<LiveSource[]>('/live/sources');
            if (sourcesRes.success && sourcesRes.data) {
                setSources(sourcesRes.data.filter(s => s.enabled === 1));
            }

            // 获取直播状态
            const statusRes = await apiGet<any[]>('/live/status');
            if (statusRes.success && statusRes.data) {
                const map: Record<number, LiveStatus> = {};
                statusRes.data.forEach(item => {
                    if (item.is_live !== undefined) {
                        map[item.id] = {
                            source_id: item.id,
                            is_live: item.is_live,
                            title: item.title,
                            viewer_count: item.viewer_count,
                            stream_url: item.stream_url,
                            cover_url: item.current_cover,
                            avatar_url: item.current_avatar,
                            updated_at: item.status_updated_at
                        };
                    }
                });
                setStatusMap(map);
            }
        } catch (error) {
            console.error('Failed to load live data:', error);
        } finally {
            setLoading(false);
        }
    };

    // 筛选源
    const filteredSources = sources.filter(source => {
        if (selectedPlatform !== 'all' && source.platform !== selectedPlatform) return false;
        if (showLiveOnly && !statusMap[source.id]?.is_live) return false;
        return true;
    });

    // 按平台分组
    const groupedByPlatform = PLATFORMS.filter(p => p.value !== 'all').reduce((acc, platform) => {
        const platformSources = filteredSources.filter(s => s.platform === platform.value);
        if (platformSources.length > 0) {
            acc[platform.value] = {
                label: platform.label,
                sources: platformSources
            };
        }
        return acc;
    }, {} as Record<string, { label: string; sources: LiveSource[] }>);

    const handleCardClick = (source: LiveSource) => {
        if (onPlay) {
            onPlay(source.id);
        } else {
            // Fallback to old behavior if no callback
            const status = statusMap[source.id];
            if (status?.stream_url) {
                window.open(status.stream_url, '_blank');
            } else {
                const platformUrls: Record<string, string> = {
                    bilibili: `https://live.bilibili.com/${source.channel_id}`,
                    douyin: `https://live.douyin.com/${source.channel_id}`,
                };
                const url = platformUrls[source.platform];
                if (url) {
                    window.open(url, '_blank');
                }
            }
        }
    };

    if (loading) {
        return (
            <div className="p-6 space-y-4">
                <div className="animate-pulse space-y-4">
                    <div className="h-10 bg-secondary rounded w-64"></div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {[...Array(12)].map((_, i) => (
                            <div key={i} className="h-48 bg-secondary rounded"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* 筛选栏 */}
            <div className="flex flex-wrap gap-3 items-center">
                <h1 className="text-2xl font-bold text-primary">直播</h1>

                <select
                    value={selectedPlatform}
                    onChange={e => setSelectedPlatform(e.target.value)}
                    className="px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                >
                    {PLATFORMS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                </select>

                <label className="flex items-center gap-2 text-primary cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showLiveOnly}
                        onChange={e => setShowLiveOnly(e.target.checked)}
                        className="rounded"
                    />
                    只看直播中
                </label>

                <button
                    onClick={() => loadData(true)}
                    disabled={loading}
                    className="ml-auto px-4 py-2 bg-secondary text-primary rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                    <i className={`fas fa-sync-alt ${loading ? 'animate-spin' : ''}`}></i>
                    {loading ? '刷新中...' : '刷新'}
                </button>
            </div>

            {/* 按平台分组展示 */}
            {selectedPlatform === 'all' ? (
                <div className="space-y-8">
                    {Object.entries(groupedByPlatform).map(([platform, data]) => (
                        <section key={platform}>
                            <h2 className="text-xl font-bold text-primary mb-4 flex items-center gap-2">
                                <span>{data.label}</span>
                                <span className="text-sm text-secondary">({data.sources.length})</span>
                            </h2>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                                {data.sources.map(source => (
                                    <LiveCard
                                        key={source.id}
                                        source={source}
                                        status={statusMap[source.id]}
                                        onClick={() => handleCardClick(source)}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                    {filteredSources.map(source => (
                        <LiveCard
                            key={source.id}
                            source={source}
                            status={statusMap[source.id]}
                            onClick={() => handleCardClick(source)}
                        />
                    ))}
                </div>
            )}

            {filteredSources.length === 0 && (
                <div className="text-center py-16 text-secondary">
                    <i className="fas fa-broadcast-tower text-6xl mb-4 opacity-50"></i>
                    <p className="text-lg">暂无直播源</p>
                    <p className="text-sm mt-2">请到后台管理添加直播源</p>
                </div>
            )}
        </div>
    );
}
