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
  onSearch, onNavigate, activeView, activeModule, onModuleChange,
  onToggleSidebar, theme, onToggleTheme, isAdminPasswordEnabled,
}: GlobalSearchBarProps) {
  const [keyword, setKeyword] = useState('');
  const { isAuthenticated, login, logout, password } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (keyword.trim()) onSearch(keyword.trim(), null);
  };

  const handleUser = async () => {
    if (isAuthenticated) { onNavigate('admin'); setAccountOpen(false); return; }
    if (!isAdminPasswordEnabled) { await login(''); return; }
    setLoginOpen(true);
  };


  const confirmLogin = async () => {
    if (await login(loginPassword)) { setLoginOpen(false); setLoginPassword(''); onNavigate('admin'); }
  };

  return (
    <>
      <header className={`sticky top-0 z-20 border-b px-3 py-2 ${theme === 'dark' ? 'bg-secondary/95 border-border-color' : 'bg-white/95 border-gray-200'}`}>
        <div className="flex items-center gap-2 max-w-screen-2xl mx-auto">
          {onToggleSidebar && <button aria-label="打开菜单" onClick={onToggleSidebar} className="p-2 rounded-lg"><i className="fas fa-bars" /></button>}
          <button className="font-bold text-primary whitespace-nowrap" onClick={() => onNavigate('home')}>视频中心</button>
          <form onSubmit={submit} className="flex flex-1 min-w-0 gap-2">
            <input aria-label="搜索视频" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索全部视频..." className="min-w-0 flex-1 rounded-lg border border-border-color bg-transparent px-3 py-2 text-sm" />
            <button aria-label="搜索" type="submit" className="rounded-lg bg-blue-600 px-3 text-white"><i className="fas fa-search" /></button>
          </form>
          <button aria-label="切换主题" onClick={onToggleTheme} className="p-2 rounded-lg"><i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} /></button>
          <div className="relative">
            <button aria-label={isAuthenticated ? '已认证，打开账户菜单' : '未认证，打开登录窗口'} onClick={handleUser} className={`p-2 rounded-lg ${isAuthenticated ? 'text-green-500' : 'text-secondary'}`}><i className={`fas ${isAuthenticated ? 'fa-user-check' : 'fa-user-lock'}`} /></button>
            {accountOpen && isAuthenticated && <>
              <div className="fixed inset-0 z-20" onClick={() => setAccountOpen(false)} />
              <div className="absolute right-0 top-11 z-30 min-w-48 rounded-xl border border-border-color bg-primary p-2 shadow-xl">
                <div className="border-b border-border-color px-3 py-2 mb-1"><p className="text-[10px] uppercase tracking-wider text-secondary">当前身份</p><p className="text-sm font-bold text-primary">系统管理员</p></div>
                <button onClick={() => { logout(); setAccountOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-white/10"><i className="fas fa-sign-out-alt mr-2" />安全退出登录</button>
              </div>
            </>}
          </div>
        </div>
        {loginOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md" onClick={() => setLoginOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border-color bg-secondary p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-6 flex flex-col items-center"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10"><i className="fas fa-user-shield text-2xl text-red-500" /></div><h3 className="text-2xl font-black text-primary">管理员登录</h3><p className="mt-1 text-sm text-secondary">请输入管理密码以继续</p></div>
            <input autoFocus type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="管理密码" className="w-full rounded-xl border border-border-color bg-white px-4 py-3 text-center font-mono tracking-wider text-black placeholder:text-gray-400" onKeyDown={e => e.key === 'Enter' && confirmLogin()} />
            <div className="mt-5 flex gap-3"><button onClick={() => setLoginOpen(false)} className="flex-1 rounded-xl border border-border-color px-4 py-3 font-bold text-primary">取消</button><button onClick={confirmLogin} className="flex-1 rounded-xl bg-red-500 px-4 py-3 font-bold text-white">确认登录</button></div>
          </div>
        </div>}
      </header>
      <div className="hidden" data-active-view={activeView} data-active-module={activeModule} data-auth-password={password ? 'set' : 'unset'}>
        <button onClick={() => onModuleChange(activeModule)} />
      </div>
    </>
  );
}
