import { useState, useEffect } from 'react';
import { VideoSource, TvSource, LiveSource, NetdiskSource, TvChannel, Category } from '../types';
import { apiPost, apiGet } from '../utils/api';
import { AppModule } from '../App';

interface NavParams {
    sourceId?: number;
    categoryId?: string;
    categoryName?: string;
    vodId?: string;
    keyword?: string;
    platform?: string;
    liveSourceId?: number;
    mediaServerId?: number;
    netdiskSourceId?: number;
}

interface SidebarProps {
    sources: VideoSource[];
    categoriesMap: Record<number, Category[]>;
    selectedSourceId: number | null;
    onSourceChange: (id: number) => void;

    // TV Props
    tvSources?: TvSource[];
    selectedTvSourceId?: number | null;
    onTvSourceChange?: (id: number) => void;
    onPlayChannel?: (channel: TvChannel) => void;

    // Live Props
    liveSources?: LiveSource[];

    // Netdisk Props
    netdiskSources?: NetdiskSource[];
    selectedNetdiskSourceId?: number | null;
    onNetdiskSourceChange?: (id: number) => void;

    tvRefreshKey?: number; // New prop
    currentChannelUrl?: string; // Current playing channel URL
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
    activeView: string;
    navParams: NavParams;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    isMobile?: boolean; // 是否为移动端模式
    onCloseMobile?: () => void;
    activeModule?: AppModule; // 当前激活的模块
    onModuleChange?: (module: AppModule) => void; // 模块切换回调
    theme?: 'light' | 'dark';
    onToggleTheme?: () => void;
    liveStatuses?: Record<number, any>;
    isAdminPasswordEnabled?: boolean;

    // Media Server Props
    mediaServers?: any[];
    selectedMediaServerId?: number | null;
    onMediaServerChange?: (id: number) => void;
}

export function Sidebar({
    sources,
    // categoriesMap,
    selectedSourceId,
    onSourceChange,

    tvSources = [],
    selectedTvSourceId,
    onTvSourceChange,
    onPlayChannel,
    tvRefreshKey,
    currentChannelUrl,

    liveSources = [],

    netdiskSources = [],
    selectedNetdiskSourceId,
    onNetdiskSourceChange,

    onNavigate,
    activeView,
    navParams,
    collapsed = false,
    onToggleCollapse,
    isMobile = false,
    onCloseMobile,
    activeModule,
    onModuleChange,
    theme = 'dark',
    liveStatuses = {},

    mediaServers = [],
    selectedMediaServerId,
    onMediaServerChange
}: SidebarProps) {
    const [isSourcesOpen, setIsSourcesOpen] = useState(true);

    // TV State
    // const [tvChannels, setTvChannels] = useState<TvChannel[]>([]);
    const [groupedChannels, setGroupedChannels] = useState<Record<string, TvChannel[]>>({});
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [tvSearch, setTvSearch] = useState('');

    // Media Server State
    const [mediaServerCategories, setMediaServerCategories] = useState<Record<number, any[]>>({});

    // 加载电视频道
    useEffect(() => {
        if (activeModule === 'tv' && selectedTvSourceId) {
            loadTvChannels(selectedTvSourceId);
        }
    }, [activeModule, selectedTvSourceId, tvRefreshKey]);

    useEffect(() => {
        if (activeModule === 'media_server' && mediaServers.length > 0) {
            loadMediaServerCategories();
        }
    }, [activeModule, mediaServers]);

    const loadMediaServerCategories = async () => {
        try {
            const newCategories: Record<number, any[]> = {};
            await Promise.all(mediaServers.map(async (server) => {
                if (server.enabled) {
                    const res = await apiGet<any[]>(`/media-servers/${server.id}/libraries`);
                    if (res.success && res.data) {
                        newCategories[server.id] = res.data;
                    }
                }
            }));
            setMediaServerCategories(newCategories);
        } catch (e) {
            console.error('Failed to load media server categories', e);
        }
    };

    const loadTvChannels = async (sourceId: number) => {
        try {
            const res = await apiGet<TvChannel[]>(`/tv/playlist/${sourceId}`);
            if (res.success && res.data) {
                // Group channels
                const groups: Record<string, TvChannel[]> = {};
                res.data.forEach(ch => {
                    const g = ch.group || '其他';
                    if (!groups[g]) groups[g] = [];
                    groups[g].push(ch);
                });
                setGroupedChannels(groups);

                // 默认收起所有电视分组
                setExpandedGroups({});
            }
        } catch (e) {
            console.error('Failed to load TV channels', e);
        }
    };

    const toggleGroup = (group: string) => {
        setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
    };

    const isActive = (id: string) => {
        if (id === 'home' && activeView === 'home') return true;

        // 🚀 核心优化：优先从 navParams 获取 ID，确保在多级路由下高亮准确 antisocial antisense
        if (id.startsWith('source-')) {
            const sid = parseInt(id.split('-')[1]);
            const currentSourceId = navParams.sourceId || selectedSourceId;
            // 只有在相关联的视图（源概览、分类列表、播放页）时才高亮对应的源
            const isSourceView = activeView === 'source' || activeView === 'category' || activeView === 'play';
            return isSourceView && sid === currentSourceId;
        }

        if (id.startsWith('netdisk-source-')) {
            const sid = parseInt(id.split('-')[1]);
            const currentNetdiskId = navParams.netdiskSourceId || selectedNetdiskSourceId;
            const isNetdiskView = activeView === 'netdisk' || activeView === 'netdisk_play';
            return isNetdiskView && sid === currentNetdiskId;
        }

        if (id.startsWith('live-play-')) {
            const sid = parseInt(id.split('-')[1]);
            return (activeView === 'live' || activeView === 'live_play') && sid === navParams.liveSourceId;
        }

        if (id === activeView) return true;
        return false;
    };

    const handleNavigate = (view: string, params?: Record<string, unknown>) => {
        onNavigate(view, params);
        if (onCloseMobile) onCloseMobile();
    };

    // 渲染 Logo/Header
    const renderHeader = () => {
        const borderColor = theme === 'dark' ? 'border-border-color' : 'border-slate-200';
        const titleColor = theme === 'dark' ? 'text-slate-100' : 'text-slate-900';

        if (collapsed) {
            return (
                <div className={`h-16 flex items-center justify-center border-b ${borderColor} bg-white/5`}>
                    <i className="fas fa-play-circle text-blue-500 text-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></i>
                </div>
            );
        }
        return (
            <div className={`p-4 h-16 border-b ${borderColor} flex items-center justify-between bg-white/5 backdrop-blur-sm`}>
                <div className="flex flex-col">
                    <h1 className={`text-lg font-bold ${titleColor} flex items-center gap-2 tracking-tight`}>
                        <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <i className={`fas ${activeModule === 'tv' ? 'fa-tv' : 'fa-play-circle'} text-white text-sm`}></i>
                        </div>
                        {activeModule === 'tv' ? '电视直播' : '视频中心'}
                    </h1>
                </div>
                {/* 移动端关闭按钮 */}
                {isMobile && onCloseMobile && (
                    <button onClick={onCloseMobile} className={`${theme === 'dark' ? 'text-secondary hover:text-primary' : 'text-secondary hover:text-slate-900'} lg:hidden transition-colors`}>
                        <i className="fas fa-times text-lg"></i>
                    </button>
                )}
            </div>
        );
    };

    const renderLiveSidebar = () => {
        return (
            <div className="w-full space-y-0.5 mt-2">
                {/* 全部直播 */}
                <SidebarItem
                    key="all"
                    icon="fas fa-broadcast-tower"
                    label="全部直播"
                    isActive={!navParams.platform || navParams.platform === 'all'}
                    onClick={() => {
                        onNavigate('live', { platform: 'all' });
                        if (isMobile && onCloseMobile) onCloseMobile();
                    }}
                    collapsed={collapsed}
                />

                {/* B站 */}
                <div className="w-full">
                    <SidebarItem
                        icon="fab fa-product-hunt"
                        label="B站"
                        isActive={navParams.platform === 'bilibili'}
                        onClick={() => {
                            if (!collapsed) toggleGroup('live-bilibili');
                            onNavigate('live', { platform: 'bilibili' });
                        }}
                        collapsed={collapsed}
                        hasChildren={liveSources.some(s => s.platform === 'bilibili')}
                        isExpanded={expandedGroups['live-bilibili'] !== false} // 默认展开
                    />
                    {!collapsed && expandedGroups['live-bilibili'] !== false && (
                        <div className="space-y-0.5">
                            {liveSources.filter(s => s.platform === 'bilibili').map(source => (
                                <SidebarItem
                                    key={source.id}
                                    icon=""
                                    dot={true}
                                    label={source.name}
                                    status={liveStatuses[source.id]?.is_live ? 'live' : 'none'}
                                    isActive={navParams.liveSourceId === source.id}
                                    onClick={() => {
                                        onNavigate('live_play', { liveSourceId: source.id });
                                        if (isMobile && onCloseMobile) onCloseMobile();
                                    }}
                                    level={1}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* 抖音 */}
                <div className="w-full">
                    <SidebarItem
                        icon="fab fa-tiktok"
                        label="抖音"
                        isActive={navParams.platform === 'douyin'}
                        onClick={() => {
                            if (!collapsed) toggleGroup('live-douyin');
                            onNavigate('live', { platform: 'douyin' });
                        }}
                        collapsed={collapsed}
                        hasChildren={liveSources.some(s => s.platform === 'douyin')}
                        isExpanded={expandedGroups['live-douyin'] !== false} // 默认展开
                    />
                    {!collapsed && expandedGroups['live-douyin'] !== false && (
                        <div className="space-y-0.5">
                            {liveSources.filter(s => s.platform === 'douyin').map(source => (
                                <SidebarItem
                                    key={source.id}
                                    icon=""
                                    dot={true}
                                    label={source.name}
                                    status={liveStatuses[source.id]?.is_live ? 'live' : 'none'}
                                    isActive={navParams.liveSourceId === source.id}
                                    onClick={() => {
                                        onNavigate('live_play', { liveSourceId: source.id });
                                        if (isMobile && onCloseMobile) onCloseMobile();
                                    }}
                                    level={1}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderNetdiskSidebar = () => (
        <div className="w-full space-y-0.5 mt-2">
            {/* 全部网盘 */}
            {!isMobile && (
                <SidebarItem
                    icon="fas fa-cloud"
                    label="全部媒体"
                    isActive={activeView === 'netdisk' && !selectedNetdiskSourceId}
                    onClick={() => {
                        onNetdiskSourceChange?.(0);  // 清空选中的网盘源
                        onNavigate('netdisk', { netdiskSourceId: undefined });
                        if (onCloseMobile) onCloseMobile();
                    }}
                    collapsed={collapsed}
                />
            )}

            {/* 网盘源列表 */}
            {netdiskSources.filter(s => s.enabled).map(source => {
                const scanPaths = Array.isArray(source.scan_paths) ? source.scan_paths : [];
                const isExpanded = expandedGroups[`netdisk-${source.id}`] !== false; // 默认展开

                return (
                    <div key={source.id} className="w-full">
                        <SidebarItem
                            icon="fas fa-hdd"
                            label={source.name}
                            isActive={isActive(`netdisk-source-${source.id}`) && !navParams.keyword}
                            onClick={() => {
                                if (!collapsed && scanPaths.length > 0) {
                                    toggleGroup(`netdisk-${source.id}`);
                                }
                                onNetdiskSourceChange?.(source.id);
                                onNavigate('netdisk', { netdiskSourceId: source.id });
                            }}
                            collapsed={collapsed}
                            hasChildren={scanPaths.length > 0}
                            isExpanded={isExpanded}
                        />
                        {!collapsed && isExpanded && scanPaths.length > 0 && (
                            <div className="space-y-0.5">
                                {scanPaths.map((pathObj: any, idx) => (
                                    <SidebarItem
                                        key={`${source.id}-${idx}`}
                                        icon="fas fa-folder"
                                        label={pathObj.name}
                                        isActive={selectedNetdiskSourceId === source.id && navParams.keyword === pathObj.path}
                                        onClick={() => {
                                            onNetdiskSourceChange?.(source.id);
                                            onNavigate('netdisk', { netdiskSourceId: source.id, keyword: pathObj.path });
                                            if (isMobile && onCloseMobile) onCloseMobile();
                                        }}
                                        level={1}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const renderMediaServerSidebar = () => (
        <div className="w-full space-y-0.5 mt-2">
            {mediaServers
                .filter(s => s.enabled)
                .map(server => {
                    const categories = mediaServerCategories[server.id] || [];
                    const isExpanded = expandedGroups[`media-server-${server.id}`] !== false;
                    return (
                        <div key={server.id} className="w-full">
                            <SidebarItem
                                icon={server.type === 'emby' ? 'fas fa-play-circle' : 'fas fa-server'}
                                label={server.name}
                                isActive={selectedMediaServerId === server.id && !navParams.categoryId}
                                onClick={() => {
                                    if (!collapsed && categories.length > 0) {
                                        // 如果当前没展开，或者点击的是新服务器，确保展开列表
                                        if (!isExpanded || selectedMediaServerId !== server.id) {
                                            setExpandedGroups(prev => ({ ...prev, [`media-server-${server.id}`]: true }));
                                        }
                                    }
                                    onMediaServerChange?.(server.id);
                                    // 🔑 显式设置 categoryId 为 undefined，触发 MediaServer 组件显示首页聚合视图
                                    onNavigate('media_server', { mediaServerId: server.id, categoryId: undefined });
                                }}
                                collapsed={collapsed}
                                hasChildren={categories.length > 0}
                                isExpanded={isExpanded}
                            />
                            {!collapsed && isExpanded && categories.length > 0 && (
                                <div className="space-y-0.5">
                                    {categories.map((lib) => (
                                        <SidebarItem
                                            key={lib.Id}
                                            icon="fas fa-folder"
                                            label={lib.Name}
                                            isActive={selectedMediaServerId === server.id && navParams.categoryId === lib.Id}
                                            onClick={() => {
                                                onMediaServerChange?.(server.id);
                                                onNavigate('media_server', {
                                                    mediaServerId: server.id,
                                                    categoryId: lib.Id,
                                                    categoryName: lib.Name
                                                });
                                                if (isMobile && onCloseMobile) onCloseMobile();
                                            }}
                                            level={1}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
        </div>
    );

    const renderVideoSidebar = () => (
        <div className="w-full space-y-0.5">
            {/* 首页 (桌面端) */}
            {!isMobile && (
                <SidebarItem
                    icon="fas fa-home"
                    label="首页"
                    isActive={isActive('home')}
                    onClick={() => handleNavigate('home')}
                    collapsed={collapsed}
                />
            )}

            {/* 视频源 (折叠组) */}
            <div className="w-full mt-2">
                {!collapsed ? (
                    <div
                        className="w-full flex items-center px-4 py-3 text-sm font-medium text-secondary dark:text-secondary cursor-pointer hover:text-black dark:hover:text-primary transition-colors"
                        onClick={() => setIsSourcesOpen(!isSourcesOpen)}
                    >
                        <i className={`fas fa-chevron-right text-[10px] w-4 transition-transform ${isSourcesOpen ? 'rotate-90' : ''}`}></i>
                        <span className="flex-1 ml-1">视频源站</span>
                    </div>
                ) : (
                    <div className="flex justify-center py-2 text-secondary border-t border-border-color dark:border-border-color/50 mt-2 pt-4">
                        <i className="fas fa-server text-xs" title="视频源"></i>
                    </div>
                )}

                {(isSourcesOpen || collapsed) && (
                    <div className="w-full space-y-0.5 mt-0">
                        {sources.map(source => (
                            <SidebarItem
                                key={source.id}
                                icon="fas fa-server"
                                label={source.name}
                                isActive={isActive(`source-${source.id}`)}
                                onClick={() => {
                                    onSourceChange(source.id);
                                    // 触发后台异步同步分类（不阻塞UI）
                                    apiPost(`/sources/${source.id}/background-sync`).catch(() => { });
                                    if (onCloseMobile) onCloseMobile();
                                }}
                                collapsed={collapsed}
                            />
                        ))}
                    </div >
                )}
            </div >
        </div>
    );

    const renderTvSidebar = () => {
        // 源选择器 (重构为折叠列表)
        const sourceSelector = !collapsed && (
            <div className="w-full mb-2">
                <SidebarItem
                    icon="fas fa-server"
                    label="电视源选择"
                    isActive={false}
                    onClick={() => toggleGroup('tv-sources')}
                    hasChildren={true}
                    isExpanded={expandedGroups['tv-sources'] !== false}
                />
                {expandedGroups['tv-sources'] !== false && (
                    <div className="space-y-0.5">
                        {tvSources.map(s => (
                            <SidebarItem
                                key={s.id}
                                icon="fas fa-satellite-dish"
                                label={s.name}
                                isActive={selectedTvSourceId === s.id}
                                onClick={() => {
                                    onTvSourceChange?.(s.id);
                                    // 自动收起
                                    toggleGroup('tv-sources');
                                }}
                                level={1}
                            />
                        ))}
                    </div>
                )}
            </div>
        );

        // 搜索框
        const searchBox = !collapsed && (
            <div className="px-3 mb-2">
                <div className="relative">
                    <input
                        type="text"
                        className={`w-full text-xs rounded-full border py-1.5 pl-8 pr-3 focus:outline-none focus:border-blue-500
                            ${theme === 'dark'
                                ? 'bg-secondary text-gray-200 border-border-color'
                                : 'bg-gray-100 text-gray-800 border-gray-200'}
                        `}
                        placeholder="搜索频道..."
                        value={tvSearch}
                        onChange={(e) => setTvSearch(e.target.value)}
                    />
                    <i className="fas fa-search absolute left-3 top-2 text-secondary text-xs"></i>
                </div>
            </div>
        );

        // 过滤频道
        let displayGroups: Record<string, TvChannel[]> = groupedChannels;
        if (tvSearch) {
            displayGroups = {};
            Object.entries(groupedChannels).forEach(([group, channels]) => {
                const filtered = channels.filter(ch => ch.name.toLowerCase().includes(tvSearch.toLowerCase()));
                if (filtered.length > 0) {
                    displayGroups[group] = filtered;
                }
            });
        }

        // 确保搜索时自动展开有结果的组
        const currentExpanded: Record<string, boolean> = tvSearch ?
            Object.keys(displayGroups).reduce((acc: Record<string, boolean>, g) => ({ ...acc, [g]: true }), {})
            : expandedGroups;

        return (
            <div className="flex flex-col h-full">
                {sourceSelector}
                {searchBox}

                <div className="flex-1 overflow-y-auto sidebar-scrollbar px-1 space-y-0.5">
                    {Object.entries(displayGroups).map(([group, channels]) => (
                        <div key={group} className="w-full">
                            {!collapsed ? (
                                <>
                                    <SidebarItem
                                        icon="fas fa-list-ul"
                                        label={group}
                                        isActive={false}
                                        onClick={() => toggleGroup(group)}
                                        hasChildren={true}
                                        isExpanded={currentExpanded[group]}
                                    />
                                    {currentExpanded[group] && (
                                        <div className="space-y-0.5">
                                            {channels.map((ch, idx) => (
                                                <SidebarItem
                                                    key={`${idx}-${ch.name}`}
                                                    icon=""
                                                    img={ch.logo}
                                                    dot={!ch.logo}
                                                    label={ch.name}
                                                    isActive={ch.url === currentChannelUrl}
                                                    onClick={() => {
                                                        onPlayChannel?.(ch);
                                                        if (isMobile && onCloseMobile) onCloseMobile();
                                                    }}
                                                    level={1}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                // Collapsed view (just icons or skipped)
                                <div className="flex justify-center py-2 relative group" title={group}>
                                    <span className="text-[10px] text-secondary font-mono border border-border-color/50 rounded px-1">{group.substring(0, 2)}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className={`flex flex-col h-full w-full select-none pb-safe transition-all duration-500 border-r glass-effect
            ${theme === 'dark' ? 'text-slate-300 border-border-color shadow-2xl' : 'text-slate-600 border-slate-200 shadow-xl'}
        `}>
            {renderHeader()}

            <div className={`flex-1 w-full min-w-full overflow-y-auto overflow-x-hidden sidebar-scrollbar scrollbar-overlay space-y-0.5 ${collapsed ? 'py-4' : 'py-2'}`}>
                {/* 移动端导航菜单 */}
                {isMobile && onModuleChange && (
                    <div className={`px-1 pb-3 mb-2 border-b ${theme === 'dark' ? 'border-border-color' : 'border-gray-200'}`}>
                        <div className="text-[10px] font-bold text-secondary uppercase tracking-wider px-3 mb-2">导航</div>
                        {[
                            { key: 'home', label: '首页', icon: 'fa-home' },
                            { key: 'sources', label: '资源站', icon: 'fa-database' },
                            { key: 'media_server', label: '影视库', icon: 'fa-film' },
                            { key: 'netdisk', label: '媒体库', icon: 'fa-cloud' },
                            { key: 'tv', label: '电视', icon: 'fa-tv' },
                            { key: 'live', label: '直播', icon: 'fa-broadcast-tower' },
                        ].map(item => (
                            <SidebarItem
                                key={item.key}
                                icon={`fas ${item.icon}`}
                                label={item.label}
                                isActive={activeModule === item.key}
                                onClick={() => {
                                    onModuleChange(item.key as AppModule);
                                    if (onCloseMobile) onCloseMobile();
                                }}
                            />
                        ))}
                    </div>
                )}

                {activeModule === 'tv'
                    ? renderTvSidebar()
                    : (activeModule === 'live'
                        ? renderLiveSidebar()
                        : (activeModule === 'netdisk'
                            ? renderNetdiskSidebar()
                            : (activeModule === 'media_server'
                                ? renderMediaServerSidebar()
                                : renderVideoSidebar())))}
            </div>

            {/* 底部功能按钮 */}
            <div className={`p-3 border-t space-y-1 ${theme === 'dark' ? 'border-border-color' : 'border-gray-200'}`}>

                {!isMobile && onToggleCollapse && (
                    <button
                        onClick={onToggleCollapse}
                        className={`
                            flex items-center w-full px-3 py-2 text-sm rounded-md transition-colors
                            ${collapsed ? 'justify-center' : 'justify-start'}
                            ${theme === 'dark'
                                ? 'text-secondary hover:text-primary hover:bg-white/5'
                                : 'text-secondary hover:text-gray-900 hover:bg-black/5'}
                        `}
                        title={collapsed ? "展开" : "收起"}
                    >
                        <i className={`fas fa-angle-double-${collapsed ? 'right' : 'left'} w-4 text-center`}></i>
                        {!collapsed && <span className="ml-2">收起侧边栏</span>}
                    </button>
                )}
            </div>
        </div>
    );
}



// 辅助组件：侧边栏项 (标准化风格)
interface SidebarItemProps {
    icon: string;
    label: string;
    isActive: boolean;
    onClick: () => void;
    collapsed?: boolean;
    hasChildren?: boolean;
    isExpanded?: boolean;
    level?: number;      // 0: 一级, 1: 二级
    dot?: boolean;       // 是否显示小圆点（用于二级无图标项）
    img?: string;        // 是否显示图标图片
    status?: 'live' | 'offline' | 'none'; // 状态灯
}

function SidebarItem({
    icon,
    label,
    isActive,
    onClick,
    collapsed,
    hasChildren,
    isExpanded,
    level = 0,
    dot = false,
    img,
    status = 'none'
}: SidebarItemProps) {
    const isLevel1 = level === 1;

    return (
        <div
            className={`
                group w-full flex items-center transition-all duration-300 text-sm cursor-pointer relative min-h-[46px] my-0.5
                ${collapsed ? 'justify-center py-3 px-0' : `${isLevel1 ? 'pl-10 pr-4' : 'px-4'} py-2.5`}
                ${isActive
                    ? 'active-brand-item text-white font-bold shadow-lg shadow-blue-500/30 z-10'
                    : `text-secondary dark:text-secondary hover:text-slate-900 dark:hover:text-slate-100 
                       hover:bg-slate-100 dark:hover:bg-white/5`
                }
                ${!collapsed && isActive ? 'rounded-xl mx-2 w-[calc(100%-16px)]' : ''}
                ${collapsed && isActive ? 'rounded-lg mx-1 w-[calc(100%-8px)]' : ''}
            `}
            onClick={onClick}
            title={collapsed ? label : ''}
        >
            {/* 图标容器 - 固定宽度确保对齐 */}
            <div className={`flex items-center justify-center ${collapsed ? '' : 'w-8 -ml-1'} transition-transform group-hover:scale-110`}>
                {img ? (
                    <img
                        src={img}
                        className="w-4 h-4 object-contain opacity-80 group-hover:opacity-100 rounded-sm bg-white/10"
                        onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                    />
                ) : dot ? (
                    <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-blue-500' : 'bg-gray-500 opacity-60'}`}></div>
                ) : (
                    <i className={`${icon} ${collapsed ? 'text-lg' : 'text-sm opacity-80 group-hover:opacity-100'} ${isActive ? 'text-white' : ''}`}></i>
                )}
            </div>

            {!collapsed && (
                <>
                    <span className="flex-1 truncate text-left ml-1 flex items-center gap-2">
                        {label}
                        {status === 'live' && (
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                        )}
                    </span>
                    {hasChildren && (
                        <i className={`fas fa-chevron-right text-[10px] opacity-40 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}></i>
                    )}
                </>
            )}

            {/* 选中时的光晕（仅在非激活态 hover 时可选） */}
            {isActive && !collapsed && (
                <div className="absolute inset-0 bg-blue-400/10 blur-xl -z-10 rounded-full"></div>
            )}
        </div>
    );
}
