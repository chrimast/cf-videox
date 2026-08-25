import { useState, useEffect } from 'react';
import { Settings } from '../types';
import { apiGet, apiPost, apiPut } from '../utils/api';

interface SettingsManagerProps {
    onSettingsChange?: () => void;
}

export function SettingsManager({ onSettingsChange }: SettingsManagerProps) {
    const [settings, setSettings] = useState<Partial<Settings>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // 测试状态
    const [testingProxy, setTestingProxy] = useState(false);
    const [testingTmdb, setTestingTmdb] = useState(false);

    const [proxyTestResult, setProxyTestResult] = useState<{ valid: boolean; message: string } | null>(null);
    const [tmdbTestResult, setTmdbTestResult] = useState<{ valid: boolean; message: string } | null>(null);


    // 密码确认
    const [confirmPassword, setConfirmPassword] = useState('');


    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        setLoading(true);
        const res = await apiGet<Settings>('/settings');
        if (res.success && res.data) {
            setSettings(res.data);
        }
        setLoading(false);
    };

    const handleSave = async () => {
        // 验证密码确认
        if (settings.admin_password_enabled && settings.admin_password) {
            if (settings.admin_password !== confirmPassword) {
                alert('两次输入的密码不一致');
                return;
            }
        }

        setSaving(true);
        const res = await apiPut('/settings', settings);
        if (res.success) {
            alert('设置已保存');

            onSettingsChange?.();
        } else {
            alert('保存失败: ' + res.error);
        }
        setSaving(false);
    };

    const handleTestProxy = async () => {
        setTestingProxy(true);
        setProxyTestResult(null);

        const res = await apiPost<{ valid: boolean; message: string }>('/settings/test-proxy', {
            proxy_type: settings.proxy_type,
            proxy_host: settings.proxy_host,
            proxy_port: settings.proxy_port,
            proxy_auth_enabled: settings.proxy_auth_enabled,
            proxy_username: settings.proxy_username,
            proxy_password: settings.proxy_password
        });

        if (res.success) {
            setProxyTestResult({ valid: (res as any).valid || false, message: (res as any).message || '测试完成' });
        } else {
            setProxyTestResult({ valid: false, message: res.error || '测试失败' });
        }
        setTestingProxy(false);
    };

    const handleTestTmdb = async () => {
        setTestingTmdb(true);
        setTmdbTestResult(null);

        const res = await apiPost<{ valid: boolean; message: string }>('/settings/test-tmdb', {
            api_key: settings.tmdb_api_key
        });

        if (res.success) {
            setTmdbTestResult({ valid: (res as any).valid || false, message: (res as any).message || '测试完成' });
        } else {
            setTmdbTestResult({ valid: false, message: res.error || '测试失败' });
        }
        setTestingTmdb(false);
    };


    if (loading) {
        return (
            <div className="animate-pulse space-y-4">
                <div className="h-10 bg-secondary rounded w-full"></div>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-16 bg-secondary rounded"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* 代理配置 */}
            <div className="bg-secondary/50 rounded-xl p-6 border border-border-color">
                <h3
                    className="text-lg font-medium text-primary mb-4 flex items-center gap-2"
                >
                    <i className="fas fa-network-wired text-blue-400"></i>
                    代理配置
                </h3>
                <p className="text-secondary text-sm mb-4">
                    配置网络代理服务器，用于访问外部采集站和资源
                </p>

                <div className="space-y-4">
                    {/* 启用开关 */}
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.proxy_enabled || false}
                            onChange={e => setSettings(prev => ({ ...prev, proxy_enabled: e.target.checked }))}
                            className="w-5 h-5 rounded"
                        />
                        <span className="text-primary">启用代理</span>
                    </label>

                    {settings.proxy_enabled && (
                        <>
                            {/* 代理类型 */}
                            <div className="max-w-xs">
                                <label className="block text-secondary text-sm mb-2">代理类型</label>
                                <select
                                    value={settings.proxy_type || 'http'}
                                    onChange={e => setSettings(prev => ({ ...prev, proxy_type: e.target.value as 'http' | 'socks5' }))}
                                    className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                             focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="http">HTTP</option>
                                    <option value="socks5">SOCKS5</option>
                                </select>
                            </div>

                            {/* 服务器地址和端口 */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="md:col-span-3">
                                    <label className="block text-secondary text-sm mb-2">服务器地址</label>
                                    <input
                                        type="text"
                                        value={settings.proxy_host || ''}
                                        onChange={e => setSettings(prev => ({ ...prev, proxy_host: e.target.value }))}
                                        placeholder="127.0.0.1"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                                 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-secondary text-sm mb-2">端口</label>
                                    <input
                                        type="number"
                                        value={settings.proxy_port || ''}
                                        onChange={e => setSettings(prev => ({ ...prev, proxy_port: parseInt(e.target.value) || 0 }))}
                                        placeholder="7890"
                                        className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                                 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* 认证 */}
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.proxy_auth_enabled || false}
                                    onChange={e => setSettings(prev => ({ ...prev, proxy_auth_enabled: e.target.checked }))}
                                    className="w-4 h-4 rounded"
                                />
                                <span className="text-secondary text-sm">需要认证</span>
                            </label>

                            {settings.proxy_auth_enabled && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-secondary text-sm mb-2">用户名</label>
                                        <input
                                            type="text"
                                            value={settings.proxy_username || ''}
                                            onChange={e => setSettings(prev => ({ ...prev, proxy_username: e.target.value }))}
                                            className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                                     focus:border-blue-500 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-secondary text-sm mb-2">密码</label>
                                        <input
                                            type="password"
                                            value={settings.proxy_password || ''}
                                            onChange={e => setSettings(prev => ({ ...prev, proxy_password: e.target.value }))}
                                            className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                                     focus:border-blue-500 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* 测试按钮 */}
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={handleTestProxy}
                                    disabled={testingProxy || !settings.proxy_host || !settings.proxy_port}
                                    className="px-4 py-2 bg-blue-600 dark:bg-blue-500 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 
                                             transition-colors disabled:opacity-50 flex items-center gap-2 text-white"
                                >
                                    {testingProxy ? (
                                        <><i className="fas fa-spinner fa-spin"></i> 测试中...</>
                                    ) : (
                                        <><i className="fas fa-plug"></i> 测试连接</>
                                    )}
                                </button>
                                {proxyTestResult && (
                                    <span className={`text-sm font-medium ${proxyTestResult.valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                        <i className={`fas fa-${proxyTestResult.valid ? 'check' : 'times'} mr-1`}></i>
                                        {proxyTestResult.message}
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* 安全设置 */}
            <div className="bg-secondary/50 rounded-xl p-6 border border-border-color">
                <h3
                    className="text-lg font-medium text-primary mb-4 flex items-center gap-2"
                >
                    <i className="fas fa-shield-alt text-green-400"></i>
                    安全设置
                </h3>
                <p className="text-secondary text-sm mb-4">
                    开启后访问后台需要输入密码，输入密码也可查看隐藏的视频源
                </p>

                <div className="space-y-4">
                    {/* 启用开关 */}
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.admin_password_enabled || false}
                            onChange={e => setSettings(prev => ({ ...prev, admin_password_enabled: e.target.checked }))}
                            className="w-5 h-5 rounded"
                        />
                        <span className="text-primary">启用访问密码</span>
                    </label>

                    {settings.admin_password_enabled && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-secondary text-sm mb-2">设置密码</label>
                                <input
                                    type="password"
                                    value={settings.admin_password || ''}
                                    onChange={e => setSettings(prev => ({ ...prev, admin_password: e.target.value }))}
                                    placeholder="输入访问密码"
                                    className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                             focus:border-green-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-secondary text-sm mb-2">确认密码</label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    placeholder="再次输入密码"
                                    className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                             focus:border-green-500 focus:outline-none"
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="h-px bg-border-color my-6"></div>

                <p className="text-secondary text-sm mb-4">
                    全站访问密码：开启后访问任何组件（包括主页）都需要输入密码（通常用于外网公开部署）
                </p>

                <div className="space-y-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.site_password_enabled || false}
                            onChange={e => setSettings(prev => ({ ...prev, site_password_enabled: e.target.checked }))}
                            className="w-5 h-5 rounded"
                        />
                        <span className="text-primary">启用全站访问密码</span>
                    </label>

                    {settings.site_password_enabled && (
                        <div className="max-w-md">
                            <label className="block text-secondary text-sm mb-2">设置全站密码</label>
                            <input
                                type="password"
                                value={settings.site_password || ''}
                                onChange={e => setSettings(prev => ({ ...prev, site_password: e.target.value }))}
                                placeholder="输入全站访问密码"
                                className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                         focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* TMDB API 设置 */}
            <div className="bg-secondary/50 rounded-xl p-6 border border-border-color">
                <h3
                    className="text-lg font-medium text-primary mb-4 flex items-center gap-2"
                >
                    <i className="fas fa-film text-purple-400"></i>
                    TMDB API 设置
                </h3>
                <p className="text-secondary text-sm mb-4">
                    API Key 用于获取电影、电视剧的详细信息、海报、演员等信息
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-secondary text-sm mb-2">API Key</label>
                        <input
                            type="text"
                            value={settings.tmdb_api_key || ''}
                            onChange={e => setSettings(prev => ({ ...prev, tmdb_api_key: e.target.value }))}
                            placeholder="输入 TMDB API Key"
                            className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                     focus:border-purple-500 focus:outline-none"
                        />
                        <p className="text-secondary text-xs mt-1">
                            从 <a href="https://www.themoviedb.org/settings/api" target="_blank" className="text-purple-400 hover:underline">TMDB</a> 获取
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleTestTmdb}
                            disabled={testingTmdb || !settings.tmdb_api_key}
                            className="px-4 py-2 bg-purple-600 dark:bg-purple-500 rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 
                                     transition-colors disabled:opacity-50 flex items-center gap-2 text-white"
                        >
                            {testingTmdb ? (
                                <><i className="fas fa-spinner fa-spin"></i> 测试中...</>
                            ) : (
                                <><i className="fas fa-check-circle"></i> 测试连接</>
                            )}
                        </button>
                        {tmdbTestResult && (
                            <span className={`text-sm font-medium ${tmdbTestResult.valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                <i className={`fas fa-${tmdbTestResult.valid ? 'check' : 'times'} mr-1`}></i>
                                {tmdbTestResult.message}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* 在线播放说明 */}
            <div className="bg-secondary/50 rounded-xl p-6 border border-border-color">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                        <i className="fas fa-play text-green-400"></i>
                    </div>
                    <h3 className="text-lg font-bold">在线播放</h3>
                </div>
                <p className="text-secondary text-sm leading-relaxed">
                    当前版本仅支持源站提供的在线 MP4、M3U8/HLS 和其他浏览器可播放的视频地址。
                    不使用本地媒体目录，不安装或调用转码程序；浏览器不兼容的编码请更换播放源或设备。
                </p>
            </div>

            {/* 扫描与性能设置 */}
            <div className="bg-secondary/50 rounded-xl p-6 border border-border-color">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <i className="fas fa-bolt text-blue-400"></i>
                    </div>
                    <h3 className="text-lg font-bold">扫描与性能控制</h3>
                </div>

                <p className="text-secondary text-sm mb-6">
                    根据服务器配置调整并发处理速度。数值越高处理越快，但也更消耗 CPU 和网盘带宽。
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-secondary text-sm mb-2">目录扫描并发 (默认: 5)</label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={settings.scan_concurrency || 5}
                            onChange={e => setSettings(prev => ({ ...prev, scan_concurrency: parseInt(e.target.value) || 5 }))}
                            className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                     focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-black dark:text-white mt-1.5 leading-relaxed">
                            <i className="fas fa-info-circle mr-1.5 text-blue-500"></i>
                            影响阶段: 初始手动扫描。主要消耗网络/API 请求次数，对磁盘 IO 影响较小。
                        </p>
                    </div>

                    <div>
                        <label className="block text-secondary text-sm mb-2">图片缓存并发 (默认: 5)</label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={settings.image_concurrency || 5}
                            onChange={e => setSettings(prev => ({ ...prev, image_concurrency: parseInt(e.target.value) || 5 }))}
                            className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                     focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-black dark:text-white mt-1.5 leading-relaxed">
                            <i className="fas fa-exclamation-triangle mr-1.5 text-amber-500"></i>
                            影响阶段: 后台静默。**高 IO 负载**: 涉及频繁的小文件写入，调高会显著增加磁盘压力。
                        </p>
                    </div>

                    <div>
                        <label className="block text-secondary text-sm mb-2">元数据补全并发 (默认: 5)</label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={settings.metadata_concurrency || 5}
                            onChange={e => setSettings(prev => ({ ...prev, metadata_concurrency: parseInt(e.target.value) || 5 }))}
                            className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                     focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-black dark:text-white mt-1.5 leading-relaxed">
                            <i className="fas fa-info-circle mr-1.5 text-blue-500"></i>
                            影响阶段: 后台静默。主要消耗网络请求（NFO下载/TMDB），涉及少量 NFO 解析。
                        </p>
                    </div>

                    <div>
                        <label className="block text-secondary text-sm mb-2">视频探测并发 (默认: 3)</label>
                        <input
                            type="number"
                            min="1"
                            max="10"
                            value={settings.probe_concurrency || 3}
                            onChange={e => setSettings(prev => ({ ...prev, probe_concurrency: parseInt(e.target.value) || 3 }))}
                            className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                     focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-black dark:text-white mt-1.5 leading-relaxed">
                            <i className="fas fa-microchip mr-1.5 text-red-500"></i>
                            影响阶段: 后台静默。**中到高 CPU 负载**: 调用 ffprobe 涉及视频流读取解析。
                        </p>
                    </div>
                </div>
            </div>

            {/* 保存按钮 */}
            <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-3 bg-red-600 dark:bg-red-500 rounded-lg hover:bg-red-700 dark:hover:bg-red-600 
                         transition-colors disabled:opacity-50 font-medium text-white"
            >
                {saving ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> 保存中...</>
                ) : (
                    <><i className="fas fa-save mr-2"></i> 保存设置</>
                )}
            </button>
        </div>
    );
}
