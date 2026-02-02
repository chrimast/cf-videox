
import { ReactNode, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { GlobalSearchBar } from './GlobalSearchBar';
import { CategoryNav } from './CategoryNav';
import { VideoSource, TvSource, LiveSource, NetdiskSource, TvChannel, Category } from '../types';
import { AppModule } from '../App';

interface NavParams {
    sourceId?: number;
    categoryId?: string;
    categoryName?: string;
    vodId?: string;
    keyword?: string;
    platform?: string;
    liveSourceId?: number;
    netdiskSourceId?: number; // For Netdisk
    mediaServerId?: number; // For Media Server
}

interface LayoutProps {
    children: ReactNode;
    sidebarProps: {
        sources: VideoSource[];
        categoriesMap: Record<number, Category[]>;
        selectedSourceId: number | null;
        onSourceChange: (id: number) => void;

        // TV Props
        tvSources?: TvSource[];
        selectedTvSourceId?: number | null;
        onTvSourceChange?: (id: number) => void;
        onPlayChannel?: (channel: TvChannel) => void;
        currentChannelUrl?: string;
        tvRefreshKey?: number;

        liveSources?: LiveSource[];

        netdiskSources?: NetdiskSource[];
        selectedNetdiskSourceId?: number | null;
        onNetdiskSourceChange?: (id: number) => void;

        onNavigate: (view: string, params?: Record<string, unknown>) => void;
        activeView: string;
        navParams: NavParams;
        activeModule: AppModule;
        onModuleChange: (module: AppModule) => void;
        theme: 'light' | 'dark';
        onToggleTheme: () => void;
        liveStatuses?: Record<number, any>;
        isAdminPasswordEnabled?: boolean;

        // Media Server Props
        mediaServers?: any[];
        selectedMediaServerId?: number | null;
        onMediaServerChange?: (id: number) => void;
    };
}

const COLLAPSED_KEY = 'video_sidebar_collapsed';

export function Layout({ children, sidebarProps }: LayoutProps) {
    const [isCollapsed, setIsCollapsed] = useState(() => {
        return localStorage.getItem(COLLAPSED_KEY) === 'true';
    });
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        localStorage.setItem(COLLAPSED_KEY, String(isCollapsed));
    }, [isCollapsed]);

    // 处理全局搜索
    const handleGlobalSearch = (keyword: string, sourceId: number | null, netdiskPath?: string, isMediaServer: boolean = false) => {
        sidebarProps.onNavigate('search', { keyword, sourceId, netdiskPath, isMediaServer, _t: Date.now() });
    };

    return (
        <div className={`flex h-screen overflow-hidden relative transition-colors duration-300
            ${sidebarProps.theme === 'dark' ? 'bg-primary' : 'bg-gray-50'}
        `}>

            {/* 桌面端 Sidebar */}
            <div
                className={`
                    hidden lg:flex flex-shrink-0 h-full overflow-hidden transition-all duration-300
                    ${isCollapsed ? 'w-16' : 'w-72'}
                `}
            >
                <Sidebar
                    {...sidebarProps}
                    collapsed={isCollapsed}
                    onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
                />
            </div>

            {/* 移动端 Sidebar (抽屉) */}
            {mobileOpen && (
                <div className="fixed inset-0 z-[100] lg:hidden">
                    {/* 遮罩 */}
                    <div
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={() => setMobileOpen(false)}
                    ></div>
                    {/* 侧边栏内容 */}
                    <div className={`
                        absolute left-0 top-0 bottom-0 w-64 shadow-2xl animate-slide-right border-r
                        ${sidebarProps.theme === 'dark' ? 'bg-primary border-border-color' : 'bg-white border-gray-100'}
                    `}>
                        <Sidebar
                            {...sidebarProps}
                            isMobile={true}
                            onCloseMobile={() => setMobileOpen(false)}
                            activeModule={sidebarProps.activeModule}
                            onModuleChange={sidebarProps.onModuleChange}
                            theme={sidebarProps.theme}
                            onToggleTheme={sidebarProps.onToggleTheme}
                        />
                    </div>
                </div>
            )}

            {/* 主内容区域 - 自动填充剩余空间，可滚动 */}
            <div className="flex-1 min-w-0 flex flex-col h-full relative">
                {/* 全局搜索栏 */}
                <GlobalSearchBar
                    sources={sidebarProps.sources}
                    onSearch={handleGlobalSearch}
                    onNavigate={sidebarProps.onNavigate}
                    activeView={sidebarProps.activeView}
                    activeModule={sidebarProps.activeModule}
                    onModuleChange={sidebarProps.onModuleChange}
                    onToggleSidebar={() => setMobileOpen(true)}
                    theme={sidebarProps.theme}
                    onToggleTheme={sidebarProps.onToggleTheme}
                    isAdminPasswordEnabled={sidebarProps.isAdminPasswordEnabled}
                />

                {/* 全局分类导航 (提升至此处以强制对齐搜索栏) */}
                {(sidebarProps.activeView === 'source' || sidebarProps.activeView === 'category') && sidebarProps.selectedSourceId && (
                    <CategoryNav
                        categories={sidebarProps.categoriesMap[sidebarProps.selectedSourceId] || []}
                        sourceId={sidebarProps.selectedSourceId}
                        currentCategoryId={sidebarProps.navParams.categoryId}
                        onNavigate={sidebarProps.onNavigate}
                    />
                )}

                {/* 内容区域 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>
    );
}

