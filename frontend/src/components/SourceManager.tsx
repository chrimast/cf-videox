import { useState, useEffect, useRef } from 'react';
import { VideoSource } from '../types';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api';
import { ConfirmDialog } from './ConfirmDialog';
import { AlertDialog } from './AlertDialog';

interface SourceManagerProps {
    onSourcesChange?: () => void;
}

type StatusFilter = 'all' | 'enabled' | 'disabled';

export function SourceManager({ onSourcesChange }: SourceManagerProps) {
    const [sources, setSources] = useState<VideoSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // 对话框状态
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        variant?: 'danger' | 'primary';
    } | null>(null);
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        variant?: 'success' | 'error' | 'info' | 'warning';
    } | null>(null);

    // 筛选和搜索
    const [searchKeyword, setSearchKeyword] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    // 选择状态
    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    // 测速状态
    const [testingIds, setTestingIds] = useState<number[]>([]);

    // 同步分类状态
    const [syncingIds, setSyncingIds] = useState<number[]>([]);
    const [syncStatus, setSyncStatus] = useState<Record<number, { message: string; current: number; total: number }>>({});

    // 表单状态
    const [showForm, setShowForm] = useState(false);
    const [editingSource, setEditingSource] = useState<VideoSource | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        url: '',
        type: 'cms_api' as const,
        enabled: true,
        hidden: false,
        proxy_enabled: false,
        tags: '',
        remark: ''
    });

    // 导入状态
    const [showImportModal, setShowImportModal] = useState(false);
    const [importData, setImportData] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadSources();
    }, []);

    const loadSources = async () => {
        setLoading(true);
        const res = await apiGet<VideoSource[]>('/sources');
        if (res.success && res.data) {
            setSources(res.data);
        }
        setLoading(false);
    };

    // 筛选后的数据
    const filteredSources = sources.filter(source => {
        // 搜索过滤
        if (searchKeyword && !source.name.toLowerCase().includes(searchKeyword.toLowerCase())) {
            return false;
        }
        // 状态过滤
        if (statusFilter === 'enabled' && !source.enabled) return false;
        if (statusFilter === 'disabled' && source.enabled) return false;
        return true;
    });

    // 全选/取消全选
    const handleSelectAll = () => {
        if (selectedIds.length === filteredSources.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredSources.map(s => s.id));
        }
    };

    // 单个选择
    const handleSelect = (id: number) => {
        setSelectedIds(prev =>
            prev.includes(id)
                ? prev.filter(i => i !== id)
                : [...prev, id]
        );
    };

    // 添加源
    const handleAdd = () => {
        setEditingSource(null);
        setFormData({ name: '', url: '', type: 'cms_api', enabled: true, hidden: false, proxy_enabled: false, tags: '', remark: '' });
        setShowForm(true);
    };

    // 编辑源
    const handleEdit = (source: VideoSource) => {
        setEditingSource(source);
        setFormData({
            name: source.name,
            url: source.url,
            type: source.type as 'cms_api',
            enabled: !!source.enabled,
            hidden: !!source.hidden,
            proxy_enabled: !!source.proxy_enabled,
            tags: source.tags || '',
            remark: source.remark || ''
        });
        setShowForm(true);
    };

    // 保存
    const handleSave = async () => {
        setSaving(true);
        try {
            if (editingSource) {
                const res = await apiPut<VideoSource>(`/sources/${editingSource.id}`, formData);
                if (res.success && res.data) {
                    // 乐观更新本地状态，无需等待重新加载整个列表
                    setSources(prev => prev.map(s => s.id === editingSource.id ? res.data! : s));
                }
            } else {
                const res = await apiPost<VideoSource>('/sources', formData);
                if (res.success && res.data) {
                    setSources(prev => [res.data!, ...prev]);
                }
            }

            // 通知全局 (App.tsx)
            onSourcesChange?.();

            setShowForm(false);
        } catch (error) {
            alert('保存失败');
        }
        setSaving(false);
    };

    // 删除
    const handleDelete = (id: number, name: string) => {
        setConfirmDialog({
            isOpen: true,
            title: '确认删除',
            message: `确定要删除视频源"${name}"吗？`,
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                await apiDelete(`/sources/${id}`);
                setSources(prev => prev.filter(s => s.id !== id));
                onSourcesChange?.();
            }
        });
    };


    // 切换启用状态
    const handleToggleEnabled = async (source: VideoSource) => {
        const newStatus = !source.enabled;
        await apiPut(`/sources/${source.id}`, { enabled: newStatus });
        setSources(prev => prev.map(s =>
            s.id === source.id ? { ...s, enabled: newStatus ? 1 : 0 } : s
        ));
        onSourcesChange?.();


    };

    // 切换隐藏状态
    const handleToggleHidden = async (source: VideoSource) => {
        await apiPut(`/sources/${source.id}`, { hidden: !source.hidden });
        setSources(prev => prev.map(s =>
            s.id === source.id ? { ...s, hidden: s.hidden ? 0 : 1 } : s
        ));
        onSourcesChange?.();
    };

    // 测速
    const handleTest = async (source: VideoSource) => {
        setTestingIds(prev => [...prev, source.id]);
        try {
            const res = await apiPost<{ responseTime: number }>(`/sources/${source.id}/test`);
            if (res.success) {
                await loadSources();
            } else {
                alert(`测速失败: ${res.error}`);
            }
        } catch {
            alert('测速失败');
        }
        setTestingIds(prev => prev.filter(id => id !== source.id));
    };

    // 同步分类
    const handleSync = async (source: VideoSource) => {
        setSyncingIds(prev => [...prev, source.id]);
        setSyncStatus(prev => ({
            ...prev,
            [source.id]: { message: '正在初始化...', current: 0, total: 100 }
        }));

        try {
            const token = localStorage.getItem('auth_token');
            const adminPassword = localStorage.getItem('video_admin_auth');
            const url = new URL(`${window.location.origin}/api/sources/${source.id}/sync`);
            url.searchParams.append('stream', 'true');

            const response = await fetch(url.toString(), {
                method: 'POST',
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    ...(adminPassword ? { 'X-Admin-Password': adminPassword } : {}),
                    'X-No-Compression': 'true'
                }
            });

            if (!response.body) throw new Error('ReadableStream not supported');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.replace('data: ', '').trim();
                        if (dataStr === '[DONE]') continue;

                        try {
                            const prog = JSON.parse(dataStr);
                            if (prog.type === 'progress') {
                                setSyncStatus(prev => ({
                                    ...prev,
                                    [source.id]: { message: prog.message, current: prog.current, total: prog.total }
                                }));
                            } else if (prog.type === 'error') {
                                alert(`同步错误: ${prog.error}`);
                            }
                        } catch (e) {
                            console.error('[Sync] Failed to parse SSE data:', e);
                        }
                    }
                }
            }
            // alert(`"${source.name}" 分类同步完成！`);
        } catch (err: any) {
            console.error('[Sync] Failed:', err);
            alert(`同步失败: ${err.message || '网络错误'}`);
        } finally {
            setSyncingIds(prev => prev.filter(id => id !== source.id));
            setSyncStatus(prev => {
                const next = { ...prev };
                delete next[source.id];
                return next;
            });
        }
    };

    // 批量操作
    const handleBatchUpdate = async (updates: { enabled?: boolean; hidden?: boolean }) => {
        if (selectedIds.length === 0) {
            alert('请先选择要操作的视频源');
            return;
        }
        await apiPost('/sources/batch-update', { ids: selectedIds, updates });
        await loadSources();
        setSelectedIds([]);
        onSourcesChange?.();
    };

    const handleBatchDelete = () => {
        if (selectedIds.length === 0) {
            setAlertDialog({
                isOpen: true,
                title: '提示',
                message: '请先选择要删除的视频源',
                variant: 'warning'
            });
            return;
        }
        setConfirmDialog({
            isOpen: true,
            title: '批量删除',
            message: `确定要删除选中的 ${selectedIds.length} 个视频源吗？`,
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                await apiPost('/sources/batch-delete', { ids: selectedIds });
                await loadSources();
                setSelectedIds([]);
                onSourcesChange?.();
            }
        });
    };


    const handleBatchTest = async () => {
        if (selectedIds.length === 0) {
            alert('请先选择要测速的视频源');
            return;
        }
        setTestingIds(selectedIds);
        await apiPost('/sources/batch-test', { ids: selectedIds });
        await loadSources();
        setTestingIds([]);
    };

    // 导出
    const handleExport = async () => {
        const res = await apiGet<VideoSource[]>('/sources/export');
        if (res.success && res.data) {
            const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'video_sources.json';
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    // 导入
    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            setImportData(evt.target?.result as string);
            setShowImportModal(true);
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleImportConfirm = async (mode: 'append' | 'replace') => {
        try {
            const parsed = JSON.parse(importData);
            const sourcesToImport = parsed.data || parsed;

            await apiPost('/sources/import', { sources: sourcesToImport, mode });
            await loadSources();
            setShowImportModal(false);
            setImportData('');
            onSourcesChange?.();
            alert('导入成功');
        } catch (error) {
            alert('导入失败，请检查文件格式');
        }
    };

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
                {/* 搜索 */}
                <div className="relative flex-1 min-w-[200px]">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-secondary"></i>
                    <input
                        type="text"
                        placeholder="搜索站点名称..."
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                 focus:border-red-500 focus:outline-none"
                    />
                </div>

                {/* 状态筛选 */}
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                    className="px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                             focus:border-red-500 focus:outline-none"
                >
                    <option value="all">全部状态</option>
                    <option value="enabled">已启用</option>
                    <option value="disabled">已禁用</option>
                </select>

                {/* 操作按钮 */}
                <button
                    onClick={handleAdd}
                    className="px-4 py-2 bg-red-500 rounded-lg hover:bg-red-600 
                             transition-colors flex items-center gap-2"
                    style={{ color: '#fff' }}
                >
                    <i className="fas fa-plus"></i>
                    添加
                </button>

                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 
                             transition-colors flex items-center gap-2"
                >
                    <i className="fas fa-file-import"></i>
                    导入
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportFile}
                    className="hidden"
                />

                <button
                    onClick={handleExport}
                    className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 
                             transition-colors flex items-center gap-2"
                >
                    <i className="fas fa-file-export"></i>
                    导出
                </button>
            </div>

            {/* 批量操作栏 */}
            {selectedIds.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center p-3 bg-secondary/50 rounded-lg border border-border-color">
                    <span className="text-secondary">已选择 {selectedIds.length} 项</span>
                    <button
                        onClick={() => handleBatchUpdate({ enabled: true })}
                        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-500 text-sm"
                    >
                        批量启用
                    </button>
                    <button
                        onClick={() => handleBatchUpdate({ enabled: false })}
                        className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-500 text-sm"
                    >
                        批量禁用
                    </button>
                    <button
                        onClick={() => handleBatchUpdate({ hidden: true })}
                        className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-500 text-sm"
                    >
                        批量隐藏
                    </button>
                    <button
                        onClick={() => handleBatchUpdate({ hidden: false })}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm"
                    >
                        批量显示
                    </button>
                    <button
                        onClick={handleBatchTest}
                        className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500 text-sm"
                    >
                        批量测试
                    </button>
                    <button
                        onClick={handleBatchDelete}
                        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 text-sm"
                    >
                        批量删除
                    </button>
                </div>
            )}

            {/* 📱 移动端卡片视图 */}
            <div className="md:hidden space-y-3">
                {filteredSources.map(source => (
                    <div
                        key={source.id}
                        className={`bg-secondary/30 rounded-lg border border-border-color p-3 ${!source.enabled ? 'opacity-50' : ''}`}
                    >
                        {/* 顶部：选择框 + 名称 + 状态标签 */}
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(source.id)}
                                onChange={() => handleSelect(source.id)}
                                className="rounded"
                            />
                            <span className="text-primary font-medium flex-1 truncate">{source.name}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold text-white ${source.enabled ? 'bg-green-600' : 'bg-gray-500'}`}>
                                {source.enabled ? '启用' : '禁用'}
                            </span>
                        </div>

                        {/* 地址 */}
                        <div className="text-secondary text-xs truncate mb-2" title={source.url}>
                            <i className="fas fa-link mr-1 opacity-50"></i>{source.url}
                        </div>

                        {/* 标签和状态 */}
                        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                            {source.proxy_enabled && (
                                <span className="px-1.5 py-0.5 bg-purple-600 text-white rounded text-[10px]">代理</span>
                            )}
                            {source.hidden && (
                                <span className="px-1.5 py-0.5 bg-orange-500 text-white rounded text-[10px]">隐藏</span>
                            )}
                            {source.tags && source.tags.split(',').filter(Boolean).map((tag, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-secondary text-primary rounded text-[10px] border border-border-color">
                                    {tag.trim()}
                                </span>
                            ))}
                            {/* 延迟 */}
                            {testingIds.includes(source.id) ? (
                                <span className="text-yellow-400"><i className="fas fa-spinner fa-spin"></i></span>
                            ) : source.response_time ? (
                                <span className={`${source.response_time < 500 ? 'text-green-400' : source.response_time < 1000 ? 'text-yellow-400' : 'text-red-400'}`}>
                                    {source.response_time}ms
                                </span>
                            ) : null}
                            {/* 健康 */}
                            {source.failure_count && source.failure_count > 0 ? (
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${source.failure_count >= 5 ? 'bg-red-500/20 text-red-400' : source.failure_count >= 3 ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                    失败 {source.failure_count}
                                </span>
                            ) : (
                                <span className="px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px]">健康</span>
                            )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1 pt-2 border-t border-border-color">
                            <button onClick={() => handleTest(source)} disabled={testingIds.includes(source.id)} className="flex-1 py-1.5 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors disabled:opacity-50">
                                <i className="fas fa-tachometer-alt mr-1"></i>测速
                            </button>
                            <button onClick={() => handleSync(source)} disabled={syncingIds.includes(source.id)} className="flex-1 py-1.5 text-xs bg-cyan-500 text-white rounded hover:bg-cyan-600 transition-colors disabled:opacity-50">
                                <i className={`fas fa-sync mr-1 ${syncingIds.includes(source.id) ? 'fa-spin' : ''}`}></i>同步
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
                                    className="rounded"
                                />
                            </th>
                            <th className="p-3">站点名称</th>
                            <th className="p-3 w-20">状态</th>
                            <th className="p-3 w-20">代理</th>
                            <th className="p-3 w-20">隐藏</th>
                            <th className="p-3">接口地址</th>
                            <th className="p-3 w-24">标签</th>
                            <th className="p-3 w-24">备注</th>
                            <th className="p-3 w-40">健康状态</th>
                            <th className="p-3 w-48">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSources.map(source => (
                            <tr
                                key={source.id}
                                className={`border-b border-border-color hover:bg-secondary/50 transition-colors
                                          ${!source.enabled ? 'opacity-50' : ''}`}
                            >
                                <td className="p-3">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.includes(source.id)}
                                        onChange={() => handleSelect(source.id)}
                                        className="rounded"
                                    />
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
                                    <span
                                        className={`px-2 py-1 rounded text-xs font-medium ${source.proxy_enabled
                                            ? 'bg-purple-600'
                                            : 'bg-gray-500'
                                            }`}
                                        style={{ color: '#fff' }}
                                    >
                                        {source.proxy_enabled ? '开启' : '关闭'}
                                    </span>
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
                                    <span className="text-secondary text-xs truncate block max-w-xs" title={source.url}>
                                        {source.url}
                                    </span>
                                </td>
                                <td className="p-3">
                                    {source.tags && (
                                        <div className="flex flex-wrap gap-1">
                                            {source.tags.split(',').filter(Boolean).map((tag, i) => (
                                                <span key={i} className="px-1.5 py-0.5 bg-secondary text-primary rounded text-xs border border-border-color">
                                                    {tag.trim()}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </td>
                                <td className="p-3">
                                    <span className="text-secondary text-xs">{source.remark}</span>
                                </td>
                                <td className="p-3">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-1.5">
                                            {testingIds.includes(source.id) ? (
                                                <span className="text-yellow-400 text-xs">
                                                    <i className="fas fa-spinner fa-spin mr-1"></i>
                                                </span>
                                            ) : source.response_time ? (
                                                <span className={`text-xs ${source.response_time < 500 ? 'text-green-400' :
                                                    source.response_time < 1000 ? 'text-yellow-400' : 'text-red-400'
                                                    }`}>
                                                    {source.response_time}ms
                                                </span>
                                            ) : (
                                                <span className="text-secondary text-xs">-</span>
                                            )}

                                            {/* 健康状态标识 */}
                                            {source.failure_count && source.failure_count > 0 ? (
                                                <span
                                                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${source.failure_count >= 5 ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                                        source.failure_count >= 3 ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                                                            'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                                        }`}
                                                    title={source.status_message || '未知错误'}
                                                >
                                                    失败 {source.failure_count}
                                                </span>
                                            ) : (
                                                <span className="px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-[10px]">
                                                    健康
                                                </span>
                                            )}
                                        </div>
                                        {source.status_message && (
                                            <span className="text-[10px] text-secondary truncate max-w-[100px]" title={source.status_message}>
                                                {source.status_message}
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="p-3">
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => handleTest(source)}
                                            disabled={testingIds.includes(source.id)}
                                            className="p-1.5 text-secondary hover:text-purple-400 transition-colors disabled:opacity-50"
                                            title="测速"
                                        >
                                            <i className="fas fa-tachometer-alt"></i>
                                        </button>
                                        <button
                                            onClick={() => handleSync(source)}
                                            disabled={syncingIds.includes(source.id)}
                                            className="p-1.5 text-secondary hover:text-cyan-400 transition-colors disabled:opacity-50 relative group/sync"
                                            title="同步分类"
                                        >
                                            <i className={`fas fa-sync ${syncingIds.includes(source.id) ? 'fa-spin text-cyan-400' : ''}`}></i>
                                            {syncingIds.includes(source.id) && syncStatus[source.id] && (
                                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[200px] z-[60] 
                                                              bg-secondary border border-border-color rounded-lg p-3 shadow-2xl pointer-events-none">
                                                    <div className="text-xs text-primary mb-2 truncate">
                                                        {syncStatus[source.id].message}
                                                    </div>
                                                    <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                                                        <div
                                                            className="bg-cyan-500 h-full transition-all duration-300"
                                                            style={{
                                                                width: `${Math.round((syncStatus[source.id].current / syncStatus[source.id].total) * 100)}%`
                                                            }}
                                                        ></div>
                                                    </div>
                                                    <div className="text-[10px] text-secondary mt-1 text-right">
                                                        {syncStatus[source.id].current} / {syncStatus[source.id].total}
                                                    </div>
                                                </div>
                                            )}
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
                                            onClick={() => handleToggleHidden(source)}
                                            className={`p-1.5 transition-colors ${source.hidden ? 'text-orange-400 hover:text-orange-300' : 'text-secondary hover:text-secondary'
                                                }`}
                                            title={source.hidden ? '显示' : '隐藏'}
                                        >
                                            <i className={`fas fa-${source.hidden ? 'eye-slash' : 'eye'}`}></i>
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
                        ))}
                    </tbody>
                </table>
            </div>

            {
                filteredSources.length === 0 && (
                    <div className="text-center py-12 text-secondary">
                        <i className="fas fa-database text-4xl mb-4 opacity-50"></i>
                        <p>暂无视频源</p>
                    </div>
                )

            }

            {/* 表单弹窗 */}
            {
                showForm && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                        <div className="bg-secondary rounded-xl p-6 w-full max-w-md">
                            <h2 className="text-xl font-bold text-primary mb-4">
                                {editingSource ? '编辑视频源' : '添加视频源'}
                            </h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-primary mb-2">名称 *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="如：非凡资源"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg 
                                             border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-primary mb-2">API 地址 *</label>
                                    <input
                                        type="url"
                                        value={formData.url}
                                        onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                                        placeholder="如：https://ffzy5.tv/api.php/provide/vod"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg 
                                             border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>


                                <div>
                                    <label className="block text-primary mb-2">标签</label>
                                    <input
                                        type="text"
                                        value={formData.tags}
                                        onChange={e => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                                        placeholder="逗号分隔，如：高速,稳定"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg 
                                             border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-primary mb-2">备注</label>
                                    <textarea
                                        value={formData.remark}
                                        onChange={e => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                                        placeholder="备注信息..."
                                        rows={2}
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg 
                                             border border-border-color focus:border-red-500 focus:outline-none resize-none"
                                    />
                                </div>

                                <div className="flex items-center gap-6">
                                    <label className="flex items-center gap-2 text-primary cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.enabled}
                                            onChange={e => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                                            className="rounded"
                                        />
                                        启用
                                    </label>
                                    <label className="flex items-center gap-2 text-primary cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.hidden}
                                            onChange={e => setFormData(prev => ({ ...prev, hidden: e.target.checked }))}
                                            className="rounded"
                                        />
                                        隐藏
                                    </label>
                                    <label className="flex items-center gap-2 text-primary cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.proxy_enabled}
                                            onChange={e => setFormData(prev => ({ ...prev, proxy_enabled: e.target.checked }))}
                                            className="rounded"
                                        />
                                        启用代理
                                    </label>
                                </div>
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => setShowForm(false)}
                                    className="flex-1 px-4 py-2 bg-secondary text-primary rounded-lg 
                                         hover:bg-gray-700 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving || !formData.name || !formData.url}
                                    className="flex-1 px-4 py-2 bg-red-500 text-primary rounded-lg 
                                         hover:bg-red-600 transition-colors disabled:opacity-50"
                                >
                                    {saving ? '保存中...' : '保存'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 导入确认弹窗 */}
            {
                showImportModal && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                        <div className="bg-secondary rounded-xl p-6 w-full max-w-md">
                            <h2 className="text-xl font-bold text-primary mb-4">导入视频源</h2>
                            <p className="text-secondary mb-4">请选择导入方式：</p>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => handleImportConfirm('append')}
                                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg 
                                         hover:bg-blue-600 transition-colors"
                                >
                                    追加导入
                                </button>
                                <button
                                    onClick={() => handleImportConfirm('replace')}
                                    className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg 
                                         hover:bg-orange-600 transition-colors"
                                >
                                    替换导入
                                </button>
                            </div>
                            <button
                                onClick={() => { setShowImportModal(false); setImportData(''); }}
                                className="w-full mt-3 px-4 py-2 bg-secondary text-primary rounded-lg 
                                     hover:bg-gray-700 transition-colors"
                            >
                                取消
                            </button>
                        </div>
                    </div>
                )
            }

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
