import { useState, useEffect } from 'react';
import { Video, VideoSource } from '../types';
import { VideoCard } from '../components/VideoCard';

interface SearchProps {
    initialKeyword?: string;
    sourceId?: number | null;
    netdiskPath?: string;
    isMediaServer?: boolean;
    _t?: number; // 接收强制刷新时间戳
    sources?: VideoSource[];
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
}

export function Search({ initialKeyword, sourceId, netdiskPath, isMediaServer, _t, sources = [], onNavigate }: SearchProps) {
    const [results, setResults] = useState<Video[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [currentKeyword, setCurrentKeyword] = useState(initialKeyword || '');
    const [searchingSource, setSearchingSource] = useState<string>('');
    const [isFinished, setIsFinished] = useState(false);

    // 核心搜索函数
    const doSearch = async (kw: string, srcId: number | null, ndPath?: string, isMediaServer: boolean = false) => {
        if (!kw.trim()) return;

        setLoading(true);
        setSearched(true);
        setIsFinished(false);
        setResults([]);
        setCurrentKeyword(kw);

        const token = localStorage.getItem('auth_token');
        const adminAuth = localStorage.getItem('video_admin_auth');
        let adminPassword = '';
        if (adminAuth) {
            try {
                const parsed = JSON.parse(adminAuth);
                if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
                    adminPassword = parsed.password || '';
                }
            } catch (e) { /* ignore */ }
        }

        // 🛠️ 辅助搜索：媒体库 (DB)
        const runNetdiskSearch = async (targetPath?: string) => {
            const url = new URL(`${window.location.origin}/api/netdisk/media`);
            url.searchParams.append('keyword', kw.trim());
            if (targetPath && targetPath !== '/') {
                url.searchParams.append('path', targetPath);
            }
            url.searchParams.append('limit', '100');

            try {
                const response = await fetch(url.toString(), {
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                        ...(adminPassword ? { 'X-Admin-Password': adminPassword } : {})
                    }
                });
                const res = await response.json();
                if (res.success && Array.isArray(res.data)) {
                    return res.data.map((item: any) => ({
                        source_id: item.source_id,
                        vod_id: item.id.toString(),
                        vod_name: item.title,
                        vod_pic: item.poster_url || '',
                        type_name: item.media_type === 'movie' ? '电影' : '剧集',
                        vod_year: item.year?.toString() || '',
                        vod_remarks: item.rating ? `⭐ ${item.rating}` : (item.original_title || ''),
                        is_netdisk: true
                    }));
                }
            } catch (err) {
                console.error('[Search] Netdisk search failed:', err);
            }
            return [];
        };

        // 🛠️ 辅助搜索：资源站 (SSE)
        const runCmsSearch = async (forceMediaServer?: boolean) => {
            const url = new URL(`${window.location.origin}/api/videos/search`);
            url.searchParams.append('keyword', kw.trim());
            url.searchParams.append('stream', 'true');
            if (srcId !== null && srcId !== undefined) {
                url.searchParams.append('source_id', String(srcId));
            }
            if (isMediaServer || forceMediaServer) {
                url.searchParams.append('is_media_server', 'true');
            }

            try {
                const response = await fetch(url.toString(), {
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                        ...(adminPassword ? { 'X-Admin-Password': adminPassword } : {}),
                        'X-No-Compression': 'true'
                    }
                });

                if (!response.body) return;
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
                                const message = JSON.parse(dataStr);
                                if (message.type === 'results' && Array.isArray(message.data)) {
                                    const processed = message.data.map((v: any) => ({
                                        ...v,
                                        vod_pic: v.vod_pic || v.pic || '',
                                        vod_name: v.vod_name || v.name || ''
                                    }));
                                    setResults(prev => [...prev, ...processed]);
                                    setSearchingSource(`正在从 ${message.source} 获取结果...`);
                                }
                            } catch (e) { /* ignore */ }
                        }
                    }
                }
            } catch (err) {
                console.error('[Search] CMS search failed:', err);
            }
        };

        // 🚀 执行策略
        try {
            if (ndPath) {
                // 仅搜媒体库
                setSearchingSource('正在搜索媒体库...');
                const results = await runNetdiskSearch(ndPath);
                setResults(results);
            } else if (isMediaServer) {
                // 仅搜影视库 (Emby/Jellyfin)
                setSearchingSource('正在搜索影视库...');
                await runCmsSearch(true);
            } else if (srcId) {
                // 仅搜指定资源站
                await runCmsSearch();
            } else {
                // 全部源：并行方案
                setSearchingSource('同步检索媒体库与资源站...');

                // 1. 媒体库优先展示 (并行执行)
                runNetdiskSearch().then(ndResults => {
                    if (ndResults.length > 0) {
                        setResults(prev => [...ndResults, ...prev.filter(v => !(v as any).is_netdisk)]);
                    }
                });

                // 2. 资源站流式跟进
                await runCmsSearch();
            }
        } catch (error) {
            console.error('[Search] Strategy execution failed:', error);
        } finally {
            setLoading(false);
            setSearchingSource('');
            setIsFinished(true);
        }
    };

    useEffect(() => {
        if (initialKeyword) {
            doSearch(initialKeyword, sourceId ?? null, netdiskPath, isMediaServer);
        }
    }, [initialKeyword, sourceId, netdiskPath, isMediaServer, _t]); // 🚀 监听 _t，确保即便关键词不变也能重新搜索

    const handleVideoClick = (video: Video) => {
        if ((video as any).is_netdisk) {
            onNavigate('netdisk_play', {
                mediaId: parseInt(video.vod_id),
                sourceId: video.source_id,
                videoIndex: 0
            });
        } else if ((video as any).is_media_server) {
            onNavigate('media_server_play', {
                mediaServerId: video.source_id,
                vodId: video.vod_id,
                title: video.vod_name,
                url: '',
                cover: video.vod_pic
            });
        } else {
            onNavigate('play', {
                sourceId: video.source_id,
                vodId: video.vod_id
            });
        }
    };

    const getSourceName = (srcId: number) => {
        const source = sources.find(s => s.id === srcId);
        return source?.name || `源${srcId}`;
    };

    const getSearchScope = () => {
        if (netdiskPath) return `媒体库: ${netdiskPath.split('/').pop()}`;
        if (sourceId === null || sourceId === undefined) return '全部视频源';
        return getSourceName(sourceId);
    };

    return (
        <div className="p-4 lg:p-6 space-y-6">
            {/* 正在搜索状态 */}
            {(loading || searchingSource) && !isFinished && (
                <div className="glass-effect border border-border-color rounded-2xl p-5 shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className="w-5 h-5 border-2 border-blue-500/20 rounded-full"></div>
                                <div className="absolute top-0 left-0 w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            </div>
                            <span className="text-primary font-bold text-sm">{searchingSource}</span>
                        </div>
                        <div className="px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                            <span className="text-blue-400 text-xs font-black">发现 {results.length}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* 顶栏描述 */}
            {currentKeyword && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-secondary opacity-60">搜索范围</span>
                        <span className="px-2.5 py-0.5 bg-secondary/40 text-primary rounded-lg border border-border-color font-bold text-xs">{getSearchScope()}</span>
                        <div className="h-3 w-px bg-white/10 mx-1"></div>
                        <span className="text-secondary opacity-60">关键词</span>
                        <span className={`${netdiskPath ? 'text-green-500' : 'text-blue-500'} font-black`}>"{currentKeyword}"</span>
                    </div>
                    {isFinished && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-secondary opacity-40">
                            <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                            COMPLETED
                        </div>
                    )}
                </div>
            )}

            {/* 结果显示 */}
            {loading && results.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                    {[...Array(16)].map((_, i) => (
                        <div key={i} className="aspect-[2/3] bg-secondary/20 rounded-2xl border border-border-color animate-pulse"></div>
                    ))}
                </div>
            ) : searched ? (
                results.length > 0 ? (
                    <div className="space-y-4">
                        <p className="text-secondary">找到 <span className="text-primary font-medium">{results.length}</span> 个相关结果</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
                            {results.map((video, idx) => (
                                <VideoCard
                                    key={`${video.source_id || 'nd'}-${video.vod_id}-${idx}`}
                                    video={video}
                                    onClick={() => handleVideoClick(video)}
                                    showSource={true}
                                    sourceName={video.is_netdisk ? '媒体库' : (video.is_media_server ? (video.source_name || '影视库') : getSourceName(video.source_id!))}
                                />
                            ))}
                        </div>
                    </div>
                ) : !loading && isFinished ? (
                    <div className="text-center py-32 glass-effect rounded-3xl border border-border-color">
                        <i className="fas fa-search-minus text-3xl text-secondary opacity-30 mb-4 block"></i>
                        <h3 className="text-xl font-bold text-primary">未找到结果</h3>
                        <p className="text-secondary text-sm opacity-50">尝试更换关键词或检查权限</p>
                    </div>
                ) : null
            ) : null}
        </div>
    );
}
