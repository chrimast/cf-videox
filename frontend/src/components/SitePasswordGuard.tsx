import React, { useState, useEffect } from 'react';
import { apiPost } from '../utils/api';

interface SitePasswordGuardProps {
    children: React.ReactNode;
}

export function SitePasswordGuard({ children }: SitePasswordGuardProps) {
    const [isLocked, setIsLocked] = useState(false);
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        checkLockStatus();
    }, []);

    const checkLockStatus = async () => {
        const savedPassword = localStorage.getItem('videox_site_password');
        console.log('[SiteGuard] Checking status. Saved password present:', !!savedPassword);

        // 我们通过请求专门的验证接口来探测是否需要密码
        const res = await apiPost<{ valid: boolean }>('/settings/verify-site-password', {
            password: savedPassword || ''
        });

        console.log('[SiteGuard] Verification response (full):', JSON.stringify(res, null, 2));

        if (res.success) {
            // 注意：有些接口可能直接返回数据，有些嵌套在 data 中
            const isValid = res.data ? res.data.valid : (res as any).valid;
            console.log('[SiteGuard] Extracted isValid:', isValid);

            if (isValid) {
                console.log('[SiteGuard] Access granted.');
                setIsLocked(false);
            } else {
                console.warn('[SiteGuard] Access denied. Site is locked.');
                setIsLocked(true);
            }
        } else if (res.error === 'SITE_LOCKED') {
            console.warn('[SiteGuard] Site is locked (401 error).');
            setIsLocked(true);
        } else {
            // 后端报错或其他情况，默认不锁定以防无法进入系统
            console.error('[SiteGuard] Unexpected verification error:', res.error);
            setIsLocked(false);
        }

        setLoading(false);
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        console.log('[SiteGuard] Attempting login...');

        const res = await apiPost<{ valid: boolean }>('/settings/verify-site-password', {
            password
        });

        const isValid = res.data ? res.data.valid : (res as any).valid;

        if (res.success && isValid) {
            console.log('[SiteGuard] Login success. Storing password and reloading.');
            localStorage.setItem('videox_site_password', password);
            setIsLocked(false);
            // 刷新页面以确保所有后续请求都带上 header (api.ts 会读取 localStorage)
            window.location.reload();
        } else {
            console.warn('[SiteGuard] Login failed. Invalid password.');
            setError('密码错误，请重试');
        }
    };

    if (loading) {
        return (
            <div className="fixed inset-0 bg-main flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <i className="fas fa-spinner fa-spin text-3xl text-blue-500"></i>
                    <p className="text-secondary">检查站点状态...</p>
                </div>
            </div>
        );
    }

    if (isLocked) {
        return (
            <div className="fixed inset-0 bg-main z-[9999] flex items-center justify-center p-6 overflow-hidden">
                {/* 背景装饰 */}
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500/10 blur-[120px] rounded-full"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/10 blur-[120px] rounded-full"></div>
                </div>

                <div className="glass-effect relative z-10 p-10 w-full max-w-md text-center rounded-3xl border border-border-color shadow-2xl space-y-8">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                        <i className="fas fa-fingerprint text-blue-500 text-3xl animate-pulse"></i>
                    </div>

                    <div>
                        <h1 className="text-3xl font-black text-primary tracking-tight mb-2">VideoX</h1>
                        <p className="text-secondary text-xs opacity-60">此站点已加密，请输入访问密码以继续</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-4">
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="访问密码"
                                autoFocus
                                className="w-full px-5 py-4 bg-white/10 text-white rounded-2xl border border-border-color 
                                         focus:border-blue-500 focus:bg-white/20 focus:outline-none text-center transition-all placeholder:text-white/20"
                            />
                            {error && (
                                <div className="py-2 px-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                                    <p className="text-red-400 text-xs font-semibold text-center">
                                        <i className="fas fa-exclamation-circle mr-2"></i>
                                        {error}
                                    </p>
                                </div>
                            )}
                        </div>

                        <button
                            type="submit"
                            className="w-full py-4 bg-blue-600 text-primary rounded-2xl hover:bg-blue-500 
                                     shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50 font-bold text-sm"
                        >
                            <i className="fas fa-shield-alt mr-2"></i> 进入站点
                        </button>
                    </form>

                    <p className="text-center text-secondary/30 text-[10px] tracking-widest uppercase">
                        VideoX Standalone Edition
                    </p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
