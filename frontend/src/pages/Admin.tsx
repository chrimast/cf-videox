import { useState, useEffect } from 'react';
import { SourceManager } from '../components/SourceManager';
import { SettingsManager } from '../components/SettingsManager';
import { HomeManager } from '../components/HomeManager';
import { TvSourceManager } from '../components/TvSourceManager';
import { LiveSourceManager } from '../components/LiveSourceManager';
import { NetdiskSourceManager } from '../components/NetdiskSourceManager';
import { MediaServerManager } from '../components/MediaServerManager';
import { useAuth } from '../contexts/AuthContext';
import { VideoSource } from '../types';
import { apiGet } from '../utils/api';

interface AdminProps {
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
    onSourcesChange?: () => void;
}

type TabType = 'home' | 'sources' | 'tv_sources' | 'live_sources' | 'netdisk_sources' | 'media_servers' | 'settings';

export function Admin({ onNavigate: _onNavigate, onSourcesChange }: AdminProps) {
    const [activeTab, setActiveTab] = useState<TabType>('home');
    const [sources, setSources] = useState<VideoSource[]>([]);

    // 认证上下文
    const { isAuthenticated, login, checkPasswordRequired } = useAuth();

    // UI 状态
    const [passwordRequired, setPasswordRequired] = useState(false);
    const [password, setPassword] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        initCheck();
        loadSources();
    }, [isAuthenticated]);

    const initCheck = async () => {
        setLoading(true);
        if (isAuthenticated) {
            setPasswordRequired(false);
        } else {
            const required = await checkPasswordRequired();
            setPasswordRequired(required);
        }
        setLoading(false);
    };

    const loadSources = async () => {
        try {
            const res = await apiGet<VideoSource[]>('/sources');
            if (res.success && res.data) {
                setSources(res.data);
            }
        } catch (error) {
            console.error('Failed to load sources:', error);
        }
    };

    const handleVerifyPassword = async () => {
        if (!password.trim()) {
            setError('请输入密码');
            return;
        }

        setVerifying(true);
        setError('');

        const success = await login(password);
        if (success) {
            // 登录成功，AuthContext 会更新 isAuthenticated
        } else {
            setError('密码错误，请重试');
        }

        setVerifying(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleVerifyPassword();
        }
    };

    // 加载中
    if (loading) {
        return (
            <div className="p-6 animate-pulse space-y-8">
                <div className="h-10 bg-secondary/30 rounded-2xl w-48"></div>
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-24 bg-secondary/20 rounded-2xl border border-border-color"></div>
                    ))}
                </div>
            </div>
        );
    }

    // 需要密码但未验证
    if (passwordRequired && !isAuthenticated) {
        return (
            <div className="min-h-[70vh] flex items-center justify-center p-6 relative overflow-hidden">
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500/10 blur-[120px] rounded-full"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/10 blur-[120px] rounded-full"></div>
                </div>

                <div className="glass-effect relative z-10 p-10 w-full max-w-md text-center rounded-3xl border border-border-color shadow-2xl space-y-8">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                        <i className="fas fa-fingerprint text-blue-500 text-3xl animate-pulse"></i>
                    </div>

                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-2">安全验证</h2>
                        <p className="text-secondary text-xs opacity-60">此区域受管理密码保护，请输入密码以继续</p>
                    </div>

                    <div className="space-y-4">
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="管理密码"
                            className="w-full px-5 py-4 bg-white/10 text-white rounded-2xl border border-border-color 
                                     focus:border-blue-500 focus:bg-white/20 focus:outline-none text-center transition-all placeholder:text-white/20"
                            autoFocus
                        />

                        {error && (
                            <div className="py-2 px-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                                <p className="text-red-400 text-xs font-semibold">
                                    <i className="fas fa-exclamation-circle mr-2"></i>
                                    {error}
                                </p>
                            </div>
                        )}

                        <button
                            onClick={handleVerifyPassword}
                            disabled={verifying}
                            className="w-full py-4 bg-blue-600 text-primary rounded-2xl hover:bg-blue-500 
                                     shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50 font-bold text-sm"
                        >
                            {verifying ? (
                                <><i className="fas fa-circle-notch fa-spin mr-2"></i> 正在验证身份...</>
                            ) : (
                                <><i className="fas fa-shield-alt mr-2"></i> 确认并解锁</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-black text-primary tracking-tight">管理中心</h1>
            </div>

            {/* 标签页 */}
            <div className="flex flex-wrap gap-2.5 p-1.5 bg-secondary/30 backdrop-blur-md border border-border-color rounded-2xl w-fit">
                {[
                    { id: 'home', label: '首页配置', icon: 'fa-home' },
                    { id: 'sources', label: '资源站', icon: 'fa-database' },
                    { id: 'media_servers', label: '影视库', icon: 'fa-film' },
                    { id: 'netdisk_sources', label: '媒体库', icon: 'fa-cloud' },
                    { id: 'tv_sources', label: '电视直播', icon: 'fa-tv' },
                    { id: 'live_sources', label: '热门直播', icon: 'fa-broadcast-tower' },
                    { id: 'settings', label: '系统设置', icon: 'fa-cog' }
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`
                            flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-300
                            ${activeTab === tab.id
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40'
                                : 'text-secondary hover:bg-secondary/80 hover:text-primary'}
                        `}
                    >
                        <i className={`fas ${tab.icon} ${activeTab === tab.id ? 'scale-110' : 'opacity-70'}`}></i>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* 首页管理 */}
            {activeTab === 'home' && (
                <HomeManager sources={sources} onRefresh={onSourcesChange} onSourcesChange={onSourcesChange} />
            )}

            {/* 视频源管理 - 使用独立组件 */}
            {activeTab === 'sources' && (
                <SourceManager onSourcesChange={() => { onSourcesChange?.(); loadSources(); }} />
            )}

            {/* 电视源管理 */}
            {activeTab === 'tv_sources' && (
                <TvSourceManager onSourcesChange={() => { onSourcesChange?.(); }} />
            )}

            {/* 直播源管理 */}
            {activeTab === 'live_sources' && (
                <LiveSourceManager onSourcesChange={() => { onSourcesChange?.(); }} />
            )}

            {/* 网盘源管理 */}
            {activeTab === 'netdisk_sources' && (
                <NetdiskSourceManager onSourceChange={() => { onSourcesChange?.(); }} />
            )}

            {/* 影视库管理 */}
            {activeTab === 'media_servers' && (
                <MediaServerManager onServersChange={() => { onSourcesChange?.(); }} />
            )}

            {/* 系统设置 - 使用独立组件 */}
            {activeTab === 'settings' && (
                <SettingsManager onSettingsChange={onSourcesChange} />
            )}
        </div>
    );
}
