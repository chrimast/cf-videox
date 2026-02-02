import { useState, useEffect, useRef } from 'react';
import { Video, Category as CategoryType, Pagination } from '../types';
import { apiGet } from '../utils/api';
import { VideoCard } from '../components/VideoCard';

interface CategoryProps {
    sourceId?: number;
    categoryId?: string;
    categoryName?: string;
    subCategories?: CategoryType[];  // 子分类列表
    categories?: CategoryType[];     // 完整分类列表
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
}

// 子分类板块数据（支持分页）
interface SubCategorySection {
    id: string;
    name: string;
    videos: Video[];
    page: number;
    hasMore: boolean;
    loading: boolean;
}

// 每行显示的视频数量（8列布局）
const VIDEOS_PER_ROW = 8;
// 初始显示行数（3行，24个位置，23个视频+1个加载更多）
const INITIAL_ROWS = 3;
// 初始显示数量：3行 * 8 - 1 = 23
const INITIAL_COUNT = INITIAL_ROWS * VIDEOS_PER_ROW - 1;
// 每次加载更多的数量
const LOAD_MORE_COUNT = 16;

export function Category({ sourceId, categoryId, categoryName, subCategories, onNavigate }: CategoryProps) {
    const [videos, setVideos] = useState<Video[]>([]);
    const [sections, setSections] = useState<SubCategorySection[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [pagination, setPagination] = useState<Pagination | null>(null);
    const [page, setPage] = useState(1);

    // 无限滚动引用
    const loaderRef = useRef<HTMLDivElement>(null);

    // 判断是否有子分类（显示概览视图）
    const hasSubCategories = subCategories && subCategories.length > 0;

    // 当 sourceId 或 categoryId 变化时重新加载
    useEffect(() => {
        if (sourceId) {
            setPage(1);
            if (hasSubCategories) {
                loadSubCategoryVideos();
            } else {
                loadVideos(sourceId, categoryId || null, 1, true);
            }
        }
    }, [sourceId, categoryId, subCategories]);

    // 加载子分类视频（概览模式）
    const loadSubCategoryVideos = async () => {
        if (!sourceId || !subCategories) return;

        setLoading(true);

        try {
            const newSections: SubCategorySection[] = [];

            // 显示所有子分类
            for (const cat of subCategories) {
                // 确保 type_id 是整数格式的字符串，去除 .0 后缀
                const cleanTypeId = String(Math.floor(Number(cat.type_id)));

                const videoRes = await apiGet<Video[]>('/videos', {
                    source_id: sourceId,
                    category_id: cleanTypeId,
                    page: 1,
                    limit: 20  // 回滚到20，避免500错误
                });

                if (videoRes.success && Array.isArray(videoRes.data) && videoRes.data.length > 0) {
                    // 使用 pagination 判断是否有更多页
                    const hasMore = videoRes.pagination
                        ? videoRes.pagination.page < videoRes.pagination.pagecount
                        : videoRes.data.length >= 20;

                    newSections.push({
                        id: cat.type_id,
                        name: cat.name,
                        videos: videoRes.data.slice(0, INITIAL_COUNT).map(v => ({ ...v, source_id: sourceId })),
                        page: 1,
                        hasMore,
                        loading: false
                    });
                }
            }

            setSections(newSections);
        } catch (error) {
            console.error('[Category] Failed to load sub-category videos:', error);
        } finally {
            setLoading(false);
        }
    };

    // 子分类加载更多
    const loadMoreForSection = async (sectionId: string) => {
        if (!sourceId) return;

        // 标记该 section 为加载中
        setSections(prev => prev.map(s =>
            s.id === sectionId ? { ...s, loading: true } : s
        ));

        const section = sections.find(s => s.id === sectionId);
        if (!section) return;

        try {
            const nextPage = section.page + 1;
            // 确保 type_id 是整数
            const cleanSectionId = String(Math.floor(Number(sectionId)));

            const videoRes = await apiGet<Video[]>('/videos', {
                source_id: sourceId,
                category_id: cleanSectionId,
                page: nextPage,
                limit: LOAD_MORE_COUNT + 1  // 多请求1个来判断是否还有更多
            });

            if (videoRes.success && Array.isArray(videoRes.data)) {
                const hasMore = videoRes.data.length > LOAD_MORE_COUNT;
                const newVideos = videoRes.data.slice(0, LOAD_MORE_COUNT).map(v => ({ ...v, source_id: sourceId }));

                setSections(prev => prev.map(s =>
                    s.id === sectionId
                        ? {
                            ...s,
                            videos: [...s.videos, ...newVideos],
                            page: nextPage,
                            hasMore,
                            loading: false
                        }
                        : s
                ));
            }
        } catch (error) {
            console.error('[Category] Failed to load more videos:', error);
            setSections(prev => prev.map(s =>
                s.id === sectionId ? { ...s, loading: false } : s
            ));
        }
    };

    // 加载单个分类视频（列表模式）
    const loadVideos = async (srcId: number, catId: string | null, pg: number, reset: boolean) => {
        if (reset) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }

        try {
            const params: Record<string, unknown> = {
                source_id: srcId,
                page: pg,
                limit: 20 // 回滚到20
            };
            if (catId) {
                // 确保 type_id 是整数
                params.category_id = String(Math.floor(Number(catId)));
            }

            const res = await apiGet<Video[]>('/videos', params);

            if (res.success && Array.isArray(res.data)) {
                const newVideos = res.data.map(v => ({ ...v, source_id: srcId }));
                if (reset) {
                    setVideos(newVideos);
                } else {
                    setVideos(prev => [...prev, ...newVideos]);
                }
                if (res.pagination) {
                    setPagination(res.pagination);
                }
            }
        } catch (error) {
            console.error('[Category] Failed to load videos:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const loadMore = () => {
        if (!loadingMore && sourceId && pagination && page < pagination.pagecount) {
            const nextPage = page + 1;
            setPage(nextPage);
            loadVideos(sourceId, categoryId || null, nextPage, false);
        }
    };

    // 监听滚动到底部自动加载（仅在列表模式下）
    useEffect(() => {
        if (hasSubCategories || loading || !pagination || page >= pagination.pagecount) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !loadingMore) {
                    loadMore();
                }
            },
            { threshold: 0.1 }
        );

        if (loaderRef.current) {
            observer.observe(loaderRef.current);
        }

        return () => {
            if (loaderRef.current) {
                observer.unobserve(loaderRef.current);
            }
        };
    }, [hasSubCategories, loading, loadingMore, pagination, page]);

    const handleVideoClick = (video: Video) => {
        onNavigate('play', {
            sourceId: video.source_id,
            vodId: video.vod_id
        });
    };

    return (
        <>

            {loading ? (
                <div className="p-6 animate-pulse space-y-8">
                    {hasSubCategories ? (
                        // 概览模式骨架
                        [...Array(3)].map((_, i) => (
                            <div key={i} className="space-y-4">
                                <div className="h-6 bg-secondary rounded w-32"></div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                                    {[...Array(INITIAL_COUNT + 1)].map((_, j) => (
                                        <div key={j} className="aspect-[2/3] bg-secondary rounded-lg"></div>
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : (
                        // 列表模式骨架
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                            {[...Array(24)].map((_, i) => (
                                <div key={i} className="aspect-[2/3] bg-secondary rounded-lg"></div>
                            ))}
                        </div>
                    )}
                </div>
            ) : hasSubCategories ? (
                // 子分类概览模式
                (() => {
                    if (sections.length === 0) {
                        return (
                            <div className="p-6 text-center py-12 text-secondary">
                                <i className="fas fa-film text-4xl mb-4 opacity-50"></i>
                                <p>该分类暂无内容</p>
                            </div>
                        );
                    }

                    return (
                        <div className="p-4 lg:p-6 space-y-8">
                            {/* 分类标题 */}
                            {categoryName && (
                                <div className="flex items-center gap-2">
                                    <i className="fas fa-folder text-red-400"></i>
                                    <h1 className="text-xl font-bold text-primary">{categoryName}</h1>
                                </div>
                            )}

                            {/* 子分类板块 */}
                            {sections.map(section => (
                                <section key={section.id}>
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                            <i className="fas fa-tag text-secondary"></i>
                                            {section.name}
                                            <span className="text-sm text-secondary font-normal">
                                                ({section.videos.length}+)
                                            </span>
                                        </h2>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                                        {section.videos.map(video => (
                                            <VideoCard
                                                key={`${video.source_id} -${video.vod_id} `}
                                                video={video}
                                                onClick={() => handleVideoClick(video)}
                                            />
                                        ))}
                                        {/* "加载更多"卡片 - 始终显示在最后位置 */}
                                        {section.hasMore && (
                                            <button
                                                onClick={() => loadMoreForSection(section.id)}
                                                disabled={section.loading}
                                                className="aspect-[2/3] bg-secondary/50 rounded-lg border-2 border-dashed border-border-color 
                                                         hover:border-red-500 hover:bg-secondary transition-all duration-300
                                                         flex flex-col items-center justify-center gap-3 group
                                                         disabled:opacity-50 disabled:cursor-wait"
                                            >
                                                {section.loading ? (
                                                    <>
                                                        <div className="w-14 h-14 rounded-full bg-gray-700 
                                                                      flex items-center justify-center">
                                                            <i className="fas fa-spinner fa-spin text-2xl text-red-400"></i>
                                                        </div>
                                                        <span className="text-secondary text-sm font-medium">
                                                            加载中...
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="w-14 h-14 rounded-full bg-gray-700 group-hover:bg-red-500/20 
                                                                      flex items-center justify-center transition-colors">
                                                            <i className="fas fa-plus text-2xl text-secondary group-hover:text-red-400 transition-colors"></i>
                                                        </div>
                                                        <span className="text-secondary group-hover:text-primary text-sm font-medium transition-colors">
                                                            加载更多
                                                        </span>
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </section>
                            ))}
                        </div>
                    );
                })()
            ) : (
                // 普通列表模式无需包裹在额外的 div，直接返回 div 结构即可
                // 但由于我们统一用 fragment 包裹，这里的 return 需要是 JSX.Element
                <div className="p-4 lg:p-6 space-y-4">
                    {/* 当前分类标题 */}
                    {categoryName && (
                        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                            <i className="fas fa-folder text-red-400"></i>
                            {categoryName}
                        </h2>
                    )}

                    {/* 视频网格 */}
                    {videos.length > 0 ? (
                        <>
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                                {videos.map(video => (
                                    <VideoCard
                                        key={`${video.source_id} -${video.vod_id} `}
                                        video={video}
                                        onClick={() => handleVideoClick(video)}
                                    />
                                ))}
                            </div>

                            {/* 探针：用于触发无限滚动加载 */}
                            <div ref={loaderRef} className="h-10 flex items-center justify-center mt-4">
                                {pagination && page < pagination.pagecount && (
                                    <div className="flex items-center gap-2 text-secondary text-sm">
                                        <i className="fas fa-spinner fa-spin"></i>
                                        <span>正在加载更多内容... ({page} / {pagination.pagecount})</span>
                                    </div>
                                )}
                                {pagination && page >= pagination.pagecount && videos.length > 0 && (
                                    <span className="text-secondary text-sm italic">已经到底啦 ~</span>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-12 text-secondary">
                            <i className="fas fa-film text-4xl mb-4 opacity-50"></i>
                            <p>暂无视频</p>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
