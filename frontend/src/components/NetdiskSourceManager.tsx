import React, { useState, useEffect } from 'react';
import { NetdiskSource } from '../types';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api';
import { DirectoryPicker } from './DirectoryPicker';
import { ConfirmDialog } from './ConfirmDialog';
import { AlertDialog } from './AlertDialog';

interface NetdiskSourceManagerProps {
    onSourceChange?: () => void;
}

interface EditablePathRowProps {
    source: NetdiskSource;
    pathObj: any;
    idx: number;
    onUpdate: (nextPaths: any[]) => void;
    onScan: (force: boolean) => void;
    onDelete: () => void;
    onClearIndex: () => void;
    onCleanup: () => void; // 🧹 新增：清理孤儿记录
    onShowPicker: () => void;
    scanningStatus?: any;
}

function EditablePathRow({ source, pathObj, idx, onUpdate, onScan, onDelete, onClearIndex, onCleanup, onShowPicker, scanningStatus }: EditablePathRowProps) {
    const [localName, setLocalName] = useState(pathObj.name);
    const [localPath, setLocalPath] = useState(pathObj.path);

    // 当外部 pathObj 发生非交互性变更（如 loadSources 加载完成）时，同步本地状态
    useEffect(() => {
        setLocalName(pathObj.name);
        setLocalPath(pathObj.path);
    }, [pathObj.name, pathObj.path]);

    const handleBlur = () => {
        // 只有当内容发生实质变化时才触发昂贵的 API 调用
        if (localName !== pathObj.name || localPath !== pathObj.path) {
            const next = [...(source.scan_paths as any[])];
            next[idx] = { ...next[idx], name: localName, path: localPath };
            onUpdate(next);
        }
    };

    return (
        <div className="bg-secondary/50 p-3 rounded-lg border border-border-color">
            {/* 📱 移动端布局 */}
            <div className="md:hidden space-y-3">
                {/* 名称和路径输入 */}
                <div className="space-y-2">
                    <input
                        type="text"
                        value={localName}
                        onChange={(e) => setLocalName(e.target.value)}
                        onBlur={handleBlur}
                        placeholder="媒体库名称 (如: 电影、剧集)"
                        className="w-full px-2 py-2 bg-secondary text-primary border border-border-color rounded text-xs focus:border-blue-500 outline-none"
                    />
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={localPath}
                            onChange={(e) => setLocalPath(e.target.value)}
                            onBlur={handleBlur}
                            placeholder="媒体库路径"
                            className="flex-1 px-2 py-2 bg-secondary text-primary border border-border-color rounded text-xs focus:border-blue-500 outline-none"
                        />
                        <button
                            onClick={onShowPicker}
                            className="px-3 py-2 bg-gray-500 text-white rounded text-xs hover:bg-gray-600 transition-colors"
                        >
                            <i className="fas fa-folder-open"></i>
                        </button>
                    </div>
                </div>

                {/* 复选框选项 */}
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer">
                        <input
                            type="checkbox"
                            checked={pathObj.tmdb_enabled !== false}
                            onChange={(e) => {
                                const next = [...(source.scan_paths as any[])];
                                next[idx] = { ...next[idx], tmdb_enabled: e.target.checked };
                                onUpdate(next);
                            }}
                            className="w-3 h-3 rounded"
                        />
                        TMDB
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!!pathObj.hidden}
                            onChange={(e) => {
                                const next = [...(source.scan_paths as any[])];
                                next[idx] = { ...next[idx], hidden: e.target.checked };
                                onUpdate(next);
                            }}
                            className="w-3 h-3 rounded"
                        />
                        隐藏
                    </label>
                </div>

                {/* 操作按钮 - 两行布局 */}
                <div className="grid grid-cols-3 gap-1">
                    <button
                        onClick={() => onScan(false)}
                        disabled={scanningStatus?.scanning}
                        className={`py-2 rounded text-xs text-white transition-colors ${scanningStatus?.scanning && scanningStatus?.mode === 'incremental'
                            ? 'bg-blue-400 cursor-not-allowed opacity-70'
                            : scanningStatus?.scanning
                                ? 'bg-blue-500/50 cursor-not-allowed'
                                : 'bg-blue-500 hover:bg-blue-600'
                            }`}
                    >
                        <i className={`fas ${scanningStatus?.scanning && scanningStatus?.mode === 'incremental' ? 'fa-spinner fa-spin' : 'fa-plus-circle'} mr-1`}></i>
                        扫描
                    </button>
                    <button
                        onClick={() => onScan(true)}
                        disabled={scanningStatus?.scanning}
                        className={`py-2 rounded text-xs text-white transition-colors ${scanningStatus?.scanning && scanningStatus?.mode === 'full'
                            ? 'bg-indigo-400 cursor-not-allowed opacity-70'
                            : scanningStatus?.scanning
                                ? 'bg-indigo-500/50 cursor-not-allowed'
                                : 'bg-indigo-500 hover:bg-indigo-600'
                            }`}
                    >
                        <i className={`fas ${scanningStatus?.scanning && scanningStatus?.mode === 'full' ? 'fa-spinner fa-spin' : 'fa-redo-alt'} mr-1`}></i>
                        刷新
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                const res = await apiPost<any>('/netdisk/retry-failed-images', {});
                                if (res.success) {
                                    alert(res.message || '重试已启动');
                                }
                            } catch (e) {
                                console.error('Failed to retry images:', e);
                            }
                        }}
                        className="py-2 bg-amber-500 text-white rounded text-xs hover:bg-amber-600 transition-colors"
                    >
                        <i className="fas fa-image mr-1"></i>封面
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                    <button onClick={onCleanup} className="py-2 bg-orange-500 text-white rounded text-xs hover:bg-orange-600 transition-colors">
                        <i className="fas fa-broom mr-1"></i>清理
                    </button>
                    <button onClick={onClearIndex} className="py-2 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition-colors">
                        <i className="fas fa-eraser mr-1"></i>索引
                    </button>
                    <button onClick={onDelete} className="py-2 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition-colors">
                        <i className="fas fa-times mr-1"></i>删除
                    </button>
                </div>
            </div>

            {/* 🖥️ 桌面端布局 */}
            <div className="hidden md:flex flex-wrap items-center gap-2">
                <div className="flex-1 flex items-center gap-2 min-w-[300px]">
                    <input
                        type="text"
                        value={localName}
                        onChange={(e) => setLocalName(e.target.value)}
                        onBlur={handleBlur}
                        placeholder="媒体库名称 (如: 电影、剧集)"
                        className="w-1/3 px-2 py-1.5 bg-secondary text-primary border border-border-color rounded text-xs focus:border-blue-500 outline-none hover:border-gray-600 transition-colors"
                    />
                    <input
                        type="text"
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                        onBlur={handleBlur}
                        placeholder="媒体库路径 (网盘中的目录路径)"
                        className="flex-1 px-2 py-1.5 bg-secondary text-primary border border-border-color rounded text-xs focus:border-blue-500 outline-none hover:border-gray-600 transition-colors"
                    />
                    <button
                        onClick={onShowPicker}
                        className="px-2 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-xs text-primary transition-colors"
                    >
                        <i className="fas fa-folder-open"></i>
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 px-2 py-1 bg-secondary border border-border-color rounded text-[10px] text-primary cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                        <input
                            type="checkbox"
                            checked={pathObj.tmdb_enabled !== false}
                            onChange={(e) => {
                                const next = [...(source.scan_paths as any[])];
                                next[idx] = { ...next[idx], tmdb_enabled: e.target.checked };
                                onUpdate(next);
                            }}
                            className="w-3 h-3 rounded border-gray-600 bg-secondary text-blue-500 focus:ring-0"
                        />
                        TMDB
                    </label>
                    <label className="flex items-center gap-1.5 px-2 py-1 bg-secondary border border-border-color rounded text-[10px] text-primary cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                        <input
                            type="checkbox"
                            checked={!!pathObj.hidden}
                            onChange={(e) => {
                                const next = [...(source.scan_paths as any[])];
                                next[idx] = { ...next[idx], hidden: e.target.checked };
                                onUpdate(next);
                            }}
                            className="w-3 h-3 rounded border-gray-600 bg-secondary text-blue-500 focus:ring-0"
                        />
                        隐藏
                    </label>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onScan(false)}
                            disabled={scanningStatus?.scanning}
                            className={`px-2 py-1 rounded-l text-[10px] transition-all flex items-center gap-1 ${scanningStatus?.scanning && scanningStatus?.mode === 'incremental'
                                ? 'bg-blue-400 text-white cursor-not-allowed opacity-70'
                                : scanningStatus?.scanning
                                    ? 'bg-blue-500 text-white/50 cursor-not-allowed'
                                    : 'bg-blue-500 text-white hover:bg-blue-600'
                                }`}
                            title="仅扫描新增或变动的内容 (极速)"
                        >
                            <i className={`fas ${scanningStatus?.scanning && scanningStatus?.mode === 'incremental' ? 'fa-spinner fa-spin' : 'fa-plus-circle'}`}></i>
                            {scanningStatus?.scanning && scanningStatus?.mode === 'incremental' ? '正在扫描' : '扫描新内容'}
                        </button>
                        <button
                            onClick={() => onScan(true)}
                            disabled={scanningStatus?.scanning}
                            className={`px-2 py-1 rounded-r text-[10px] transition-all border-l border-blue-400/50 flex items-center gap-1 ${scanningStatus?.scanning && scanningStatus?.mode === 'full'
                                ? 'bg-indigo-400 text-white cursor-not-allowed opacity-70'
                                : scanningStatus?.scanning
                                    ? 'bg-indigo-500 text-white/50 cursor-not-allowed'
                                    : 'bg-indigo-500 text-white hover:bg-indigo-600'
                                }`}
                            title="强制重新刮削该目录下所有内容 (耗时)"
                        >
                            <i className={`fas ${scanningStatus?.scanning && scanningStatus?.mode === 'full' ? 'fa-spinner fa-spin' : 'fa-redo-alt'}`}></i>
                            {scanningStatus?.scanning && scanningStatus?.mode === 'full' ? '刷新中' : '刷新全部'}
                        </button>
                    </div>
                    <button
                        onClick={async () => {
                            try {
                                const res = await apiPost<any>('/netdisk/retry-failed-images', {});
                                if (res.success) {
                                    alert(res.message || '重试已启动');
                                }
                            } catch (e) {
                                console.error('Failed to retry images:', e);
                            }
                        }}
                        className="px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 text-xs transition-colors"
                        title="立即重试该目录下加载失败的封面图片"
                    >
                        <i className="fas fa-image mr-1"></i> 重试封面
                    </button>
                    <button
                        onClick={onCleanup}
                        className="px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 text-xs transition-colors"
                        title="检测并清理已从源目录删除的失效记录"
                    >
                        <i className="fas fa-broom mr-1"></i> 清理失效
                    </button>
                    <button
                        onClick={onClearIndex}
                        className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs transition-colors"
                    >
                        <i className="fas fa-eraser mr-1"></i> 清理索引
                    </button>
                    <button onClick={onDelete} className="p-1.5 text-secondary hover:text-red-400 transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </div>
        </div>
    );
}


export function NetdiskSourceManager({ onSourceChange }: NetdiskSourceManagerProps) {
    const [sources, setSources] = useState<NetdiskSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [expandedIds, setExpandedIds] = useState<number[]>([]);
    const [scanningStatuses, setScanningStatuses] = useState<Record<number, any>>({});
    const [globalStatus, setGlobalStatus] = useState<any>(null);

    // 对话框状态
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        onCancel?: () => void;
        variant?: 'danger' | 'primary';
        children?: React.ReactNode;
    } | null>(null);
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        variant?: 'success' | 'error' | 'info' | 'warning';
    } | null>(null);

    // 目录选择器状态
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerSourceId, setPickerSourceId] = useState<number | null>(null);
    const [pickerMode, setPickerMode] = useState<'add' | 'edit'>('add');
    const [pickerEditIndex, setPickerEditIndex] = useState<number>(-1);

    // 筛选和搜索
    const [searchKeyword, setSearchKeyword] = useState('');

    // 选择状态
    const [selectedIds, setSelectedIds] = useState<number[]>([]);


    // 表单状态
    const [showForm, setShowForm] = useState(false);
    const [editingSource, setEditingSource] = useState<NetdiskSource | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        type: 'alist',
        url: '',
        username: 'admin',
        password: '',
        root_path: '/',
        enabled: true,
        proxy_enabled: false,
        hidden: false,
        remark: ''
    });

    useEffect(() => {
        loadSources();
    }, []);

    const loadSources = async () => {
        setLoading(true);
        try {
            const res = await apiGet<NetdiskSource[]>('/netdisk/sources');
            if (res.success && res.data) {
                setSources(res.data);
            }
        } catch (error) {
            console.error('Failed to load netdisk sources:', error);
        } finally {
            setLoading(false);
        }
    };

    // 扫描状态轮询
    useEffect(() => {
        const fetchGlobalStatus = async () => {
            try {
                const res = await apiGet<any>('/netdisk/probe/status');
                if (res.success && res.data) {
                    setGlobalStatus(res.data);
                }
            } catch (e) {
                console.warn('Failed to fetch global probe status:', e);
            }
        };

        fetchGlobalStatus();
        const interval = setInterval(() => {
            fetchGlobalStatus();
            sources.forEach(source => {
                if (source.enabled) {
                    apiGet<any>(`/netdisk/scan/${source.id}/status`).then(res => {
                        if (res.success && res.data) {
                            setScanningStatuses(prev => ({
                                ...prev,
                                [source.id]: res.data
                            }));
                        }
                    });
                }
            });
        }, 3000);

        return () => clearInterval(interval);
    }, [sources]);

    const handleAdd = () => {
        setEditingSource(null);
        setFormData({
            name: '',
            type: 'alist',
            url: '',
            username: 'admin',
            password: '',
            root_path: '/',
            enabled: true,
            proxy_enabled: false,
            hidden: false,
            remark: ''
        });
        setShowForm(true);
    };

    const handleEdit = (source: NetdiskSource) => {
        setEditingSource(source);
        setFormData({
            name: source.name,
            type: source.type || 'alist',
            url: source.url,
            username: source.username || 'admin',
            password: '',
            root_path: source.root_path,
            enabled: !!source.enabled,
            proxy_enabled: !!source.proxy_enabled,
            hidden: !!source.hidden,
            remark: source.remark || ''
        });
        setShowForm(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // 在这个精简后的版本中，handleSave 不再处理 scan_paths，
            // 除非是初次创建且有默认值，或者我们保持现有逻辑不覆盖它。
            // 由于 scan_paths 已经在表格的子行中管理，这里我们只需要保证不误删它即可。

            const payload: any = {
                ...formData
            };

            // 修复：编辑模式下，如果密码为空，则不发送该字段以实现“留空保持不变”
            if (editingSource && !payload.password) {
                delete payload.password;
            }

            if (editingSource) {
                await apiPut(`/netdisk/sources/${editingSource.id}`, payload);
            } else {
                await apiPost('/netdisk/sources', payload);
            }

            setShowForm(false);
            loadSources();
            onSourceChange?.();
        } catch (error) {
            console.error('Failed to save source:', error);
            setAlertDialog({
                isOpen: true,
                title: '保存失败',
                message: '保存失败',
                variant: 'error'
            });
        } finally {
            setSaving(false);
        }
    };

    // 校验必填项
    const isFormValid = () => {
        if (!formData.name) return false;
        if (formData.type === 'local') {
            return !!formData.root_path;
        } else {
            return !!formData.url;
        }
    };

    const handleDelete = (id: number, name: string) => {
        setConfirmDialog({
            isOpen: true,
            title: '确认删除',
            message: `确定要删除媒体库"${name}"吗？`,
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                try {
                    await apiDelete(`/netdisk/sources/${id}`);
                    loadSources();
                    onSourceChange?.();
                } catch (error) {
                    console.error('Failed to delete source:', error);
                }
            }
        });
    };


    const handleTest = async (source: NetdiskSource) => {
        try {
            const res = await apiPost<{ connected: boolean; itemCount?: number; error?: string }>(`/netdisk/sources/${source.id}/test`);
            if (res.success && res.data) {
                if (res.data.connected) {
                    setAlertDialog({
                        isOpen: true,
                        title: '连接测试',
                        message: `连接成功！共 ${res.data.itemCount || 0} 个项目`,
                        variant: 'success'
                    });
                } else {
                    setAlertDialog({
                        isOpen: true,
                        title: '连接测试',
                        message: `连接失败：${res.data.error || '未知错误'}`,
                        variant: 'error'
                    });
                }
            }
        } catch (error) {
            setAlertDialog({
                isOpen: true,
                title: '连接测试',
                message: '测试失败',
                variant: 'error'
            });
        }
    };

    const handleToggleEnabled = async (source: NetdiskSource) => {
        try {
            await apiPut(`/netdisk/sources/${source.id}`, {
                enabled: !source.enabled
            });
            loadSources();
            onSourceChange?.();
        } catch (error) {
            console.error('Failed to toggle source:', error);
        }
    };

    // 批量操作
    const handleSelectAll = () => {
        if (selectedIds.length === filteredSources.length && filteredSources.length > 0) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredSources.map(s => s.id));
        }
    };

    const handleSelect = (id: number) => {
        setSelectedIds(prev =>
            prev.includes(id)
                ? prev.filter(i => i !== id)
                : [...prev, id]
        );
    };

    const handleBatchDelete = () => {
        if (selectedIds.length === 0) return;
        setConfirmDialog({
            isOpen: true,
            title: '批量删除',
            message: `确定要删除选中的 ${selectedIds.length} 个媒体库吗？`,
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                try {
                    await Promise.all(selectedIds.map(id => apiDelete(`/netdisk/sources/${id}`)));
                    setSelectedIds([]);
                    loadSources();
                    onSourceChange?.();
                } catch (error) {
                    console.error('Batch delete failed:', error);
                }
            }
        });
    };


    const handleBatchStatus = async (enabled: boolean) => {
        if (selectedIds.length === 0) return;
        try {
            await Promise.all(selectedIds.map(id => apiPut(`/netdisk/sources/${id}`, { enabled: enabled ? 1 : 0 })));
            setSelectedIds([]);
            loadSources();
            onSourceChange?.();
        } catch (error) {
            console.error('Batch status update failed:', error);
        }
    };

    const handleToggleExpand = (id: number) => {
        setExpandedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleScan = async (sourceId: number, path?: string, force: boolean = false) => {
        try {
            const res = await apiPost(`/netdisk/scan`, { sourceId, path, force });
            if (res.success) {
                setAlertDialog({
                    isOpen: true,
                    title: force ? '全量刷新已启动' : '增量扫描已启动',
                    message: force
                        ? (path ? `正在强制刷新目录: ${path}` : '正在强制全量刷新...')
                        : (path ? `正在扫描新内容: ${path}` : '正在扫描新增资源...'),
                    variant: 'info'
                });
            }
        } catch (error) {
            setAlertDialog({
                isOpen: true,
                title: '扫描失败',
                message: '扫描启动失败',
                variant: 'error'
            });
        }
    };

    // 🧹 清理失效记录（孤儿记录）
    const handleCleanup = async (sourceId: number, path?: string) => {
        console.log('[Cleanup] Starting cleanup for sourceId:', sourceId, 'path:', path);
        try {
            // 1. 先预览模式获取孤儿列表
            const previewRes = await apiPost<{ orphans: any[], deletedCount: number }>(`/netdisk/cleanup-orphans`, {
                sourceId,
                path,
                preview: true
            });

            console.log('[Cleanup] Preview response:', previewRes);

            // 🚨 修复：API 直接返回对象，orpans 在顶层而非 data 中
            const responseData = previewRes as any;
            if (!responseData.success) {
                setAlertDialog({ isOpen: true, title: '检测失败', message: '无法检测失效记录', variant: 'error' });
                return;
            }

            const orphans = responseData.orphans || [];
            if (orphans.length === 0) {
                setAlertDialog({ isOpen: true, title: '无失效记录', message: '未发现需要清理的失效记录，所有数据均有效。', variant: 'success' });
                return;
            }

            // 2. 展示确认弹窗
            setConfirmDialog({
                isOpen: true,
                title: `发现 ${orphans.length} 条失效记录`,
                message: '以下媒体在源目录中已不存在，是否删除这些数据库记录？',
                children: (
                    <div className="mt-3 max-h-48 overflow-y-auto text-xs space-y-1 bg-black/20 p-2 rounded">
                        {orphans.slice(0, 20).map((o: any, i: number) => (
                            <div key={i} className="text-orange-400 truncate" title={o.path}>
                                <i className="fas fa-exclamation-triangle mr-1"></i> {o.title || o.path}
                            </div>
                        ))}
                        {orphans.length > 20 && (
                            <div className="text-gray-500">... 还有 {orphans.length - 20} 条</div>
                        )}
                    </div>
                ),
                variant: 'danger',
                onConfirm: async () => {
                    setConfirmDialog(null);
                    // 3. 执行删除
                    const deleteRes = await apiPost<{ deletedCount: number }>(`/netdisk/cleanup-orphans`, {
                        sourceId,
                        path,
                        preview: false
                    });
                    const deleteData = deleteRes as any;
                    if (deleteData.success) {
                        setAlertDialog({
                            isOpen: true,
                            title: '清理完成',
                            message: `已删除 ${deleteData.deletedCount || 0} 条失效记录`,
                            variant: 'success'
                        });
                        onSourceChange?.();
                    }
                }
            });
        } catch (error) {
            setAlertDialog({ isOpen: true, title: '清理失败', message: '清理过程中发生错误', variant: 'error' });
        }
    };

    const handleClearIndex = (sourceId: number, path?: string) => {
        setConfirmDialog({
            isOpen: true,
            title: '确认清除',
            message: path ? `确定要清除目录 "${path}" 的媒体索引吗？` : '确定要清除该媒体库的所有索引吗？',
            children: (
                <label className="flex items-center gap-3 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl cursor-pointer hover:bg-red-500/20 transition-all group">
                    <input
                        type="checkbox"
                        defaultChecked={false}
                        onChange={(e) => {
                            (window as any).__lastClearImages = e.target.checked;
                        }}
                        className="w-5 h-5 rounded border-red-500/50 text-red-500 focus:ring-0 bg-transparent cursor-pointer"
                    />
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-red-400 group-hover:text-red-300">同步清空全部海报图片缓存</span>
                        <span className="text-[10px] text-red-400/60 leading-tight">注意：这会删除 video_covers 下的所有物理文件</span>
                    </div>
                </label>
            ),
            variant: 'danger',
            onConfirm: async () => {
                const clearImages = (window as any).__lastClearImages || false;
                setConfirmDialog(null);
                (window as any).__lastClearImages = false;
                try {
                    const res = await apiPost(`/netdisk/clear-index`, { sourceId, path, clearImages });
                    if (res.success) {
                        setAlertDialog({
                            isOpen: true,
                            title: '操作成功',
                            message: '清理成功',
                            variant: 'success'
                        });
                        onSourceChange?.();
                    }
                } catch (error) {
                    setAlertDialog({
                        isOpen: true,
                        title: '操作失败',
                        message: '清理失败',
                        variant: 'error'
                    });
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    };


    const handleUpdateScanPaths = async (source: NetdiskSource, newPaths: any[]) => {
        try {
            await apiPut(`/netdisk/sources/${source.id}`, {
                scan_paths: JSON.stringify(newPaths)
            });
            loadSources();
            onSourceChange?.();
        } catch (error) {
            setAlertDialog({
                isOpen: true,
                title: '更新失败',
                message: '更新失败',
                variant: 'error'
            });
        }
    };

    const filteredSources = sources.filter(source =>
        source.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        source.url.toLowerCase().includes(searchKeyword.toLowerCase())
    );

    if (loading) {
        return (
            <div className="animate-pulse space-y-4">
                <div className="h-10 bg-secondary rounded w-full"></div>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-16 bg-secondary rounded"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* 工具栏 */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-secondary"></i>
                    <input
                        type="text"
                        placeholder="搜索媒体库名称..."
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                 focus:border-red-500 focus:outline-none"
                    />
                </div>

                <div className="flex items-center gap-2">
                    {globalStatus && (
                        <div className="flex items-center gap-3 px-4 py-2 bg-blue-600/10 border border-blue-500/20 rounded-lg text-[11px]">
                            <div className="flex items-center gap-1.5" title="后台队列是否正在运行">
                                <i className={`fas fa-circle text-[8px] ${globalStatus.isRunning ? 'text-green-500 animate-pulse' : 'text-gray-500'}`}></i>
                                <span className="text-secondary uppercase font-bold tracking-wider">后台扫描队列</span>
                            </div>
                            <div className="w-px h-3 bg-blue-500/20"></div>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1">
                                    <span className="text-blue-400 font-bold">{globalStatus.pendingNfo || 0}</span>
                                    <span className="text-secondary">待补全</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-purple-400 font-bold">{globalStatus.pending || 0}</span>
                                    <span className="text-secondary">待探测</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-green-400 font-bold">{globalStatus.locked || 0}</span>
                                    <span className="text-secondary">已锁定</span>
                                </div>
                                {globalStatus.isPausedByPlayback && (
                                    <div className="flex items-center gap-1 text-orange-400 animate-pulse px-1.5 py-0.5 bg-orange-400/10 rounded">
                                        <i className="fas fa-pause-circle"></i>
                                        <span>正在播放，后台避让中</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {selectedIds.length > 0 && (
                        <>
                            <button
                                onClick={() => handleBatchStatus(true)}
                                className="px-3 py-2 bg-green-600 rounded-lg hover:bg-green-700 transition-colors text-sm"
                                style={{ color: '#fff' }}
                            >
                                启用选中
                            </button>
                            <button
                                onClick={() => handleBatchStatus(false)}
                                className="px-3 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-sm"
                                style={{ color: '#fff' }}
                            >
                                禁用选中
                            </button>
                            <button
                                onClick={handleBatchDelete}
                                className="px-3 py-2 bg-red-600 rounded-lg hover:bg-red-700 transition-colors text-sm"
                                style={{ color: '#fff' }}
                            >
                                删除选中
                            </button>
                        </>
                    )}
                    <button
                        onClick={handleAdd}
                        className="px-4 py-2 bg-red-500 rounded-lg hover:bg-red-600 
                                 transition-colors flex items-center gap-2 text-sm"
                        style={{ color: '#fff' }}
                    >
                        <i className="fas fa-plus"></i>
                        添加媒体库
                    </button>
                </div>
            </div>

            {/* 📱 移动端卡片视图 */}
            <div className="md:hidden space-y-3">
                {filteredSources.map(source => (
                    <div key={source.id} className={`bg-secondary/30 rounded-lg border border-border-color overflow-hidden ${!source.enabled ? 'opacity-50' : ''}`}>
                        {/* 主卡片 */}
                        <div className="p-3">
                            {/* 顶部：选择框 + 展开 + 名称 + 状态 */}
                            <div className="flex items-center gap-2 mb-2">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(source.id)}
                                    onChange={() => handleSelect(source.id)}
                                    className="rounded"
                                />
                                <button
                                    onClick={() => handleToggleExpand(source.id)}
                                    className={`p-1 text-secondary hover:text-primary transition-transform ${expandedIds.includes(source.id) ? 'rotate-90' : ''}`}
                                >
                                    <i className="fas fa-chevron-right text-xs"></i>
                                </button>
                                <span className="text-primary font-medium flex-1 truncate">{source.name}</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${source.enabled ? 'bg-green-600' : 'bg-gray-500'}`} style={{ color: '#fff' }}>
                                    {source.enabled ? '启用' : '禁用'}
                                </span>
                            </div>

                            {/* 类型和地址 */}
                            <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                                <span className="px-1.5 py-0.5 bg-secondary text-primary rounded text-[10px] border border-border-color">
                                    {source.type === 'alist' ? 'Alist' : (source.type === 'webdav' ? 'WebDAV' : '本地')}
                                </span>
                                {source.type !== 'local' && source.proxy_enabled && (
                                    <span className="px-1.5 py-0.5 bg-purple-600 text-white rounded text-[10px]">代理</span>
                                )}
                                {source.hidden && (
                                    <span className="px-1.5 py-0.5 bg-orange-500 text-white rounded text-[10px]">隐藏</span>
                                )}
                            </div>
                            <div className="text-secondary text-xs truncate mb-2" title={source.type === 'local' ? source.root_path : source.url}>
                                <i className="fas fa-link mr-1 opacity-50"></i>{source.type === 'local' ? source.root_path : source.url}
                            </div>

                            {/* 操作按钮 */}
                            <div className="flex items-center gap-1 pt-2 border-t border-border-color">
                                <button onClick={() => handleScan(source.id, undefined, false)} className="flex-1 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600 transition-colors">
                                    <i className="fas fa-sync-alt mr-1"></i>扫描
                                </button>
                                <button onClick={() => handleTest(source)} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
                                    <i className="fas fa-plug mr-1"></i>测试
                                </button>
                                <button onClick={() => handleToggleEnabled(source)} className={`flex-1 py-1.5 text-xs text-white rounded transition-colors ${source.enabled ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-500 hover:bg-gray-600'}`}>
                                    <i className={`fas fa-${source.enabled ? 'toggle-on' : 'toggle-off'} mr-1`}></i>{source.enabled ? '禁用' : '启用'}
                                </button>
                                <button onClick={() => handleEdit(source)} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
                                    <i className="fas fa-edit mr-1"></i>编辑
                                </button>
                                <button onClick={() => handleDelete(source.id, source.name)} className="flex-1 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors">
                                    <i className="fas fa-trash mr-1"></i>删除
                                </button>
                            </div>

                        </div>

                        {/* 展开区域：扫描目录管理 */}
                        {expandedIds.includes(source.id) && (
                            <div className="border-t border-border-color bg-secondary/20 p-3">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-xs font-bold text-secondary uppercase tracking-wider">扫描目录管理</h4>
                                    <button
                                        onClick={() => {
                                            setPickerSourceId(source.id);
                                            setPickerMode('add');
                                            setPickerOpen(true);
                                        }}
                                        className="text-xs text-white flex items-center gap-1 bg-blue-500 px-2 py-1 rounded-md transition-all hover:bg-blue-600"
                                    >
                                        <i className="fas fa-folder-open"></i> 添加目录
                                    </button>
                                </div>

                                {/* 扫描路径列表 */}
                                <div className="space-y-2">
                                    {(Array.isArray(source.scan_paths) ? source.scan_paths : []).map((pathObj: any, idx: number) => (
                                        <EditablePathRow
                                            key={`${source.id}-${idx}`}
                                            source={source}
                                            pathObj={pathObj}
                                            idx={idx}
                                            onUpdate={(nextPaths) => handleUpdateScanPaths(source, nextPaths)}
                                            onScan={(force) => handleScan(source.id, pathObj.path, force)}
                                            onDelete={() => {
                                                const next = (source.scan_paths as any[]).filter((_, i) => i !== idx);
                                                handleUpdateScanPaths(source, next);
                                            }}
                                            onClearIndex={() => handleClearIndex(source.id, pathObj.path)}
                                            onCleanup={() => handleCleanup(source.id, pathObj.path)}
                                            onShowPicker={() => {
                                                setPickerSourceId(source.id);
                                                setPickerMode('edit');
                                                setPickerEditIndex(idx);
                                                setPickerOpen(true);
                                            }}
                                            scanningStatus={scanningStatuses[source.id]?.paths?.[pathObj.path]}
                                        />
                                    ))}
                                    {(Array.isArray(source.scan_paths) ? source.scan_paths : []).length === 0 && (
                                        <div className="text-center py-4 text-gray-600 italic text-xs">
                                            未配置扫描目录，将扫描全量资源
                                        </div>
                                    )}
                                </div>

                                <div className="pt-2 border-t border-border-color/50 mt-3">
                                    <button
                                        onClick={() => handleClearIndex(source.id)}
                                        className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                                    >
                                        <i className="fas fa-trash-alt"></i> 清空全部索引
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* 🖥️ 桌面端表格视图 */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-secondary border-b border-border-color">
                            <th className="p-3 w-10">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.length === filteredSources.length && filteredSources.length > 0}
                                    onChange={handleSelectAll}
                                    className="rounded border-border-color bg-secondary text-blue-600 focus:ring-blue-500"
                                />
                            </th>
                            <th className="p-3 w-10"></th>
                            <th className="p-3">名称</th>
                            <th className="p-3 w-20">状态</th>
                            <th className="p-3 w-20">代理</th>
                            <th className="p-3 w-20">隐藏</th>
                            <th className="p-3">存储类型</th>
                            <th className="p-3">地址/根目录</th>
                            <th className="p-3">备注</th>
                            <th className="p-3 w-40">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSources.map(source => (
                            <React.Fragment key={source.id}>
                                <tr
                                    className={`border-b border-border-color hover:bg-secondary/50 transition-colors
                                          ${!source.enabled ? 'opacity-50' : ''}
                                          ${selectedIds.includes(source.id) ? 'bg-blue-600/10' : ''}`}
                                >
                                    <td className="p-3">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(source.id)}
                                            onChange={() => handleSelect(source.id)}
                                            className="rounded border-border-color bg-secondary text-blue-600 focus:ring-blue-500"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <button
                                            onClick={() => handleToggleExpand(source.id)}
                                            className={`p-1 text-secondary hover:text-primary transition-transform ${expandedIds.includes(source.id) ? 'rotate-90' : ''}`}
                                        >
                                            <i className="fas fa-chevron-right text-xs"></i>
                                        </button>
                                    </td>
                                    <td className="p-3">
                                        <span className="text-primary font-medium">{source.name}</span>
                                    </td>
                                    <td className="p-3">
                                        <span
                                            className={`px-2 py-1 rounded text-xs font-medium ${source.enabled
                                                ? 'bg-green-600'
                                                : 'bg-gray-500'
                                                }`}
                                            style={{ color: '#fff' }}
                                        >
                                            {source.enabled ? '启用' : '禁用'}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        {source.type !== 'local' ? (
                                            <span
                                                className={`px-2 py-1 rounded text-xs font-medium ${source.proxy_enabled
                                                    ? 'bg-purple-600'
                                                    : 'bg-gray-500'
                                                    }`}
                                                style={{ color: '#fff' }}
                                            >
                                                {source.proxy_enabled ? '开启' : '关闭'}
                                            </span>
                                        ) : <span className="text-gray-600">-</span>}
                                    </td>
                                    <td className="p-3">
                                        <span
                                            className={`px-2 py-1 rounded text-xs font-medium ${source.hidden
                                                ? 'bg-orange-500'
                                                : 'bg-blue-600'
                                                }`}
                                            style={{ color: '#fff' }}
                                        >
                                            {source.hidden ? '是' : '否'}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <span className="px-2 py-1 bg-secondary text-primary rounded text-xs border border-border-color">
                                            {source.type === 'alist' ? 'Alist' : (source.type === 'webdav' ? 'WebDAV' : '本地目录')}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <span className="text-secondary text-xs truncate block max-w-xs" title={source.type === 'local' ? source.root_path : source.url}>
                                            {source.type === 'local' ? source.root_path : source.url}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <span className="text-secondary text-xs">{source.remark || '-'}</span>
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleScan(source.id, undefined, false)}
                                                className="p-1.5 text-secondary hover:text-green-400 transition-colors"
                                                title="扫描新内容 (增量扫描)"
                                            >
                                                <i className="fas fa-sync-alt"></i>
                                            </button>
                                            <button
                                                onClick={() => handleScan(source.id, undefined, true)}
                                                className="p-1.5 text-secondary hover:text-red-400 transition-colors"
                                                title="刷新全部 (强制全量重新刮削)"
                                            >
                                                <i className="fas fa-redo-alt"></i>
                                            </button>
                                            <button
                                                onClick={() => handleTest(source)}
                                                className="p-1.5 text-secondary hover:text-blue-400 transition-colors"
                                                title="测试连接"
                                            >
                                                <i className="fas fa-plug"></i>
                                            </button>
                                            <button
                                                onClick={() => handleToggleEnabled(source)}
                                                className={`p-1.5 transition-colors ${source.enabled ? 'text-green-400 hover:text-green-300' : 'text-secondary hover:text-secondary'
                                                    }`}
                                                title={source.enabled ? '禁用' : '启用'}
                                            >
                                                <i className={`fas fa-${source.enabled ? 'toggle-on' : 'toggle-off'}`}></i>
                                            </button>
                                            <button
                                                onClick={() => handleEdit(source)}
                                                className="p-1.5 text-secondary hover:text-primary transition-colors"
                                                title="编辑"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(source.id, source.name)}
                                                className="p-1.5 text-secondary hover:text-red-400 transition-colors"
                                                title="删除"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {
                                    expandedIds.includes(source.id) && (
                                        <tr className="bg-secondary/30 border-b border-border-color">
                                            <td colSpan={10} className="p-4">
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <h4 className="text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-2">
                                                            扫描目录管理
                                                            <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded-full text-[10px] lowercase normal-case flex items-center gap-1">
                                                                <i className="fas fa-info-circle"></i> 建议按分类添加目录
                                                            </span>
                                                        </h4>
                                                        <button
                                                            onClick={() => {
                                                                setPickerSourceId(source.id);
                                                                setPickerMode('add');
                                                                setPickerOpen(true);
                                                            }}
                                                            className="text-xs text-white flex items-center gap-1 bg-blue-500 px-2 py-1 rounded-md transition-all hover:bg-blue-600"
                                                        >
                                                            <i className="fas fa-folder-open"></i> 浏览并添加目录
                                                        </button>
                                                    </div>

                                                    <div className="bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/30 dark:border-blue-500/20 rounded-lg p-3 text-[11px] text-blue-700 dark:text-blue-300/80 leading-relaxed shadow-sm">
                                                        <div className="font-bold mb-1 flex items-center gap-1 text-blue-800 dark:text-blue-400">
                                                            <i className="fas fa-lightbulb"></i> 使用小贴士：
                                                        </div>
                                                        <ul className="list-disc list-inside space-y-0.5 opacity-80">
                                                            <li>添加新目录后系统将<b>自动启动全量扫描</b>。</li>
                                                            <li>勾选"隐藏"属性后，访客（未登录用户）在手机/网页端将无法看到该目录下的资源。</li>
                                                            <li>如果目录中包含 NFO 文件，系统将优先从本地读取元数据（海报、简介等）。</li>
                                                        </ul>
                                                    </div>

                                                    <div className="grid grid-cols-1 gap-2">
                                                        {/* 表头 */}
                                                        {(Array.isArray(source.scan_paths) ? source.scan_paths : []).length > 0 && (
                                                            <div className="flex items-center gap-2 px-3 py-1 text-[10px] font-bold text-secondary uppercase tracking-wider">
                                                                <div className="w-1/4 ml-1">媒体库名称</div>
                                                                <div className="w-1/3">媒体库路径</div>
                                                                <div className="flex-1 text-right pr-6">操作</div>
                                                            </div>
                                                        )}
                                                        {(Array.isArray(source.scan_paths) ? source.scan_paths : []).map((pathObj: any, idx: number) => {
                                                            // 为每个输入框维护一个独立的本地状态，解决输入过程中的抖动和丢焦点问题
                                                            return (
                                                                <EditablePathRow
                                                                    key={`${source.id}-${idx}`}
                                                                    source={source}
                                                                    pathObj={pathObj}
                                                                    idx={idx}
                                                                    onUpdate={(nextPaths) => handleUpdateScanPaths(source, nextPaths)}
                                                                    onScan={(force) => handleScan(source.id, pathObj.path, force)}
                                                                    onDelete={() => {
                                                                        const next = (source.scan_paths as any[]).filter((_, i) => i !== idx);
                                                                        handleUpdateScanPaths(source, next);
                                                                    }}
                                                                    onClearIndex={() => handleClearIndex(source.id, pathObj.path)}
                                                                    onCleanup={() => handleCleanup(source.id, pathObj.path)}
                                                                    onShowPicker={() => {
                                                                        setPickerSourceId(source.id);
                                                                        setPickerMode('edit');
                                                                        setPickerEditIndex(idx);
                                                                        setPickerOpen(true);
                                                                    }}
                                                                    scanningStatus={scanningStatuses[source.id]?.paths?.[pathObj.path]}
                                                                />
                                                            );
                                                        })}
                                                        {(Array.isArray(source.scan_paths) ? source.scan_paths : []).length === 0 && (
                                                            <div className="text-center py-4 text-gray-600 italic text-xs">
                                                                未配置扫描目录，将扫描全量资源
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="pt-2 border-t border-border-color/50 flex gap-4">
                                                        <button
                                                            onClick={() => handleClearIndex(source.id)}
                                                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                                                        >
                                                            <i className="fas fa-trash-alt"></i> 清空全部索引
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                }
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>


            {
                filteredSources.length === 0 && (
                    <div className="text-center py-12 text-secondary">
                        <i className="fas fa-cloud text-4xl mb-4 opacity-50"></i>
                        <p>暂无媒体库</p>
                    </div>
                )
            }

            {/* 表单弹窗 */}
            {
                showForm && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
                        <div className="bg-secondary rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar shadow-2xl border border-border-color">
                            <h2 className="text-xl font-bold text-primary mb-6 flex items-center gap-3">
                                {editingSource ? <i className="fas fa-edit text-blue-500"></i> : <i className="fas fa-plus-circle text-blue-500"></i>}
                                {editingSource ? '编辑媒体库' : '添加媒体库'}
                            </h2>

                            <div className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-secondary mb-2 text-xs uppercase tracking-wider">名称 *</label>
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                            placeholder="我的媒体库"
                                            className="w-full px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                                 border border-border-color focus:border-blue-500 focus:outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-secondary mb-2 text-xs uppercase tracking-wider">存储类型 *</label>
                                        <select
                                            value={formData.type}
                                            onChange={e => {
                                                const newType = e.target.value;
                                                setFormData(prev => ({
                                                    ...prev,
                                                    type: newType,
                                                    // WebDAV 默认开启代理以解决认证和播放问题
                                                    proxy_enabled: newType === 'webdav' ? true : (newType === 'local' ? false : prev.proxy_enabled)
                                                }));
                                            }}
                                            className="w-full px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                                 border border-border-color focus:border-blue-500 focus:outline-none transition-all"
                                        >
                                            <option value="alist">Alist / OpenList</option>
                                            <option value="webdav">WebDAV</option>
                                            <option value="local">本地目录</option>
                                        </select>
                                    </div>
                                </div>

                                {formData.type !== 'local' && (
                                    <>
                                        <div>
                                            <label className="block text-secondary mb-2 text-xs uppercase tracking-wider">地址 *</label>
                                            <input
                                                type="url"
                                                value={formData.url}
                                                onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                                                placeholder="http://192.168.1.100:5244"
                                                className="w-full px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                                     border border-border-color focus:border-blue-500 focus:outline-none transition-all"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-secondary mb-2 text-xs uppercase tracking-wider">用户名 (可选)</label>
                                                <input
                                                    type="text"
                                                    value={formData.username}
                                                    onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))}
                                                    placeholder="admin"
                                                    className="w-full px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                                         border border-border-color focus:border-blue-500 focus:outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-secondary mb-2 text-xs uppercase tracking-wider">密码 (可选)</label>
                                                <input
                                                    type="password"
                                                    value={formData.password}
                                                    onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                                                    placeholder={editingSource ? '留空保持不变' : '密码'}
                                                    className="w-full px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                                         border border-border-color focus:border-blue-500 focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {formData.type === 'local' && (
                                    <div>
                                        <label className="block text-secondary mb-2 text-xs uppercase tracking-wider">本地根路径 *</label>
                                        <input
                                            type="text"
                                            value={formData.root_path}
                                            onChange={e => setFormData(prev => ({ ...prev, root_path: e.target.value }))}
                                            placeholder="/home/media"
                                            className="w-full px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                                 border border-border-color focus:border-blue-500 focus:outline-none"
                                        />
                                        <p className="mt-1 text-[10px] text-secondary">后端可访问的绝对路径</p>
                                        <div className="mt-2 p-2 bg-orange-500/10 border border-orange-500/20 rounded text-[10px] text-orange-300/80">
                                            <span className="font-bold"><i className="fas fa-docker mr-1"></i>Docker 部署提示：</span>
                                            <span>需先在 docker-compose.yml 中映射宿主机目录，此处填写容器内的路径。</span>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-secondary mb-2 text-xs uppercase tracking-wider">备注</label>
                                    <textarea
                                        value={formData.remark}
                                        onChange={e => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                                        placeholder="用于辨识媒体库..."
                                        rows={2}
                                        className="w-full px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                             border border-border-color focus:border-blue-500 focus:outline-none resize-none"
                                    />
                                </div>

                                <div className="flex flex-wrap items-center gap-6 pt-2">
                                    <label className="flex items-center gap-2 text-sm text-primary cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={formData.enabled}
                                            onChange={e => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                                            className="w-4 h-4 rounded border-border-color bg-secondary text-blue-500 focus:ring-0 focus:ring-offset-0"
                                        />
                                        启用源
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-primary cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={formData.hidden}
                                            onChange={e => setFormData(prev => ({ ...prev, hidden: e.target.checked }))}
                                            className="w-4 h-4 rounded border-border-color bg-secondary text-blue-500 focus:ring-0 focus:ring-offset-0"
                                        />
                                        未登录隐藏
                                    </label>
                                    {formData.type !== 'local' && (
                                        <label className="flex items-center gap-2 text-sm text-primary cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={formData.proxy_enabled}
                                                onChange={e => setFormData(prev => ({ ...prev, proxy_enabled: e.target.checked }))}
                                                className="w-4 h-4 rounded border-border-color bg-secondary text-blue-500 focus:ring-0 focus:ring-offset-0"
                                            />
                                            启用图片/流代理
                                        </label>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-4 mt-8">
                                <button
                                    onClick={() => setShowForm(false)}
                                    className="flex-1 px-4 py-2.5 bg-secondary text-primary rounded-lg 
                                         hover:bg-gray-700 transition-colors border border-border-color"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving || !isFormValid()}
                                    className="flex-1 px-4 py-2.5 bg-blue-600 text-primary rounded-lg 
                                         hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-lg shadow-blue-900/20"
                                >
                                    {saving ? '正在保存...' : '确认保存'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 目录选择器 */}
            {
                pickerSourceId && (
                    <DirectoryPicker
                        sourceId={pickerSourceId}
                        isOpen={pickerOpen}
                        onClose={() => {
                            setPickerOpen(false);
                            setPickerSourceId(null);
                            setPickerEditIndex(-1);
                        }}
                        onSelect={(path, name) => {
                            const source = sources.find(s => s.id === pickerSourceId);
                            if (!source) return;

                            const currentPaths = Array.isArray(source.scan_paths) ? source.scan_paths : [];

                            if (pickerMode === 'add') {
                                // 添加新目录
                                handleUpdateScanPaths(source, [...currentPaths, { name, path, tmdb_enabled: false }]);
                                // 自动执行扫描任务
                                setTimeout(() => {
                                    handleScan(source.id, path);
                                }, 500);
                            } else if (pickerMode === 'edit' && pickerEditIndex >= 0) {
                                // 编辑现有目录路径
                                const next = [...currentPaths];
                                next[pickerEditIndex] = { ...next[pickerEditIndex], path, name: next[pickerEditIndex].name || name };
                                handleUpdateScanPaths(source, next);
                            }
                        }}
                    />
                )
            }

            {confirmDialog && (
                <ConfirmDialog
                    isOpen={confirmDialog.isOpen}
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmVariant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel || (() => setConfirmDialog(null))}
                >
                    {confirmDialog.children}
                </ConfirmDialog>
            )}

            {/* 提示对话框 */}
            {alertDialog && (
                <AlertDialog
                    isOpen={alertDialog.isOpen}
                    title={alertDialog.title}
                    message={alertDialog.message}
                    variant={alertDialog.variant}
                    onClose={() => setAlertDialog(null)}
                />
            )}
        </div >
    );
}
