import { useEffect, useRef } from 'react';

interface MenuItem {
    label: string;
    icon: string;
    onClick: () => void;
    variant?: 'default' | 'danger';
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleScroll = () => onClose();

        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [onClose]);

    // 计算位置，防止溢出屏幕
    const menuWidth = 160;
    const menuHeight = items.length * 40 + 8;
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10);

    return (
        <div
            ref={menuRef}
            className="fixed z-[1000] bg-secondary border border-border-color rounded-xl shadow-xl py-1 w-40 animate-in fade-in zoom-in duration-200"
            style={{ left: adjustedX, top: adjustedY }}
        >
            {items.map((item, idx) => (
                <button
                    key={idx}
                    onClick={(e) => {
                        e.stopPropagation();
                        item.onClick();
                        onClose();
                    }}
                    className={`w-full px-4 py-2.5 flex items-center gap-3 text-sm transition-all duration-200
                               ${item.variant === 'danger'
                            ? 'text-red-500 hover:bg-red-500/10'
                            : 'text-primary hover:bg-tertiary transition-colors'}
                              first:rounded-t-lg last:rounded-b-lg`}
                >
                    <i className={`${item.icon} w-4 text-center opacity-70`}></i>
                    <span className="font-medium">{item.label}</span>
                </button>
            ))}
        </div>
    );
}
