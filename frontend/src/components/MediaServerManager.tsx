import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api';

interface MediaServer {
    id: number;
    name: string;
    url: string;
    type: 'emby' | 'jellyfin';
    api_key: string;
    user_id?: string;
    enabled: number;
    hidden: number;
    remark?: string;
    last_sync_at?: string;
}

interface MediaServerManagerProps {
    onServersChange?: () => void;
}

export function MediaServerManager({ onServersChange }: MediaServerManagerProps) {
    const [servers, setServers] = useState<MediaServer[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingServer, setEditingServer] = useState<Partial<MediaServer> | null>(null);
    const [testResults, setTestResults] = useState<Record<number, { status: string; message: string }>>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        loadServers();
    }, []);

    const loadServers = async () => {
        setLoading(true);
        try {
            const res = await apiGet<MediaServer[]>('/media-servers');
            if (res.success && res.data) {
                setServers(res.data);
            }
        } catch (error) {
            console.error('Failed to load media servers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingServer?.name || !editingServer?.url) return;

        setSaving(true);
        setSaveError(null);

        try {
            let res;
            if (editingServer.id) {
                res = await apiPut(`/media-servers/${editingServer.id}`, editingServer);
            } else {
                res = await apiPost('/media-servers', editingServer);
            }

            if (res.success) {
                setShowModal(false);
                setEditingServer(null);
                loadServers();
                onServersChange?.();
            } else {
                setSaveError(res.error || '保存失败');
            }
        } catch (error: any) {
            console.error('Failed to save media server:', error);
            setSaveError(error.message || '网络请求失败');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('确定要删除这个影视库服务器吗？')) return;
        try {
            const res = await apiDelete(`/media-servers/${id}`);
            if (res.success) {
                loadServers();
                onServersChange?.();
            }
        } catch (error) {
            console.error('Failed to delete media server:', error);
        }
    };

    const handleTest = async (id: number) => {
        setTestResults(prev => ({ ...prev, [id]: { status: 'testing', message: '正在测试...' } }));
        try {
            const res = await apiPost<any>(`/media-servers/${id}/test`);
            if (res.success) {
                setTestResults(prev => ({ ...prev, [id]: { status: 'success', message: '连接成功' } }));
            } else {
                setTestResults(prev => ({ ...prev, [id]: { status: 'error', message: res.error || '连接失败' } }));
            }
        } catch (error) {
            setTestResults(prev => ({ ...prev, [id]: { status: 'error', message: '请求失败' } }));
        }
    };

    if (loading && servers.length === 0) {
        return <div className="p-8 text-center text-secondary">加载中...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-bold text-primary">影视库服务器</h3>
                    <p className="text-xs text-secondary opacity-60">对接 Emby 或 Jellyfin 服务器，实现媒体聚合展示</p>
                </div>
                <button
                    onClick={() => {
                        setEditingServer({ type: 'emby', enabled: 1, hidden: 0 });
                        setShowModal(true);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-600/20"
                >
                    <i className="fas fa-plus mr-2"></i> 添加服务器
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {servers.map(server => (
                    <div key={server.id} className="glass-effect p-5 rounded-2xl border border-border-color hover:border-blue-500/30 transition-all group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${server.type === 'emby' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                    <i className={`fas ${server.type === 'emby' ? 'fa-play-circle' : 'fa-server'} text-xl`}></i>
                                </div>
                                <div>
                                    <h4 className="font-bold text-primary">{server.name}</h4>
                                    <span className="text-[10px] uppercase font-black opacity-40">{server.type}</span>
                                </div>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleTest(server.id)} title="测试连接" className="p-2 hover:bg-white/5 rounded-lg text-secondary hover:text-blue-400">
                                    <i className="fas fa-plug text-xs"></i>
                                </button>
                                <button onClick={() => { setEditingServer(server); setShowModal(true); }} title="编辑" className="p-2 hover:bg-white/5 rounded-lg text-secondary hover:text-primary">
                                    <i className="fas fa-edit text-xs"></i>
                                </button>
                                <button onClick={() => handleDelete(server.id)} title="删除" className="p-2 hover:bg-white/5 rounded-lg text-secondary hover:text-red-400">
                                    <i className="fas fa-trash text-xs"></i>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2 mb-4">
                            <div className="flex items-center gap-2 text-xs text-secondary bg-black/20 p-2 rounded-lg break-all">
                                <i className="fas fa-link opacity-40"></i>
                                <span className="truncate">{server.url}</span>
                            </div>
                        </div>

                        {testResults[server.id] && (
                            <div className={`text-[10px] font-bold px-2 py-1 rounded-md mb-3 w-fit ${testResults[server.id].status === 'success' ? 'bg-green-500/10 text-green-400' :
                                testResults[server.id].status === 'testing' ? 'bg-blue-500/10 text-blue-400' : 'bg-red-500/10 text-red-400'
                                }`}>
                                <i className={`fas ${testResults[server.id].status === 'success' ? 'fa-check-circle' : testResults[server.id].status === 'testing' ? 'fa-circle-notch fa-spin' : 'fa-exclamation-circle'} mr-1`}></i>
                                {testResults[server.id].message}
                            </div>
                        )}

                        <div className="flex items-center justify-between mt-auto pt-4 border-t border-border-color/30">
                            <div className="flex items-center gap-4 text-[10px] text-secondary opacity-50">
                                <span><i className="fas fa-sync-alt mr-1"></i> {server.last_sync_at ? new Date(server.last_sync_at).toLocaleString() : '从未同步'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-600'}`}></div>
                                {server.hidden === 1 && (
                                    <span className="px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded text-[8px] font-black uppercase">Hidden</span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                {servers.length === 0 && (
                    <div className="col-span-full py-12 text-center glass-effect rounded-3xl border border-dashed border-border-color">
                        <i className="fas fa-film text-4xl opacity-10 mb-4 block"></i>
                        <p className="text-secondary opacity-40">还没有添加任何影视库服务器</p>
                    </div>
                )}
            </div>

            {/* 编辑/添加 弹窗 */}
            {showModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                    <div className="glass-effect p-8 w-full max-w-lg rounded-3xl border border-border-color shadow-2xl animate-in zoom-in duration-300">
                        <h2 className="text-2xl font-black text-primary mb-6 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                                <i className="fas fa-server text-white text-sm"></i>
                            </div>
                            {editingServer?.id ? '编辑影视库' : '添加影视库'}
                        </h2>

                        <form onSubmit={handleSave} className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-secondary ml-1">服务器类型</label>
                                    <select
                                        value={editingServer?.type}
                                        onChange={e => setEditingServer({ ...editingServer, type: e.target.value as any })}
                                        className="w-full px-4 py-3 bg-white/5 border border-border-color rounded-xl text-primary focus:outline-none focus:border-blue-500 transition-all font-bold"
                                    >
                                        <option value="emby" className="bg-secondary text-primary">Emby</option>
                                        <option value="jellyfin" className="bg-secondary text-primary">Jellyfin</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-secondary ml-1">备注名称</label>
                                    <input
                                        type="text"
                                        value={editingServer?.name || ''}
                                        onChange={e => setEditingServer({ ...editingServer, name: e.target.value })}
                                        placeholder="如：我的 Emby"
                                        className="w-full px-4 py-3 bg-white/5 border border-border-color rounded-xl text-primary focus:outline-none focus:border-blue-500 transition-all"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-secondary ml-1">服务器地址 (URL)</label>
                                <input
                                    type="url"
                                    value={editingServer?.url || ''}
                                    onChange={e => setEditingServer({ ...editingServer, url: e.target.value })}
                                    placeholder="http://192.168.1.100:8096"
                                    className="w-full px-4 py-3 bg-white/5 border border-border-color rounded-xl text-primary focus:outline-none focus:border-blue-500 transition-all"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-secondary ml-1">API Key</label>
                                    <input
                                        type="password"
                                        value={editingServer?.api_key || ''}
                                        onChange={e => setEditingServer({ ...editingServer, api_key: e.target.value })}
                                        placeholder="Emby API 密钥"
                                        className="w-full px-4 py-3 bg-white/5 border border-border-color rounded-xl text-primary focus:outline-none focus:border-blue-500 transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-secondary ml-1">User ID (可选)</label>
                                    <input
                                        type="text"
                                        value={editingServer?.user_id || ''}
                                        onChange={e => setEditingServer({ ...editingServer, user_id: e.target.value })}
                                        placeholder="特定用户ID"
                                        className="w-full px-4 py-3 bg-white/5 border border-border-color rounded-xl text-primary focus:outline-none focus:border-blue-500 transition-all"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 py-1">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="server_enabled"
                                        checked={editingServer?.enabled === 1}
                                        onChange={e => setEditingServer({ ...editingServer, enabled: e.target.checked ? 1 : 0 })}
                                        className="w-4 h-4 rounded border-border-color text-blue-600 focus:ring-blue-500 bg-white/5"
                                    />
                                    <label htmlFor="server_enabled" className="text-sm font-bold text-primary cursor-pointer">启用服务器</label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="server_hidden"
                                        checked={editingServer?.hidden === 1}
                                        onChange={e => setEditingServer({ ...editingServer, hidden: e.target.checked ? 1 : 0 })}
                                        className="w-4 h-4 rounded border-border-color text-yellow-600 focus:ring-yellow-500 bg-white/5"
                                    />
                                    <label htmlFor="server_hidden" className="text-sm font-bold text-primary cursor-pointer">在主页隐藏</label>
                                </div>
                            </div>

                            {saveError && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs font-bold flex items-center gap-2">
                                    <i className="fas fa-exclamation-circle text-sm"></i>
                                    {saveError}
                                </div>
                            )}

                            <div className="flex gap-3 pt-4 border-t border-border-color/30">
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); setEditingServer(null); }}
                                    className="flex-1 px-4 py-3 bg-secondary hover:bg-tertiary text-primary rounded-xl font-bold transition-all"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                                >
                                    {saving ? (
                                        <>
                                            <i className="fas fa-circle-notch fa-spin"></i>
                                            正在保存...
                                        </>
                                    ) : (
                                        '保存设置'
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
