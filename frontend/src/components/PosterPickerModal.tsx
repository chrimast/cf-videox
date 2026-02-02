import { useState, useEffect, useRef } from 'react';
import { apiPost, apiGet } from '../utils/api';

interface Poster {
    path: string;
    preview: string;
    full: string;
    width: number;
    height: number;
    vote_average: number;
}

interface PosterPickerModalProps {
    mediaId: number;
    title: string;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function PosterPickerModal({ mediaId, title, isOpen, onClose, onSuccess }: PosterPickerModalProps) {
    const [activeTab, setActiveTab] = useState<'search' | 'upload'>('search');
    const [posters, setPosters] = useState<Poster[]>([]);
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen && activeTab === 'search') {
            loadPosters();
        }
    }, [isOpen, activeTab]);

    const loadPosters = async () => {
        setLoading(true);
        try {
            const res = await apiGet<Poster[]>(`/netdisk/media/${mediaId}/posters`);
            if (res.success && res.data) {
                setPosters(res.data);
            }
        } catch (err) {
            console.error('Failed to load posters:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleApplyPoster = async (posterUrl: string) => {
        setApplying(posterUrl);
        try {
            const res = await apiPost(`/netdisk/media/${mediaId}/update-poster`, { posterUrl });
            if (res.success) {
                onSuccess();
                onClose();
            }
        } catch (err) {
            alert('应用海报失败');
        } finally {
            setApplying(null);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            // 注意：apiPost 可能需要处理 FormData
            const response = await fetch(`${(window as any).API_BASE_URL || ''}/api/netdisk/media/${mediaId}/upload-poster`, {
                method: 'POST',
                body: formData,
                headers: {
                    'x-admin-password': localStorage.getItem('admin_password') || ''
                }
            });
            const res = await response.json();
            if (res.success) {
                onSuccess();
                onClose();
            } else {
                alert(res.error || '上传失败');
            }
        } catch (err) {
            alert('上传请求异常');
        } finally {
            setUploading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-300">
            <div className="bg-secondary border border-border-color rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                {/* 头部 */}
                <div className="px-6 py-4 border-b border-border-color flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                            <i className="fas fa-image text-blue-400"></i>
                            更换封面
                        </h2>
                        <p className="text-secondary/60 text-xs mt-1 truncate max-w-md">当前媒体：{title}</p>
                    </div>
                    <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
                        <i className="fas fa-times text-lg"></i>
                    </button>
                </div>

                {/* 标签页渲染 */}
                <div className="flex border-b border-border-color px-6">
                    <button
                        onClick={() => setActiveTab('search')}
                        className={`px-6 py-3 text-sm font-bold transition-all relative ${activeTab === 'search' ? 'text-blue-500' : 'text-secondary hover:text-primary'}`}
                    >
                        TMDB 库搜索
                        {activeTab === 'search' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 rounded-t-full"></div>}
                    </button>
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`px-6 py-3 text-sm font-bold transition-all relative ${activeTab === 'upload' ? 'text-blue-500' : 'text-secondary hover:text-primary'}`}
                    >
                        手动上传
                        {activeTab === 'upload' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 rounded-t-full"></div>}
                    </button>
                </div>

                {/* 内容区域 */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {activeTab === 'search' ? (
                        loading ? (
                            <div className="py-20 text-center text-secondary">
                                <i className="fas fa-spinner fa-spin text-4xl mb-4 text-blue-500"></i>
                                <p>正在从 TMDB 获取精选海报...</p>
                            </div>
                        ) : posters.length === 0 ? (
                            <div className="py-20 text-center text-secondary opacity-40">
                                <i className="fas fa-images text-6xl mb-4"></i>
                                <p>该影视在 TMDB 上暂无海报数据</p>
                                <button onClick={() => setActiveTab('upload')} className="mt-4 text-blue-500 font-bold hover:underline">去手动上传封面</button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {posters.map((p, idx) => (
                                    <div
                                        key={idx}
                                        className="group relative aspect-[2/3] bg-tertiary/20 rounded-xl overflow-hidden border border-border-color hover:border-blue-500/50 transition-all cursor-pointer"
                                        onClick={() => !applying && handleApplyPoster(p.full)}
                                    >
                                        <img src={p.preview} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="poster" />
                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-3 text-center">
                                            <span className="text-white text-xs font-bold mb-2">{p.width} x {p.height}</span>
                                            <button
                                                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black shadow-lg"
                                                disabled={!!applying}
                                            >
                                                {applying === p.full ? <i className="fas fa-circle-notch fa-spin"></i> : '应用此封面'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    ) : (
                        <div className="max-w-xl mx-auto py-10">
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed border-border-color rounded-3xl p-12 text-center transition-all cursor-pointer
                                           ${uploading ? 'bg-secondary opacity-50 cursor-wait' : 'hover:border-blue-500/50 hover:bg-blue-500/5'}`}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                />
                                <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                                    {uploading ? (
                                        <i className="fas fa-circle-notch fa-spin text-4xl text-blue-500"></i>
                                    ) : (
                                        <i className="fas fa-cloud-upload-alt text-4xl text-blue-500"></i>
                                    )}
                                </div>
                                <h3 className="text-lg font-bold text-primary mb-2">
                                    {uploading ? '正在极速处理中...' : '点击或拖拽图片到这里'}
                                </h3>
                                <p className="text-secondary/60 text-sm">
                                    支持 JPG, PNG, WebP 等主流图片格式<br />
                                    系统将自动压缩并转换为 WebP 格式以优化展示
                                </p>
                            </div>

                            <div className="mt-8 bg-blue-500/5 border border-blue-500/10 rounded-2xl p-4 flex gap-3">
                                <i className="fas fa-info-circle text-blue-500 mt-0.5"></i>
                                <div className="text-xs text-secondary/80 leading-relaxed">
                                    <p className="font-bold text-blue-500 mb-1">温馨提示：</p>
                                    <p>手动更换封面后，该媒体记录将自动被“锁定”，系统扫描时不会再自动根据文件名匹配新封面。如果需要恢复自动逻辑，请在“三个点”菜单中选择“恢复自动识别”。</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 底部 */}
                <div className="px-6 py-4 border-t border-border-color bg-black/20 flex justify-between items-center text-[10px] text-secondary/50 uppercase tracking-widest font-bold">
                    <span>MANUAL POSTER MANAGEMENT</span>
                    <span>TMDB ENHANCED</span>
                </div>
            </div>
        </div>
    );
}
