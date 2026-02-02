import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiGet } from '../utils/api';
import { useAppNavigate } from '../contexts/NavigationContext';

interface MediaServerProps {
    serverId?: number;
    categoryId?: string;
    categoryName?: string;
    theme?: 'light' | 'dark';
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
}

interface MediaItem {
    Id: string;
    Name: string;
    Type: string;
    ImageTags: {
        Primary: string;
        Thumb?: string;
    };
    ProductionYear?: number;
    Overview?: string;
    MediaType?: string;
    Container?: string;
    CommunityRating?: number;
    RunTimeTicks?: number;
    UserData?: {
        PlayedPercentage?: number;
    };
    SeriesName?: string;
    IndexNumber?: number;
}

interface HomeSection {
    title: string;
    id: string;
    type: string;
    items: MediaItem[];
}

/**
 * 🎬 Emby 首页动态视图组件
 * 核心：不再死板，Emby 首页有什么板块，这里同步拉取并展示什么板块
 */
function MediaServerHomeView({ server, onPlay, onNavigate, theme: _theme }: { server: any, onPlay: (item: any) => void, onNavigate: (view: string, params?: any) => void, theme?: string }) {
    const [resumeItems, setResumeItems] = useState<MediaItem[]>([]);
    const [sections, setSections] = useState<HomeSection[]>([]);
    const [loading, setLoading] = useState(true);

    const resumeScrollRef = useRef<HTMLDivElement>(null);
    const sectionsScrollRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const [scrollStates, setScrollStates] = useState<{ [key: string]: number }>({ resume: 0 });

    const handleScroll = (ref: React.RefObject<HTMLDivElement> | HTMLDivElement | null, direction: 'left' | 'right', key: string) => {
        const el = (ref && 'current' in ref) ? ref.current : ref;
        if (el) {
            el.scrollBy({ left: direction === 'right' ? 600 : -600, behavior: 'smooth' });
            // 更新状态通过监听 scroll 事件，这里主动触发可能是多余的但为了即时性可以更新
            setTimeout(() => {
                setScrollStates(prev => ({ ...prev, [key]: el.scrollLeft }));
            }, 300);
        }
    };

    const handleOnScroll = (e: React.UIEvent<HTMLDivElement>, key: string) => {
        const target = e.currentTarget;
        setScrollStates(prev => ({ ...prev, [key]: target.scrollLeft }));
    };

    useEffect(() => {
        if (server) {
            loadHomeData();
        }
    }, [server]);

    const loadHomeData = async () => {
        setLoading(true);
        try {
            // 1. 获取动态聚合首页数据
            const homeRes = await apiGet<{ resume: MediaItem[], sections: HomeSection[] }>(`/media-servers/${server.id}/home`);
            if (homeRes.success && homeRes.data) {
                setResumeItems(homeRes.data.resume || []);
                setSections(homeRes.data.sections || []);
            }
        } catch (error) {
            console.error('Failed to load dynamic home data:', error);
        } finally {
            setLoading(false);
        }
    };

    const getPosterUrl = (item: any, type: 'Primary' | 'Thumb' = 'Primary', width = 300) => {
        const tag = type === 'Thumb' ? (item.ImageTags?.Thumb || item.ImageTags?.Primary) : item.ImageTags?.Primary;
        if (!tag || !server) return '';
        return `${server.url}/emby/Items/${item.Id}/Images/${type}?maxWidth=${width}&tag=${tag}&api_key=${server.api_key}`;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[2000px] mx-auto">
            {/* 2. 继续观看 (横海报) */}
            {resumeItems.length > 0 && (
                <section className="space-y-4">
                    <h3 className="text-xl font-black text-primary flex items-center gap-2">
                        <i className="fas fa-history text-blue-500"></i>
                        继续观看
                    </h3>
                    <div className="relative group/scroll">
                        <div
                            ref={resumeScrollRef}
                            className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar scroll-smooth"
                            onScroll={(e) => handleOnScroll(e, 'resume')}
                        >
                            {resumeItems.map(item => (
                                <div key={item.Id} className="flex-shrink-0 w-[280px] group cursor-pointer" onClick={() => onPlay(item)}>
                                    <div className="aspect-video rounded-xl overflow-hidden bg-white/5 border border-white/5 group-hover:border-blue-500/50 transition-all shadow-lg relative">
                                        <img src={getPosterUrl(item, 'Thumb', 400)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        {item.UserData?.PlayedPercentage !== undefined && (
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                                                <div className="h-full bg-blue-500" style={{ width: `${item.UserData.PlayedPercentage}%` }}></div>
                                            </div>
                                        )}
                                        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                                            <p className="text-white text-xs font-bold truncate">{item.SeriesName || item.Name}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* 向左引导按钮 - 只有滚动了才显示 */}
                        {scrollStates['resume'] > 10 && (
                            <>
                                <div className="absolute top-0 left-0 bottom-4 w-24 bg-gradient-to-r from-black/80 to-transparent pointer-events-none z-10 opacity-0 group-hover/scroll:opacity-100 transition-opacity duration-300"></div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleScroll(resumeScrollRef, 'left', 'resume');
                                    }}
                                    className="absolute top-1/2 left-4 -translate-y-1/2 w-12 h-12 rounded-full bg-blue-600/80 backdrop-blur-md hover:bg-blue-500 shadow-2xl shadow-blue-500/40 border border-white/20 flex items-center justify-center text-white z-20 opacity-0 group-hover/scroll:opacity-100 transition-all duration-300 scale-75 group-hover/scroll:scale-100 active:scale-90"
                                >
                                    <i className="fas fa-chevron-left text-lg"></i>
                                </button>
                            </>
                        )}

                        {/* 向右引导按钮 - 功能化升级，修复点击穿透 */}
                        <div className="absolute top-0 right-0 bottom-4 w-24 bg-gradient-to-l from-black/80 to-transparent pointer-events-none z-10 opacity-0 group-hover/scroll:opacity-100 transition-opacity duration-300"></div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleScroll(resumeScrollRef, 'right', 'resume');
                            }}
                            className="absolute top-1/2 right-4 -translate-y-1/2 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 shadow-2xl shadow-blue-500/40 border border-white/20 flex items-center justify-center text-white z-20 opacity-0 group-hover/scroll:opacity-100 transition-all duration-300 scale-75 group-hover/scroll:scale-100 active:scale-90"
                        >
                            <i className="fas fa-chevron-right text-lg"></i>
                        </button>
                    </div>
                </section>
            )}

            {/* 3. 动态 Section 列表 (同步 Emby 排序) */}
            {sections.map(section => (
                <section key={section.id} className="space-y-4">
                    <h3
                        className="text-xl font-black text-primary flex items-center gap-2 cursor-pointer hover:text-blue-500 transition-colors group/title w-fit"
                        onClick={() => onNavigate('media_server', {
                            serverId: server.id,
                            categoryId: section.id,
                            _t: Date.now()
                        })}
                    >
                        <i className={`fas ${section.type === 'tvshows' ? 'fa-tv' : 'fa-film'} opacity-50 text-sm`}></i>
                        最新{section.title}
                        <i className="fas fa-chevron-right text-xs opacity-0 group-hover/title:opacity-100 transition-opacity"></i>
                    </h3>
                    <div className="relative group/scroll">
                        <div
                            ref={el => sectionsScrollRefs.current[section.id] = el}
                            className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar scroll-smooth"
                            onScroll={(e) => handleOnScroll(e, section.id)}
                        >
                            {section.items.map(item => (
                                <div
                                    key={item.Id}
                                    className={`flex-shrink-0 group cursor-pointer ${section.type === 'movies' || section.type === 'tvshows' ? 'w-[160px]' : 'w-[240px]'}`}
                                    onClick={() => onPlay(item)}
                                >
                                    <div className={`${section.type === 'movies' || section.type === 'tvshows' ? 'aspect-[2/3]' : 'aspect-video'} rounded-xl overflow-hidden bg-white/5 border border-white/5 group-hover:border-blue-500/50 transition-all shadow-lg relative`}>
                                        <img
                                            src={getPosterUrl(item, (section.type === 'movies' || section.type === 'tvshows') ? 'Primary' : 'Thumb')}
                                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                            loading="lazy"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                                            <p className="text-white text-[10px] font-bold truncate">{item.Name}</p>
                                        </div>
                                    </div>
                                    <div className="mt-2">
                                        <p className="text-xs font-bold text-primary truncate group-hover:text-blue-500 transition-colors">{item.Name}</p>
                                        <p className="text-[10px] text-secondary opacity-60">{item.ProductionYear || ''}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* 向左引导按钮 - 只有滚动了才显示 */}
                        {scrollStates[section.id] > 10 && (
                            <>
                                <div className="absolute top-0 left-0 bottom-4 w-24 bg-gradient-to-r from-black/80 to-transparent pointer-events-none z-10 opacity-0 group-hover/scroll:opacity-100 transition-opacity duration-300"></div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleScroll(sectionsScrollRefs.current[section.id], 'left', section.id);
                                    }}
                                    className="absolute top-1/2 left-4 -translate-y-1/2 w-12 h-12 rounded-full bg-blue-600/80 backdrop-blur-md hover:bg-blue-500 shadow-2xl shadow-blue-500/40 border border-white/20 flex items-center justify-center text-white z-20 opacity-0 group-hover/scroll:opacity-100 transition-all duration-300 scale-75 group-hover/scroll:scale-100 active:scale-90"
                                >
                                    <i className="fas fa-chevron-left text-lg"></i>
                                </button>
                            </>
                        )}

                        {/* 向向右引导按钮 - 功能化升级，修复点击穿透 */}
                        <div className="absolute top-0 right-0 bottom-4 w-24 bg-gradient-to-l from-black/80 to-transparent pointer-events-none z-10 opacity-0 group-hover/scroll:opacity-100 transition-opacity duration-300"></div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleScroll(sectionsScrollRefs.current[section.id], 'right', section.id);
                            }}
                            className="absolute top-1/2 right-4 -translate-y-1/2 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 shadow-2xl shadow-blue-500/40 border border-white/20 flex items-center justify-center text-white z-20 opacity-0 group-hover/scroll:opacity-100 transition-all duration-300 scale-75 group-hover/scroll:scale-100 active:scale-90"
                        >
                            <i className="fas fa-chevron-right text-lg"></i>
                        </button>
                    </div>
                </section>
            ))}

            {!loading && resumeItems.length === 0 && sections.length === 0 && (
                <div className="py-20 text-center opacity-20">
                    <i className="fas fa-ghost text-6xl mb-4"></i>
                    <p>Emby 首页暂无内容同步</p>
                </div>
            )}
        </div>
    );
}

export function MediaServer({ serverId, categoryId, categoryName }: MediaServerProps) {
    const onNavigate = useAppNavigate();

    console.info(`[MediaServer] Active. Server: ${serverId}, Library: ${categoryId}`);

    const [loading, setLoading] = useState(false);
    const [server, setServer] = useState<any>(null);
    const [items, setItems] = useState<MediaItem[]>([]);

    // 🎨 增强状态：排序与视图
    const [sortBy, setSortBy] = useState('DateCreated,SortName'); // 默认按加入日期排序
    const [sortOrder, setSortOrder] = useState('Descending'); // 默认降序（最新在前）
    const [viewType, setViewType] = useState<'poster' | 'list'>('poster');
    const [showSortMenu, setShowSortMenu] = useState(false);

    // 📑 视图标签页
    const [activeTab, setActiveTab] = useState('items');

    // 二级视图状态
    const [subView, setSubView] = useState<{ type: 'genre' | 'tag' | 'boxset' | 'folder', id: string, name: string } | null>(null);

    // 📱 移动端抽屉控制
    const [showMobileDrawer, setShowMobileDrawer] = useState(false);

    // 当切换主 Tab 或库时，重置二级视图
    useEffect(() => {
        setSubView(null);
    }, [categoryId, activeTab]);

    useEffect(() => {
        if (serverId) {
            loadServerData();
        }
    }, [serverId]);

    useEffect(() => {
        if (serverId && categoryId) {
            loadItems(categoryId);
        } else {
            setItems([]);
        }
    }, [serverId, categoryId, sortBy, sortOrder, activeTab, subView]); // 监听 subView 变化

    const loadServerData = async () => {
        try {
            const serversRes = await apiGet<any[]>('/media-servers');
            if (serversRes.success && serversRes.data) {
                const s = serversRes.data.find(item => item.id === serverId);
                setServer(s);
            }
        } catch (error) {
            console.error('Failed to load server data:', error);
        }
    };

    const loadItems = async (libraryId: string) => {
        try {
            setLoading(true);

            // 如果处于二级视图 (点击了某个合集/类型/标签)
            if (subView) {
                console.log(`[MediaServer] Loading sub-view: ${subView.type} - ${subView.name}`);
                let url = `/media-servers/${serverId}/items`;
                let params: any = {
                    parentId: libraryId, // 保持在当前库范围内筛选
                    sortBy,
                    sortOrder,
                    recursive: true
                };

                // 根据不同类型构建查询
                if (subView.type === 'boxset' || subView.type === 'folder') {
                    // 合集/文件夹：ParentId 应该是合集 ID。
                    // 注意：Emby 中合集也是 Items，获取合集内容通常是 GetItems(ParentId=BoxSetId)
                    params.parentId = subView.id;
                } else if (subView.type === 'genre') {
                    // 类型：在当前库中筛选 GenreIds
                    params.genreIds = subView.id;
                } else if (subView.type === 'tag') {
                    // 标签：在当前库中筛选 TagIds
                    params.tagIds = subView.id;
                }

                // 执行查询
                const res = await apiGet<any>(url, params);
                setItems(res.success ? (res.data.Items || []) : []);
                setLoading(false);
                return;
            }

            // ... (Conventional Tab Loading Logic) ...
            console.log(`[MediaServer] Loading items for ${activeTab}...`);
            let url = `/media-servers/${serverId}/items`;
            let params: any = {
                parentId: libraryId,
                sortBy,
                sortOrder
            };

            // 根据标签页调整查询参数
            switch (activeTab) {
                case 'collections':
                    params.includeItemTypes = 'BoxSet';
                    params.recursive = true;
                    break;
                case 'favorites':
                    params.filters = 'IsFavorite';
                    params.recursive = true;
                    break;
                case 'genres':
                    url = `/media-servers/${serverId}/genres`;
                    break;
                case 'tags':
                    url = `/media-servers/${serverId}/tags`;
                    break;
                case 'items':
                default:
                    // 默认显示主要内容 (Movie, Series)
                    // 后端默认已处理
                    params.recursive = true;
                    break;
            }

            // ... (Execute) ...
            const res = await apiGet<any>(url, params);
            if (res.success && res.data) {
                let dataItems = [];
                if (Array.isArray(res.data)) {
                    dataItems = res.data;
                } else if (res.data.Items) {
                    dataItems = res.data.Items;
                }
                setItems(dataItems);
            } else {
                setItems([]);
            }
        } catch (error) {
            console.error('Failed to load items:', error);
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    const handlePlay = async (item: MediaItem) => {
        // 点击处理逻辑更新

        // 1. 合集 (BoxSet) -> 进入二级视图
        if (item.Type === 'BoxSet') {
            setSubView({ type: 'boxset', id: item.Id, name: item.Name });
            return;
        }

        // 2. 类型 (Genre) -> 进入二级视图
        if (activeTab === 'genres' || item.Type === 'Genre') {
            setSubView({ type: 'genre', id: item.Id, name: item.Name }); // Or item.Id? Genre items usually have Id.
            // Note: For some APIs, Genre "Id" might be the name or an ID. Emby returns IDs for Genres.
            return;
        }

        // 3. 标签 (Tag) -> 进入二级视图
        if (activeTab === 'tags' || item.Type === 'Tag') {
            setSubView({ type: 'tag', id: item.Id, name: item.Name });
            return;
        }

        // 4. 文件夹 (Folder)
        if (item.Type === 'Folder') {
            // 文件夹暂时也视为一种容器，类似 BoxSet
            setSubView({ type: 'folder', id: item.Id, name: item.Name });
            return;
        }

        // 5. 媒体文件 -> 播放
        try {
            const res = await apiGet<any>(`/media-servers/${serverId}/playback/${item.Id}`);
            if (res.success && res.data.streamUrl) {
                onNavigate('media_server_play', {
                    mediaServerId: serverId,
                    vodId: item.Id,
                    title: item.Name,
                    url: res.data.streamUrl,
                    cover: getPosterUrl(item)
                });
            } else {
                alert(res.error || '获取播放地址失败');
            }
        } catch (error) {
            console.error('Failed to get playback info:', error);
        }
    };

    const getPosterUrl = (item: MediaItem) => {
        if (!item.ImageTags?.Primary || !server) return '';
        return `${server.url}/emby/Items/${item.Id}/Images/Primary?maxWidth=300&tag=${item.ImageTags.Primary}&api_key=${server.api_key}`;
    };

    const formatRuntime = (ticks: number) => {
        if (!ticks) return '';
        const minutes = Math.floor(ticks / 600000000);
        return `${minutes} 分钟`;
    };

    if (!serverId) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-secondary">
                <i className="fas fa-film text-6xl opacity-10 mb-4"></i>
                <p>请在左侧选择一个影视库</p>
            </div>
        );
    }

    const sortOptions = [
        { label: '加入日期', value: 'DateCreated,SortName' },
        { label: '上映日期', value: 'PremiereDate,SortName' },
        { label: 'IMDb 评分', value: 'CommunityRating,SortName' },
        { label: '分辨率', value: 'VideoBitDepth,Width,SortName' },
        { label: '添加日期', value: 'DateCreated,SortName' },
        { label: '媒体容器', value: 'Container,SortName' },
        { label: '家长评分', value: 'OfficialRating,SortName' },
        { label: '导演', value: 'Director,SortName' },
        { label: '帧率', value: 'VideoFrameRate,SortName' },
        { label: '年份', value: 'ProductionYear,SortName' },
        { label: '影评人评分', value: 'CriticRating,SortName' },
        { label: '播放日期', value: 'DatePlayed,SortName' },
        { label: '播放时长', value: 'Runtime,SortName' },
        { label: '播放次数', value: 'PlayCount,SortName' },
        { label: '文件名', value: 'Path,SortName' },
        { label: '文件尺寸', value: 'Size,SortName' },
        { label: '标题', value: 'SortName' },
        { label: '比特率', value: 'TotalBitrate,SortName' },
    ];

    const tabs = [
        { id: 'items', label: '影片', icon: 'fa-film' },
        { id: 'collections', label: '合集', icon: 'fa-layer-group' },
        { id: 'genres', label: '类型', icon: 'fa-tags' },
        { id: 'tags', label: '标签', icon: 'fa-hashtag' },
        { id: 'favorites', label: '收藏', icon: 'fa-heart' },
    ];






    const renderEmptyState = () => (
        <div className="py-32 text-center glass-effect rounded-[40px] border border-dashed border-border-color">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                <i className="fas fa-inbox text-4xl opacity-10"></i>
            </div>
            <h3 className="text-xl font-bold text-primary mb-2">空空如也</h3>
            <p className="text-sm text-secondary opacity-40 max-w-xs mx-auto">此视图下暂无内容</p>
        </div>
    );

    const renderPosterCard = (item: MediaItem) => (
        <div key={item.Id} className="group relative cursor-pointer" onClick={() => handlePlay(item)}>
            <div className="aspect-[2/3] rounded-2xl overflow-hidden bg-white/5 border border-border-color group-hover:border-blue-500/50 transition-all active:scale-95 shadow-md">
                {/* 处理不同类型的内容展示 */}
                {(activeTab === 'genres' || activeTab === 'tags') && !subView && !item.ImageTags?.Primary ? (
                    // 标签/类型卡片
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-500/20 to-purple-500/20 group-hover:from-blue-500/30 group-hover:to-purple-500/30 transition-colors p-4 text-center">
                        <i className={`fas ${activeTab === 'genres' ? 'fa-tags' : 'fa-hashtag'} text-3xl mb-2 text-white/50 group-hover:text-white transition-colors`}></i>
                        <span className="text-sm font-bold text-white line-clamp-2">{item.Name}</span>
                    </div>
                ) : item.ImageTags?.Primary ? (
                    <img src={getPosterUrl(item)} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-secondary opacity-20">
                        <i className="fas fa-image text-4xl"></i>
                    </div>
                )}

                {/* 评分角标 */}
                {item.CommunityRating && (
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-yellow-500 text-black text-[10px] font-black flex items-center gap-1 shadow-lg">
                        <i className="fas fa-star text-[8px]"></i>
                        {item.CommunityRating.toFixed(1)}
                    </div>
                )}
            </div>
            <div className="mt-3">
                <p className="text-sm font-bold text-primary truncate group-hover:text-blue-500 transition-colors">{item.Name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-secondary opacity-60">{item.ProductionYear || ''}</span>
                    {item.Type === 'Series' && <span className="text-[9px] px-1 bg-blue-500/10 text-blue-500 rounded font-bold uppercase scale-90 origin-left">剧集</span>}
                    {item.Type === 'BoxSet' && <span className="text-[9px] px-1 bg-purple-500/10 text-purple-500 rounded font-bold uppercase scale-90 origin-left">合集</span>}
                </div>
            </div>
        </div>
    );

    const renderListItem = (item: MediaItem) => (
        <div
            key={item.Id}
            className="flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 transition-all cursor-pointer group border border-transparent hover:border-white/5"
            onClick={() => handlePlay(item)}
        >
            <div className="w-16 aspect-[2/3] rounded-lg overflow-hidden flex-shrink-0 shadow-lg">
                {(activeTab === 'genres' || activeTab === 'tags') && !subView && !item.ImageTags?.Primary ? (
                    <div className="w-full h-full flex items-center justify-center bg-white/5">
                        <i className={`fas ${activeTab === 'genres' ? 'fa-tags' : 'fa-hashtag'} text-secondary opacity-50`}></i>
                    </div>
                ) : (
                    <img src={getPosterUrl(item)} className="w-full h-full object-cover" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-primary truncate group-hover:text-blue-500 transition-colors">{item.Name}</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-secondary opacity-60">
                    <span className="font-mono">{item.ProductionYear || ''}</span>
                    <span>•</span>
                    <span>{item.Type === 'Series' ? '剧集' : (item.Type === 'BoxSet' ? '合集' : '电影')}</span>
                    {item.RunTimeTicks && (
                        <>
                            <span>•</span>
                            <span>{formatRuntime(item.RunTimeTicks)}</span>
                        </>
                    )}
                </div>
                <p className="text-xs text-secondary mt-2 line-clamp-1 opacity-40">{item.Overview || ''}</p>
            </div>

        </div>
    );

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm text-secondary animate-pulse font-medium">
                        {subView ? `正在加载${subView.name}...` : '正在加载媒体列表...'}
                    </p>
                </div>
            );
        }

        if (items.length === 0) return renderEmptyState();

        return viewType === 'poster' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-x-4 gap-y-6">
                {items.map(item => renderPosterCard(item))}
            </div>
        ) : (
            <div className="space-y-2">
                {items.map(item => renderListItem(item))}
            </div>
        );
    };

    return (
        <div className="p-6 space-y-6">
            {!categoryId ? (
                <MediaServerHomeView server={server} onPlay={handlePlay} onNavigate={onNavigate} />
            ) : (
                <>
                    {/* 🛠 顶部增强工具栏 (单行布局) */}
                    <div className="flex items-center h-14 border-b border-white/5 mb-4 gap-4">
                        {/* 1. 左侧：返回 & 标题 */}
                        <div className="flex items-center gap-4 flex-shrink-0">
                            <button
                                onClick={() => onNavigate('media_server', { serverId })}
                                className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-secondary hover:bg-white/10 hover:text-primary transition-all group"
                                title="返回首页"
                            >
                                <i className="fas fa-chevron-left text-xs group-hover:-translate-x-0.5 transition-transform"></i>
                            </button>
                            <h2 className="text-lg font-bold text-primary truncate tracking-tight max-w-[200px]">
                                {categoryName || server?.name || '影视库'}
                            </h2>
                        </div>

                        {/* 2. 中间：Tabs (桌面端显示胶囊样式，移动端隐藏) */}
                        <div className="flex-1 hidden md:flex items-center gap-1 overflow-x-auto hide-scrollbar">
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`
                                        px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap
                                        ${activeTab === tab.id
                                            ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                                            : 'text-secondary hover:text-primary hover:bg-white/5'
                                        }
                                    `}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>


                        {/* 移动端筛选按钮 - 移出条件块，确保始终显示 */}
                        <button
                            onClick={() => setShowMobileDrawer(true)}
                            className="md:hidden h-8 px-3 rounded-lg flex items-center gap-2 text-xs transition-all shadow-sm active:scale-95 bg-secondary border border-border-color text-primary"
                        >
                            <i className="fas fa-sliders-h text-blue-500 text-[10px]"></i>
                            <span className="font-bold">{tabs.find(t => t.id === activeTab)?.label || '筛选'}</span>
                        </button>

                        {/* 3. 右侧：排序 & 视图 (条件显示) */}
                        {(subView || ['items', 'collections', 'favorites'].includes(activeTab)) && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {/* 排序菜单 (桌面端显示) */}
                                <div className="relative hidden md:block">
                                    <button
                                        onClick={() => setShowSortMenu(!showSortMenu)}
                                        className="h-8 px-3 rounded-lg flex items-center gap-2 text-xs transition-all shadow-sm active:scale-95 bg-secondary border border-border-color text-primary hover:opacity-80"
                                    >
                                        <i className="fas fa-filter text-blue-500 text-[10px]"></i>
                                        <span className="max-w-[60px] truncate font-bold">{sortOptions.find(o => o.value === sortBy)?.label || '排序'}</span>
                                        <i className={`fas fa-chevron-down text-[8px] opacity-40 transition-transform ${showSortMenu ? 'rotate-180' : ''}`}></i>
                                    </button>

                                    {showSortMenu && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)}></div>
                                            <div
                                                className="absolute z-50 right-0 top-full mt-2 w-48 rounded-xl shadow-2xl overflow-hidden border border-border-color bg-secondary"
                                                style={{ backgroundColor: 'var(--bg-secondary)' }}
                                            >
                                                <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                                                    {sortOptions.map(opt => (
                                                        <button
                                                            key={opt.value}
                                                            className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-all flex items-center justify-between group 
                                                                ${sortBy === opt.value
                                                                    ? 'bg-blue-500/10 text-blue-500'
                                                                    : 'text-secondary hover:bg-primary/5'}`}
                                                            onClick={() => {
                                                                setSortBy(opt.value);
                                                                setShowSortMenu(false);
                                                            }}
                                                        >
                                                            <span>{opt.label}</span>
                                                            {sortBy === opt.value && <i className="fas fa-check text-[10px]"></i>}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="p-2 border-t border-border-color">
                                                    <button
                                                        className="w-full h-8 flex items-center justify-center gap-2 text-xs rounded-lg transition-colors hover:bg-primary/5 text-secondary"
                                                        onClick={() => setSortOrder(sortOrder === 'Ascending' ? 'Descending' : 'Ascending')}
                                                    >
                                                        <i className={`fas ${sortOrder === 'Ascending' ? 'fa-sort-alpha-down' : 'fa-sort-alpha-up'}`}></i>
                                                        {sortOrder === 'Ascending' ? '升序' : '降序'}
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* 排序菜单保留 */}

                                {/* 视图切换 (桌面端显示) */}
                                <div className="hidden md:flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
                                    <button
                                        className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${viewType === 'poster' ? 'bg-blue-500 text-white' : 'text-secondary hover:text-primary'}`}
                                        onClick={() => setViewType('poster')}
                                    >
                                        <i className="fas fa-th-large text-[10px]"></i>
                                    </button>
                                    <button
                                        className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${viewType === 'list' ? 'bg-blue-500 text-white' : 'text-secondary hover:text-primary'}`}
                                        onClick={() => setViewType('list')}
                                    >
                                        <i className="fas fa-list text-[10px]"></i>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 📱 移动端底部抽屉 Portal */}
                    {showMobileDrawer && createPortal(
                        <div className="fixed inset-0 z-[100]" onClick={() => setShowMobileDrawer(false)}>
                            {/* 遮罩 */}
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"></div>

                            {/* 抽屉内容 */}
                            <div
                                className="absolute bottom-0 left-0 right-0 bg-secondary rounded-t-3xl max-h-[70vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-full duration-300"
                                onClick={e => e.stopPropagation()}
                            >
                                {/* 头部装饰条 */}
                                <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto mt-3 mb-1"></div>

                                {/* 标题 */}
                                <div className="px-6 py-4 flex items-center justify-between border-b border-white/5">
                                    <h3 className="text-lg font-black text-primary">选择视图</h3>
                                    <button
                                        onClick={() => setShowMobileDrawer(false)}
                                        className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-secondary"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>

                                {/* 列表区域 */}
                                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-8">
                                    {/* 1. 浏览板块 (调整到最前，并改为紧凑按钮) */}
                                    <section>
                                        <h4 className="px-2 mb-3 text-[10px] font-black uppercase tracking-widest text-secondary opacity-50 flex items-center gap-2">
                                            <i className="fas fa-th-list"></i>
                                            浏览板块
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {tabs.map(tab => (
                                                <button
                                                    key={tab.id}
                                                    onClick={() => {
                                                        setActiveTab(tab.id);
                                                        setShowMobileDrawer(false);
                                                    }}
                                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-2 ${activeTab === tab.id
                                                        ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20'
                                                        : 'bg-white/5 border-white/5 text-primary active:scale-95'
                                                        }`}
                                                >
                                                    <i className={`fas ${tab.id === 'items' ? 'fa-video' :
                                                        tab.id === 'collections' ? 'fa-layer-group' :
                                                            tab.id === 'genres' ? 'fa-tags' :
                                                                tab.id === 'tags' ? 'fa-hashtag' : 'fa-star'
                                                        } text-[10px]`}></i>
                                                    <span>{tab.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </section>

                                    {/* 2. 排序区块 */}
                                    <section>
                                        <h4 className="px-2 mb-3 text-[10px] font-black uppercase tracking-widest text-secondary opacity-50 flex items-center gap-2">
                                            <i className="fas fa-sort-amount-down-alt"></i>
                                            排序设置
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {sortOptions.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => setSortBy(opt.value)}
                                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${sortBy === opt.value
                                                        ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20'
                                                        : 'bg-white/5 border-white/5 text-primary active:scale-95'
                                                        }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                            <button
                                                onClick={() => setSortOrder('Ascending')}
                                                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border transition-all ${sortOrder === 'Ascending'
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'bg-white/5 border-white/5 text-secondary'
                                                    }`}
                                            >
                                                <i className="fas fa-sort-alpha-down"></i>
                                                升序
                                            </button>
                                            <button
                                                onClick={() => setSortOrder('Descending')}
                                                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border transition-all ${sortOrder === 'Descending'
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'bg-white/5 border-white/5 text-secondary'
                                                    }`}
                                            >
                                                <i className="fas fa-sort-alpha-up"></i>
                                                降序
                                            </button>
                                        </div>
                                    </section>
                                </div>

                                {/* 安全区填充 */}
                                <div className="h-8"></div>
                            </div>
                        </div>,
                        document.body
                    )}

                    {renderContent()}
                </>
            )}
        </div>
    );
}

export default MediaServer;

