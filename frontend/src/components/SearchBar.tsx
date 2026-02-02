import React, { useState, useRef, useEffect } from 'react';

interface SearchBarProps {
    initialValue?: string;
    onSearch: (keyword: string) => void;
    autoFocus?: boolean;
}

export function SearchBar({ initialValue = '', onSearch, autoFocus = false }: SearchBarProps) {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (value.trim()) {
            onSearch(value.trim());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && value.trim()) {
            onSearch(value.trim());
        }
    };

    return (
        <form onSubmit={handleSubmit} className="relative">
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="搜索电影、电视剧、动漫..."
                className="w-full px-5 py-3 pl-12 bg-secondary text-primary rounded-xl
                         border border-border-color focus:border-red-500 focus:outline-none
                         placeholder-gray-500 transition-colors"
            />
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-secondary"></i>
            {value && (
                <button
                    type="button"
                    onClick={() => setValue('')}
                    className="absolute right-14 top-1/2 -translate-y-1/2 text-secondary 
                             hover:text-primary transition-colors"
                >
                    <i className="fas fa-times"></i>
                </button>
            )}
            <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5
                         bg-red-500 text-primary rounded-lg hover:bg-red-600 transition-colors"
            >
                搜索
            </button>
        </form>
    );
}
