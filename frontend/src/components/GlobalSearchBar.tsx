/**
 * 全局搜索栏组件
 * 置顶显示在所有页面，支持选择视频源进行搜索
 * 包含收藏、历史、管理按钮和主题切换
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { VideoSource, NetdiskSource } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { AppModule } from '../App';
import { apiRequest } from '../utils/api';

interface GlobalSearchBarProps {
    sources: VideoSource[];
    onSearch: (keyword: string, sourceId: number | null, netdiskPath?: string, isMediaServer?: boolean) => void;
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
    activeView: string;
    activeModule: AppModule;
    onModuleChange: (module: AppModule) => void;
    onToggleSidebar?: () => void; // 移动端侧边栏切换
    theme: 'light' | 'dark';
    onToggleTheme: () => void;
    isAdminPasswordEnabled?: boolean;
}

// 简单的密码输入模态框
function PasswordModal({ isOpen, onClose, onLogin }: { isOpen: boolean; onClose: () => void; onLogin: (pwd: string) => Promise<boolean> }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password.trim()) return;

        setLoading(true);
        setError('');

        const success = await onLogin(password);
        if (success) {
            setPassword('');
            onClose();
            // 登录成功后强制刷新页面以同步所有状态
            window.location.reload();
        } else {
            setError('密码错误');
        }
        setLoading(false);
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <div className="bg-secondary rounded-2xl p-8 w-full max-w-sm shadow-2xl border border-border-color transform transition-all">
                <div className="flex flex-col items-center mb-6">
                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                        <i className="fas fa-user-shield text-red-500 text-2xl"></i>
                    </div>
                    <h3 className="text-2xl font-black text-primary">管理员登录</h3>
                    <p className="text-secondary text-sm mt-1">请输入管理密码以继续</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="relative">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="管理密码"
                            className="w-full px-4 py-3 bg-white text-black rounded-xl border border-border-color focus:border-red-500 focus:ring-2 focus:ring-red-500/20 focus:outline-none text-center font-mono tracking-wider transition-all placeholder:text-gray-400"
                            autoFocus
                        />
                        {error && (
                            <div className="flex items-center justify-center gap-2 mt-3 text-red-500 text-xs font-bold animate-shake">
                                <i className="fas fa-exclamation-circle"></i>
                                {error}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 bg-secondary hover:bg-tertiary text-primary rounded-xl border border-border-color font-bold transition-all active:scale-95"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 shadow-lg shadow-red-500/25 transition-all font-bold active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <i className="fas fa-spinner fa-spin mr-2"></i>
                            ) : (
                                '确认登录'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}


// localStorage key
const THEME_KEY = 'video_theme';

export function GlobalSearchBar({ sources, onSearch, onNavigate, activeView, activeModule, onModuleChange, onToggleSidebar, theme, onToggleTheme, isAdminPasswordEnabled }: GlobalSearchBarProps) {
    const [keyword, setKeyword] = useState('');
    const [selectedSource, setSelectedSource] = useState<{ type: 'all' | 'video' | 'netdisk' | 'media_server'; id: number | null; name: string; path?: string }>({ type: 'all', id: null, name: '全部源' });
    const [netdiskSources, setNetdiskSources] = useState<NetdiskSource[]>([]);
    const [mediaServers, setMediaServers] = useState<any[]>([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false); // 移动端搜索弹出层

    // 🚀 新增：分级菜单激活分类
    const [activeCategory, setActiveCategory] = useState<'video' | 'netdisk' | 'media_server'>('video');

    // 认证状态
    const { isAuthenticated, login, logout, password } = useAuth();
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    // 获取网盘源
    useEffect(() => {
        let isMounted = true;
        const fetchNetdiskSources = async () => {
            try {
                const res = await apiRequest<{ success: boolean; data: any }>('netdisk/sources');
                if (isMounted && res.success && Array.isArray(res.data)) {
                    setNetdiskSources(res.data);
                }
            } catch (err) {
                console.error('[GlobalSearchBar] Failed to fetch netdisk sources:', err);
            }
        };

        const fetchMediaServers = async () => {
            try {
                const res = await apiRequest<{ success: boolean; data: any }>('media-servers');
                if (isMounted && res.success && Array.isArray(res.data)) {
                    setMediaServers(res.data.filter((s: any) => s.enabled));
                }
            } catch (err) {
                console.error('[GlobalSearchBar] Failed to fetch media servers:', err);
            }
        };

        const timer = setTimeout(() => {
            fetchNetdiskSources();
            fetchMediaServers();
        }, 300);
        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [isAdminPasswordEnabled, isAuthenticated, password]);

    // 应用主题到 document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);

        if (theme === 'light') {
            document.documentElement.classList.remove('dark');
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
        } else {
            document.documentElement.classList.add('dark');
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
        }
    }, [theme]);

    const submitSearch = (kw: string) => {
        const trimmedKw = kw.trim();

        // 🚀 对齐逻辑：媒体库和影视库允许空关键词（即查看全部）
        if (!trimmedKw && selectedSource.type !== 'netdisk' && selectedSource.type !== 'media_server') {
            return;
        }

        if (selectedSource.type === 'netdisk') {
            onSearch(trimmedKw, null, selectedSource.path || '/');
        } else if (selectedSource.type === 'media_server') {
            onSearch(trimmedKw, selectedSource.id, undefined, true);
        } else {
            onSearch(trimmedKw, selectedSource.id, undefined);
        }
        setIsDropdownOpen(false);
    };

    const handleSubmit = (e?: React.FormEvent | React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        submitSearch(keyword);
    };

    const handleUserIconClick = async () => {
        if (isAuthenticated) {
            setIsUserMenuOpen(!isUserMenuOpen);
        } else if (!isAdminPasswordEnabled) {
            // 后台未启用密码：自动免密登录并刷新
            const success = await login('');
            if (success) {
                window.location.reload();
            }
        } else {
            setIsLoginModalOpen(true);
        }
    };

    const handleLogout = () => {
        logout();
        setIsUserMenuOpen(false);
        // 退出后强制刷新页面以同步所有状态
        window.location.reload();
    };

    // 按钮样式
    const buttonClass = (isActive: boolean) => `
        p-2.5 rounded-lg transition-colors text-sm
        ${isActive
            ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
            : theme === 'dark'
                ? 'text-secondary hover:text-primary hover:bg-white/10'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
        }
    `;

    const buttonStyle = (isActive: boolean) => isActive ? { color: '#fff' } : undefined;

    return (
        <>
            {/* 移动端导航栏 - 简洁版 */}
            <div className={`lg:hidden sticky top-0 z-20 border-b px-3 py-2 transition-colors
                ${theme === 'dark'
                    ? 'bg-secondary/95 border-border-color backdrop-blur-lg'
                    : 'bg-white/95 border-gray-200 backdrop-blur-lg'
                }`}
            >
                <div className="flex items-center justify-between">
                    {/* 左侧：侧边栏按钮 + 标题 */}
                    <div className="flex items-center gap-3">
                        {onToggleSidebar && (
                            <button
                                onClick={onToggleSidebar}
                                className={`p-2 rounded-lg transition-colors
                                    ${theme === 'dark'
                                        ? 'text-secondary hover:text-primary hover:bg-white/10'
                                        : 'text-secondary hover:text-slate-900 hover:bg-black/5'
                                    }`}
                            >
                                <i className="fas fa-bars text-lg"></i>
                            </button>
                        )}
                        <h1 className={`text-lg font-bold ${theme === 'dark' ? 'text-primary' : 'text-gray-900'}`}>
                            视频中心
                        </h1>
                    </div>

                    {/* 右侧：工具按钮 */}
                    <div className="flex items-center gap-1">
                        {/* 搜索按钮 */}
                        <button
                            onClick={() => setIsMobileSearchOpen(true)}
                            className={`p-2 rounded-lg transition-colors
                                ${theme === 'dark'
                                    ? 'text-secondary hover:text-primary hover:bg-secondary'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                                }`}
                        >
                            <i className="fas fa-search"></i>
                        </button>

                        {/* 主题切换 */}
                        <button
                            onClick={onToggleTheme}
                            className={`p-2 rounded-lg transition-colors
                                ${theme === 'dark'
                                    ? 'text-secondary hover:text-primary hover:bg-secondary'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                                }`}
                        >
                            <i className={`fas ${theme === 'dark' ? 'fa-moon' : 'fa-sun'}`}></i>
                        </button>

                        {/* 用户图标 - 始终显示以提供管理入口 */}
                        <div className="relative">
                            <button
                                onClick={handleUserIconClick}
                                className={`p-2 rounded-lg transition-colors
                                    ${isAuthenticated
                                        ? 'text-green-400'
                                        : theme === 'dark'
                                            ? 'text-secondary hover:text-primary'
                                            : 'text-secondary hover:text-gray-600'
                                    }`}
                            >
                                <i className={`fas ${isAuthenticated ? 'fa-user-check' : 'fa-user-lock'}`}></i>
                            </button>

                            {/* 移动端用户菜单 */}
                            {isUserMenuOpen && isAuthenticated && (
                                <>
                                    <div
                                        className="fixed inset-0 z-[60]"
                                        onClick={() => setIsUserMenuOpen(false)}
                                    ></div>
                                    <div className={`absolute right-0 top-full mt-2 w-48 py-2 rounded-xl shadow-2xl z-[70] transform origin-top-right transition-all animate-in fade-in zoom-in duration-200
                                    ${theme === 'dark'
                                            ? 'bg-secondary border border-border-color shadow-black/50'
                                            : 'bg-white border border-gray-100 shadow-slate-200'
                                        }`}
                                    >
                                        <div className="px-4 py-2 border-b border-border-color mb-1">
                                            <p className="text-[10px] text-secondary uppercase font-bold tracking-wider">当前身份</p>
                                            <p className="text-sm font-bold text-primary">系统管理员</p>
                                        </div>
                                        <button
                                            onClick={handleLogout}
                                            className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors
                                            ${theme === 'dark'
                                                    ? 'text-red-400 hover:bg-red-500/10'
                                                    : 'text-red-500 hover:bg-red-50'
                                                }`}
                                        >
                                            <i className="fas fa-sign-out-alt"></i>
                                            <span className="font-bold">安全退出登录</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 移动端搜索弹出层 */}
            {isMobileSearchOpen && (
                <div className={`lg:hidden fixed inset-0 z-50 ${theme === 'dark' ? 'bg-secondary' : 'bg-white'}`}>
                    <div className="flex flex-col h-full">
                        {/* 搜索标题栏 */}
                        <div className={`flex items-center gap-3 px-3 py-3 border-b ${theme === 'dark' ? 'border-border-color' : 'border-gray-200'}`}>
                            <button
                                onClick={() => setIsMobileSearchOpen(false)}
                                className={`p-2 rounded-lg transition-colors
                                    ${theme === 'dark'
                                        ? 'text-secondary hover:text-primary hover:bg-secondary'
                                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                                    }`}
                            >
                                <i className="fas fa-arrow-left"></i>
                            </button>
                            <input
                                type="text"
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        submitSearch(keyword);
                                        setIsMobileSearchOpen(false);
                                    }
                                }}
                                placeholder="搜索电影、电视剧、动漫..."
                                autoFocus
                                className={`w-full px-4 py-2.5 rounded-lg border focus:outline-none transition-colors text-sm
                                        ${theme === 'dark'
                                        ? 'bg-secondary text-primary border-border-color focus:border-red-500 placeholder-gray-500'
                                        : 'bg-gray-100 text-gray-900 border-gray-300 focus:border-red-500 placeholder-gray-400'
                                    }`}
                            />
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    submitSearch(keyword);
                                    setIsMobileSearchOpen(false);
                                }}
                                className={`px-4 py-2.5 rounded-lg transition-colors text-sm font-bold
                                    ${selectedSource.type === 'netdisk' || selectedSource.type === 'media_server' || keyword.trim()
                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                    }`}
                            >
                                搜索
                            </button>
                        </div>

                        {/* 搜索提示 */}
                        <div className="flex-1 p-4">
                            <p className="text-sm text-secondary">
                                <i className="fas fa-lightbulb mr-2 text-yellow-500"></i>
                                输入关键词后点击搜索或按回车键
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* 桌面端导航栏 */}
            <div className={`hidden lg:block sticky top-0 z-[50] border-b px-4 py-3 h-16 transition-colors
                ${theme === 'dark'
                    ? 'bg-secondary/80 border-border-color backdrop-blur-lg'
                    : 'bg-white/80 border-gray-200 backdrop-blur-lg'
                }`}
            >
                <div className="flex items-center gap-2">
                    {/* 左侧：视频源选择器 + 搜索框 */}
                    <div className="flex items-center gap-2 flex-1 max-w-[280px] xl:max-w-md 2xl:max-w-xl min-w-0">
                        {/* 视频源选择器 (分级菜单重构版) */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition-colors min-w-[100px]
                                ${theme === 'dark'
                                        ? 'bg-secondary border-border-color text-primary hover:bg-gray-750'
                                        : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                <i className="fas fa-database text-xs opacity-70"></i>
                                <span className="truncate">{selectedSource.name}</span>
                                <i className={`fas fa-chevron-down text-xs transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}></i>
                            </button>

                            {isDropdownOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-10"
                                        onClick={() => setIsDropdownOpen(false)}
                                    ></div>
                                    <div className={`absolute top-full left-0 mt-2 w-[420px] border rounded-xl shadow-2xl z-20 flex overflow-hidden min-h-[350px] max-h-[500px] animate-in fade-in zoom-in duration-200
                                    ${theme === 'dark'
                                            ? 'bg-[#1a1c1e] border-white/10 shadow-black/80'
                                            : 'bg-white border-gray-100 shadow-slate-200'
                                        }`}
                                    >
                                        {/* 左侧：分类导航 (一级分类) */}
                                        <div className={`w-36 flex-shrink-0 border-r py-3 flex flex-col gap-1.5
                                            ${theme === 'dark' ? 'bg-[#111315]/50 border-white/5' : 'bg-gray-50 border-gray-100'}
                                        `}>
                                            <div className="px-4 py-2 mb-1">
                                                <span className="text-[10px] font-black uppercase text-secondary/30 tracking-widest">筛选分类</span>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedSource({ type: 'all', id: null, name: '全部源' });
                                                    setIsDropdownOpen(false);
                                                }}
                                                className={`mx-2 px-3 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 relative group
                                                    ${selectedSource.type === 'all'
                                                        ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                                                        : theme === 'dark' ? 'text-secondary hover:bg-white/5 hover:text-primary' : 'text-gray-500 hover:bg-black/5 hover:text-gray-900'
                                                    }`}
                                            >
                                                <i className="fas fa-globe text-sm"></i>
                                                全部源
                                            </button>

                                            <div className="mx-4 my-2 border-t border-border-color/10"></div>

                                            {[
                                                { id: 'video', name: '资源站', icon: 'fa-film', color: 'blue' },
                                                { id: 'netdisk', name: '媒体库', icon: 'fa-database', color: 'green' },
                                                { id: 'media_server', name: '影视库', icon: 'fa-server', color: 'orange' }
                                            ].map(cat => (
                                                <button
                                                    key={cat.id}
                                                    type="button"
                                                    onClick={() => setActiveCategory(cat.id as any)}
                                                    className={`mx-2 px-3 py-3.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-2 relative group
                                                        ${activeCategory === cat.id
                                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                                                            : theme === 'dark' ? 'text-secondary hover:bg-white/5 hover:text-primary' : 'text-gray-500 hover:bg-black/5 hover:text-gray-900'
                                                        }`}
                                                >
                                                    <i className={`fas ${cat.icon} text-lg transition-transform group-hover:scale-110 ${activeCategory === cat.id ? 'scale-110' : ''}`}></i>
                                                    {cat.name}
                                                    {activeCategory === cat.id && (
                                                        <div className={`w-1 h-6 rounded-full absolute left-0 bg-${cat.id === 'video' ? 'blue' : (cat.id === 'netdisk' ? 'green' : 'orange')}-500 shadow-lg shadow-current`}></div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>

                                        {/* 右侧：具体源列表 (二级选择) */}
                                        <div className="flex-1 overflow-y-auto py-3 custom-scrollbar">
                                            {activeCategory === 'video' && (
                                                <div className="flex flex-col gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedSource({ type: 'video', id: null, name: '全站视频' });
                                                            setIsDropdownOpen(false);
                                                        }}
                                                        className={`mx-3 px-4 py-3 rounded-xl text-sm transition-all flex items-center gap-4 group
                                                            ${selectedSource.type === 'video' && !selectedSource.id
                                                                ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/20'
                                                                : theme === 'dark' ? 'text-primary hover:bg-white/5' : 'text-gray-700 hover:bg-black/5'
                                                            }`}
                                                    >
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 ${theme === 'dark' ? 'bg-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : 'bg-blue-100'}`}>
                                                            <i className="fas fa-video text-blue-500 text-sm"></i>
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span>资源站全搜索</span>
                                                            <span className="text-[10px] opacity-40">聚合搜索所有资源站内容</span>
                                                        </div>
                                                    </button>

                                                    <div className="px-6 py-2 mt-2 flex items-center gap-3">
                                                        <span className="text-[10px] font-black uppercase text-secondary/30 tracking-widest whitespace-nowrap">具体站点</span>
                                                        <div className="h-[1px] flex-1 bg-border-color/10"></div>
                                                    </div>

                                                    {sources.map(source => (
                                                        <button
                                                            key={`video-${source.id}`}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedSource({ type: 'video', id: source.id, name: source.name });
                                                                setIsDropdownOpen(false);
                                                            }}
                                                            className={`mx-3 px-4 py-2.5 rounded-xl text-sm transition-all flex items-center gap-4 group
                                                                ${selectedSource.type === 'video' && selectedSource.id === source.id
                                                                    ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/20'
                                                                    : theme === 'dark' ? 'text-primary hover:bg-white/5' : 'text-gray-700 hover:bg-black/5'
                                                                }`}
                                                        >
                                                            <div className="w-10 h-10 rounded-xl bg-tertiary flex items-center justify-center border border-border-color/50 transition-transform group-hover:scale-110">
                                                                <span className="font-black text-secondary uppercase text-xs">{source.name.substring(0, 1)}</span>
                                                            </div>
                                                            <span className="truncate">{source.name}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {activeCategory === 'netdisk' && (
                                                <div className="flex flex-col gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedSource({ type: 'netdisk', id: null, name: '全部媒体库', path: '/' });
                                                            setIsDropdownOpen(false);
                                                        }}
                                                        className={`mx-3 px-4 py-3 rounded-xl text-sm transition-all flex items-center gap-4 group
                                                            ${selectedSource.type === 'netdisk' && !selectedSource.id
                                                                ? 'bg-green-600 text-white font-bold shadow-lg shadow-green-500/20'
                                                                : theme === 'dark' ? 'text-primary hover:bg-white/5' : 'text-gray-700 hover:bg-black/5'
                                                            }`}
                                                    >
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 ${theme === 'dark' ? 'bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]' : 'bg-green-100'}`}>
                                                            <i className="fas fa-search-plus text-green-500 text-sm"></i>
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span>媒体库全搜索</span>
                                                            <span className="text-[10px] opacity-40">跨多源网盘全局搜索</span>
                                                        </div>
                                                    </button>

                                                    <div className="px-6 py-2 mt-2 flex items-center gap-3">
                                                        <span className="text-[10px] font-black uppercase text-secondary/30 tracking-widest whitespace-nowrap">存储位置</span>
                                                        <div className="h-[1px] flex-1 bg-border-color/10"></div>
                                                    </div>

                                                    {netdiskSources.map(source => {
                                                        const scanPaths = Array.isArray(source.scan_paths) ? source.scan_paths : [];
                                                        const itemsToRender = scanPaths.length > 0 ? scanPaths : [{ name: '源根目录', path: '/' }];

                                                        return itemsToRender.map((sp: any) => (
                                                            <button
                                                                key={`netdisk-${source.id}-${sp.path}`}
                                                                type="button"
                                                                onClick={() => {
                                                                    setSelectedSource({
                                                                        type: 'netdisk',
                                                                        id: source.id,
                                                                        name: sp.name || sp.path?.split('/').pop() || source.name,
                                                                        path: sp.path || '/'
                                                                    });
                                                                    setIsDropdownOpen(false);
                                                                }}
                                                                className={`mx-3 px-4 py-2.5 rounded-xl text-sm transition-all flex items-center gap-4 group
                                                                    ${selectedSource.type === 'netdisk' && selectedSource.id === source.id && selectedSource.path === sp.path
                                                                        ? 'bg-green-600 text-white font-bold shadow-lg shadow-green-500/20'
                                                                        : theme === 'dark' ? 'text-primary hover:bg-white/5' : 'text-gray-700 hover:bg-black/5'
                                                                    }`}
                                                            >
                                                                <div className="w-10 h-10 rounded-xl bg-tertiary flex items-center justify-center border border-border-color/50 transition-transform group-hover:scale-110">
                                                                    <i className="fas fa-folder text-secondary text-sm"></i>
                                                                </div>
                                                                <div className="flex flex-col min-w-0">
                                                                    <span className="truncate">{sp.name || sp.path?.split('/').pop() || source.name}</span>
                                                                    <span className="text-[10px] opacity-30 truncate">所属: {source.name}</span>
                                                                </div>
                                                            </button>
                                                        ));
                                                    })}
                                                </div>
                                            )}

                                            {activeCategory === 'media_server' && (
                                                <div className="flex flex-col gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedSource({ type: 'media_server', id: null, name: '全部影视库' });
                                                            setIsDropdownOpen(false);
                                                        }}
                                                        className={`mx-3 px-4 py-3 rounded-xl text-sm transition-all flex items-center gap-4 group
                                                            ${selectedSource.type === 'media_server' && !selectedSource.id
                                                                ? theme === 'dark' ? 'bg-orange-500/10 text-orange-400 font-bold' : 'bg-orange-50 text-orange-600 font-bold'
                                                                : theme === 'dark' ? 'text-primary hover:bg-white/5' : 'text-gray-700 hover:bg-black/5'
                                                            }`}
                                                    >
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 ${theme === 'dark' ? 'bg-orange-500/20 shadow-[0_0_15px_rgba(249,115,22,0.1)]' : 'bg-orange-100'}`}>
                                                            <i className="fas fa-globe-asia text-orange-500 text-sm"></i>
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span>影视库全搜索</span>
                                                            <span className="text-[10px] opacity-40">跨服务器统一搜索</span>
                                                        </div>
                                                    </button>

                                                    <div className="px-6 py-2 mt-2 flex items-center gap-3">
                                                        <span className="text-[10px] font-black uppercase text-secondary/30 tracking-widest whitespace-nowrap">可用服务</span>
                                                        <div className="h-[1px] flex-1 bg-border-color/10"></div>
                                                    </div>

                                                    {mediaServers.map(server => (
                                                        <button
                                                            key={`media-server-${server.id}`}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedSource({ type: 'media_server', id: server.id, name: server.name });
                                                                setIsDropdownOpen(false);
                                                            }}
                                                            className={`mx-3 px-4 py-2.5 rounded-xl text-sm transition-all flex items-center gap-4 group
                                                                ${selectedSource.type === 'media_server' && selectedSource.id === server.id
                                                                    ? 'bg-orange-500 text-white font-bold shadow-lg shadow-orange-500/20'
                                                                    : theme === 'dark' ? 'text-primary hover:bg-white/5' : 'text-gray-700 hover:bg-black/5'
                                                                }`}
                                                        >
                                                            <div className="w-10 h-10 rounded-xl bg-tertiary flex items-center justify-center border border-border-color/50 transition-transform group-hover:scale-110">
                                                                <i className="fas fa-hdd text-secondary text-sm"></i>
                                                            </div>
                                                            <span className="truncate">{server.name}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 搜索输入框 */}
                        <form
                            onSubmit={handleSubmit}
                            className="flex-1 relative flex gap-2"
                        >
                            <div className="flex-1 relative">
                                <div
                                    className={`absolute left-0 top-0 bottom-0 px-3 flex items-center justify-center pointer-events-none z-10`}
                                >
                                    <i className={`fas fa-search text-sm
                                        ${theme === 'dark' ? 'text-secondary' : 'text-secondary'}`}></i>
                                </div>
                                <input
                                    type="text"
                                    value={keyword}
                                    onChange={(e) => setKeyword(e.target.value)}
                                    autoComplete="off"
                                    placeholder="搜索电影、电视剧、动漫..."
                                    className={`w-full px-4 py-2.5 pl-10 rounded-lg border focus:outline-none transition-colors text-sm
                                    ${theme === 'dark'
                                            ? 'bg-secondary text-primary border-border-color focus:border-red-500 placeholder-gray-500'
                                            : 'bg-gray-100 text-gray-900 border-gray-300 focus:border-red-500 placeholder-gray-400'
                                        }`}
                                />
                                {keyword && (
                                    <button
                                        type="button"
                                        onClick={() => setKeyword('')}
                                        className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors z-20
                                        ${theme === 'dark' ? 'text-secondary hover:text-primary' : 'text-secondary hover:text-gray-600'}`}
                                    >
                                        <i className="fas fa-times text-xs"></i>
                                    </button>
                                )}
                            </div>

                            {/* 搜索按钮 */}
                            <button
                                type="submit"
                                className={`px-5 py-2.5 rounded-lg transition-all duration-300 shadow-lg text-sm font-medium
                                      ${selectedSource.type === 'netdisk' || selectedSource.type === 'media_server'
                                        ? 'bg-green-600 hover:bg-green-700 shadow-green-500/20 text-white font-bold'
                                        : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20 text-white'
                                    } 
                                      disabled:opacity-40 disabled:scale-95 disabled:cursor-not-allowed`}
                            >
                                <i className="fas fa-search"></i>
                            </button>
                        </form>
                    </div>

                    {/* 导航菜单 */}
                    <div className="hidden md:flex items-center gap-1 flex-shrink-0 ml-auto">
                        {[
                            { key: 'home', label: '首页', icon: 'fa-home' },
                            { key: 'sources', label: '资源站', icon: 'fa-database' },
                            { key: 'media_server', label: '影视库', icon: 'fa-film' },
                            { key: 'netdisk', label: '媒体库', icon: 'fa-cloud' },
                            { key: 'tv', label: '电视', icon: 'fa-tv' },
                            { key: 'live', label: '直播', icon: 'fa-broadcast-tower' },
                        ].map(item => (
                            <button
                                key={item.key}
                                onClick={() => onModuleChange(item.key as AppModule)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
                                ${activeModule === item.key
                                        ? 'bg-blue-500 text-white'
                                        : theme === 'dark'
                                            ? 'text-secondary hover:text-primary hover:bg-secondary'
                                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                                    }`}
                                style={activeModule === item.key ? { color: '#fff' } : undefined}
                            >
                                <i className={`fas ${item.icon} text-xs`}></i>
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* 右侧工具栏 */}
                    <div className="flex items-center gap-1">
                        {/* 主题切换开关 */}
                        <div
                            className={`relative w-14 h-7 rounded-full cursor-pointer transition-colors flex items-center px-1
                            ${theme === 'dark' ? 'bg-gray-700' : 'bg-blue-100'}`}
                            onClick={onToggleTheme}
                            title={theme === 'dark' ? '切换到明亮模式' : '切换到暗黑模式'}
                        >
                            <div
                                className={`absolute w-5 h-5 rounded-full shadow-md transition-all duration-300 flex items-center justify-center
                                ${theme === 'dark'
                                        ? 'left-1 bg-gray-600'
                                        : 'left-8 bg-yellow-400'
                                    }`}
                            >
                                <i className={`fas ${theme === 'dark' ? 'fa-moon text-blue-300' : 'fa-sun text-yellow-600'} text-xs`}></i>
                            </div>
                        </div>

                        <div className={`w-px h-6 mx-2 ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-300'}`}></div>

                        {/* 收藏按钮 */}
                        {(!isAdminPasswordEnabled || isAuthenticated) && (
                            <button
                                onClick={() => onNavigate('favorites')}
                                className={buttonClass(activeView === 'favorites')}
                                style={buttonStyle(activeView === 'favorites')}
                                title="我的收藏"
                            >
                                <i className="fas fa-heart"></i>
                            </button>
                        )}

                        {/* 历史按钮 */}
                        {(!isAdminPasswordEnabled || isAuthenticated) && (
                            <button
                                onClick={() => onNavigate('history')}
                                className={buttonClass(activeView === 'history')}
                                style={buttonStyle(activeView === 'history')}
                                title="观看历史"
                            >
                                <i className="fas fa-history"></i>
                            </button>
                        )}

                        {/* 管理按钮 */}
                        {(!isAdminPasswordEnabled || isAuthenticated) && (
                            <button
                                onClick={() => onNavigate('admin')}
                                className={buttonClass(activeView === 'admin')}
                                style={buttonStyle(activeView === 'admin')}
                                title="视频源管理"
                            >
                                <i className="fas fa-cog"></i>
                            </button>
                        )}

                        {/* 登录状态图标 */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={handleUserIconClick}
                                className={`p-2.5 rounded-lg text-sm transition-colors ${isAuthenticated
                                    ? 'text-green-400 hover:bg-gray-700/50'
                                    : theme === 'dark' ? 'text-gray-600 hover:text-primary hover:bg-gray-700/50' : 'text-secondary hover:text-gray-600 hover:bg-gray-200'
                                    }`}
                                title={isAuthenticated ? '已认证 (点击管理)' : '未认证 (点击登录)'}
                            >
                                <i className={`fas ${isAuthenticated ? 'fa-user-check' : 'fa-user-lock'}`}></i>
                            </button>

                            {isUserMenuOpen && isAuthenticated && (
                                <>
                                    <div
                                        className="fixed inset-0 z-[60]"
                                        onClick={() => setIsUserMenuOpen(false)}
                                    ></div>
                                    <div className={`absolute right-0 top-full mt-2 w-48 py-2 rounded-xl shadow-2xl z-[70] transform origin-top-right transition-all animate-in fade-in zoom-in duration-200
                                    ${theme === 'dark'
                                            ? 'bg-secondary border border-border-color shadow-black/50'
                                            : 'bg-white border border-gray-100 shadow-slate-200'
                                        }`}
                                    >
                                        <div className="px-4 py-2 border-b border-border-color mb-1">
                                            <p className="text-[10px] text-secondary uppercase font-bold tracking-wider">当前身份</p>
                                            <p className="text-sm font-bold text-primary">系统管理员</p>
                                        </div>
                                        <button
                                            onClick={handleLogout}
                                            className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors
                                            ${theme === 'dark'
                                                    ? 'text-red-400 hover:bg-red-500/10'
                                                    : 'text-red-500 hover:bg-red-50'
                                                }`}
                                        >
                                            <i className="fas fa-sign-out-alt"></i>
                                            <span className="font-bold">安全退出登录</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 登录模态框 */}
            <PasswordModal
                isOpen={isLoginModalOpen}
                onClose={() => setIsLoginModalOpen(false)}
                onLogin={login}
            />
        </>
    );
}
