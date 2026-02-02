/**
 * 首页管理组件
 * 选择参与首页聚合的资源站
 */
import { useState, useEffect } from 'react';
import { VideoSource } from '../types';
import { apiGet, apiPost, apiPut } from '../utils/api';

interface HomeManagerProps {
    sources: VideoSource[];
    onRefresh?: () => void;
    onSourcesChange?: () => void;
}

// 延迟测试结果
interface LatencyResult {
    loading: boolean;
    latency: number | null; // ms
    error: boolean;
}

export function HomeManager({ sources, onRefresh, onSourcesChange }: HomeManagerProps) {
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [testingAll, setTestingAll] = useState(false);

    // 每个资源站的延迟测试结果
    const [latencyMap, setLatencyMap] = useState<Record<number, LatencyResult>>({});

    const [hasLoadedSettings, setHasLoadedSettings] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    // 当 sources 变化且还没有加载到设置时，或者设置为空时，提供默认全选
    useEffect(() => {
        if (!loading && !hasLoadedSettings && sources.length > 0 && selectedIds.length === 0) {
            setSelectedIds(sources.filter(s => s.enabled).map(s => s.id));
        }
    }, [sources, loading, hasLoadedSettings]);


    // 当 sources 加载完成且设置也加载完成后，自动进行一次测速
    // 已禁用：用户手动点击"测速"按钮时才测速
    // useEffect(() => {
    //     if (!loading && sources.length > 0) {
    //         testAllLatency();
    //     }
    // }, [sources, loading]);


    const loadSettings = async () => {
        try {
            const res = await apiGet<{ value: any }>('/settings/home_source_ids');
            if (res.success && res.data?.value) {
                let ids = res.data.value;
                // 如果后端返回的是字符串（虽然通常会自动解析），则手动解析一次
                if (typeof ids === 'string') {
                    try {
                        ids = JSON.parse(ids);
                    } catch (e) {
                        console.error('Failed to parse home_source_ids string:', e);
                        ids = [];
                    }
                }

                if (Array.isArray(ids)) {
                    setSelectedIds(ids);
                    setHasLoadedSettings(true);
                }
            }
        } catch (error) {
            console.error('Failed to load home source settings:', error);
        } finally {
            setLoading(false);
        }
    };

    // 批量测试所有资源站延迟
    const testAllLatency = async () => {
        const enabledSources = sources.filter(s => s.enabled);
        if (enabledSources.length === 0) return;

        setTestingAll(true);

        // 立即设置所有为加载中状态
        setLatencyMap(prev => {
            const next = { ...prev };
            enabledSources.forEach(s => {
                next[s.id] = { loading: true, latency: null, error: false };
            });
            return next;
        });

        try {
            const res = await apiPost<any[]>('/sources/batch-test', {
                ids: enabledSources.map(s => s.id)
            });

            if (res.success && res.data) {
                const newResults: Record<number, LatencyResult> = {};
                res.data.forEach((item: any) => {
                    newResults[item.id] = {
                        loading: false,
                        latency: item.success ? item.responseTime : null,
                        error: !item.success
                    };
                });
                setLatencyMap(prev => ({ ...prev, ...newResults }));
            }
        } catch (err) {
            console.error('[HomeManager] Batch test failed:', err);
        } finally {
            setTestingAll(false);
        }
    };

    const handleToggle = (id: number) => {
        setSelectedIds(prev =>
            prev.includes(id)
                ? prev.filter(x => x !== id)
                : [...prev, id]
        );
    };

    const handleSelectAll = () => {
        const enabledIds = sources.filter(s => s.enabled).map(s => s.id);
        setSelectedIds(enabledIds);
    };

    const handleSelectNone = () => {
        setSelectedIds([]);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // 使用 PUT /settings/:key 端点保存设置
            await apiPut('/settings/home_source_ids', {
                value: JSON.stringify(selectedIds)
            });
            alert('保存成功！需要刷新首页缓存后生效。');
            onSourcesChange?.();
        } catch (error) {
            console.error('Failed to save settings:', error);
            alert('保存失败');
        } finally {
            setSaving(false);
        }
    };

    const handleRefreshHome = async () => {
        setRefreshing(true);
        try {
            await apiPost('/home/refresh');
            alert('首页缓存刷新已启动，请等待1-2分钟后刷新页面查看效果。');
            onRefresh?.();
        } catch (error) {
            console.error('Failed to refresh home:', error);
            alert('刷新失败');
        } finally {
            setRefreshing(false);
        }
    };

    // 获取延迟显示样式
    const getLatencyStyle = (result: LatencyResult | undefined) => {
        if (!result) {
            return { color: 'text-secondary', icon: 'fa-question-circle', text: '未测试' };
        }
        if (result.loading) {
            return { color: 'text-yellow-400', icon: 'fa-spinner fa-spin', text: '测速中...' };
        }
        if (result.error || result.latency === null) {
            return { color: 'text-red-400', icon: 'fa-times-circle', text: '失败' };
        }
        const ms = result.latency;
        if (ms < 500) {
            return { color: 'text-green-400', icon: 'fa-bolt', text: `${ms}ms` };
        } else if (ms < 1500) {
            return { color: 'text-yellow-400', icon: 'fa-clock', text: `${ms}ms` };
        } else {
            return { color: 'text-orange-400', icon: 'fa-hourglass-half', text: `${ms}ms` };
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    const enabledSources = sources.filter(s => s.enabled);
    const selectedCount = selectedIds.length;
    const totalCount = enabledSources.length;

    return (
        <div className="space-y-6">
            {/* 头部说明 */}
            <div className="bg-secondary/50 border border-border-color rounded-lg p-4">
                <h3
                    className="text-lg font-semibold text-primary mb-2 flex items-center gap-2"
                >
                    <i className="fas fa-home text-blue-400"></i>
                    首页聚合资源站
                </h3>
                <p className="text-secondary text-sm">
                    选择参与首页内容聚合的资源站。建议选择响应速度快（绿色）的站点，以加快首页加载速度。
                </p>
            </div>

            {/* 操作栏 */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-secondary text-sm">
                        已选择 <span className="text-blue-500 font-medium">{selectedCount}</span> / {totalCount} 个资源站
                    </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={testAllLatency}
                        disabled={testingAll}
                        className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 text-primary border border-border-color rounded-lg transition-colors disabled:opacity-50"
                    >
                        {testingAll ? (
                            <><i className="fas fa-spinner fa-spin mr-1"></i> 测速中...</>
                        ) : (
                            <><i className="fas fa-tachometer-alt mr-1"></i> 重新测速</>
                        )}
                    </button>
                    <button
                        onClick={handleSelectAll}
                        className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 text-primary border border-border-color rounded-lg transition-colors"
                    >
                        全选
                    </button>
                    <button
                        onClick={handleSelectNone}
                        className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 text-primary border border-border-color rounded-lg transition-colors"
                    >
                        清空
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? '保存中...' : '保存设置'}
                    </button>
                    <button
                        onClick={handleRefreshHome}
                        disabled={refreshing}
                        className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        {refreshing ? '刷新中...' : '刷新首页'}
                    </button>
                </div>
            </div>

            {/* 资源站列表 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {enabledSources.map(source => {
                    const isSelected = selectedIds.includes(source.id);
                    const latencyResult = latencyMap[source.id];
                    const latencyStyle = getLatencyStyle(latencyResult);

                    return (
                        <div
                            key={source.id}
                            onClick={() => handleToggle(source.id)}
                            className={`
                                relative p-4 rounded-lg border cursor-pointer transition-all
                                ${isSelected
                                    ? 'bg-blue-600/20 border-blue-500'
                                    : 'bg-secondary/50 border-border-color hover:border-blue-400/50'
                                }
                            `}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`
                                    w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 mt-0.5
                                    ${isSelected
                                        ? 'bg-blue-500 border-blue-500'
                                        : 'border-gray-500'
                                    }
                                `}>
                                    {isSelected && (
                                        <i className="fas fa-check text-primary text-xs"></i>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-primary font-medium truncate">
                                            {source.name}
                                        </div>
                                        {/* 延迟显示 */}
                                        <div className={`flex items-center gap-1 text-xs ${latencyStyle.color} flex-shrink-0`}>
                                            <i className={`fas ${latencyStyle.icon}`}></i>
                                            <span>{latencyStyle.text}</span>
                                        </div>
                                    </div>
                                    {source.tags && (
                                        <div className="text-secondary text-xs truncate mt-0.5">
                                            {source.tags}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {enabledSources.length === 0 && (
                <div className="text-center py-12 text-secondary">
                    <i className="fas fa-database text-4xl mb-4"></i>
                    <p>暂无启用的资源站</p>
                </div>
            )}
        </div>
    );
}
