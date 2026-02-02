/**
 * 网盘筛选组件
 * 桌面端：横向标签栏
 * 移动端：筛选按钮 + 底部抽屉
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface FilterOption {
    value: string | number;
    count: number;
}

interface FiltersData {
    genres: FilterOption[];
    years: FilterOption[];
    areas: FilterOption[];
    actors: FilterOption[];
    studios: FilterOption[];
}

interface ActiveFilters {
    genres?: string;
    year?: number;
    area?: string;
    actor?: string;
    studio?: string;
    series?: string;
    tags?: string;
    date?: string;
    sort?: string;
}

interface NetdiskFilterProps {
    sourceId: number;
    onFilterChange: (filters: ActiveFilters) => void;
    isMobile?: boolean;
    viewMode?: string;
    onViewModeChange?: (mode: string) => void;
}

export function NetdiskFilter({ sourceId, onFilterChange, isMobile = false, viewMode = 'default', onViewModeChange }: NetdiskFilterProps) {
    const [filters, setFilters] = useState<FiltersData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [showDrawer, setShowDrawer] = useState(false);
    const [showSortDropdown, setShowSortDropdown] = useState(false);
    const [activeSort, setActiveSort] = useState<string>('latest');

    // 排序选项
    const sortOptions = [
        { value: 'latest', label: '按加入时间', icon: 'fa-clock' },
        { value: 'year', label: '按发行时间', icon: 'fa-calendar-alt' },
        { value: 'title', label: '按文件名称', icon: 'fa-sort-alpha-down' },
        { value: 'rating', label: '按评分', icon: 'fa-star' },
        { value: 'resolution', label: '按分辨率', icon: 'fa-film' }
    ];

    // 加载筛选选项
    useEffect(() => {
        loadFilters();
    }, [sourceId]);

    const loadFilters = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/netdisk/media/filters?sourceId=${sourceId}`);
            const data = await res.json();
            if (data.success) {
                setFilters(data.data);
            }
        } catch (err) {
            console.error('Failed to load filters:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleFilterSelect = (category: string, value: string | number | null) => {
        const newFilters = { ...activeFilters };
        if (value === null) {
            delete (newFilters as any)[category];
        } else {
            (newFilters as any)[category] = value;
        }
        setActiveFilters(newFilters);
        onFilterChange(newFilters);
        setExpandedCategory(null);
        setShowSortDropdown(false);
    };

    const handleSortChange = (sortValue: string) => {
        setActiveSort(sortValue);
        const newFilters = { ...activeFilters, sort: sortValue };
        setActiveFilters(newFilters);
        onFilterChange(newFilters);
        setShowSortDropdown(false);
    };

    const clearAllFilters = () => {
        setActiveFilters({});
        onFilterChange({});
        setShowDrawer(false);
    };

    const getActiveFilterCount = () => {
        return Object.keys(activeFilters).length;
    };

    const categories = [
        { key: 'genres', label: '类型', icon: 'fas fa-tags' },
        { key: 'years', label: '年份', icon: 'fas fa-calendar' },
        { key: 'areas', label: '地区', icon: 'fas fa-globe' },
        { key: 'actors', label: '演员', icon: 'fas fa-user' },
        { key: 'studios', label: '制片厂', icon: 'fas fa-building' }
    ];

    const getFilterKey = (catKey: string): string => {
        const keyMap: Record<string, string> = {
            'years': 'year',
            'areas': 'area',
            'actors': 'actor',
            'studios': 'studio'
        };
        return keyMap[catKey] || catKey;
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 px-4 py-2 text-secondary text-sm">
                <i className="fas fa-spinner animate-spin"></i>
                <span>加载筛选...</span>
            </div>
        );
    }

    if (!filters || (filters.genres.length === 0 && filters.years.length === 0 && filters.areas.length === 0 && filters.actors.length === 0 && filters.studios.length === 0)) {
        return null;
    }

    // 移动端：筛选按钮 + 底部抽屉
    if (isMobile) {
        return (
            <>
                {/* 筛选按钮 */}
                <button
                    onClick={() => setShowDrawer(true)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${getActiveFilterCount() > 0
                        ? 'bg-blue-600 text-primary'
                        : 'bg-secondary text-primary hover:bg-gray-700'
                        }`}
                >
                    <i className="fas fa-sliders-h"></i>
                    <span>筛选</span>
                    {getActiveFilterCount() > 0 && (
                        <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-xs">
                            {getActiveFilterCount()}
                        </span>
                    )}
                </button>

                {/* 底部抽屉 - 使用 Portal 渲染到 body，避免 sticky 父容器影响 */}
                {showDrawer && createPortal(
                    <div className="fixed inset-0 z-50" onClick={() => setShowDrawer(false)}>
                        {/* 遮罩 */}
                        <div className="absolute inset-0 bg-black/60"></div>

                        {/* 抽屉内容 */}
                        <div
                            className="absolute bottom-0 left-0 right-0 bg-secondary rounded-t-2xl max-h-[70vh] overflow-y-auto"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* 头部 */}
                            <div className="sticky top-0 bg-secondary px-4 py-3 border-b border-border-color flex items-center justify-between z-10">
                                <h3 className="text-lg font-bold text-primary">筛选与排序</h3>
                                <div className="flex items-center gap-2">
                                    {getActiveFilterCount() > 0 && (
                                        <button onClick={clearAllFilters} className="text-sm text-secondary hover:text-primary">
                                            清空
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setShowDrawer(false)}
                                        className="w-8 h-8 flex items-center justify-center text-secondary hover:text-primary"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>
                            </div>

                            {/* 内容区域 */}
                            <div className="p-4 space-y-6">
                                {/* 视图模式 */}
                                <div>
                                    <h4 className="text-sm font-medium text-secondary mb-3 flex items-center gap-2">
                                        <i className="fas fa-th-large"></i>
                                        视图模式
                                    </h4>
                                    <div className="grid grid-cols-5 gap-2">
                                        {[
                                            { id: 'default', icon: 'fa-th-large', label: '默认' },
                                            { id: 'date', icon: 'fa-calendar-alt', label: '日期' },
                                            { id: 'collection', icon: 'fa-layer-group', label: '系列' },
                                            { id: 'category', icon: 'fa-tags', label: '分类' },
                                            { id: 'tag', icon: 'fa-hashtag', label: '标签' }
                                        ].map(item => (
                                            <button
                                                key={item.id}
                                                onClick={() => onViewModeChange?.(item.id)}
                                                className={`flex flex-col items-center gap-1 py-2 rounded-lg text-xs transition-colors ${viewMode === item.id ? 'bg-blue-600 text-white' : 'bg-secondary/50 text-primary hover:bg-gray-700'}`}
                                            >
                                                <i className={`fas ${item.icon}`}></i>
                                                <span>{item.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 排序 */}
                                <div>
                                    <h4 className="text-sm font-medium text-secondary mb-3 flex items-center gap-2">
                                        <i className="fas fa-sort"></i>
                                        排序方式
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {sortOptions.map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => handleSortChange(opt.value)}
                                                className={`px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-1.5 ${activeSort === opt.value ? 'bg-blue-600 text-white' : 'bg-secondary/50 text-primary hover:bg-gray-700'}`}
                                            >
                                                <i className={`fas ${opt.icon} text-xs`}></i>
                                                <span>{opt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 筛选项 */}
                                {categories.map(cat => {
                                    const options = (filters as any)[cat.key] as FilterOption[];
                                    if (!options || options.length === 0) return null;
                                    return (
                                        <div key={cat.key}>
                                            <h4 className="text-sm font-medium text-secondary mb-3 flex items-center gap-2">
                                                <i className={cat.icon}></i>
                                                {cat.label}
                                            </h4>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    onClick={() => handleFilterSelect(getFilterKey(cat.key), null)}
                                                    className={`px-3 py-1.5 rounded text-sm transition-colors ${!(activeFilters as any)[getFilterKey(cat.key)] ? 'bg-blue-600 text-white' : 'bg-secondary/50 text-primary'}`}
                                                >
                                                    全部
                                                </button>
                                                {options.slice(0, 20).map(opt => (
                                                    <button
                                                        key={String(opt.value)}
                                                        onClick={() => handleFilterSelect(getFilterKey(cat.key), opt.value)}
                                                        className={`px-3 py-1.5 rounded text-sm transition-colors ${(activeFilters as any)[getFilterKey(cat.key)] === opt.value ? 'bg-blue-600 text-white' : 'bg-secondary/50 text-primary hover:bg-gray-700'}`}
                                                    >
                                                        {opt.value}
                                                        <span className="ml-1 text-xs opacity-60">({opt.count})</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 确定按钮 */}
                            <div className="sticky bottom-0 bg-secondary px-4 py-3 border-t border-border-color">
                                <button
                                    onClick={() => setShowDrawer(false)}
                                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </>
        );
    }

    // 桌面端：横向标签栏
    return (
        <div className="flex items-center gap-2 flex-wrap">
            {categories.map(cat => {
                const options = (filters as any)[cat.key] as FilterOption[];
                if (!options || options.length === 0) return null;

                const filterKey = getFilterKey(cat.key);
                const activeValue = (activeFilters as any)[filterKey];
                const isExpanded = expandedCategory === cat.key;

                return (
                    <div key={cat.key} className="relative">
                        <button
                            onClick={() => setExpandedCategory(isExpanded ? null : cat.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${activeValue ? 'bg-blue-600 text-primary' : 'bg-secondary text-primary hover:bg-gray-700'}`}
                        >
                            <i className={`${cat.icon} text-xs`}></i>
                            <span>{activeValue || cat.label}</span>
                            <i className={`fas fa-chevron-down text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}></i>
                        </button>
                        {isExpanded && (
                            <div className="absolute top-full left-0 mt-1 bg-secondary rounded-lg shadow-xl border border-border-color z-20 min-w-[200px] max-h-[300px] overflow-y-auto">
                                <button
                                    onClick={() => handleFilterSelect(filterKey, null)}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-700 ${!activeValue ? 'text-blue-400' : 'text-primary'}`}
                                >
                                    全部
                                </button>
                                {options.map(opt => (
                                    <button
                                        key={String(opt.value)}
                                        onClick={() => handleFilterSelect(filterKey, opt.value)}
                                        className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center justify-between ${activeValue === opt.value ? 'text-blue-400' : 'text-primary'}`}
                                    >
                                        <span>{opt.value}</span>
                                        <span className="text-xs text-secondary">({opt.count})</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* 排序下拉 */}
            <div className="relative">
                <button
                    onClick={() => { setShowSortDropdown(!showSortDropdown); setExpandedCategory(null); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors bg-secondary text-primary hover:bg-gray-700"
                >
                    <i className="fas fa-sort text-xs"></i>
                    <span>{sortOptions.find(s => s.value === activeSort)?.label || '排序'}</span>
                    <i className={`fas fa-chevron-down text-xs transition-transform ${showSortDropdown ? 'rotate-180' : ''}`}></i>
                </button>
                {showSortDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-secondary rounded-lg shadow-xl border border-border-color z-20 min-w-[150px]">
                        {sortOptions.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => handleSortChange(opt.value)}
                                className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 ${activeSort === opt.value ? 'text-blue-400' : 'text-primary'}`}
                            >
                                <i className={`fas ${opt.icon} text-xs`}></i>
                                <span>{opt.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* 清空按钮 */}
            {getActiveFilterCount() > 0 && (
                <button
                    onClick={clearAllFilters}
                    className="flex items-center gap-1 px-2 py-1 text-sm text-secondary hover:text-primary transition-colors"
                >
                    <i className="fas fa-times-circle"></i>
                    清空筛选
                </button>
            )}
        </div>
    );
}
