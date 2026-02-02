import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api';
import { ConfirmDialog } from './ConfirmDialog';
import { AlertDialog } from './AlertDialog';

interface LiveSource {
    id: number;
    name: string;
    platform: string;
    channel_id: string;
    streamer_name?: string;
    category?: string;
    cover_url?: string;
    enabled: number;
    sort_order: number;
    tags?: string;
    remark?: string;
}

interface LiveSourceManagerProps {
    onSourcesChange?: () => void;
}

type StatusFilter = 'all' | 'enabled' | 'disabled';
type PlatformFilter = 'all' | 'bilibili' | 'douyin' | 'douyu' | 'youtube' | 'yy' | 'huya';

const PLATFORMS = [
    { value: 'bilibili', label: 'B站', color: 'text-pink-400' },
    { value: 'douyin', label: '抖音', color: 'text-red-400' },
];

export function LiveSourceManager({ onSourcesChange }: LiveSourceManagerProps) {
    const [sources, setSources] = useState<LiveSource[]>([]);
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
    const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');

    // 选择状态
    const [selectedIds, setSelectedIds] = useState<number[]>([]);


    // 表单状态
    const [showForm, setShowForm] = useState(false);
    const [editingSource, setEditingSource] = useState<LiveSource | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        platform: 'bilibili',
        channel_id: '',
        streamer_name: '',
        category: '',
        cover_url: '',
        enabled: 1,
        sort_order: 0,
        tags: '',
        remark: ''
    });

    useEffect(() => {
        loadSources();
    }, []);

    const loadSources = async () => {
        setLoading(true);
        try {
            const res = await apiGet<LiveSource[]>('/live/sources');
            if (res.success && res.data) {
                setSources(res.data);
            }
        } catch (error) {
            console.error('Failed to load live sources:', error);
        } finally {
            setLoading(false);
        }
    };

    // 筛选后的数据
    const filteredSources = sources.filter(source => {
        // 搜索过滤
        if (searchKeyword) {
            const keyword = searchKeyword.toLowerCase();
            if (!source.name.toLowerCase().includes(keyword) &&
                !source.streamer_name?.toLowerCase().includes(keyword)) {
                return false;
            }
        }
        // 状态过滤
        if (statusFilter === 'enabled' && !source.enabled) return false;
        if (statusFilter === 'disabled' && source.enabled) return false;
        // 平台过滤
        if (platformFilter !== 'all' && source.platform !== platformFilter) return false;
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
        setFormData({
            name: '',
            platform: 'bilibili',
            channel_id: '',
            streamer_name: '',
            category: '',
            cover_url: '',
            enabled: 1,
            sort_order: sources.length + 1,
            tags: '',
            remark: ''
        });
        setShowForm(true);
    };

    // 编辑源
    const handleEdit = (source: LiveSource) => {
        setEditingSource(source);
        setFormData({
            name: source.name,
            platform: source.platform,
            channel_id: source.channel_id,
            streamer_name: source.streamer_name || '',
            category: source.category || '',
            cover_url: source.cover_url || '',
            enabled: source.enabled,
            sort_order: source.sort_order,
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
                await apiPut(`/live/sources/${editingSource.id}`, formData);
            } else {
                await apiPost('/live/sources', formData);
            }
            await loadSources();
            setShowForm(false);
            onSourcesChange?.();
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
            message: `确定要删除直播源"${name}"吗？`,
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                await apiDelete(`/live/sources/${id}`);
                setSources(prev => prev.filter(s => s.id !== id));
                onSourcesChange?.();
            }
        });
    };

    // 切换启用状态
    const handleToggleEnabled = async (source: LiveSource) => {
        await apiPut(`/live/sources/${source.id}`, { enabled: source.enabled ? 0 : 1 });
        setSources(prev => prev.map(s =>
            s.id === source.id ? { ...s, enabled: s.enabled ? 0 : 1 } : s
        ));
        onSourcesChange?.();
    };

    // 刷新直播状态
    const handleRefresh = async (id: number) => {
        try {
            await apiPost(`/live/refresh/${id}`, {});
            alert('刷新成功');
        } catch (error) {
            console.error('Failed to refresh source:', error);
            alert('刷新失败');
        }
    };

    // 批量操作
    const handleBatchUpdate = async (updates: { enabled?: number }) => {
        if (selectedIds.length === 0) {
            alert('请先选择要操作的直播源');
            return;
        }
        await apiPost('/live/sources/batch-update', { ids: selectedIds, updates });
        await loadSources();
        setSelectedIds([]);
        onSourcesChange?.();
    };

    const handleBatchDelete = () => {
        if (selectedIds.length === 0) {
            setAlertDialog({
                isOpen: true,
                title: '提示',
                message: '请先选择要删除的直播源',
                variant: 'warning'
            });
            return;
        }
        setConfirmDialog({
            isOpen: true,
            title: '批量删除',
            message: `确定要删除选中的 ${selectedIds.length} 个直播源吗？`,
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(null);
                await apiPost('/live/sources/batch-delete', { ids: selectedIds });
                await loadSources();
                setSelectedIds([]);
                onSourcesChange?.();
            }
        });
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
                        placeholder="搜索直播源或主播..."
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                 focus:border-red-500 focus:outline-none"
                    />
                </div>

                {/* 平台筛选 */}
                <select
                    value={platformFilter}
                    onChange={e => setPlatformFilter(e.target.value as PlatformFilter)}
                    className="px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                             focus:border-red-500 focus:outline-none"
                >
                    <option value="all">全部平台</option>
                    {PLATFORMS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                </select>

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

                {/* 添加按钮 */}
                <button
                    onClick={handleAdd}
                    className="px-4 py-2 bg-red-500 rounded-lg hover:bg-red-600 
                             transition-colors flex items-center gap-2"
                    style={{ color: '#fff' }}
                >
                    <i className="fas fa-plus"></i>
                    添加
                </button>
            </div>

            {/* 批量操作栏 */}
            {selectedIds.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center p-3 bg-secondary/50 rounded-lg border border-border-color">
                    <span className="text-secondary">已选择 {selectedIds.length} 项</span>
                    <button
                        onClick={() => handleBatchUpdate({ enabled: 1 })}
                        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-500 text-sm"
                    >
                        批量启用
                    </button>
                    <button
                        onClick={() => handleBatchUpdate({ enabled: 0 })}
                        className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-500 text-sm"
                    >
                        批量禁用
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
                        {/* 顶部：选择框 + 名称 + 状态 */}
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(source.id)}
                                onChange={() => handleSelect(source.id)}
                                className="rounded"
                            />
                            <span className="text-primary font-medium flex-1 truncate">{source.name}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${source.enabled ? 'bg-green-600' : 'bg-gray-500'}`} style={{ color: '#fff' }}>
                                {source.enabled ? '启用' : '禁用'}
                            </span>
                        </div>

                        {/* 主播和平台 */}
                        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${source.platform === 'bilibili' ? 'bg-pink-500' : 'bg-red-500'}`} style={{ color: '#fff' }}>
                                {PLATFORMS.find(p => p.value === source.platform)?.label || source.platform}
                            </span>
                            {source.streamer_name && (
                                <span className="text-secondary"><i className="fas fa-user mr-1 opacity-50"></i>{source.streamer_name}</span>
                            )}
                            {source.category && (
                                <span className="text-secondary"><i className="fas fa-tag mr-1 opacity-50"></i>{source.category}</span>
                            )}
                        </div>

                        {/* 频道ID */}
                        <div className="text-secondary text-xs mb-2">
                            <i className="fas fa-hashtag mr-1 opacity-50"></i>频道: {source.channel_id}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1 pt-2 border-t border-border-color">
                            <button onClick={() => handleRefresh(source.id)} className="flex-1 py-1.5 text-xs bg-cyan-500 text-white rounded hover:bg-cyan-600 transition-colors">
                                <i className="fas fa-sync-alt mr-1"></i>刷新
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
                            <th className="p-3">直播源名称</th>
                            <th className="p-3">主播</th>
                            <th className="p-3 w-24">平台</th>
                            <th className="p-3">频道ID</th>
                            <th className="p-3">分类</th>
                            <th className="p-3 w-20">状态</th>
                            <th className="p-3 w-20">排序</th>
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
                                    <span className="text-secondary text-sm">{source.streamer_name || '-'}</span>
                                </td>
                                <td className="p-3">
                                    <span
                                        className={`px-2 py-1 rounded text-xs font-medium ${source.platform === 'bilibili' ? 'bg-pink-500' : 'bg-red-500'}`}
                                        style={{ color: '#fff' }}
                                    >
                                        {PLATFORMS.find(p => p.value === source.platform)?.label || source.platform}
                                    </span>
                                </td>
                                <td className="p-3">
                                    <span className="text-secondary text-xs">{source.channel_id}</span>
                                </td>
                                <td className="p-3">
                                    <span className="text-secondary text-sm">{source.category || '-'}</span>
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
                                <td className="p-3 text-secondary">{source.sort_order}</td>
                                <td className="p-3">
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => handleRefresh(source.id)}
                                            className="p-1.5 text-secondary hover:text-cyan-400 transition-colors"
                                            title="检查直播状态"
                                        >
                                            <i className="fas fa-sync-alt"></i>
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
                        ))}
                    </tbody>
                </table>
            </div>

            {filteredSources.length === 0 && (
                <div className="text-center py-12 text-secondary">
                    <i className="fas fa-broadcast-tower text-4xl mb-4 opacity-50"></i>
                    <p>暂无直播源</p>
                </div>
            )}


            {/* 表单弹窗 */}
            {showForm && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-secondary rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold text-primary mb-4">
                            {editingSource ? '编辑直播源' : '添加直播源'}
                        </h2>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-primary mb-2">直播源名称 *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="如：某某直播间"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-primary mb-2">主播名称</label>
                                    <input
                                        type="text"
                                        value={formData.streamer_name}
                                        onChange={e => setFormData(prev => ({ ...prev, streamer_name: e.target.value }))}
                                        placeholder="主播昵称"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-primary mb-2">平台 *</label>
                                    <select
                                        value={formData.platform}
                                        onChange={e => setFormData(prev => ({ ...prev, platform: e.target.value }))}
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                    >
                                        {PLATFORMS.map(p => (
                                            <option key={p.value} value={p.value}>{p.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-primary mb-2">频道ID/房间号 *</label>
                                    <input
                                        type="text"
                                        value={formData.channel_id}
                                        onChange={e => setFormData(prev => ({ ...prev, channel_id: e.target.value }))}
                                        placeholder="如：123456"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-primary mb-2">封面图 URL</label>
                                <input
                                    type="url"
                                    value={formData.cover_url}
                                    onChange={e => setFormData(prev => ({ ...prev, cover_url: e.target.value }))}
                                    placeholder="https://example.com/cover.jpg"
                                    className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-primary mb-2">分类</label>
                                    <input
                                        type="text"
                                        value={formData.category}
                                        onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                                        placeholder="如：游戏、娱乐"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-primary mb-2">排序</label>
                                    <input
                                        type="number"
                                        value={formData.sort_order}
                                        onChange={e => setFormData(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-primary mb-2">标签（逗号分隔）</label>
                                <input
                                    type="text"
                                    value={formData.tags}
                                    onChange={e => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                                    placeholder="如：热门,推荐"
                                    className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-primary mb-2">备注</label>
                                <textarea
                                    value={formData.remark}
                                    onChange={e => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                                    rows={3}
                                    className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color focus:border-red-500 focus:outline-none"
                                />
                            </div>

                            <div className="flex items-center gap-6">
                                <label className="flex items-center gap-2 text-primary cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.enabled === 1}
                                        onChange={e => setFormData(prev => ({ ...prev, enabled: e.target.checked ? 1 : 0 }))}
                                        className="rounded"
                                    />
                                    启用
                                </label>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowForm(false)}
                                className="flex-1 px-4 py-2 bg-secondary text-primary rounded-lg hover:bg-gray-700 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || !formData.name || !formData.platform || !formData.channel_id}
                                className="flex-1 px-4 py-2 bg-red-500 text-primary rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                                {saving ? '保存中...' : '保存'}
                            </button>
                        </div>
                    </div>
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
        </div>
    );
}
