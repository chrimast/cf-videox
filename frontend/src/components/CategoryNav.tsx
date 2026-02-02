import { useState, useEffect, useRef } from 'react';
import { Category } from '../types';

interface CategoryNavProps {
    categories: Category[];
    sourceId: number;
    currentCategoryId?: string;
    onNavigate: (view: string, params?: Record<string, unknown>) => void;
}

// 展开按钮 ref
let expandButtonRef: HTMLButtonElement | null = null;

export function CategoryNav({ categories, sourceId, currentCategoryId, onNavigate }: CategoryNavProps) {
    const [activeTopLevelId, setActiveTopLevelId] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // 获取所有分类的 type_id 集合，用于判断父分类是否存在
    const allTypeIds = new Set(categories.map(c => String(c.type_id)));

    // Filter top-level categories: parent_id 为空/0，或者 parent_id 不在当前分类列表中
    // 这样可以兼容那些 parent_id 指向不存在分类的资源站
    const topLevelCats = categories.filter(c => {
        const isOrphan = c.parent_id && !allTypeIds.has(String(c.parent_id));
        const isRealTopLevel = !c.parent_id || c.parent_id === 0;
        const hasContent = c.has_content === undefined || c.has_content === 1;
        return (isRealTopLevel || isOrphan) && hasContent;
    });

    // Identify active top-level category based on currentCategoryId
    useEffect(() => {
        if (!currentCategoryId) {
            setActiveTopLevelId(null);
            return;
        }

        // Check if current ID is a top-level category
        const isTopLevel = topLevelCats.some(c => c.type_id === currentCategoryId);
        if (isTopLevel) {
            setActiveTopLevelId(currentCategoryId);
            return;
        }

        // Check if current ID is a sub-category, find its parent
        const currentCat = categories.find(c => c.type_id === currentCategoryId);
        if (currentCat && currentCat.parent_id) {
            const parentId = String(currentCat.parent_id);
            // Verify parent is in topLevelCats (it should be)
            if (topLevelCats.some(c => c.type_id === parentId)) {
                setActiveTopLevelId(parentId);
            }
        }
    }, [currentCategoryId, categories, topLevelCats]);

    // 导航时自动收起
    useEffect(() => {
        setIsExpanded(false);
    }, [sourceId, currentCategoryId]);

    // Handle clicking a top-level category
    const handleTopLevelClick = (cat: Category) => {
        const subCats = categories.filter(c =>
            c.parent_id === parseInt(cat.type_id) ||
            (c.parent_id && String(c.parent_id) === cat.type_id)
        );

        setActiveTopLevelId(cat.type_id);
        onNavigate('category', {
            sourceId: sourceId,
            categoryId: cat.type_id,
            categoryName: cat.name,
            subCategories: subCats
        });
    };

    // Handle clicking a sub-category
    const handleSubLevelClick = (sub: Category) => {
        onNavigate('category', {
            sourceId: sourceId,
            categoryId: sub.type_id,
            categoryName: sub.name
        });
    };

    // Get sub-categories for the active top-level category
    const activeSubCats = activeTopLevelId
        ? categories.filter(c =>
            c.parent_id === parseInt(activeTopLevelId) ||
            (c.parent_id && String(c.parent_id) === activeTopLevelId)
        )
        : [];

    // 检测是否超过一行
    useEffect(() => {
        const checkOverflow = () => {
            if (contentRef.current && containerRef.current) {
                // 如果内容高度显著大于容器高度（一行的典型高度约 56px）
                setHasMore(contentRef.current.scrollHeight > 60);
            }
        };

        checkOverflow();
        window.addEventListener('resize', checkOverflow);
        return () => window.removeEventListener('resize', checkOverflow);
    }, [topLevelCats]);

    // 监听滚动收起
    const lastScrollTop = useRef(0);

    useEffect(() => {
        // 查找滚动容器：优先查找 iframe 内的主滚动容器，然后尝试多个候选
        const scrollContainer = document.querySelector('.custom-scrollbar') ||
            document.querySelector('.overflow-y-auto') ||
            document.documentElement;

        const handleScroll = () => {
            if (isExpanded && scrollContainer) {
                const currentScrollTop = scrollContainer instanceof HTMLElement
                    ? scrollContainer.scrollTop
                    : window.scrollY;
                // 仅向下滚动超过 30px 时收起（降低阈值提高移动端响应速度）
                if (currentScrollTop - lastScrollTop.current > 30) {
                    setIsExpanded(false);
                }
            }
        };

        // 点击外部区域收起（移动端优化）
        const handleClickOutside = (e: MouseEvent) => {
            // 排除展开按钮和分类容器
            if (isExpanded && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                // 也排除展开按钮本身
                if (expandButtonRef && expandButtonRef.contains(e.target as Node)) {
                    return;
                }
                setIsExpanded(false);
            }
        };

        if (isExpanded) {
            // 记录当前滚动位置
            lastScrollTop.current = scrollContainer instanceof HTMLElement
                ? scrollContainer.scrollTop
                : window.scrollY;

            // 延迟添加监听，避免点击展开按钮时立即触发收起
            const timer = setTimeout(() => {
                if (scrollContainer instanceof HTMLElement) {
                    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
                } else {
                    window.addEventListener('scroll', handleScroll, { passive: true });
                }
                // 使用 mousedown 而不是 click，更及时响应
                document.addEventListener('mousedown', handleClickOutside);
            }, 300); // 增加延迟时间避免立即触发

            return () => {
                clearTimeout(timer);
                if (scrollContainer instanceof HTMLElement) {
                    scrollContainer.removeEventListener('scroll', handleScroll);
                } else {
                    window.removeEventListener('scroll', handleScroll);
                }
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [isExpanded, sourceId, currentCategoryId]);

    // Helper for icons (Same as Sidebar logic)
    const getIcon = (name: string): string => {
        const icons: Record<string, string> = {
            '电影': 'fas fa-film',
            '连续剧': 'fas fa-tv',
            '电视剧': 'fas fa-tv',
            '剧集': 'fas fa-tv',
            '综艺': 'fas fa-masks-theater',
            '动漫': 'fas fa-dragon',
            '动画': 'fas fa-dragon',
            '纪录片': 'fas fa-video',
            '明星': 'fas fa-star',
            '更新': 'fas fa-clock',
            '热榜': 'fas fa-fire',
            '资讯': 'fas fa-newspaper',
        };
        for (const [key, icon] of Object.entries(icons)) {
            if (name.includes(key)) return icon;
        }
        return 'fas fa-folder';
    };

    return (
        <div className="w-full glass-effect relative z-25 transition-all duration-300 border-b border-border-color">
            {/* Top Level Categories Row */}
            <div
                ref={containerRef}
                className={`
                    relative px-4 transition-all duration-300 ease-in-out overflow-hidden
                    ${isExpanded ? 'max-h-[500px] py-3' : 'max-h-[64px] py-3'}
                `}
            >
                <div ref={contentRef} className="flex flex-wrap gap-2">
                    {topLevelCats.map(cat => {
                        const isActive = activeTopLevelId === cat.type_id;
                        const icon = getIcon(cat.name);

                        return (
                            <button
                                key={cat.type_id}
                                onClick={() => handleTopLevelClick(cat)}
                                className={`
                                    flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-300
                                    ${isActive
                                        ? 'active-brand-item text-white shadow-lg shadow-blue-500/30 scale-105'
                                        : 'bg-secondary/40 text-secondary hover:bg-secondary/80 hover:text-primary'}
                                `}
                            >
                                <i className={`${icon} ${isActive ? 'scale-110' : 'text-secondary/70'}`}></i>
                                {cat.name}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 下拉箭头 */}
            {hasMore && (
                <div className="flex justify-center pb-1 -mt-1 scale-90">
                    <button
                        ref={(el) => { expandButtonRef = el; }}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                        className={`
                                w-10 h-5 flex items-center justify-center bg-secondary/50 hover:bg-secondary/80 rounded-b-xl transition-all border-x border-b border-border-color
                                ${isExpanded ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : 'text-secondary/60'}
                            `}
                    >
                        <i className={`fas fa-chevron-down text-[9px] transition-transform duration-500 ${isExpanded ? 'rotate-180' : ''}`}></i>
                    </button>
                </div>
            )}

            {/* Sub Categories Row (Visible if Active Top Level has subs) */}
            {activeSubCats.length > 0 && (
                <div className="flex flex-wrap items-center px-4 py-2 bg-secondary/20 backdrop-blur-sm gap-2 transition-all duration-300 border-t border-border-color">
                    <span className="flex items-center text-[11px] text-secondary font-bold px-2 uppercase tracking-tight shrink-0 mr-1 select-none opacity-60">
                        {topLevelCats.find(c => c.type_id === activeTopLevelId)?.name}
                    </span>
                    <div className="h-3 w-px bg-white/10 mx-1 shrink-0"></div>
                    {activeSubCats.map(sub => {
                        const isSubActive = currentCategoryId === sub.type_id;

                        return (
                            <button
                                key={sub.type_id}
                                onClick={() => handleSubLevelClick(sub)}
                                className={`
                                    px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-300
                                    ${isSubActive
                                        ? 'bg-blue-600 text-white shadow-sm ring-1 ring-white/10'
                                        : 'text-secondary hover:text-primary hover:bg-white/5'}
                                `}
                            >
                                {sub.name}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
