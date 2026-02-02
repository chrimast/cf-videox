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
    const [testingFfmpeg, setTestingFfmpeg] = useState(false);
    const [proxyTestResult, setProxyTestResult] = useState<{ valid: boolean; message: string } | null>(null);
    const [tmdbTestResult, setTmdbTestResult] = useState<{ valid: boolean; message: string } | null>(null);
    const [ffmpegTestResult, setFfmpegTestResult] = useState<{ available: boolean; version: string; platform?: string; hwaccel?: { nvenc: boolean; qsv: boolean; vaapi: boolean } } | null>(null);
    const [isInstallingFfmpeg, setIsInstallingFfmpeg] = useState(false);
    const [installProgress, setInstallProgress] = useState(0);

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

    const handleTestFfmpeg = async () => {
        setTestingFfmpeg(true);
        setFfmpegTestResult(null);

        const res = await apiGet<{ available: boolean; version: string; platform?: string; hwaccel?: { nvenc: boolean; qsv: boolean; vaapi: boolean } }>('/transcode/detect', {
            path: settings.ffmpeg_path || ''
        });

        if (res.success && res.data) {
            setFfmpegTestResult(res.data);
        } else {
            setFfmpegTestResult({ available: false, version: '' });
        }
        setTestingFfmpeg(false);
    };

    const handleInstallFfmpeg = async () => {
        if (!confirm('确定要自动下载并安装 FFmpeg 吗？\n将从 reliable CDN 下载静态包 (~70MB)，仅支持 Linux x64/arm64。')) return;

        setIsInstallingFfmpeg(true);
        setInstallProgress(0);

        try {
            // 触发安装
            const startRes = await apiPost('/transcode/install', {});
            if (!startRes.success) {
                alert('启动安装失败: ' + startRes.error);
                setIsInstallingFfmpeg(false);
                return;
            }

            // 轮询进度
            const interval = setInterval(async () => {
                const statusRes = await apiGet<{ status: string; progress: number; error?: string }>('/transcode/install/status');
                if (statusRes.success && statusRes.data) {
                    const { status, progress, error } = statusRes.data;
                    setInstallProgress(progress);

                    if (status === 'completed') {
                        clearInterval(interval);
                        setIsInstallingFfmpeg(false);
                        alert('FFmpeg 安装成功！');
                        handleTestFfmpeg(); // 重新检测
                    } else if (status === 'error') {
                        clearInterval(interval);
                        setIsInstallingFfmpeg(false);
                        alert('安装失败: ' + error);
                    }
                }
            }, 1000);
        } catch (e) {
            console.error(e);
            setIsInstallingFfmpeg(false);
            alert('请求失败');
        }
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

            {/* 转码设置 */}
            <div className="bg-secondary/50 rounded-xl p-6 border border-border-color">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                        <i className="fas fa-film text-orange-400"></i>
                    </div>
                    <h3 className="text-lg font-bold">转码设置</h3>
                </div>

                <p className="text-secondary text-sm mb-4">
                    当视频内容（如 HEVC, MPEG, WMV 等编码）由于浏览器兼容性无法直接播放时，使用 FFmpeg 转码为兼容格式
                </p>

                <div className="space-y-4">
                    {/* 启用开关 */}
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.strm_transcode_enabled || false}
                            onChange={e => setSettings(prev => ({ ...prev, strm_transcode_enabled: e.target.checked }))}
                            className="w-5 h-5 rounded bg-secondary border-border-color text-orange-500 
                                     focus:ring-orange-500 focus:ring-offset-0"
                        />
                        <span>启用转码服务</span>
                    </label>

                    {settings.strm_transcode_enabled && (
                        <>
                            {/* FFmpeg 路径 */}
                            <div>
                                <label className="block text-secondary text-sm mb-2">FFmpeg 路径</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={settings.ffmpeg_path || ''}
                                        onChange={e => setSettings(prev => ({ ...prev, ffmpeg_path: e.target.value }))}
                                        placeholder="ffmpeg (留空使用系统默认)"
                                        className="flex-1 px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                                 focus:border-orange-500 focus:outline-none"
                                    />
                                    <button
                                        onClick={handleTestFfmpeg}
                                        disabled={testingFfmpeg}
                                        className="px-4 py-2 bg-orange-500 rounded-lg hover:bg-orange-600 
                                                 transition-colors disabled:opacity-50 whitespace-nowrap"
                                    >
                                        {testingFfmpeg ? (
                                            <><i className="fas fa-spinner fa-spin"></i></>
                                        ) : (
                                            <>检测</>
                                        )}
                                    </button>
                                </div>
                                {ffmpegTestResult && (
                                    <div className={`mt-2 text-sm ${ffmpegTestResult.available ? 'text-green-400' : 'text-red-400'}`}>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <i className={`fas fa-${ffmpegTestResult.available ? 'check-circle' : 'times-circle'} mr-1`}></i>
                                                {ffmpegTestResult.available
                                                    ? `已检测到 FFmpeg ${ffmpegTestResult.version}`
                                                    : '未检测到 FFmpeg'}
                                            </div>

                                            {/* 一键安装按钮 - 仅限 Linux */}
                                            {!ffmpegTestResult.available && !isInstallingFfmpeg && ffmpegTestResult.platform === 'linux' && (
                                                <button
                                                    onClick={handleInstallFfmpeg}
                                                    className="text-orange-400 hover:text-orange-300 underline text-xs ml-4"
                                                >
                                                    一键安装便携版 (Linux Only)
                                                </button>
                                            )}
                                        </div>

                                        {/* 安装进度条 */}
                                        {isInstallingFfmpeg && (
                                            <div className="mt-2 w-full bg-secondary/80 rounded-full h-2.5">
                                                <div
                                                    className="bg-orange-500 h-2.5 rounded-full transition-all duration-300"
                                                    style={{ width: `${installProgress}%` }}
                                                ></div>
                                                <p className="text-xs text-secondary mt-1 text-center">正在下载并安装... {installProgress}%</p>
                                            </div>
                                        )}

                                        {ffmpegTestResult.hwaccel && (
                                            <span className="ml-2 text-secondary">
                                                硬件加速:
                                                {ffmpegTestResult.hwaccel.nvenc && <span className="text-green-400 ml-1">NVENC</span>}
                                                {ffmpegTestResult.hwaccel.qsv && <span className="text-green-400 ml-1">QSV</span>}
                                                {ffmpegTestResult.hwaccel.vaapi && <span className="text-green-400 ml-1">VA-API</span>}
                                                {!ffmpegTestResult.hwaccel.nvenc && !ffmpegTestResult.hwaccel.qsv && !ffmpegTestResult.hwaccel.vaapi && <span className="text-secondary ml-1">无</span>}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 转码模式 */}
                            <div>
                                <label className="block text-secondary text-sm mb-2">转码模式</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="transcode_mode"
                                            checked={settings.strm_transcode_mode !== 'force'}
                                            onChange={() => setSettings(prev => ({ ...prev, strm_transcode_mode: 'auto' }))}
                                            className="text-orange-500 focus:ring-orange-500"
                                        />
                                        <span>自动 <span className="text-secondary text-sm">(播放失败时转码)</span></span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="transcode_mode"
                                            checked={settings.strm_transcode_mode === 'force'}
                                            onChange={() => setSettings(prev => ({ ...prev, strm_transcode_mode: 'force' }))}
                                            className="text-orange-500 focus:ring-orange-500"
                                        />
                                        <span>强制 <span className="text-secondary text-sm">(所有资源都转码)</span></span>
                                    </label>
                                </div>
                            </div>

                            {/* 硬件加速 */}
                            <div>
                                <label className="block text-secondary text-sm mb-2">硬件加速</label>
                                <select
                                    value={settings.ffmpeg_hwaccel || 'none'}
                                    onChange={e => setSettings(prev => ({ ...prev, ffmpeg_hwaccel: e.target.value as Settings['ffmpeg_hwaccel'] }))}
                                    className="w-full px-4 py-2 bg-secondary text-primary rounded-lg border border-border-color 
                                             focus:border-orange-500 focus:outline-none"
                                >
                                    <option value="none">无 (CPU 软解)</option>
                                    <option value="nvenc">NVIDIA NVENC</option>
                                    <option value="qsv">Intel QSV</option>
                                    <option value="vaapi">VA-API (Linux)</option>
                                </select>
                            </div>

                            {/* 输出质量 */}
                            <div>
                                <label className="block text-secondary text-sm mb-2">输出质量</label>
                                <div className="flex gap-4">
                                    {[
                                        { value: 'fast', label: '快速', desc: '速度优先' },
                                        { value: 'medium', label: '平衡', desc: '推荐' },
                                        { value: 'high', label: '高质量', desc: '画质优先' }
                                    ].map(opt => (
                                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="ffmpeg_quality"
                                                checked={(settings.ffmpeg_quality || 'medium') === opt.value}
                                                onChange={() => setSettings(prev => ({ ...prev, ffmpeg_quality: opt.value as Settings['ffmpeg_quality'] }))}
                                                className="bg-secondary border-border-color text-orange-500 focus:ring-orange-500"
                                            />
                                            <span>{opt.label} <span className="text-secondary text-sm">({opt.desc})</span></span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
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
