/**
 * 网盘媒体库页面
 * 三级视图结构：
 * 1. 全部网盘视图（类似 SourceOverview）：各网盘源作为板块，每板块显示部分媒体 + "更多"
 * 2. 网盘源视图（类似 Category 子分类概览）：扫描目录作为板块，22个媒体+1个加载更多卡片，点击扩展
 * 3. 扫描目录视图（类似 Category 列表）：显示该目录下的全部媒体，支持无限滚动
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { NetdiskSource } from '../types';
import { apiGet, apiPost } from '../utils/api';
import { NetdiskFilter } from '../components/NetdiskFilter';
import { useAuth } from '../contexts/AuthContext';
import { VirtuosoGrid } from 'react-virtuoso';
import { ContextMenu } from '../components/ContextMenu';
import { TmdbCorrectModal } from '../components/TmdbCorrectModal';
import { PosterPickerModal } from '../components/PosterPickerModal';

interface MediaItem {
    id: number;
    source_id: number;
    path: string;
    title: string;
    original_title?: string;
    year?: number;
    overview?: string;
    poster_url?: string;
    fanart_url?: string;
    rating?: number;
    genres: string[];
    media_type: string;
    tmdb_id?: number;
    video_files: string[];
    nfo_parsed: number;
    actor?: string;
}

interface ScanStatus {
    scanning: boolean;
    progress: number;
    total: number;
    message?: string;
}

interface MediaGroup {
    name: string;
    path: string;
    items: MediaItem[];
    total: number;
}

// 网盘源板块数据（全部网盘视图用）
interface SourceSection {
    sourceId: number;
    sourceName: string;
    sourceType: string;
    items: MediaItem[];
    total: number;
    path?: string;     // 新增：具体扫描路径
    pathName?: string; // 新增：具体扫描路径名称
}

// 扫描目录板块数据（支持分页扩展）
interface DirectorySection {
    path: string;
    name: string;
    items: MediaItem[];
    total: number;
    offset: number;
    hasMore: boolean;
    loading: boolean;
}

interface NetdiskProps {
    sourceId?: number;
    selectedPath?: string;
    onPlay?: (mediaId: number, sourceId: number, videoIndex?: number) => void;
}

// 每行显示的视频数量（8列布局）
const VIDEOS_PER_ROW = 8;
// 初始显示行数（4行，31个位置，30个视频+1个加载更多）
const INITIAL_ROWS = 4;
// 初始显示数量：4行 * 8 - 1 = 31（实际显示30个视频+1个加载更多卡片）
const INITIAL_COUNT = INITIAL_ROWS * VIDEOS_PER_ROW - 1;
// 每次加载更多的数量
const LOAD_MORE_COUNT = 16;
// 全部网盘视图每个网盘源显示的数量
const SOURCE_PREVIEW_COUNT = 8;

// 视图层级
type ViewLevel = 'all' | 'source' | 'directory';
type ViewMode = 'default' | 'date' | 'collection' | 'category' | 'tag';

interface GroupInfo {
    key: string;
    name: string;
    covers: string[];  // 最多4个封面
    count: number;
}

export function Netdisk({ sourceId, selectedPath, onPlay }: NetdiskProps) {
    const [sources, setSources] = useState<NetdiskSource[]>([]);
    const [sourcesLoaded, setSourcesLoaded] = useState(false);
    const [sourceSections, setSourceSections] = useState<SourceSection[]>([]);
    const [directorySections, setDirectorySections] = useState<DirectorySection[]>([]);
    const [media, setMedia] = useState<MediaItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 24;

    // 当前视图层级
    const [currentLevel, setCurrentLevel] = useState<ViewLevel>('all');
    const [currentSourceId, setCurrentSourceId] = useState<number | null>(null);

    // 筛选状态
    const [activeFilters, setActiveFilters] = useState<{
        genres?: string; year?: number; area?: string; actor?: string; studio?: string;
        series?: string; tags?: string; date?: string; sort?: string
    }>({});
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    // 交互状态
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: MediaItem } | null>(null);
    const [correctModal, setCorrectModal] = useState<{ mediaId: number, query: string } | null>(null);
    const [posterPicker, setPosterPicker] = useState<{ mediaId: number, title: string } | null>(null);

    // 聚合视图状态
    const [viewMode, setViewMode] = useState<ViewMode>('default');
    const [groupedData, setGroupedData] = useState<GroupInfo[]>([]);

    // 监听窗口大小变化及全局同步消息
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);

        // 监听同步消息
        const channel = new BroadcastChannel('video-plugin-sync');
        channel.onmessage = (event) => {
            if (event.data === 'sources-updated') {
                // 同步网盘源
                loadSources();
            }
        };

        return () => {
            window.removeEventListener('resize', handleResize);
            channel.close();
        };
    }, []);
    const [currentPath, setCurrentPath] = useState<string | null>(null);

    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);



    // 同步外部 props 到内部状态
    useEffect(() => {
        if (sourceId !== undefined) {
            if (selectedPath) {
                setCurrentLevel('directory');
                setCurrentSourceId(sourceId);
                setCurrentPath(selectedPath);
            } else {
                setCurrentLevel('source');
                setCurrentSourceId(sourceId);
                setCurrentPath(null);
            }
        } else {
            setCurrentLevel('all');
            setCurrentSourceId(null);
            setCurrentPath(null);
        }
    }, [sourceId, selectedPath]);

    // 加载网盘源
    useEffect(() => {
        loadSources();
    }, []);

    // 🚀 视图切换时清空筛选条件
    useEffect(() => {
        if (viewMode !== 'default') {
            setActiveFilters({});
        }
    }, [viewMode]);

    // 根据层级加载数据
    useEffect(() => {
        if (!sourcesLoaded) return;

        if (viewMode !== 'default') {
            loadGroupedData();
        } else if (currentLevel === 'all' && sources.length > 0) {
            loadAllSourcesSections();
        } else if (currentLevel === 'source' && currentSourceId) {
            loadDirectorySections(currentSourceId, activeFilters);
            pollScanStatus(currentSourceId);
        } else if (currentLevel === 'directory' && currentSourceId && currentPath) {
            loadMediaByPath(currentSourceId, currentPath, 1, true);
            pollScanStatus(currentSourceId);
        }
    }, [currentLevel, currentSourceId, currentPath, sources, sourcesLoaded, activeFilters, viewMode]);

    // 加载聚合分组数据
    const loadGroupedData = async () => {
        const sid = currentSourceId || sources.filter(s => s.enabled)[0]?.id;
        if (!sid) return;

        setLoading(true);
        try {
            const res = await apiGet<GroupInfo[]>(`/netdisk/media/groups?sourceId=${sid}&viewType=${viewMode}${currentPath ? `&path=${encodeURIComponent(currentPath)}` : ''}`);
            if (res.success && res.data) {
                setGroupedData(res.data);
            }
        } catch (error) {
            console.error('[Netdisk] Failed to load grouped data:', error);
        } finally {
            setLoading(false);
        }
    };


    const { isAuthenticated } = useAuth();
    const loadSources = async () => {
        try {
            const res = await apiGet<NetdiskSource[]>('/netdisk/sources');
            if (res.success && res.data) {
                setSources(res.data.filter(s => s.enabled && (isAuthenticated || !s.hidden)));
            }
            setSourcesLoaded(true);
        } catch (err) {
            console.error('Failed to load netdisk sources:', err);
        }
    };

    // 加载全部网盘源的板块数据（类似 SourceOverview）
    // 修改逻辑：优先按扫描目录聚合，如果没有目录则按源聚合
    const loadAllSourcesSections = async () => {
        setLoading(true);
        try {
            const enabledSources = sources.filter(s => s.enabled);
            const allSections: SourceSection[] = [];

            for (const source of enabledSources) {
                // 解析扫描目录
                let scanPaths: any[] = [];
                try {
                    if (typeof source.scan_paths === 'string') {
                        scanPaths = JSON.parse(source.scan_paths);
                    } else if (Array.isArray(source.scan_paths)) {
                        scanPaths = source.scan_paths;
                    }
                } catch (e) {
                    console.error(`Failed to parse scan_paths for source ${source.id}:`, e);
                }

                // 过滤掉隐藏的路径
                const activePaths = scanPaths.filter(p => !p.hidden);

                if (activePaths.length > 0) {
                    // 情况 A：有下级目录，为每个目录创建一个板块
                    const pathPromises = activePaths.map(async (pathObj) => {
                        let url = `/netdisk/media?sourceId=${source.id}&path=${encodeURIComponent(pathObj.path)}&limit=${SOURCE_PREVIEW_COUNT}&sort=${activeFilters.sort || 'latest'}`;

                        // 应用过滤
                        if (activeFilters.genres) url += `&genres=${encodeURIComponent(activeFilters.genres)}`;
                        if (activeFilters.year) url += `&year=${activeFilters.year}`;
                        if (activeFilters.area) url += `&area=${encodeURIComponent(activeFilters.area)}`;
                        if (activeFilters.actor) url += `&actor=${encodeURIComponent(activeFilters.actor)}`;
                        if (activeFilters.tags) url += `&tags=${encodeURIComponent(activeFilters.tags)}`;

                        const res = await apiGet<MediaItem[]>(url);
                        if (res.success && res.data && res.data.length > 0) {
                            return {
                                sourceId: source.id,
                                sourceName: source.name,
                                sourceType: source.type || 'alist',
                                items: res.data,
                                total: (res as any).total || res.data.length,
                                path: pathObj.path,
                                pathName: pathObj.name
                            } as SourceSection;
                        }
                        return null;
                    });

                    const results = await Promise.all(pathPromises);
                    allSections.push(...results.filter((s): s is SourceSection => s !== null));
                } else {
                    // 情况 B：没有下级目录，保持原有的按源聚合逻辑
                    let url = `/netdisk/media?sourceId=${source.id}&limit=${SOURCE_PREVIEW_COUNT}&sort=${activeFilters.sort || 'latest'}`;
                    if (activeFilters.genres) url += `&genres=${encodeURIComponent(activeFilters.genres)}`;
                    if (activeFilters.year) url += `&year=${activeFilters.year}`;
                    if (activeFilters.area) url += `&area=${encodeURIComponent(activeFilters.area)}`;
                    if (activeFilters.actor) url += `&actor=${encodeURIComponent(activeFilters.actor)}`;
                    if (activeFilters.tags) url += `&tags=${encodeURIComponent(activeFilters.tags)}`;

                    const res = await apiGet<MediaItem[]>(url);
                    if (res.success && res.data && res.data.length > 0) {
                        allSections.push({
                            sourceId: source.id,
                            sourceName: source.name,
                            sourceType: source.type || 'alist',
                            items: res.data,
                            total: (res as any).total || res.data.length
                        });
                    }
                }
            }

            setSourceSections(allSections);
        } catch (err) {
            console.error('Failed to load all sources sections:', err);
        } finally {
            setLoading(false);
        }
    };

    // 加载网盘源的扫描目录板块（类似 Category 子分类概览）
    const loadDirectorySections = async (srcId: number, filters?: {
        genres?: string; year?: number; area?: string; actor?: string; studio?: string;
        series?: string; tags?: string; date?: string
    }) => {
        setLoading(true);
        try {
            // 构建查询参数
            let url = `/netdisk/media/grouped?sourceId=${srcId}&limit=${INITIAL_COUNT}`;
            if (filters?.genres) url += `&genres=${encodeURIComponent(filters.genres)}`;
            if (filters?.year) url += `&year=${filters.year}`;
            if (filters?.area) url += `&area=${encodeURIComponent(filters.area)}`;
            if (filters?.actor) url += `&actor=${encodeURIComponent(filters.actor)}`;
            if (filters?.studio) url += `&studio=${encodeURIComponent(filters.studio)}`;
            if (filters?.series) url += `&series=${encodeURIComponent(filters.series)}`;
            if (filters?.tags) url += `&tags=${encodeURIComponent(filters.tags)}`;
            if (filters?.date) url += `&date=${filters.date}`;

            const res = await apiGet<{ groups: MediaGroup[] }>(url);
            if (res.success && res.data) {
                const sections: DirectorySection[] = res.data.groups.map(group => ({
                    path: group.path,
                    name: group.name,
                    items: group.items.slice(0, INITIAL_COUNT),
                    total: group.total,
                    offset: group.items.length,
                    hasMore: group.total > INITIAL_COUNT,
                    loading: false
                }));
                setDirectorySections(sections);
            }
        } catch (err) {
            console.error('Failed to load directory sections:', err);
        } finally {
            setLoading(false);
        }
    };

    // 扫描目录板块加载更多（原地扩展）
    const loadMoreForDirectory = async (path: string) => {
        if (!currentSourceId) return;

        // 标记该 section 为加载中
        setDirectorySections(prev => prev.map(s =>
            s.path === path ? { ...s, loading: true } : s
        ));

        const section = directorySections.find(s => s.path === path);
        if (!section) return;

        try {
            const res = await apiGet<MediaItem[]>(
                `/netdisk/media?sourceId=${currentSourceId}&path=${encodeURIComponent(path)}&type=all&limit=${LOAD_MORE_COUNT + 1}&offset=${section.offset}`
            );

            if (res.success && res.data) {
                const hasMore = res.data.length > LOAD_MORE_COUNT;
                const newItems = res.data.slice(0, LOAD_MORE_COUNT);

                setDirectorySections(prev => prev.map(s =>
                    s.path === path
                        ? {
                            ...s,
                            items: [...s.items, ...newItems],
                            offset: s.offset + newItems.length,
                            hasMore,
                            loading: false
                        }
                        : s
                ));
            }
        } catch (err) {
            console.error('Failed to load more for directory:', err);
            setDirectorySections(prev => prev.map(s =>
                s.path === path ? { ...s, loading: false } : s
            ));
        }
    };

    // 加载目录下的媒体（类似 Category 列表模式）
    const loadMediaByPath = async (srcId: number, path: string, pageNum: number, reset: boolean = false) => {
        if (reset) {
            setLoading(true);
            setMedia([]);
            setPage(1);
        } else {
            setLoadingMore(true);
        }

        try {
            let url = `/netdisk/media?sourceId=${srcId}&path=${encodeURIComponent(path)}&type=all&limit=${PAGE_SIZE}&offset=${(pageNum - 1) * PAGE_SIZE}&sort=${activeFilters.sort || 'latest'}`;
            if (activeFilters.genres) url += `&genres=${encodeURIComponent(activeFilters.genres)}`;
            if (activeFilters.year) url += `&year=${activeFilters.year}`;
            if (activeFilters.area) url += `&area=${encodeURIComponent(activeFilters.area)}`;
            if (activeFilters.actor) url += `&actor=${encodeURIComponent(activeFilters.actor)}`;
            if (activeFilters.studio) url += `&studio=${encodeURIComponent(activeFilters.studio)}`;
            if (activeFilters.series) url += `&series=${encodeURIComponent(activeFilters.series)}`;
            if (activeFilters.tags) url += `&tags=${encodeURIComponent(activeFilters.tags)}`;
            if (activeFilters.date) url += `&date=${activeFilters.date}`;

            const res = await apiGet<MediaItem[]>(url);
            if (res.success && res.data) {
                if (reset) {
                    setMedia(res.data);
                } else {
                    setMedia(prev => [...prev, ...res.data!]);
                }
                setHasMore(res.data.length >= PAGE_SIZE);
                setPage(pageNum);
            }
        } catch (err) {
            console.error('Failed to load media:', err);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const loadMoreMedia = useCallback(() => {
        if (currentSourceId && currentPath && !loadingMore && hasMore) {
            loadMediaByPath(currentSourceId, currentPath, page + 1, false);
        }
    }, [currentSourceId, currentPath, page, loadingMore, hasMore]);

    // 使用 ref 追踪状态，避免 IntersectionObserver 频繁重建
    const stateRef = useRef({
        currentLevel,
        hasMore,
        loadingMore,
        loadMoreMedia: () => { }
    });

    // 更新状态 ref
    useEffect(() => {
        stateRef.current = { currentLevel, hasMore, loadingMore, loadMoreMedia };
    }, [currentLevel, hasMore, loadingMore, loadMoreMedia, media.length]);


    // 无限滚动监听（仅三级视图）
    useEffect(() => {
        if (currentLevel !== 'directory' || !hasMore) return;

        // 等待 sentinel 节点渲染完成
        if (!loadMoreRef.current) return;

        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        observerRef.current = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                const state = stateRef.current;

                if (entry.isIntersecting && state.hasMore && !state.loadingMore) {
                    state.loadMoreMedia();
                }
            },
            {
                threshold: 0,
                rootMargin: '100px'
            }
        );

        observerRef.current.observe(loadMoreRef.current);

        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, [currentLevel, hasMore, loadingMore, page, media.length]);


    const pollScanStatus = async (srcId: number) => {
        try {
            const res = await apiGet<ScanStatus>(`/netdisk/scan/${srcId}/status`);
            if (res.success && res.data) {
                setScanStatus(res.data);
                if (res.data.scanning) {
                    setTimeout(() => pollScanStatus(srcId), 2000);
                }
            }
        } catch (err) {
            console.error('Failed to get scan status:', err);
        }
    };

    const handlePlay = (item: MediaItem, videoIndex: number = 0) => {
        if (onPlay) {
            onPlay(item.id, item.source_id, videoIndex);
        }
    };

    // 导航到二级视图（网盘源）
    const navigateToSource = (srcId: number) => {
        setCurrentLevel('source');
        setCurrentSourceId(srcId);
        setCurrentPath(null);
    };

    // 导航到三级视图（具体目录）
    const navigateToDirectory = (srcId: number, path: string) => {
        setCurrentLevel('directory');
        setCurrentSourceId(srcId);
        setCurrentPath(path);
    };

    const handleRefreshMetadata = async (mediaId: number) => {
        try {
            const res = await apiPost(`/netdisk/media/${mediaId}/refresh`);
            if (res.success) {
                // 刷新数据视图
                if (currentLevel === 'all') loadAllSourcesSections();
                else if (currentLevel === 'source') loadDirectorySections(currentSourceId!);
                else loadMediaByPath(currentSourceId!, currentPath!, page, true);
            }
        } catch (err) {
            console.error('Refresh failed:', err);
        }
    };

    const handleUnlockMedia = async (mediaId: number) => {
        try {
            const res = await apiPost(`/netdisk/media/${mediaId}/unlock`);
            if (res.success) {
                if (currentLevel === 'all') loadAllSourcesSections();
                else if (currentLevel === 'source') loadDirectorySections(currentSourceId!);
                else loadMediaByPath(currentSourceId!, currentPath!, page, true);
            }
        } catch (err) {
            console.error('Unlock failed:', err);
        }
    };


    // 获取当前源名称
    const getCurrentSourceName = () => {
        if (!currentSourceId) return '';
        const source = sources.find(s => s.id === currentSourceId);
        return source?.name || '';
    };

    // 获取当前目录名称
    const getCurrentDirectoryName = () => {
        if (!currentPath) return '';
        const section = directorySections.find(s => s.path === currentPath);
        return section?.name || currentPath.split('/').filter(Boolean).pop() || '';
    };

    // 渲染媒体卡片 (统一样式：对齐视频站 VideoCard)
    // 渲染集合卡片
    const renderCollectionCard = (group: GroupInfo) => (
        <div
            key={group.key}
            onClick={() => {
                // 点击后进入详情视图：保持当前层级，但应用聚合过滤
                if (viewMode === 'date') setActiveFilters(prev => ({ ...prev, year: parseInt(group.key) }));
                else if (viewMode === 'collection') setActiveFilters(prev => ({ ...prev, series: group.key }));
                else if (viewMode === 'category') setActiveFilters(prev => ({ ...prev, genres: group.key }));
                else if (viewMode === 'tag') setActiveFilters(prev => ({ ...prev, tags: group.key }));

                // 🚀 切换到默认视图以触发数据加载
                setViewMode('default');

                // 🚀 优化跳转逻辑：点击系列后，进入“三级视图”（列表模式）以更好地支持过滤
                if (currentLevel !== 'directory') {
                    setCurrentLevel('directory');
                    // 如果在全部视图点击，需要锁定到一个源
                    if (currentLevel === 'all' && sources.length > 0) {
                        setCurrentSourceId(currentSourceId || sources[0].id);
                    }
                    // 系列视图本身带有 path 信息的话，锁定到对应目录
                    if (group.key && !currentPath) {
                        setCurrentPath('/'); // 回退到根路径下的全局过滤
                    }
                }
            }}
            className="group relative cursor-pointer"
        >
            <div className={`relative aspect-[2/3] transition-transform duration-300 group-hover:-translate-y-2 rounded-2xl overflow-hidden bg-secondary border border-border-color shadow-md`}>
                {/* 叠层效果背景 2 */}
                <div className="absolute inset-0 bg-secondary rounded-2xl translate-x-2 -translate-y-2 border border-border-color shadow-sm -z-10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                {/* 叠层效果背景 1 */}
                <div className="absolute inset-0 bg-secondary rounded-2xl translate-x-1 -translate-y-1 border border-border-color shadow-sm -z-10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                {/* 主封面 */}
                <div className="absolute inset-0 bg-secondary overflow-hidden">
                    {group.covers && group.covers.length > 0 ? (
                        group.count > 2 && group.covers.length >= 4 ? (
                            // 多封面 2x2 网格布局
                            <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-[1px]">
                                {group.covers.slice(0, 4).map((cover, idx) => (
                                    <img
                                        key={idx}
                                        src={cover.startsWith('/api/') ? cover : `/api/proxy/image?url=${encodeURIComponent(cover)}`}
                                        className="w-full h-full object-cover"
                                        alt={`${group.name}-${idx}`}
                                    />
                                ))}
                            </div>
                        ) : (
                            // 单封面
                            <img
                                src={group.covers[0].startsWith('/api/') ? group.covers[0] : `/api/proxy/image?url=${encodeURIComponent(group.covers[0])}`}
                                className="w-full h-full object-cover"
                                alt={group.name}
                            />
                        )
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-secondary/80">
                            <i className="fas fa-layer-group text-3xl text-secondary"></i>
                        </div>
                    )}
                    {/* 数量角标 */}
                    <div className="absolute bottom-2 right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm">
                        {group.count}
                    </div>
                </div>
            </div>
            <div className="mt-2 text-center">
                <p className="text-primary text-sm font-medium truncate group-hover:text-red-400 transition-colors" title={group.name}>
                    {group.name}
                </p>
                <p className="text-secondary text-[10px] uppercase tracking-wider mt-0.5">
                    {viewMode === 'date' ? '加入合集' : '媒体合集'}
                </p>
            </div>
        </div>
    );

    const renderMediaCard = (item: MediaItem) => (
        <div
            key={item.id}
            onClick={() => handlePlay(item)}
            onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, item });
            }}
            className="video-card group relative cursor-pointer"
        >
            {/* 封面部分 */}
            <div className="relative aspect-[2/3] rounded-2xl overflow-hidden bg-secondary border border-border-color group-hover:border-blue-500/50 transition-all shadow-md">
                <div className="w-full h-full bg-secondary">
                    {item.poster_url ? (
                        <img
                            src={(() => {
                                if (!item.poster_url) return '';
                                // 1. 手动上传的伪 URL -> 走 Proxy
                                if (item.poster_url.startsWith('local_upload_')) {
                                    return `/api/proxy/image?url=${encodeURIComponent(item.poster_url)}`;
                                }
                                // 2. 已经是本站 API (WebDAV/Local 生成的代理链接) -> 直接使用，避免双重代理失败
                                if (item.poster_url.startsWith('/api/')) {
                                    return item.poster_url;
                                }
                                // 3. 外部 HTTP 链接 -> 走 Proxy 以获得缓存优化
                                return `/api/proxy/image?url=${encodeURIComponent(item.poster_url)}`;
                            })()}
                            alt={item.title}
                            className="video-cover w-full h-full object-cover"
                            loading="lazy"
                            onError={e => {
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                                if (img.parentElement) {
                                    const fallback = img.parentElement.querySelector('.poster-fallback');
                                    if (fallback) (fallback as HTMLElement).style.display = 'flex';
                                }
                            }}
                        />
                    ) : null}

                    {/* 降级文字封面 (暂无图片时显示) */}
                    <div className="poster-fallback w-full h-full flex flex-col items-center justify-center p-4 bg-secondary"
                        style={{ display: item.poster_url ? 'none' : 'flex' }}>
                        <i className={`fas ${item.media_type === 'tvshow' ? 'fa-tv text-purple-400/60' : 'fa-film text-blue-400/60'} text-4xl mb-3`}></i>
                        <p className="text-secondary text-[11px] text-center line-clamp-3 px-2 leading-relaxed">{item.title}</p>
                    </div>
                </div>

                {/* 悬停遮罩 */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 
                              transition-opacity flex items-center justify-center border-b-2 border-red-500">
                    <i className="fas fa-play-circle text-4xl text-primary"></i>
                </div>

                {/* 评分 (右上角) */}
                {item.rating && item.rating > 0 && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 
                                   text-[10px] text-yellow-400 rounded flex items-center gap-1 font-bold">
                        <i className="fas fa-star"></i>
                        {item.rating.toFixed(1)}
                    </span>
                )}

                {/* 年份/备注 (右下角) */}
                {item.year && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-red-500/90 
                                   text-[10px] text-white rounded font-medium">
                        {item.year}
                    </span>
                )}

                {/* 更多按钮 (右上角) */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setContextMenu({ x: rect.left, y: rect.bottom + 5, item });
                    }}
                    className="absolute top-2 left-2 w-7 h-7 
                               bg-black/40 hover:bg-blue-600 
                               dark:bg-black/60 dark:hover:bg-blue-600
                               text-white shadow-md border border-white/10
                               flex items-center justify-center opacity-0 group-hover:opacity-100
                               transition-all duration-300 z-[30] active:scale-90 rounded-full"
                    title="更多选项"
                >
                    <i className="fas fa-ellipsis-v text-[10px]"></i>
                </button>
            </div>

            {/* 信息部分 (底部) */}
            <div className="mt-2 px-1">
                <h3 className="text-primary text-sm font-medium truncate" title={item.title}>
                    {item.title}
                </h3>
                <div className="flex items-center justify-between mt-1">
                    <span className="text-secondary text-[11px] truncate flex-1 mr-2" title={item.actor}>
                        {item.actor ? item.actor.split(/[,，/\s]/)[0].trim() : (item.media_type === 'tvshow' ? '剧集系列' : '电影视频')}
                    </span>
                    {item.video_files.length > 1 && (
                        <span className="text-red-500/80 text-[10px] font-bold">
                            {item.video_files.length}P
                        </span>
                    )}
                </div>
            </div>
        </div>
    );

    // 渲染"加载更多"卡片
    const renderLoadMoreCard = (path: string, isLoading: boolean) => (
        <button
            key={`load-more-${path}`}
            onClick={() => loadMoreForDirectory(path)}
            disabled={isLoading}
            className="aspect-[2/3] bg-secondary/50 rounded-lg border-2 border-dashed border-border-color 
                     hover:border-red-500 hover:bg-secondary transition-all duration-300
                     flex flex-col items-center justify-center gap-3 group
                     disabled:opacity-50 disabled:cursor-wait"
        >
            {isLoading ? (
                <>
                    <div className="w-14 h-14 rounded-full bg-gray-700 flex items-center justify-center">
                        <i className="fas fa-spinner fa-spin text-2xl text-red-400"></i>
                    </div>
                    <span className="text-secondary text-sm font-medium">加载中...</span>
                </>
            ) : (
                <>
                    <div className="w-14 h-14 rounded-full bg-gray-700 group-hover:bg-red-500/20 flex items-center justify-center transition-colors">
                        <i className="fas fa-plus text-2xl text-secondary group-hover:text-red-400 transition-colors"></i>
                    </div>
                    <span className="text-secondary group-hover:text-primary text-sm font-medium transition-colors">
                        加载更多
                    </span>
                </>
            )}
        </button>
    );

    if (sources.length === 0 && !loading && currentLevel === 'all') {
        return (
            <div className="flex flex-col items-center justify-center h-full text-secondary">
                <i className="fas fa-cloud text-6xl mb-4 opacity-50"></i>
                <p className="text-lg">暂无媒体库</p>
                <p className="text-sm mt-2">请到后台管理添加媒体库</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-6 animate-pulse space-y-8">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="space-y-4">
                        <div className="h-6 bg-secondary rounded w-32"></div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 sm:gap-4 lg:gap-5">
                            {[...Array(currentLevel === 'source' ? INITIAL_COUNT + 1 : 16)].map((_, j) => (
                                <div key={j} className="aspect-[2/3] bg-secondary rounded-lg"></div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="min-h-full bg-secondary">
            {/* 顶部工具栏 - 使用 sticky 定位以保持原本的顶部停留效果，或者直接随页面滚动 */}
            <div className="sticky top-0 z-20 flex items-center gap-2 lg:gap-4 px-3 lg:px-6 py-2.5 lg:py-4 border-b border-border-color glass-effect backdrop-blur-md flex-wrap">

                {/* 当前位置标题 */}
                <span className="text-primary font-medium">
                    {currentLevel === 'all'
                        ? '全部媒体'
                        : currentLevel === 'source'
                            ? getCurrentSourceName()
                            : getCurrentDirectoryName()}
                </span>


                {/* 过滤器/视图切换区域 */}
                {(currentSourceId || (sources.length > 0 && sources[0]?.id)) && (
                    <div className="flex items-center gap-4 flex-1">
                        <div className="flex-1">
                            <NetdiskFilter
                                sourceId={currentSourceId || sources[0]?.id}
                                onFilterChange={(filters) => {
                                    setActiveFilters(filters);
                                    if (viewMode !== 'default') {
                                        loadGroupedData();
                                    } else if (currentLevel === 'all') {
                                        loadAllSourcesSections();
                                    } else if (currentLevel === 'source' && currentSourceId) {
                                        loadDirectorySections(currentSourceId, filters);
                                    } else if (currentLevel === 'directory' && currentSourceId && currentPath) {
                                        loadMediaByPath(currentSourceId, currentPath, 1, true);
                                    }
                                }}
                                isMobile={isMobile}
                                viewMode={viewMode}
                                onViewModeChange={(mode) => setViewMode(mode as ViewMode)}
                            />
                        </div>

                        {/* 视图模式切换 */}
                        <div className="hidden lg:flex items-center bg-secondary/80 rounded-lg p-1 border border-border-color">
                            {[
                                { id: 'default', icon: 'fa-th-large', label: '默认' },
                                { id: 'date', icon: 'fa-calendar-alt', label: '日期' },
                                { id: 'collection', icon: 'fa-layer-group', label: '系列' },
                                { id: 'category', icon: 'fa-tags', label: '分类' },
                                { id: 'tag', icon: 'fa-hashtag', label: '标签' }
                            ].map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setViewMode(item.id as ViewMode)}
                                    title={item.label}
                                    className={`px-3 py-1.5 rounded-md text-xs transition-all flex items-center gap-1.5 ${viewMode === item.id ? 'bg-blue-500 text-white shadow-sm' : 'text-secondary hover:text-primary hover:bg-secondary'}`}
                                >
                                    <i className={`fas ${item.icon}`}></i>
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 扫描状态 */}
                {scanStatus?.scanning && (
                    <div className="flex items-center gap-2 text-sm text-blue-400 ml-auto">
                        <i className="fas fa-sync-alt animate-spin"></i>
                        <span>{scanStatus.message} ({scanStatus.progress}/{scanStatus.total})</span>
                    </div>
                )}
            </div>

            {/* 聚合过滤提示栏 */}
            {(activeFilters.series || activeFilters.tags || activeFilters.date) && (
                <div className="px-6 py-2 bg-blue-500/10 border-b border-blue-500/30 flex items-center gap-3">
                    <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                        <i className="fas fa-filter"></i>
                        当前合集:
                    </span>
                    <div className="flex items-center gap-2">
                        {activeFilters.series && (
                            <span className="px-2 py-0.5 bg-blue-500 text-white text-[11px] rounded flex items-center gap-2">
                                系列: {activeFilters.series}
                                <i className="fas fa-times cursor-pointer hover:text-white/70" onClick={() => setActiveFilters(prev => { const n = { ...prev }; delete n.series; return n; })}></i>
                            </span>
                        )}
                        {activeFilters.tags && (
                            <span className="px-2 py-0.5 bg-blue-500 text-white text-[11px] rounded flex items-center gap-2">
                                标签: {activeFilters.tags}
                                <i className="fas fa-times cursor-pointer hover:text-white/70" onClick={() => setActiveFilters(prev => { const n = { ...prev }; delete n.tags; return n; })}></i>
                            </span>
                        )}
                        {activeFilters.date && (
                            <span className="px-2 py-0.5 bg-blue-500 text-white text-[11px] rounded flex items-center gap-2">
                                日期: {activeFilters.date}
                                <i className="fas fa-times cursor-pointer hover:text-white/70" onClick={() => setActiveFilters(prev => { const n = { ...prev }; delete n.date; return n; })}></i>
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* 内容区域 */}
            <div className="p-4 lg:p-6 space-y-8">
                {viewMode !== 'default' ? (
                    /* 聚合视图 (日期/合集/分类/标签) */
                    groupedData.length === 0 ? (
                        <div className="text-center py-12 text-secondary">
                            <i className="fas fa-layer-group text-4xl mb-4 opacity-50"></i>
                            <p>未发现以此维度聚合的内容</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-6 sm:gap-8 lg:gap-10">
                            {groupedData.map(group => renderCollectionCard(group))}
                        </div>
                    )
                ) : currentLevel === 'all' ? (
                    /* 一级视图：全部网盘（类似 SourceOverview） */
                    sourceSections.length === 0 ? (
                        <div className="text-center py-12 text-secondary">
                            <i className="fas fa-film text-4xl mb-4 opacity-50"></i>
                            <p>暂无媒体内容</p>
                            <p className="text-sm mt-2">请先在后台扫描媒体库</p>
                        </div>
                    ) : (
                        sourceSections.map((section, idx) => (
                            <section key={`${section.sourceId}-${section.path || idx}`}>
                                <div className="flex items-center justify-between mb-4">
                                    <h2
                                        className="text-lg font-bold text-primary flex items-center gap-2 cursor-pointer hover:text-blue-400 transition-colors group"
                                        onClick={() => {
                                            if (section.path) {
                                                navigateToDirectory(section.sourceId, section.path);
                                            } else {
                                                navigateToSource(section.sourceId);
                                            }
                                        }}
                                    >
                                        <i className={`fas ${section.sourceType === 'local' ? 'fa-hdd text-green-400' : section.sourceType === 'webdav' ? 'fa-server text-orange-400' : 'fa-cloud text-blue-400'} group-hover:scale-110 transition-transform`}></i>
                                        {section.pathName ? (
                                            <>
                                                最新
                                                {section.pathName}
                                            </>
                                        ) : (
                                            <>最新{section.sourceName}</>
                                        )}
                                        <span className="text-sm font-normal text-secondary">({section.total})</span>
                                        <i className="fas fa-chevron-right text-xs opacity-0 group-hover:opacity-100 transition-opacity ml-1"></i>
                                    </h2>
                                    <button
                                        onClick={() => {
                                            if (section.path) {
                                                navigateToDirectory(section.sourceId, section.path);
                                            } else {
                                                navigateToSource(section.sourceId);
                                            }
                                        }}
                                        className="text-sm text-secondary hover:text-primary transition-colors flex items-center gap-1"
                                    >
                                        更多
                                        <i className="fas fa-chevron-right text-xs"></i>
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4 lg:gap-5">
                                    {section.items.slice(0, SOURCE_PREVIEW_COUNT).map(item => renderMediaCard(item))}
                                </div>
                            </section>
                        ))
                    )
                ) : currentLevel === 'source' ? (
                    /* 二级视图：网盘源的扫描目录（类似 Category 子分类概览） */
                    directorySections.length === 0 ? (
                        <div className="text-center py-12 text-secondary">
                            <i className="fas fa-folder-open text-4xl mb-4 opacity-50"></i>
                            <p>暂无媒体内容</p>
                            <p className="text-sm mt-2">请先在后台扫描此媒体库</p>
                        </div>
                    ) : (
                        <>
                            {/* 网盘源标题 */}
                            <div className="flex items-center gap-2">
                                <i className="fas fa-hdd text-blue-400"></i>
                                <h1 className="text-xl font-bold text-primary">{getCurrentSourceName()}</h1>
                            </div>

                            {/* 扫描目录板块 */}
                            {directorySections.map(section => (
                                <section key={section.path}>
                                    <div className="flex items-center justify-between mb-4">
                                        <h2
                                            className="text-lg font-bold text-primary flex items-center gap-2 cursor-pointer hover:text-blue-400 transition-colors group"
                                            onClick={() => navigateToDirectory(currentSourceId!, section.path)}
                                        >
                                            <i className="fas fa-folder text-yellow-400 group-hover:scale-110 transition-transform"></i>
                                            {section.name}
                                            <span className="text-sm text-secondary font-normal">
                                                ({section.items.length}{section.hasMore ? '+' : ''})
                                            </span>
                                            <i className="fas fa-chevron-right text-xs opacity-0 group-hover:opacity-100 transition-opacity ml-1"></i>
                                        </h2>
                                        {section.hasMore && (
                                            <button
                                                onClick={() => navigateToDirectory(currentSourceId!, section.path)}
                                                className="text-xs text-secondary hover:text-blue-400 transition-colors"
                                            >
                                                查看全部
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4 lg:gap-5">
                                        {section.items.map(item => renderMediaCard(item))}
                                        {/* "加载更多"卡片 - 始终显示在最后位置 */}
                                        {section.hasMore && renderLoadMoreCard(section.path, section.loading)}
                                    </div>
                                </section>
                            ))}
                        </>
                    )
                ) : (
                    /* 三级视图：目录下的媒体列表（类似 Category 列表模式） */
                    <>
                        {/* 🚀 返回按钮替代文件夹图标 */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    if (Object.keys(activeFilters).length > 0) {
                                        setActiveFilters({});
                                    } else {
                                        setCurrentLevel('source');
                                        setCurrentPath('');
                                    }
                                }}
                                className="text-blue-500"
                                title="返回"
                            >
                                <i className="fas fa-arrow-left text-xl"></i>
                            </button>
                            <h1 className="text-xl font-bold text-primary">{getCurrentDirectoryName()}</h1>
                        </div>

                        {media.length === 0 ? (
                            <div className="text-center py-12 text-secondary">
                                <i className="fas fa-film text-4xl mb-4 opacity-50"></i>
                                <p>暂无媒体内容</p>
                                <p className="text-sm mt-2">此目录下还没有扫描到影视内容</p>
                            </div>
                        ) : (
                            <>
                                {/* Video 2.0: 使用 VirtuosoGrid 虚拟化渲染 */}
                                <VirtuosoGrid
                                    style={{ height: 'calc(100vh - 200px)' }}
                                    totalCount={media.length}
                                    overscan={200}
                                    listClassName="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 sm:gap-4 lg:gap-5"
                                    itemContent={(index) => renderMediaCard(media[index])}
                                    endReached={() => {
                                        if (hasMore && !loadingMore) {
                                            loadMoreMedia();
                                        }
                                    }}
                                    components={{
                                        Footer: () => (
                                            <div className="h-16 flex items-center justify-center mt-4">
                                                {loadingMore ? (
                                                    <div className="flex items-center gap-2 text-secondary text-sm">
                                                        <i className="fas fa-spinner animate-spin text-blue-400"></i>
                                                        <span>正在加载...</span>
                                                    </div>
                                                ) : hasMore ? (
                                                    <div className="flex items-center gap-2 text-secondary text-sm">
                                                        <i className="fas fa-arrow-down animate-bounce"></i>
                                                        <span>加载更多</span>
                                                    </div>
                                                ) : media.length > 0 ? (
                                                    <span className="text-secondary text-sm">已加载全部内容</span>
                                                ) : null}
                                            </div>
                                        )
                                    }}
                                />
                            </>
                        )}
                    </>
                )}
            </div>

            {/* 操作菜单 */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    items={[
                        { label: '立即播放', icon: 'fas fa-play', onClick: () => handlePlay(contextMenu.item) },
                        { label: '识别修正', icon: 'fas fa-magic', onClick: () => setCorrectModal({ mediaId: contextMenu.item.id, query: contextMenu.item.title }) },
                        { label: '更换封面', icon: 'fas fa-image', onClick: () => setPosterPicker({ mediaId: contextMenu.item.id, title: contextMenu.item.title }) },
                        { label: '查看详情', icon: 'fas fa-info-circle', onClick: () => handlePlay(contextMenu.item) },
                        {
                            label: '刷新元数据',
                            icon: 'fas fa-sync-alt',
                            onClick: () => handleRefreshMetadata(contextMenu.item.id)
                        },
                        {
                            label: '恢复自动识别',
                            icon: 'fas fa-undo',
                            onClick: () => handleUnlockMedia(contextMenu.item.id)
                        },
                    ]}
                />
            )}

            {/* 纠偏弹窗 */}
            {correctModal && (
                <TmdbCorrectModal
                    isOpen={true}
                    mediaId={correctModal.mediaId}
                    initialQuery={correctModal.query}
                    onClose={() => setCorrectModal(null)}
                    onSuccess={() => {
                        // 刷新数据
                        if (currentLevel === 'all') loadAllSourcesSections();
                        else if (currentLevel === 'source') loadDirectorySections(currentSourceId!);
                        else loadMediaByPath(currentSourceId!, currentPath!, page, true);
                    }}
                />
            )}

            {/* 海报更换弹窗 */}
            {posterPicker && (
                <PosterPickerModal
                    isOpen={true}
                    mediaId={posterPicker.mediaId}
                    title={posterPicker.title}
                    onClose={() => setPosterPicker(null)}
                    onSuccess={() => {
                        if (currentLevel === 'all') loadAllSourcesSections();
                        else if (currentLevel === 'source') loadDirectorySections(currentSourceId!);
                        else loadMediaByPath(currentSourceId!, currentPath!, page, true);
                    }}
                />
            )}
        </div >
    );
}
