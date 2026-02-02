import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiPost, apiGet } from '../utils/api';

// localStorage key
const AUTH_KEY = 'video_admin_auth';
const AUTH_EXPIRY_HOURS = 24;

interface AuthState {
    isAuthenticated: boolean;
    password: string | null;
    expiresAt: number | null;
}

interface AuthContextType {
    isAuthenticated: boolean;
    password: string | null;
    login: (password: string) => Promise<boolean>;
    logout: () => void;
    checkPasswordRequired: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [authState, setAuthState] = useState<AuthState>(() => {
        // 从 localStorage 恢复登录状态
        try {
            const saved = localStorage.getItem(AUTH_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as AuthState;
                // 检查是否过期
                if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
                    return parsed;
                }
            }
        } catch {
            // 忽略解析错误
        }
        return { isAuthenticated: false, password: null, expiresAt: null };
    });

    // 保存到 localStorage
    useEffect(() => {
        if (authState.isAuthenticated) {
            localStorage.setItem(AUTH_KEY, JSON.stringify(authState));
        } else {
            localStorage.removeItem(AUTH_KEY);
        }
    }, [authState]);

    const login = async (password: string): Promise<boolean> => {
        try {
            const res = await apiPost<{ valid: boolean; message: string }>('/settings/verify-password', { password });
            const response = res as unknown as { success: boolean; valid: boolean; message: string };

            if (response.success && response.valid) {
                const expiresAt = Date.now() + AUTH_EXPIRY_HOURS * 60 * 60 * 1000;
                setAuthState({
                    isAuthenticated: true,
                    password,
                    expiresAt
                });
                return true;
            }
            return false;
        } catch {
            return false;
        }
    };

    const logout = () => {
        setAuthState({ isAuthenticated: false, password: null, expiresAt: null });
    };

    const checkPasswordRequired = async (): Promise<boolean> => {
        try {
            const res = await apiGet<{ admin_password_enabled: boolean }>('/settings');
            if (res.success && res.data) {
                return res.data.admin_password_enabled === true ||
                    String(res.data.admin_password_enabled) === 'true';
            }
            return false;
        } catch {
            return false;
        }
    };

    return (
        <AuthContext.Provider value={{
            isAuthenticated: authState.isAuthenticated,
            password: authState.password,
            login,
            logout,
            checkPasswordRequired
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
