/**
 * 导航上下文
 * 提供全局的自定义导航函数，供所有子组件使用
 */
import { createContext, useContext, ReactNode } from 'react';

type NavigateFn = (view: string, params?: Record<string, unknown>) => void;

const NavigationContext = createContext<NavigateFn | null>(null);

interface NavigationProviderProps {
    children: ReactNode;
    navigate: NavigateFn;
}

export function NavigationProvider({ children, navigate }: NavigationProviderProps) {
    return (
        <NavigationContext.Provider value={navigate}>
            {children}
        </NavigationContext.Provider>
    );
}

export function useAppNavigate(): NavigateFn {
    const navigate = useContext(NavigationContext);
    if (!navigate) {
        // 如果没有在 Provider 中，返回一个空函数
        console.warn('[NavigationContext] useAppNavigate called outside NavigationProvider');
        return () => { };
    }
    return navigate;
}
