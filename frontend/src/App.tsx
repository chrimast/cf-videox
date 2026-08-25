import { useState, useEffect } from 'react';
import { VideoSource, TvSource, LiveSource, Category } from './types';
import { apiGet } from './utils/api';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Category as CategoryPage } from './pages/Category';
import { SourceOverview } from './pages/SourceOverview';
import { Play } from './pages/Play';
import { TvPlayer } from './pages/TvPlayer';
import { Live } from './pages/Live'; // New component
import { LivePlayer } from './pages/LivePlayer'; // New component
import { Search } from './pages/Search';
import { Admin } from './pages/Admin';
import { Favorites } from './pages/Favorites';
import { History } from './pages/History';

import { NavigationProvider } from './contexts/NavigationContext';
import { useAuth } from './contexts/AuthContext';
import { SitePasswordGuard } from './components/SitePasswordGuard';

// 设置网页标题
document.title = "VideoX - 视频中心";

// 视图类型
type ViewType = 'home' | 'source' | 'category' | 'play' | 'tv_play' | 'live' | 'live_play' | 'search' | 'favorites' | 'history' | 'admin';

// 模块类型（顶部导航）
export type AppModule = 'home' | 'sources' | 'tv' | 'live';

// 导航参数
interface NavParams {
    sourceId?: number;
    categoryId?: string;
    categoryName?: string;
    subCategories?: Category[];  // 子分类列表
    vodId?: string;
    keyword?: string;
    platform?: string;
    liveSourceId?: number; // For Live
    tvSourceId?: number; // For TV
    channelUrl?: string; // For TV

    title?: string;
    url?: string;
    cover?: string;
    _t?: number; // 🚀 刷新时间戳，强制重新搜索
}

// localStorage key
const SELECTED_SOURCE_KEY = 'video_selected_source';
const SELECTED_TV_SOURCE_KEY = 'video_selected_tv_source';
const ACTIVE_VIEW_KEY = 'video_active_view';
const NAV_PARAMS_KEY = 'video_nav_params';
const ACTIVE_MODULE_KEY = 'video_active_module';

// 辅助组件：访问受限提示
function AccessDenied({ onGoHome }: { onGoHome: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <div className="w-20 h-20 bg-gray-800/50 rounded-full flex items-center justify-center mb-6">
                <i className="fas fa-lock text-3xl"></i>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">访问受限</h2>
            <p className="mb-6">您没有权限访问该资源站，请先登录管理员账号</p>
            <button
                onClick={onGoHome}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
                返回首页
            </button>
        </div>
    );
}

function VideoApp() {
    const { isAuthenticated } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);

    // 从 localStorage 初始化状态
    const [activeView, setActiveView] = useState<ViewType>(() => {
        return (localStorage.getItem(ACTIVE_VIEW_KEY) as ViewType) || 'home';
    });
    const [navParams, setNavParams] = useState<NavParams>(() => {
        const saved = localStorage.getItem(NAV_PARAMS_KEY);
        try {
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    });

    // 导航历史记录栈
    const [navHistory, setNavHistory] = useState<Array<{ view: ViewType; params: NavParams }>>([]);

    // 当前激活的模块（顶部导航）
    const [activeModule, setActiveModule] = useState<AppModule>(() => {
        return (localStorage.getItem(ACTIVE_MODULE_KEY) as AppModule) || 'home';
    });

    // 状态持久化
    useEffect(() => {
        localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
        localStorage.setItem(NAV_PARAMS_KEY, JSON.stringify(navParams));
        localStorage.setItem(ACTIVE_MODULE_KEY, activeModule);
    }, [activeView, navParams, activeModule]);

    // 视频源和分类
    const [sources, setSources] = useState<VideoSource[]>([]);
    const [categoriesMap, setCategoriesMap] = useState<Record<number, Category[]>>({});

    // 电视源
    const [tvSources, setTvSources] = useState<TvSource[]>([]);

    // 直播源
    const [liveSources, setLiveSources] = useState<LiveSource[]>([]);


    // 安全设置状态
    const [isAdminPasswordEnabled, setIsAdminPasswordEnabled] = useState<boolean>(false);

    // 直播状态数据
    const [liveStatuses, setLiveStatuses] = useState<Record<number, any>>({});

    // 当前选中的视频源
    const [selectedSourceId, setSelectedSourceId] = useState<number | null>(() => {
        const saved = localStorage.getItem(SELECTED_SOURCE_KEY);
        return saved ? parseInt(saved) : null;
    });

    // 当前选中的电视源
    const [selectedTvSourceId, setSelectedTvSourceId] = useState<number | null>(() => {
        const saved = localStorage.getItem(SELECTED_TV_SOURCE_KEY);
        return saved ? parseInt(saved) : null;
    });

    // 导航函数（带历史记录）
    const navigate = (view: string, params: Record<string, unknown> = {}) => {
        // 将当前视图推入历史栈（不推入 play 页面避免重复）
        if (activeView !== 'play' && activeView !== 'tv_play') {
            setNavHistory(prev => [...prev, { view: activeView, params: navParams }]);
        }
        setActiveView(view as ViewType);
        setNavParams(params as NavParams);
    };

    // 返回上一级
    const goBack = () => {
        if (navHistory.length > 0) {
            const prev = navHistory[navHistory.length - 1];
            setNavHistory(h => h.slice(0, -1));
            setActiveView(prev.view);
            setNavParams(prev.params);
        } else {
            // 没有历史记录时回到首页
            setActiveView('home');
            setNavParams({});
        }
    };

    // 模块切换函数
    const handleModuleChange = (module: AppModule) => {
        setActiveModule(module);
        // 根据模块切换默认视图
        if (module === 'home') {
            setActiveView('home');
            setNavParams({});
        } else if (module === 'sources') {
            // 资源站模块：显示第一个源的概览
            const firstSource = sources.find(s => s.enabled);
            if (firstSource) {
                setSelectedSourceId(firstSource.id);
                setActiveView('source');
                setNavParams({ sourceId: firstSource.id });
            }
        } else if (module === 'tv') {
            // 电视模块：显示电视播放页
            setActiveView('tv_play');
            if (selectedTvSourceId) {
                setNavParams({ tvSourceId: selectedTvSourceId });
            }
        } else if (module === 'live') {
            // 直播模块
            setActiveView('live');
            setNavParams({});
        } else {
            // 预留模块：显示占位页面
            setActiveView('home'); // 临时使用 home 视图
            setNavParams({});
        }
    };

    // TV 刷新 Key
    const [tvRefreshKey, setTvRefreshKey] = useState(0);

    // 全局数据同步通道 (用于多标签页间通信)
    useEffect(() => {
        const channel = new BroadcastChannel('video-plugin-sync');
        channel.onmessage = (event) => {
            if (event.data === 'refresh-data' || event.data === 'sources-updated') {
                console.log('[App] Received sync message, reloading data...');
                loadSourcesAndCategories();
            }
        };
        return () => channel.close();
    }, []);

    // 加载视频源和分类
    useEffect(() => {
        loadSourcesAndCategories();
    }, [isAuthenticated]);

    const loadSourcesAndCategories = async () => {
        try {
            // 1. 并发加载基础源数据
            const [sourcesRes, tvRes, liveRes, settingsRes] = await Promise.all([
                apiGet<VideoSource[]>('/sources'),
                apiGet<TvSource[]>('/tv/sources'),
                apiGet<LiveSource[]>('/live/sources'),

                apiGet<any>('/settings')
            ]);

            // 处理安全设置
            if (settingsRes.success && settingsRes.data) {
                const isEnabled = settingsRes.data.admin_password_enabled === 'true' ||
                    settingsRes.data.admin_password_enabled === true;
                setIsAdminPasswordEnabled(isEnabled);
            }

            // 处理视频源
            if (sourcesRes.success && sourcesRes.data) {
                // 🚀 防卫逻辑：检查数据结构是否真为 VideoSource
                // 如果发现数据中包含 vod_id（属于视频而非源），则说明后台数据冲突
                const sample = sourcesRes.data[0];
                if (sample && (sample as any).vod_id) {
                    console.error('[App] CRITICAL: Invalid source data structure detected!', sample);
                    // 标记加载完成并报错
                    setIsLoaded(true);
                    return;
                }

                // 如果开启了密码保护且未登录，则过滤掉隐藏源；否则显示全部启用源
                const enabledSources = sourcesRes.data.filter(s =>
                    s.enabled && (isAuthenticated || !isAdminPasswordEnabled || !s.hidden)
                );
                setSources(enabledSources);

                let finalSelectedId = selectedSourceId;
                const isSelectedValid = enabledSources.some(s => s.id === selectedSourceId);

                if (!isSelectedValid && enabledSources.length > 0) {
                    finalSelectedId = enabledSources[0].id;
                    setSelectedSourceId(finalSelectedId);
                    localStorage.setItem(SELECTED_SOURCE_KEY, String(finalSelectedId));
                }

                // 2. 并发加载这些源的分类 (不再一个一个 await)
                const catPromises = enabledSources.map(source =>
                    apiGet<Category[]>('/categories', { source_id: source.id })
                        .then(res => ({ id: source.id, data: res.success ? res.data : [] }))
                );

                const catResults = await Promise.all(catPromises);
                const catMap: Record<number, Category[]> = {};
                catResults.forEach(result => {
                    catMap[result.id] = result.data || [];
                });
                setCategoriesMap(catMap);
            }

            // 处理电视源
            if (tvRes.success && tvRes.data) {
                const enabledTv = tvRes.data.filter(s => s.enabled);
                setTvSources(enabledTv);
                setTvRefreshKey(prev => prev + 1);

                if (!selectedTvSourceId && enabledTv.length > 0) {
                    setSelectedTvSourceId(enabledTv[0].id);
                    localStorage.setItem(SELECTED_TV_SOURCE_KEY, String(enabledTv[0].id));
                }
            }

            // 处理直播源
            if (liveRes.success && liveRes.data) {
                setLiveSources(liveRes.data.filter(s => s.enabled === 1));
            }


        } catch (error) {
            console.error('[App] Failed to load sources:', error);
        } finally {
            setIsLoaded(true);
        }
    };

    // 加载直播状态
    const loadLiveStatuses = async () => {
        try {
            const res = await apiGet<any[]>('/live/status');
            if (res.success && res.data) {
                const statusMap: Record<number, any> = {};
                res.data.forEach(s => {
                    statusMap[s.source_id] = s;
                });
                setLiveStatuses(statusMap);
            }
        } catch (e) {
            console.error('[App] Failed to fetch live statuses', e);
        }
    };

    // 处理源数据变动的同步回调
    const handleSourcesChangeSync = () => {
        console.log('[App] Sources changed, refreshing and broadcasting...');
        loadSourcesAndCategories();

        // 发送广播消息，通知其他标签页
        const channel = new BroadcastChannel('video-plugin-sync');
        channel.postMessage('sources-updated');
        channel.close();
    };

    // 定期刷新直播状态 (60s)
    useEffect(() => {
        loadLiveStatuses();
        const timer = setInterval(loadLiveStatuses, 60000);
        return () => clearInterval(timer);
    }, []);

    // 切换视频源
    const handleSourceChange = (sourceId: number) => {
        setSelectedSourceId(sourceId);
        localStorage.setItem(SELECTED_SOURCE_KEY, String(sourceId));
        // 切换源后显示该源的概览（多分类视图）
        setActiveView('source');
        setNavParams({ sourceId });
        // 同步顶部导航菜单切换到"资源站"
        setActiveModule('sources');
    };

    // 切换电视源
    const handleTvSourceChange = (id: number) => {
        setSelectedTvSourceId(id);
        localStorage.setItem(SELECTED_TV_SOURCE_KEY, String(id));
        setActiveView('tv_play');
        setNavParams({ tvSourceId: id });
        setActiveModule('tv');
    };


    // 主题管理
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('video_theme') as 'light' | 'dark') || 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('video_theme', theme);

        // 同步主题到主应用
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'PLUGIN_THEME_CHANGED',
                payload: { theme }
            }, '*');
        }
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };


    // 发送最小化侧边栏配置到主应用
    useEffect(() => {
        const isInIframe = window.parent !== window;
        if (!isInIframe || !isLoaded) return;


        let count = 0;
        const maxAttempts = 5;

        const sendMessage = () => {
            // 发送空侧边栏配置
            window.parent.postMessage({
                type: 'PLUGIN_SET_SIDEBAR',
                payload: {
                    title: '视频中心',
                    subtitle: sources.find(s => s.id === selectedSourceId)?.name || '多源视频聚合',
                    items: [],
                    activeId: ''
                }
            }, '*');


            // 请求隐藏 Header（默认仅移动端隐藏，桌面端保持显示）
            window.parent.postMessage({
                type: 'PLUGIN_REQUEST_HIDE_HEADER',
                payload: { hideHeader: false }
            }, '*');

            count++;
            if (count < maxAttempts) {
                setTimeout(sendMessage, 500);
            }
        };

        sendMessage();
    }, [selectedSourceId, isLoaded, sources]);

    if (!isLoaded) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-900">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-400">加载中...</p>
                </div>
            </div>
        );
    }



    // 播放电视频道
    const handlePlayChannel = (channel: any) => {
        setActiveView('tv_play');
        setNavParams(prev => ({ ...prev, channelUrl: channel.url }));
        // Ensure module is tv
        if (activeModule !== 'tv') setActiveModule('tv');
    };

    // 辅助函数：检查当前视图所请求的视频源是否可见
    const isSourceVisible = (id?: number) => {
        if (!id) return true;
        return sources.some(s => s.id === id);
    };

    return (
        <SitePasswordGuard>
            <NavigationProvider navigate={navigate}>
                <Layout
                    sidebarProps={{
                        sources,
                        categoriesMap,
                        selectedSourceId,
                        onSourceChange: handleSourceChange,

                        tvSources,
                        selectedTvSourceId,
                        onTvSourceChange: handleTvSourceChange,
                        onPlayChannel: handlePlayChannel,
                        currentChannelUrl: navParams.channelUrl,
                        tvRefreshKey,

                        liveSources, // Pass live sources to sidebar

                        liveStatuses,   // 传递直播状态数据

                        onNavigate: navigate,
                        activeView,
                        navParams,
                        activeModule,
                        onModuleChange: handleModuleChange,

                        theme,
                        onToggleTheme: toggleTheme,
                        isAdminPasswordEnabled  // 传递安全设置状态
                    }}
                >
                    {activeView === 'home' && (
                        <Home />
                    )}
                    {activeView === 'category' && (
                        isSourceVisible(navParams.sourceId) ? (
                            <CategoryPage
                                sourceId={navParams.sourceId}
                                categoryId={navParams.categoryId}
                                categoryName={navParams.categoryName}
                                subCategories={navParams.subCategories}
                                onNavigate={navigate}
                                categories={categoriesMap[selectedSourceId || 0] || []}
                            />
                        ) : <AccessDenied onGoHome={() => navigate('home')} />
                    )}
                    {activeView === 'source' && selectedSourceId && (
                        isSourceVisible(selectedSourceId) ? (
                            <SourceOverview
                                sourceId={selectedSourceId}
                                sourceName={sources.find(s => s.id === selectedSourceId)?.name}
                                categories={categoriesMap[selectedSourceId] || []}
                                onNavigate={navigate}
                            />
                        ) : <AccessDenied onGoHome={() => navigate('home')} />
                    )}
                    {activeView === 'play' && navParams.sourceId && navParams.vodId && (
                        isSourceVisible(navParams.sourceId) ? (
                            <Play
                                sourceId={navParams.sourceId}
                                vodId={navParams.vodId}
                                onNavigate={navigate}
                                onGoBack={goBack}
                            />
                        ) : <AccessDenied onGoHome={() => navigate('home')} />
                    )}
                    {activeView === 'tv_play' && (
                        <TvPlayer
                            tvSourceId={navParams.tvSourceId || selectedTvSourceId || undefined}
                            channelUrl={navParams.channelUrl}
                            onNavigate={navigate}
                        />
                    )}
                    {activeView === 'live' && (
                        <Live platform={navParams.platform} onPlay={(sourceId: number) => navigate('live_play', { liveSourceId: sourceId })} />
                    )}
                    {activeView === 'live_play' && (
                        <LivePlayer
                            sourceId={navParams.liveSourceId}
                            onNavigate={navigate}
                        />
                    )}

                    {activeView === 'search' && (
                        <Search
                            initialKeyword={navParams.keyword}
                            sourceId={navParams.sourceId ?? null}
                            _t={navParams._t}
                            sources={sources}
                            onNavigate={navigate}
                        />
                    )}
                    {(activeView === 'favorites' || activeView === 'history' || activeView === 'admin') && !isAuthenticated && (
                        <AccessDenied onGoHome={() => navigate('home')} />
                    )}
                    {activeView === 'favorites' && isAuthenticated && (
                        <Favorites
                            onNavigate={navigate}
                            sources={sources}
                        />
                    )}
                    {activeView === 'history' && isAuthenticated && (
                        <History
                            onNavigate={navigate}
                            sources={sources}
                        />
                    )}
                    {activeView === 'admin' && isAuthenticated && (
                        <Admin
                            onNavigate={navigate}
                            onSourcesChange={handleSourcesChangeSync}
                        />
                    )}
                </Layout>
            </NavigationProvider>
        </SitePasswordGuard>
    );
}

export default VideoApp;
