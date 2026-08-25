import React, { useState } from 'react';
import { VideoSource } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { AppModule } from '../App';

interface GlobalSearchBarProps {
  sources: VideoSource[];
  onSearch: (keyword: string, sourceId: number | null) => void;
  onNavigate: (view: string, params?: Record<string, unknown>) => void;
  activeView: string;
  activeModule: AppModule;
  onModuleChange: (module: AppModule) => void;
  onToggleSidebar?: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  isAdminPasswordEnabled?: boolean;
}

export function GlobalSearchBar({
  sources, onSearch, onNavigate, activeView, activeModule, onModuleChange,
  onToggleSidebar, theme, onToggleTheme, isAdminPasswordEnabled,
}: GlobalSearchBarProps) {
  const [keyword, setKeyword] = useState('');
  const [sourceId, setSourceId] = useState<number | null>(null);
  const { isAuthenticated, login, logout, password } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (keyword.trim()) onSearch(keyword.trim(), sourceId);
  };

  const handleUser = async () => {
    if (isAuthenticated) { logout(); return; }
    if (!isAdminPasswordEnabled) { await login(''); return; }
    setLoginOpen(true);
  };

  const confirmLogin = async () => {
    if (await login(loginPassword)) { setLoginOpen(false); setLoginPassword(''); onNavigate('admin'); }
  };

  const openAdmin = async () => {
    if (isAuthenticated) { onNavigate('admin'); return; }
    if (!isAdminPasswordEnabled) { if (await login('')) onNavigate('admin'); return; }
    setLoginOpen(true);
  };

  return (
    <>
      <header className={`sticky top-0 z-20 border-b px-3 py-2 ${theme === 'dark' ? 'bg-secondary/95 border-border-color' : 'bg-white/95 border-gray-200'}`}>
        <div className="flex items-center gap-2 max-w-screen-2xl mx-auto">
          {onToggleSidebar && <button aria-label="打开菜单" onClick={onToggleSidebar} className="p-2 rounded-lg"><i className="fas fa-bars" /></button>}
          <button className="font-bold text-primary whitespace-nowrap" onClick={() => onNavigate('home')}>视频中心</button>
          <form onSubmit={submit} className="flex flex-1 min-w-0 gap-2">
            <select aria-label="视频源" value={sourceId ?? ''} onChange={e => setSourceId(e.target.value ? Number(e.target.value) : null)} className="hidden sm:block max-w-40 rounded-lg border border-border-color bg-transparent px-2 text-sm">
              <option value="">全部源</option>
              {sources.filter(source => source.enabled && !source.hidden).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
            <input aria-label="搜索视频" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索视频..." className="min-w-0 flex-1 rounded-lg border border-border-color bg-transparent px-3 py-2 text-sm" />
            <button aria-label="搜索" type="submit" className="rounded-lg bg-blue-600 px-3 text-white"><i className="fas fa-search" /></button>
          </form>
          <button aria-label="打开管理中心" onClick={openAdmin} className="p-2 rounded-lg"><i className="fas fa-cog" /></button>
          <button aria-label="切换主题" onClick={onToggleTheme} className="p-2 rounded-lg"><i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} /></button>
          <button aria-label="用户登录" onClick={handleUser} className={`p-2 rounded-lg ${isAuthenticated ? 'text-green-500' : ''}`}><i className="fas fa-user" /></button>
        </div>
        {loginOpen && <div className="absolute right-3 top-14 z-30 rounded-xl border border-border-color bg-primary p-3 shadow-xl">
          <input autoFocus type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="管理密码" className="rounded border border-border-color bg-transparent px-2 py-1" onKeyDown={e => e.key === 'Enter' && confirmLogin()} />
          <button onClick={confirmLogin} className="ml-2 rounded bg-blue-600 px-3 py-1 text-white">登录</button>
        </div>}
      </header>
      <div className="hidden" data-active-view={activeView} data-active-module={activeModule} data-auth-password={password ? 'set' : 'unset'}>
        <button onClick={() => onModuleChange(activeModule)} />
      </div>
    </>
  );
}
