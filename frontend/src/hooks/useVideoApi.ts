/**
 * 视频 API Hook
 */

import { useState, useCallback } from 'react';
import { Video, VideoSource, Category, VideoDetail, Favorite, PlayHistory, Pagination } from '../types';
import { apiRequest } from '../utils/api';

/**
 * 视频源 Hook
 */
export function useSources() {
    const [sources, setSources] = useState<VideoSource[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await apiRequest<VideoSource[]>('/sources');
        if (res.success && res.data) {
            setSources(res.data.filter(s => s.enabled));
        }
        setLoading(false);
    }, []);

    return { sources, loading, load };
}

/**
 * 分类 Hook
 */
export function useCategories(_sourceId?: number) {
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async (srcId?: number) => {
        setLoading(true);
        const params = srcId ? `?source_id=${srcId}` : '';
        const res = await apiRequest<Category[]>(`/categories${params}`);
        if (res.success && res.data) {
            setCategories(res.data);
        }
        setLoading(false);
    }, []);

    const loadTree = useCallback(async () => {
        setLoading(true);
        const res = await apiRequest<Category[]>('/categories/tree');
        if (res.success && res.data) {
            setCategories(res.data);
        }
        setLoading(false);
    }, []);

    return { categories, loading, load, loadTree };
}

/**
 * 视频列表 Hook
 */
export function useVideos() {
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState(false);
    const [pagination, setPagination] = useState<Pagination | null>(null);

    const load = useCallback(async (params: {
        source_id?: number;
        category_id?: string;
        page?: number;
        limit?: number;
    }) => {
        setLoading(true);
        const query = new URLSearchParams();
        if (params.source_id) query.set('source_id', String(params.source_id));
        if (params.category_id) query.set('category_id', params.category_id);
        if (params.page) query.set('page', String(params.page));
        if (params.limit) query.set('limit', String(params.limit));

        const res = await apiRequest<Video[]>(`/videos?${query}`);
        if (res.success && res.data) {
            setVideos(res.data);
            if (res.pagination) setPagination(res.pagination);
        }
        setLoading(false);
    }, []);

    const search = useCallback(async (keyword: string) => {
        setLoading(true);
        const res = await apiRequest<Video[]>(`/videos/search?keyword=${encodeURIComponent(keyword)}`);
        if (res.success && res.data) {
            setVideos(res.data);
        }
        setLoading(false);
    }, []);

    const loadBanner = useCallback(async () => {
        const res = await apiRequest<Video[]>('/videos/banner');
        return res.success ? res.data || [] : [];
    }, []);

    return { videos, loading, pagination, load, search, loadBanner };
}

/**
 * 视频详情 Hook
 */
export function useVideoDetail() {
    const [video, setVideo] = useState<VideoDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (sourceId: number, vodId: string) => {
        setLoading(true);
        setError(null);
        const res = await apiRequest<VideoDetail>(`/videos/${vodId}?source_id=${sourceId}`);
        if (res.success && res.data) {
            setVideo(res.data);
        } else {
            setError(res.error || '加载失败');
        }
        setLoading(false);
    }, []);

    return { video, loading, error, load };
}

/**
 * 收藏 Hook
 */
export function useFavorites() {
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await apiRequest<Favorite[]>('/favorites');
        if (res.success && res.data) {
            setFavorites(res.data);
        }
        setLoading(false);
    }, []);

    const add = useCallback(async (data: {
        source_id: number;
        vod_id: string;
        title: string;
        cover: string;
        year?: string;
    }) => {
        const res = await apiRequest<{ id: number }>('/favorites', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return res.success;
    }, []);

    const remove = useCallback(async (id: number) => {
        const res = await apiRequest(`/favorites/${id}`, { method: 'DELETE' });
        if (res.success) {
            setFavorites(prev => prev.filter(f => f.id !== id));
        }
        return res.success;
    }, []);

    const check = useCallback(async (sourceId: number, vodId: string) => {
        const res = await apiRequest<{ isFavorite: boolean }>(`/favorites/check?source_id=${sourceId}&vod_id=${vodId}`);
        return res.success && res.data?.isFavorite;
    }, []);

    return { favorites, loading, load, add, remove, check };
}

/**
 * 播放历史 Hook
 */
export function useHistory() {
    const [history, setHistory] = useState<PlayHistory[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async (limit = 50) => {
        setLoading(true);
        const res = await apiRequest<PlayHistory[]>(`/history?limit=${limit}`);
        if (res.success && res.data) {
            setHistory(res.data);
        }
        setLoading(false);
    }, []);

    const update = useCallback(async (data: {
        source_id: number;
        vod_id: string;
        title: string;
        cover: string;
        episode: number;
        episode_name?: string;
        progress: number;
        duration: number;
    }) => {
        await apiRequest('/history', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }, []);

    const clear = useCallback(async () => {
        const res = await apiRequest('/history', { method: 'DELETE' });
        if (res.success) {
            setHistory([]);
        }
    }, []);

    return { history, loading, load, update, clear };
}
