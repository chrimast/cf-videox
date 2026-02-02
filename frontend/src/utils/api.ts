import { ApiResponse } from '../types';

// API 基础路径
export const API_BASE = '/api';

/**
 * 构建完整的 API URL
 */
const buildUrl = (path: string): string => {
    const cleanPath = path.replace(/^\.?\//, '');
    return `${API_BASE}/${cleanPath}`;
};

/**
 * 通用 API 请求函数
 */
export async function apiRequest<T>(
    path: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    const url = buildUrl(path);

    try {
        const token = localStorage.getItem('auth_token');

        // 从 localStorage 获取登录密码
        let adminPassword = '';
        try {
            const authData = localStorage.getItem('video_admin_auth');
            if (authData) {
                const parsed = JSON.parse(authData);
                if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
                    adminPassword = parsed.password || '';
                }
            }
        } catch {
            // 忽略解析错误
        }

        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(adminPassword ? { 'X-Admin-Password': adminPassword } : {}),
            ...(localStorage.getItem('videox_site_password') ? { 'X-Site-Password': localStorage.getItem('videox_site_password')! } : {}), // Added X-Site-Password
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            // 如果是 401 Unauthorized
            if (response.status === 401) {
                // 尝试解析错误信息，如果是 SITE_LOCKED，不触发登出重定向，交给调用方处理
                try {
                    const errorClone = response.clone();
                    const errorData = await errorClone.json();
                    if (errorData.error === 'SITE_LOCKED') {
                        return errorData;
                    }
                } catch {
                    // 解析失败则继续走默认 401 逻辑
                }

                console.warn('[API] Auth token expired or invalid. Redirecting to login...');

                // 清除本地存储的登录相关信息
                localStorage.removeItem('auth_token');
                localStorage.removeItem('video_admin_auth');

                // 发送消息通知主框架或本地触发重定向
                // 延迟一秒给用户看提示的时间（如果以后有 Toast 的话）
                setTimeout(() => {
                    // 如果在 iframe 中，尝试通过 postMessage 通知父窗口
                    if (window.parent !== window) {
                        window.parent.postMessage({ type: 'AUTH_EXPIRED' }, '*');
                    } else {
                        // 独立运行模式下强制刷新页面，触发 App.tsx 的未登录逻辑
                        window.location.reload();
                    }
                }, 1000);
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        // 对于正在进行的轮询请求（如 live/status），静默处理 401 错误日志
        if (path.includes('live/status') && error instanceof Error && error.message.includes('401')) {
            return { success: false, error: 'Unauthorized' };
        }
        console.error(`[API] Request failed: ${url}`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * GET 请求
 */
export async function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
    let url = path;
    if (params) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                searchParams.set(key, String(value));
            }
        }
        const queryString = searchParams.toString();
        if (queryString) {
            url += `?${queryString}`;
        }
    }
    return apiRequest<T>(url);
}

/**
 * POST 请求
 */
export async function apiPost<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
    return apiRequest<T>(path, {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined
    });
}

/**
 * PUT 请求
 */
export async function apiPut<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
    return apiRequest<T>(path, {
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined
    });
}

/**
 * DELETE 请求
 */
export async function apiDelete<T>(path: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
    let url = path;
    if (params) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                searchParams.set(key, String(value));
            }
        }
        const queryString = searchParams.toString();
        if (queryString) {
            url += `?${queryString}`;
        }
    }
    return apiRequest<T>(url, {
        method: 'DELETE'
    });
}
