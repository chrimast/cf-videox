import { useState, useEffect, useMemo } from 'react';
import { PlayHistory, VideoSource, NetdiskSource } from '../types';
import { apiGet, apiDelete } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface HistoryProps {
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
    sources: VideoSource[];
    netdiskSources: NetdiskSource[];
}

export function History({ onNavigate, sources, netdiskSources }: HistoryProps) {
    const { isAuthenticated } = useAuth();
    const [history, setHistory] = useState<PlayHistory[]>([]);
    const [loading, setLoading] = useState(true);

    // 对话框状态
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        variant?: 'danger' | 'primary';
    } | null>(null);

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const res = await apiGet<PlayHistory[]>('/history', { limit: 100 });
            if (res.success && res.data) {
                setHistory(res.data);
            }
        } catch (e) {
            console.error('Failed to load history:', e);
        } finally {
            setLoading(false);
        }
    };

    // 时间分组逻辑
    const groupedHistory = useMemo(() => {
        // 先过滤权限
        let filtered = history;
        if (!isAuthenticated) {
            const hiddenCmsIds = new Set(sources.filter(s => s.hidden).map(s => s.id));
            const hiddenNetdiskIds = new Set(netdiskSources.filter(s => s.hidden).map(s => s.id));
            filtered = history.filter(item => {
                if (item.source_type === 'netdisk') return !hiddenNetdiskIds.has(item.source_id);
                return !hiddenCmsIds.has(item.source_id);
            });
        }

        const groups: Record<string, PlayHistory[]> = {
            '今天': [],
            '昨天': [],
            '更早以前': []
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        filtered.forEach(item => {
            const itemDate = new Date(item.updated_at);
            if (itemDate >= today) groups['今天'].push(item);
            else if (itemDate >= yesterday) groups['昨天'].push(item);
            else groups['更早以前'].push(item);
        });

        return Object.entries(groups).filter(([_, items]) => items.length > 0);
    }, [history, isAuthenticated, sources, netdiskSources]);

    const deleteOne = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const res = await apiDelete(`/history/${id}`);
        if (res.success) {
            setHistory(prev => prev.filter(item => item.id !== id));
        }
    };

    const clearAll = () => {
        setConfirmDialog({
            isOpen: true,
            title: '清空历史',
            message: '确定要清空所有播放记录吗？此操作不可撤销。',
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                const res = await apiDelete('/history');
                if (res.success) {
                    setHistory([]);
                }
            }
        });
    };

    const handleClick = (item: PlayHistory) => {
        if (item.source_type === 'netdisk') {
            onNavigate('netdisk_play', {
                sourceId: item.source_id,
                mediaId: parseInt(item.vod_id),
                videoIndex: item.episode - 1
            });
        } else {
            onNavigate('play', {
                sourceId: item.source_id,
                vodId: item.vod_id
            });
        }
    };

    const formatProgressText = (progress: number, duration: number) => {
        if (!duration) return '已看片段';
        const percent = Math.round((progress / duration) * 100);
        if (percent >= 95) return '已看完';
        return `已看到 ${percent}%`;
    };

    const formatDisplayTime = (seconds: number) => {
        if (!seconds) return '';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const formatRelativeTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 7) return `${days}天前`;
        return date.toLocaleDateString();
    };

    const cleanPath = (path: string) => {
        if (!path) return '正片';
        // 如果是包含 | 的复杂名称，取第一部分
        if (path.includes('|')) return path.split('|')[0];
        // 尝试从路径中提取文件名
        const parts = path.split(/[/\\]/);
        const fileName = parts[parts.length - 1];
        // 移除常见视频后缀及 .strm
        return fileName.replace(/\.(strm|mp4|mkv|avi|rmvb|ts|mov)$/i, '') || '正片';
    };

    if (loading) {
        return (
            <div className="p-6 space-y-8 animate-pulse bg-primary min-h-full">
                <div className="h-8 bg-secondary rounded w-40"></div>
                {[1, 2].map(g => (
                    <div key={g} className="space-y-4">
                        <div className="h-4 bg-secondary rounded w-20 opacity-50"></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-24 bg-secondary/50 rounded-xl"></div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center py-32 bg-primary min-h-full">
                <div className="w-24 h-24 bg-secondary rounded-full flex items-center justify-center mb-8 shadow-inner">
                    <i className="fas fa-history text-4xl text-secondary opacity-30"></i>
                </div>
                <h2 className="text-2xl font-bold text-primary mb-3">暂无权限</h2>
                <p className="text-secondary max-w-xs text-center mb-10 leading-relaxed">请先登录管理员账号以管理您的播放足迹</p>
                <button
                    onClick={() => onNavigate('home')}
                    className="px-8 py-3 bg-red-500 text-white rounded-xl shadow-lg shadow-red-500/20 hover:scale-105 transition-all font-medium"
                >
                    返回首页
                </button>
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-8 space-y-8 bg-primary min-h-full overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="flex items-end justify-between border-b border-border-color pb-6">
                <div>
                    <h1 className="text-3xl font-black text-primary flex items-center gap-3">
                        播放历史
                        <span className="text-xs bg-secondary text-secondary px-2 py-1 rounded-full font-medium">
                            {history.length} 条记录
                        </span>
                    </h1>
                </div>
                {history.length > 0 && (
                    <button
                        onClick={clearAll}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-secondary hover:text-red-500 bg-secondary/30 rounded-lg transition-all"
                    >
                        <i className="fas fa-trash-alt text-xs"></i>
                        清空全部
                    </button>
                )}
            </div>

            {groupedHistory.length > 0 ? (
                <div className="space-y-10">
                    {groupedHistory.map(([groupName, items]) => (
                        <div key={groupName} className="space-y-4">
                            <h2 className="text-sm font-bold text-secondary uppercase tracking-[0.2em] flex items-center gap-3 before:h-px before:w-4 before:bg-blue-500/50">
                                {groupName}
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {items.map(item => (
                                    <div
                                        key={item.id}
                                        onClick={() => handleClick(item)}
                                        className="group relative flex gap-4 p-3 bg-secondary/20 hover:bg-secondary/40 border border-border-color rounded-2xl transition-all cursor-pointer overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-0.5"
                                    >
                                        {/* 封面图容器 */}
                                        <div className="relative w-32 sm:w-40 aspect-video flex-shrink-0 rounded-xl overflow-hidden shadow-md">
                                            <img
                                                src={item.cover}
                                                alt={item.title}
                                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                loading="lazy"
                                                onError={e => (e.target as HTMLImageElement).src = '/poster-fallback.png'}
                                            />
                                            {/* 已看时长角标 */}
                                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 backdrop-blur-md rounded text-[10px] text-white font-mono">
                                                {formatDisplayTime(item.progress)}
                                            </div>
                                            {/* 进度条底层 */}
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                                                <div
                                                    className="h-full bg-gradient-to-r from-red-500 to-orange-400 shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-all duration-700"
                                                    style={{ width: `${item.duration > 0 ? (item.progress / item.duration) * 100 : 0}%` }}
                                                ></div>
                                            </div>
                                        </div>

                                        {/* 信息区域 */}
                                        <div className="flex-1 min-w-0 flex flex-col justify-center py-1">
                                            <div className="flex items-start justify-between gap-2">
                                                <h3 className="text-primary font-bold line-clamp-1 group-hover:text-red-500 transition-colors">
                                                    {item.title}
                                                </h3>
                                                <button
                                                    onClick={(e) => deleteOne(item.id, e)}
                                                    className="opacity-0 group-hover:opacity-100 p-1.5 text-secondary hover:text-red-500 transition-all transform hover:scale-110"
                                                    title="删除此条记录"
                                                >
                                                    <i className="fas fa-times-circle"></i>
                                                </button>
                                            </div>

                                            <p className="text-secondary text-[11px] mt-1 font-medium flex items-center gap-1.5 opacity-80">
                                                <i className="fas fa-play-circle opacity-40"></i>
                                                {cleanPath(item.episode_name)}
                                            </p>

                                            <div className="mt-auto flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded font-bold tracking-tight">
                                                        {formatProgressText(item.progress, item.duration)}
                                                    </span>
                                                    {item.source_name && (
                                                        <span className="text-[10px] text-secondary opacity-70 flex items-center gap-1 font-medium">
                                                            <i className={`fas ${item.source_type === 'netdisk' ? 'fa-cloud' : 'fa-link'} text-[9px]`}></i>
                                                            {item.source_name}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-secondary opacity-50 flex items-center gap-1 font-medium">
                                                    <i className="far fa-clock"></i>
                                                    {formatRelativeTime(item.updated_at)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* 右下角播放小图标 */}
                                        <div className="absolute top-1/2 right-4 -translate-y-1/2 text-primary opacity-0 group-hover:opacity-20 translate-x-4 group-hover:translate-x-0 transition-all duration-300">
                                            <i className="fas fa-play text-2xl"></i>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-32 text-secondary space-y-6">
                    <div className="relative">
                        <i className="fas fa-history text-8xl opacity-10"></i>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <i className="fas fa-coffee text-2xl opacity-40 animate-bounce"></i>
                        </div>
                    </div>
                    <div className="text-center space-y-2">
                        <p className="text-xl font-medium text-primary opacity-50">电影虽好，也要适度休息哦</p>
                        <p className="text-sm opacity-40">您还没有任何播放记录</p>
                    </div>
                    <button
                        onClick={() => onNavigate('home')}
                        className="px-6 py-2 border border-border-color rounded-full hover:bg-secondary/50 transition-colors text-sm"
                    >
                        去浏览新片
                    </button>
                </div>
            )}

            {/* 确认对话框 */}
            {confirmDialog && (
                <ConfirmDialog
                    isOpen={confirmDialog.isOpen}
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmVariant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}
        </div>
    );
}
