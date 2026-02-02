
/**
 * 首页 - 聚合版 (Cache-First)
 * 读取 /api/home 缓存数据，实现秒开及多源聚合
 */
import { useState, useEffect } from 'react';
import { Video } from '../types';
import { apiGet, apiPost } from '../utils/api';
import { VideoCard } from '../components/VideoCard';
import { useAppNavigate } from '../contexts/NavigationContext';

// 首页数据结构 (对应后端 /api/home 返回)
interface HomeData {
    hot: Video[];
    movie: Record<string, Video[]>;   // latest, action, comedy...
    tv: Record<string, Video[]>;      // latest, hk, kr...
    anime: Record<string, Video[]>;   // latest, cn, jp...
    variety: Record<string, Video[]>; // latest, cn, western...
}

interface SectionConfig {
    id: Exclude<keyof HomeData, 'hot'>; // Exclude 'hot' as it's handled separately
    title: string;
    icon: string;
    color: string;
    tabs: { key: string; label: string }[];
}

// 板块配置
const SECTIONS: SectionConfig[] = [
    {
        id: 'movie',
        title: '电影',
        icon: 'fas fa-film',
        color: 'blue',
        tabs: [
            { key: 'latest', label: '最新' },
            { key: 'action', label: '动作' },
            { key: 'romance', label: '爱情' },
            { key: 'comedy', label: '喜剧' },
            { key: 'scifi', label: '科幻' },
            { key: 'horror', label: '恐怖' },
            { key: 'drama', label: '剧情' },
            { key: 'war', label: '战争' },
            { key: 'documentary', label: '纪录' },
            { key: 'animation', label: '动画' },
            { key: 'crime', label: '犯罪' },
            { key: 'fantasy', label: '奇幻' },
            { key: 'suspense', label: '悬疑' },
            { key: 'disaster', label: '灾难' },
        ]
    },
    {
        id: 'tv',
        title: '电视剧',
        icon: 'fas fa-tv',
        color: 'green',
        tabs: [
            { key: 'latest', label: '最新' },
            { key: 'cn', label: '国产剧' },
            { key: 'hk', label: '港剧' },
            { key: 'tw', label: '台剧' },
            { key: 'kr', label: '韩剧' },
            { key: 'jp', label: '日剧' },
            { key: 'western', label: '欧美剧' },
            { key: 'sea', label: '泰剧' },
        ]
    },
    {
        id: 'anime',
        title: '动漫',
        icon: 'fas fa-dragon',
        color: 'purple',
        tabs: [
            { key: 'latest', label: '最新' },
            { key: 'cn', label: '国漫' },
            { key: 'jp', label: '日漫' },
            { key: 'western', label: '欧美' },
        ]
    },
    {
        id: 'variety',
        title: '综艺',
        icon: 'fas fa-masks-theater',
        color: 'pink',
        tabs: [
            { key: 'latest', label: '最新' },
            { key: 'cn', label: '大陆综艺' },
            { key: 'hk_tw', label: '港台综艺' },
            { key: 'jp_kr', label: '日韩综艺' },
            { key: 'western', label: '欧美综艺' },
        ]
    }
];

export function Home() {
    const navigate = useAppNavigate();
    const [data, setData] = useState<HomeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [refreshingSection, setRefreshingSection] = useState<string | null>(null);
    // 记录每个板块当前选中的 Tab (默认为 'latest')
    const [activeTabs, setActiveTabs] = useState<Record<string, string>>({
        movie: 'latest',
        tv: 'latest',
        anime: 'latest',
        variety: 'latest'
    });

    useEffect(() => {
        loadData();

        // 监听同步消息
        const channel = new BroadcastChannel('video-plugin-sync');
        channel.onmessage = (event) => {
            if (event.data === 'sources-updated' || event.data === 'home-refreshed') {
                console.log('[Home] Data updated in another window, reloading...');
                loadData(false); // 静默重载
            }
        };
        return () => channel.close();
    }, []);

    const loadData = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            // 1. 先获取缓存数据
            const res = await apiGet<{ data: HomeData; lastUpdated: string | null }>('/home');

            if (res.success && res.data) {
                setData(res.data.data);

                // 2. 判断是否需要自动刷新 (24小时刷新一次)
                if (res.data.lastUpdated) {
                    const lastUpdated = new Date(res.data.lastUpdated);
                    const now = new Date();
                    const hoursDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

                    if (hoursDiff > 24) {
                        console.log(`[Home] Cache is stale (${hoursDiff.toFixed(1)}h old), triggering refresh`);
                        setUpdating(true);
                        await loadDataStream();
                    } else {
                        console.log(`[Home] Cache is fresh (${hoursDiff.toFixed(1)}h old)`);
                    }
                } else {
                    console.log('[Home] No lastUpdated timestamp, triggering initial refresh');
                    setUpdating(true);
                    await loadDataStream();
                }
            }
        } catch (error) {
            console.error('[Home] Failed to load home data:', error);
            // 降级：尝试直接流式加载
            try {
                await loadDataStream();
            } catch (e) {
                console.error('[Home] Stream fallback failed:', e);
            }
        } finally {
            if (showLoading) setLoading(false);
            setUpdating(false);
        }
    };

    const loadDataStream = async () => {
        try {
            const token = localStorage.getItem('auth_token');
            const url = new URL(`${window.location.origin}/api/home`);
            url.searchParams.append('stream', 'true');

            const response = await fetch(url.toString(), {
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    'X-No-Compression': 'true'
                }
            });

            if (!response.body) throw new Error('ReadableStream not supported');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.replace('data: ', '').trim();
                        if (dataStr === '[DONE]') {
                            setUpdating(false);
                            console.log('[Home] SSE Stream finished');
                            continue;
                        }

                        try {
                            const message = JSON.parse(dataStr);
                            if (message.type === 'cache') {
                                setData(message.data);
                                setLoading(false);
                            } else if (message.type === 'update') {
                                const { section, sub, data: newData } = message;
                                setData(prev => {
                                    if (!prev) return null;
                                    if (section === 'hot') {
                                        return { ...prev, hot: newData };
                                    }
                                    return {
                                        ...prev,
                                        [section]: {
                                            ...(prev[section as keyof HomeData] || {}),
                                            [sub]: newData
                                        }
                                    };
                                });
                            }
                        } catch (e) {
                            console.error('[Home] Parse SSE error:', e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Home] Stream error:', error);
            throw error;
        }
    };

    const refreshSingleSection = async (section: string) => {
        try {
            setRefreshingSection(section);
            const res = await apiPost<any>('/home/refresh-section', { section });

            if (res.success && res.data) {
                setData(prev => {
                    if (!prev) return null;
                    if (section === 'hot') {
                        return { ...prev, hot: res.data };
                    }
                    return {
                        ...prev,
                        [section]: res.data
                    };
                });
            }
        } catch (error) {
            console.error(`[Home] Refresh section ${section} error:`, error);
        } finally {
            setRefreshingSection(null);
        }
    };

    const handleVideoClick = (video: Video) => {
        navigate('play', {
            sourceId: video.source_id,
            vodId: video.vod_id
        });
    };

    const handleTabChange = (sectionId: string, tabKey: string) => {
        setActiveTabs(prev => ({
            ...prev,
            [sectionId]: tabKey
        }));
    };

    // 获取颜色类
    const getColorClasses = (color: string) => {
        const colors: Record<string, { icon: string; tab: string; activeTab: string }> = {
            blue: { icon: 'text-blue-400', tab: 'hover:text-blue-400', activeTab: 'bg-blue-500' },
            green: { icon: 'text-green-400', tab: 'hover:text-green-400', activeTab: 'bg-green-500' },
            pink: { icon: 'text-pink-400', tab: 'hover:text-pink-400', activeTab: 'bg-pink-500' },
            purple: { icon: 'text-purple-400', tab: 'hover:text-purple-400', activeTab: 'bg-purple-500' },
            yellow: { icon: 'text-yellow-400', tab: 'hover:text-yellow-400', activeTab: 'bg-yellow-500' },
            orange: { icon: 'text-orange-400', tab: 'hover:text-orange-400', activeTab: 'bg-orange-500' },
        };
        return colors[color] || colors.blue;
    };

    if (loading) {
        return (
            <div className="p-6 animate-pulse space-y-8">
                {/* 骨架屏 */}
                {[...Array(3)].map((_, i) => (
                    <div key={i}>
                        <div className="h-6 w-32 bg-secondary rounded mb-4"></div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                            {[...Array(8)].map((__, j) => (
                                <div key={j} className="aspect-[2/3] bg-secondary rounded-lg"></div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (!data) {
        return (
            <div className="text-center py-20 text-secondary">
                <p>暂无数据，后台可能正在初始化...</p>
                <button onClick={() => loadData()} className="mt-4 text-blue-400 hover:underline">刷新重试</button>
            </div>
        );
    }

    return (
        <div className="pt-0 px-4 lg:px-6 space-y-10 pb-20">

            {/* 1. 正在热映 (Fixed Section) */}
            <section>
                <div className="flex items-center justify-between mb-4 px-1">
                    <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                        <i className="fas fa-fire text-orange-500"></i>
                        正在热映
                        {updating && (
                            <span className="ml-2 text-xs font-normal text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full animate-pulse">
                                <i className="fas fa-sync-alt fa-spin mr-1"></i>
                                正在更新最新内容...
                            </span>
                        )}
                    </h2>
                    <button
                        onClick={() => refreshSingleSection('hot')}
                        disabled={refreshingSection === 'hot'}
                        className="text-secondary hover:text-primary transition-colors disabled:opacity-50"
                        title="刷新正在热映"
                    >
                        <i className={`fas fa-sync-alt ${refreshingSection === 'hot' ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 sm:gap-4 lg:gap-5">
                    {data.hot?.slice(0, 16).map(video => (
                        <VideoCard
                            key={`hot-${video.source_id}-${video.vod_id}`}
                            video={video}
                            onClick={() => handleVideoClick(video)}
                        />
                    ))}
                </div>
            </section>

            {/* 2. 各大分类板块 (Movie, TV, Anime, Variety) */}
            {SECTIONS.map(section => {
                const colorClasses = getColorClasses(section.color);
                const currentTab = activeTabs[section.id] || 'latest';

                // 类型安全访问: 排除 'hot' 后，section.id 只能是 movie/tv/anime/variety
                // 它们的值都是 Record<string, Video[]>
                const sectionData = data[section.id] as Record<string, Video[]>;
                const videos = sectionData ? (sectionData[currentTab] || []) : [];

                return (
                    <section key={section.id}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3 px-1">
                            {/* 标题 */}
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-bold text-primary flex items-center gap-2 shrink-0">
                                    <i className={`${section.icon} ${colorClasses.icon}`}></i>
                                    {section.title}
                                </h2>
                                <button
                                    onClick={() => refreshSingleSection(section.id)}
                                    disabled={refreshingSection === section.id}
                                    className="text-secondary hover:text-primary transition-colors disabled:opacity-50"
                                    title={`刷新${section.title}`}
                                >
                                    <i className={`fas fa-sync-alt ${refreshingSection === section.id ? 'fa-spin' : ''}`}></i>
                                </button>
                            </div>

                            {/* Tabs (Scrollable) */}
                            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                                {section.tabs.map(tab => (
                                    <button
                                        key={tab.key}
                                        onClick={() => handleTabChange(section.id, tab.key)}
                                        className={`px-3 py-1 text-sm rounded-full transition-all whitespace-nowrap
                                            ${currentTab === tab.key
                                                ? `${colorClasses.activeTab} text-white shadow-md`
                                                : `text-secondary hover:text-primary hover:bg-white/10`
                                            }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 视频网格 */}
                        {videos.length > 0 ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 sm:gap-4 lg:gap-5 min-h-[200px]">
                                {videos.slice(0, 16).map((video: Video) => (
                                    <VideoCard
                                        key={`${section.id}-${currentTab}-${video.source_id}-${video.vod_id}`}
                                        video={video}
                                        onClick={() => handleVideoClick(video)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-10 text-gray-600 bg-secondary/30 rounded-lg">
                                <i className="fas fa-inbox text-3xl mb-2 opacity-50"></i>
                                <p className="text-sm">暂无该分类数据</p>
                            </div>
                        )}
                    </section>
                );
            })}

        </div>
    );
}
