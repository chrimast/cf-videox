import { useState, useEffect } from 'react';
import { apiPost } from '../utils/api';

interface DirectoryPickerProps {
    sourceId: number;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string, name: string) => void;
    initialPath?: string;
}

interface DirectoryItem {
    name: string;
    path: string;
    is_dir: boolean;
    size?: number;
    modified?: string;
}

export function DirectoryPicker({ sourceId, isOpen, onClose, onSelect, initialPath = '/' }: DirectoryPickerProps) {
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [currentFullPath, setCurrentFullPath] = useState(initialPath);
    const [items, setItems] = useState<DirectoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sourceType, setSourceType] = useState<string>('');

    useEffect(() => {
        if (isOpen && sourceId) {
            loadDirectory(initialPath);
        }
    }, [isOpen, sourceId]);

    const loadDirectory = async (path: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiPost<{ path: string; fullPath: string; sourceType: string; items: DirectoryItem[] }>('/netdisk/list', {
                sourceId,
                path
            });
            if (res.success && res.data) {
                // 只显示目录
                const dirs = res.data.items.filter(item => item.is_dir);
                setItems(dirs);
                // 后端返回的是相对于根目录的逻辑路径（用于显示）
                setCurrentPath(res.data.path);
                // 保存完整路径（用于选择和添加）
                setCurrentFullPath(res.data.fullPath);
                setSourceType(res.data.sourceType || '');
            } else {
                setError(res.error || '加载失败');
            }
        } catch (err: any) {
            console.error('[DirectoryPicker] Load failed:', err);
            setError(err.message || '加载失败');
        } finally {
            setLoading(false);
        }
    };

    const handleNavigate = (item: DirectoryItem) => {
        if (item.is_dir) {
            // AList 的 item.path 可能是绝对路径或者是拼接好的路径
            // 在我们的后端实现中，processedItems 的 item.path 已经是拼接好的 fullPath 或相对于根的路径
            // 但为了 DirectoryPicker 的通用性，我们通常传递相对于 source.root_path 的相对路径
            // 后端 /list 现在返回的处理后的 items 包含完整绝对路径
            // 目录选择器通常希望在内部维护相对路径，或者直接使用后端标记好的路径

            // 改进：后端 items.path 现在包含 fullPath，我们直接传给下一次 loadDirectory
            loadDirectory(item.path);
        }
    };

    const handleGoUp = () => {
        if (currentPath === '/' || currentPath === '') return;

        // 简单路径回退逻辑
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        const parentPath = '/' + parts.join('/');
        loadDirectory(parentPath);
    };

    const handleSelectCurrent = () => {
        const pathParts = currentPath.split('/').filter(Boolean);
        const name = pathParts[pathParts.length - 1] || '根目录';
        onSelect(currentFullPath, name);
        onClose();
    };

    const getSourceIcon = () => {
        switch (sourceType) {
            case 'alist': return 'fa-list-ul';
            case 'webdav': return 'fa-cloud';
            case 'local': return 'fa-hdd';
            default: return 'fa-folder';
        }
    };

    const getSourceLabel = () => {
        switch (sourceType) {
            case 'alist': return 'AList / OpenList';
            case 'webdav': return 'WebDAV';
            case 'local': return '本地存储';
            default: return '远程存储';
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-primary rounded-2xl border border-border-color w-full max-w-xl max-h-[80vh] flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between p-5 border-b border-border-color bg-secondary/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center text-blue-400 border border-blue-500/20">
                            <i className={`fas ${getSourceIcon()} text-lg`}></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-primary leading-none mb-1">选择扫描目录</h3>
                            <p className="text-xs text-secondary flex items-center gap-1">
                                <span className="px-1.5 py-0.5 rounded bg-secondary border border-border-color text-[10px] uppercase">{getSourceLabel()}</span>
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-secondary hover:text-primary hover:bg-white/10 transition-all">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* 路径导航 */}
                <div className="flex items-center gap-3 px-5 py-3 bg-secondary/30 border-b border-border-color backdrop-blur-md">
                    <button
                        onClick={handleGoUp}
                        disabled={currentPath === '/' || currentPath === ''}
                        className="w-8 h-8 flex items-center justify-center bg-secondary text-secondary hover:text-primary hover:bg-gray-700 rounded-lg disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                        title="返回上级"
                    >
                        <i className="fas fa-level-up-alt rotate-[-90deg]"></i>
                    </button>
                    <div className="flex-1 px-3 py-1.5 bg-secondary/50 border border-border-color rounded-lg text-sm text-blue-500 truncate font-mono shadow-inner">
                        {currentPath || '/'}
                    </div>
                </div>

                {/* 目录列表 */}
                <div className="flex-1 overflow-y-auto p-3 min-h-[300px] bg-secondary/20">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full text-secondary gap-4">
                            <i className="fas fa-spinner fa-spin text-3xl text-blue-500"></i>
                            <span className="text-sm font-medium animate-pulse">正在获取目录列表...</span>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-red-400 p-8 text-center gap-3">
                            <i className="fas fa-exclamation-triangle text-4xl opacity-50"></i>
                            <div>
                                <p className="font-bold">加载失败</p>
                                <p className="text-xs opacity-70 mt-1">{error}</p>
                            </div>
                            <button onClick={() => loadDirectory(currentPath)} className="mt-2 px-4 py-1.5 bg-red-400/10 hover:bg-red-400/20 border border-red-400/20 rounded-full text-xs transition-all">
                                重试
                            </button>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3 py-20">
                            <i className="fas fa-folder-open text-5xl opacity-20"></i>
                            <p className="text-sm font-medium italic">当前目录没有子文件夹</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-1">
                            {items.map((item, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => handleNavigate(item)}
                                    className="group flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer hover:bg-white/5 border border-transparent hover:border-border-color transition-all"
                                >
                                    <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-500 group-hover:scale-110 transition-transform">
                                        <i className="fas fa-folder text-xl"></i>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-primary font-medium group-hover:text-blue-500 transition-colors block truncate">{item.name}</span>
                                        <span className="text-[10px] text-secondary font-mono truncate block opacity-70">{item.path}</span>
                                    </div>
                                    <i className="fas fa-chevron-right text-gray-700 group-hover:text-secondary text-xs translate-x-[-10px] opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all"></i>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 底部操作 */}
                <div className="flex items-center justify-between p-5 border-t border-border-color bg-secondary/50">
                    <div className="max-w-[60%]">
                        <p className="text-[10px] text-secondary uppercase font-bold tracking-wider mb-1">当前选择</p>
                        <p className="text-sm text-blue-500 font-mono truncate">{currentPath || '/'}</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-sm bg-secondary text-primary hover:text-primary hover:bg-gray-700 rounded-xl font-medium transition-all"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSelectCurrent}
                            className="px-6 py-2 text-sm bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <i className="fas fa-check mr-2"></i> 确定选择
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
