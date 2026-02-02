/**
 * 视频源概览页面
 * 当点击侧边栏某个视频源时，显示该源的多个分类及各分类的视频
 */

import { useState, useEffect, useRef } from 'react';
import { Video, Category } from '../types';
import { apiGet } from '../utils/api';
import { VideoCard } from '../components/VideoCard';


interface SourceOverviewProps {
    sourceId: number;
    sourceName?: string;
    categories: Category[];
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
}

// 分类板块数据
interface CategorySection {
    id: string;
    name: string;
    icon: string;
    color: string;
    videos: Video[];
}

export function SourceOverview({ sourceId, sourceName, categories, onNavigate }: SourceOverviewProps) {
    const [sections, setSections] = useState<CategorySection[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [allTopLevelCats, setAllTopLevelCats] = useState<Category[]>([]);
    const [loadedCount, setLoadedCount] = useState(0);
    const loaderRef = useRef<HTMLDivElement>(null);

    const INITIAL_LOAD = 4;  // 初始加载4个分类
    const LOAD_MORE = 4;     // 每次加载更多4个

    // 分类图标和颜色配置
    const categoryConfigs: { name: string; icon: string; color: string }[] = [
        { name: '电影', icon: 'fas fa-film', color: 'blue' },
        { name: '连续剧', icon: 'fas fa-tv', color: 'green' },
        { name: '电视剧', icon: 'fas fa-tv', color: 'green' },
        { name: '剧集', icon: 'fas fa-tv', color: 'green' },
        { name: '综艺', icon: 'fas fa-masks-theater', color: 'pink' },
        { name: '动漫', icon: 'fas fa-dragon', color: 'purple' },
        { name: '动画', icon: 'fas fa-dragon', color: 'purple' },
        { name: '纪录片', icon: 'fas fa-video', color: 'yellow' },
    ];

    // 加载单个分类的视频
    const loadCategoryVideos = async (cat: Category): Promise<CategorySection | null> => {
        const config = categoryConfigs.find(c => cat.name.includes(c.name)) ||
            { icon: 'fas fa-folder', color: 'gray' };

        // 确保 type_id 是整数格式，兼容那些不支持带 .0 后缀的 ID 的 API
        const cleanCatId = String(Math.floor(Number(cat.type_id)));

        const subCats = categories.filter(c =>
            c.parent_id === parseInt(cleanCatId) ||
            (c.parent_id && String(c.parent_id) === cleanCatId)
        );

        let resultData: Video[] = [];

        // 如果有子分类，从子分类获取视频
        if (subCats.length > 0) {
            for (const subCat of subCats.slice(0, 3)) {
                // 子分类也需要清理 ID
                const cleanSubCatId = String(Math.floor(Number(subCat.type_id)));
                const subVideoRes = await apiGet<Video[]>('/videos', {
                    source_id: sourceId,
                    category_id: cleanSubCatId,
                    page: 1,
                    limit: 12
                });

                if (subVideoRes.success && Array.isArray(subVideoRes.data) && subVideoRes.data.length > 0) {
                    resultData = subVideoRes.data;
                    break;
                }
            }
        }

        // 如果子分类没有数据，尝试一级分类本身
        if (resultData.length === 0) {
            const videoRes = await apiGet<Video[]>('/videos', {
                source_id: sourceId,
                category_id: cleanCatId,
                page: 1,
                limit: 12
            });

            if (videoRes.success && Array.isArray(videoRes.data) && videoRes.data.length > 0) {
                // 检查是否是一级分类特有的内容，或者该源根本就不支持分类筛选（返回了全站最新）
                // 这一点通常在 UI 层面由用户判断，或者我们在这里对比一下视频内容是否完全一致
                resultData = videoRes.data;
            }
        }

        if (resultData.length > 0) {
            return {
                id: cat.type_id,
                name: cat.name,
                icon: config.icon,
                color: config.color,
                videos: resultData.map(v => ({ ...v, source_id: sourceId } as Video))
            };
        }

        return null;
    };

    // 加载更多分类
    const loadMoreCategories = async (startIndex: number, count: number) => {
        if (startIndex >= allTopLevelCats.length) return;

        const catsToLoad = allTopLevelCats.slice(startIndex, startIndex + count);
        const promises = catsToLoad.map(cat => loadCategoryVideos(cat));
        const results = await Promise.all(promises);
        const validSections = results.filter((s): s is CategorySection => s !== null);

        setSections(prev => [...prev, ...validSections]);
        setLoadedCount(startIndex + count);
    };

    // 初始化：筛选和排序顶级分类
    useEffect(() => {
        if (sourceId && categories.length > 0) {
            // 获取所有分类的 type_id 集合
            const allTypeIds = new Set(categories.map(c => String(c.type_id)));

            // 筛选一级分类
            const topLevelCats = categories.filter(c => {
                const isOrphan = c.parent_id && !allTypeIds.has(String(c.parent_id));
                const isRealTopLevel = !c.parent_id || c.parent_id === 0;
                return isRealTopLevel || isOrphan;
            });

            // 按优先级排序
            const priorityKeywords = ['电影', '连续剧', '电视剧', '剧集', '综艺', '动漫', '动画', '纪录片'];
            topLevelCats.sort((a, b) => {
                const indexA = priorityKeywords.findIndex(k => a.name.includes(k));
                const indexB = priorityKeywords.findIndex(k => b.name.includes(k));
                if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                if (indexA !== -1) return -1;
                if (indexB !== -1) return 1;
                return 0;
            });

            setAllTopLevelCats(topLevelCats);
            setSections([]);
            setLoadedCount(0);
        } else {
            setLoading(false);
        }
    }, [sourceId, categories]);

    // 初始加载
    useEffect(() => {
        if (allTopLevelCats.length > 0 && loadedCount === 0) {
            setLoading(true);
            loadMoreCategories(0, INITIAL_LOAD).finally(() => setLoading(false));
        }
    }, [allTopLevelCats]);

    // Intersection Observer 实现滚动懒加载
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !loadingMore && loadedCount < allTopLevelCats.length) {
                    setLoadingMore(true);
                    loadMoreCategories(loadedCount, LOAD_MORE).finally(() => setLoadingMore(false));
                }
            },
            { threshold: 0.1 }
        );

        if (loaderRef.current) {
            observer.observe(loaderRef.current);
        }

        return () => observer.disconnect();
    }, [loadedCount, allTopLevelCats.length, loadingMore]);

    const handleVideoClick = (video: Video) => {
        onNavigate('play', {
            sourceId: video.source_id,
            vodId: video.vod_id
        });
    };

    const handleViewMore = (categoryId: string, categoryName: string) => {
        const subCategories = categories.filter(c =>
            c.parent_id === parseInt(categoryId) ||
            (c.parent_id && String(c.parent_id) === categoryId)
        );

        onNavigate('category', {
            sourceId,
            categoryId,
            categoryName,
            subCategories
        });
    };

    const getColorClasses = (color: string) => {
        const colors: Record<string, { icon: string }> = {
            blue: { icon: 'text-blue-400' },
            green: { icon: 'text-green-400' },
            pink: { icon: 'text-pink-400' },
            purple: { icon: 'text-purple-400' },
            yellow: { icon: 'text-yellow-400' },
            orange: { icon: 'text-orange-400' },
            gray: { icon: 'text-secondary' },
        };
        return colors[color] || colors.gray;
    };

    if (loading) {
        return (
            <div className="p-6 animate-pulse space-y-8">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="space-y-4">
                        <div className="h-6 bg-secondary rounded w-32"></div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                            {[...Array(8)].map((_, j) => (
                                <div key={j} className="aspect-[2/3] bg-secondary rounded-lg"></div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (sections.length === 0 && !loadingMore) {
        return (
            <div className="flex flex-col h-full">
                <div className="flex-1 w-full min-w-0">
                    <div className="p-4 lg:p-6 space-y-8 text-center py-12 text-secondary">
                        <i className="fas fa-film text-4xl mb-4 opacity-50"></i>
                        <p>该视频源暂无内容</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">

            <div className="flex-1 p-4 lg:p-6 space-y-8">
                {/* 视频源标题 */}
                {sourceName && (
                    <div className="flex items-center gap-2">
                        <i className="fas fa-database text-blue-400"></i>
                        <h1 className="text-xl font-bold text-primary">{sourceName}</h1>
                    </div>
                )}

                {/* 分类板块 */}
                {sections.map(section => {
                    const colorClasses = getColorClasses(section.color);

                    return (
                        <section key={section.id}>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                    <i className={`${section.icon} ${colorClasses.icon}`}></i>
                                    {section.name}
                                </h2>
                                <button
                                    onClick={() => handleViewMore(section.id, section.name)}
                                    className="text-sm text-secondary hover:text-primary transition-colors flex items-center gap-1"
                                >
                                    更多
                                    <i className="fas fa-chevron-right text-xs"></i>
                                </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                                {Array.isArray(section.videos) && section.videos.slice(0, 8).map(video => (
                                    <VideoCard
                                        key={`${video.source_id}-${video.vod_id}`}
                                        video={video}
                                        onClick={() => handleVideoClick(video)}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}

                {/* 加载更多触发器 */}
                {loadedCount < allTopLevelCats.length && (
                    <div ref={loaderRef} className="flex justify-center py-8">
                        {loadingMore ? (
                            <div className="flex items-center gap-2 text-secondary">
                                <i className="fas fa-spinner fa-spin"></i>
                                <span>加载更多分类...</span>
                            </div>
                        ) : (
                            <div className="text-secondary text-sm opacity-50">
                                向下滚动加载更多
                            </div>
                        )}
                    </div>
                )}

                {/* 已加载完毕提示 */}
                {loadedCount >= allTopLevelCats.length && sections.length > 0 && (
                    <div className="text-center py-4 text-secondary text-sm opacity-50">
                        已加载全部 {sections.length} 个分类
                    </div>
                )}
            </div>
        </div>
    );
}
