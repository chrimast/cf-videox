/**
 * 分类列表组件 - 用于侧边栏分类导航
 */

import { useState, useEffect } from 'react';
import { Category, VideoSource } from '../types';
import { apiGet } from '../utils/api';

export interface CategoryItem {
    id: string;
    name: string;
    icon?: string;
    sourceId: number;
    typeId: string;
    children?: CategoryItem[];
}

interface CategoryListProps {
    sources: VideoSource[];
    onSelect: (sourceId: number, categoryId: string, categoryName: string) => void;
    activeSourceId?: number;
    activeCategoryId?: string;
}

export function CategoryList({ sources, onSelect, activeSourceId, activeCategoryId }: CategoryListProps) {
    const [categories, setCategories] = useState<Record<number, Category[]>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(false);

    // 加载所有源的分类
    useEffect(() => {
        loadAllCategories();
    }, [sources]);

    const loadAllCategories = async () => {
        setLoading(true);
        const result: Record<number, Category[]> = {};

        for (const source of sources) {
            const res = await apiGet<Category[]>('/categories', { source_id: source.id });
            if (res.success && res.data) {
                // 筛选一级分类：parent_id 为空/0，或者 parent_id 不在当前分类列表中
                const allTypeIds = new Set(res.data.map(c => String(c.type_id)));
                result[source.id] = res.data.filter(c => {
                    const isOrphan = c.parent_id && !allTypeIds.has(String(c.parent_id));
                    const isRealTopLevel = !c.parent_id || c.parent_id === 0;
                    return isRealTopLevel || isOrphan;
                });
            }
        }

        setCategories(result);
        setLoading(false);
    };

    const toggleExpand = (key: string) => {
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleCategoryClick = (sourceId: number, cat: Category) => {
        onSelect(sourceId, cat.type_id, cat.name);
    };

    // 定义分类图标映射
    const getCategoryIcon = (name: string): string => {
        const icons: Record<string, string> = {
            '电影': 'fas fa-film',
            '连续剧': 'fas fa-tv',
            '电视剧': 'fas fa-tv',
            '剧集': 'fas fa-tv',
            '综艺': 'fas fa-masks-theater',
            '动漫': 'fas fa-dragon',
            '动画': 'fas fa-dragon',
            '纪录片': 'fas fa-video',
            '资讯': 'fas fa-newspaper',
            '明星': 'fas fa-star',
            '体育': 'fas fa-futbol',
            '音乐': 'fas fa-music',
            '短片': 'fas fa-file-video',
            '其他': 'fas fa-folder',
        };

        for (const [key, icon] of Object.entries(icons)) {
            if (name.includes(key)) return icon;
        }
        return 'fas fa-folder';
    };

    if (loading) {
        return (
            <div className="p-4 space-y-3 animate-pulse">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-8 bg-gray-700 rounded"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="py-2">
            {sources.map(source => {
                const sourceCats = categories[source.id] || [];
                const sourceKey = `source-${source.id}`;
                const isExpanded = expanded[sourceKey] !== false; // 默认展开

                return (
                    <div key={source.id} className="mb-2">
                        {/* 源标题（多源时显示） */}
                        {sources.length > 1 && (
                            <button
                                onClick={() => toggleExpand(sourceKey)}
                                className="w-full flex items-center justify-between px-4 py-2 text-secondary 
                                         hover:text-primary text-sm font-medium"
                            >
                                <span className="flex items-center gap-2">
                                    <i className="fas fa-database text-xs"></i>
                                    {source.name}
                                </span>
                                <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'} text-xs`}></i>
                            </button>
                        )}

                        {/* 分类列表 */}
                        {(sources.length === 1 || isExpanded) && (
                            <div className="space-y-0.5">
                                {sourceCats.map(cat => {
                                    const isActive = activeSourceId === source.id && activeCategoryId === cat.type_id;

                                    return (
                                        <button
                                            key={`${source.id}-${cat.type_id}`}
                                            onClick={() => handleCategoryClick(source.id, cat)}
                                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm
                                                      transition-colors rounded-lg mx-2 
                                                      ${sources.length > 1 ? 'ml-6' : ''}
                                                      ${isActive
                                                    ? 'bg-red-500/20 text-red-400'
                                                    : 'text-primary hover:bg-secondary hover:text-primary'
                                                }`}
                                        >
                                            <i className={`${getCategoryIcon(cat.name)} w-4 text-center`}></i>
                                            <span>{cat.name}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            {sources.length === 0 && (
                <div className="px-4 py-8 text-center text-secondary text-sm">
                    <i className="fas fa-folder-open text-2xl mb-2 opacity-50"></i>
                    <p>暂无分类</p>
                </div>
            )}
        </div>
    );
}
