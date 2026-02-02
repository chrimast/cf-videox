/**
 * 视频源
 */
export interface VideoSource {
    id: number;
    name: string;
    type: 'cms_api' | 'alist';
    url: string;
    api_key?: string;
    enabled: number;
    hidden: number;
    proxy_enabled?: number;
    tags?: string;
    remark?: string;
    response_time?: number;
    last_test_at?: string;
    failure_count?: number;
    status_message?: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

/**
 * 电视源
 */
export interface TvSource {
    id: number;
    name: string;
    type: 'm3u' | 'json';
    url: string;
    enabled: number;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

/**
 * 电视频道
 */
export interface TvChannel {
    name: string;
    url: string;
    group: string;
    logo?: string;
}

/**
 * 直播源
 */
export interface LiveSource {
    id: number;
    name: string;
    platform: string;
    channel_id: string;
    streamer_name?: string;
    category?: string;
    cover_url?: string;
    enabled: number;
    sort_order: number;
    tags?: string;
    remark?: string;
    created_at: string;
    updated_at: string;
}

/**
 * 直播状态
 */
export interface LiveStatus {
    source_id: number;
    is_live: number;
    title?: string;
    viewer_count?: number;
    stream_url?: string;
    cover_url?: string;
    avatar_url?: string;
    updated_at: string;
}

/**
 * 网盘扫描路径
 */
export interface NetdiskScanPath {
    name: string;
    path: string;
}

/**
 * 网盘源
 */
export interface NetdiskSource {
    id: number;
    name: string;
    type: string;
    url: string;
    username?: string;
    root_path: string;
    scan_paths?: NetdiskScanPath[] | string; // 指定扫描的目录列表
    enabled: number;
    proxy_enabled?: number;
    hidden?: number;
    remark?: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

/**
 * 网盘文件
 */
export interface NetdiskFile {
    name: string;
    size: number;
    is_dir: boolean;
    modified: string;
    created: string;
    thumb?: string;
    type: number;
    isVideo?: boolean;
    ext?: string;
}

/**
 * 分类
 */
export interface Category {
    id: number;
    source_id: number;
    type_id: string;
    name: string;
    parent_id: number;
    show_on_home: number;
    sort_order: number;
    has_content?: number;  // 1 = 有内容, 0 = 空分类
    source_name?: string;
    children?: Category[];
}

/**
 * 视频（列表项）
 */
export interface Video {
    vod_id: string;
    vod_name: string;
    vod_pic: string;
    vod_year: string;
    vod_area: string;
    vod_lang: string;
    vod_class: string;
    vod_remarks: string;
    vod_time: string;
    vod_score: string;
    type_id: string;
    type_name: string;
    vod_actor?: string;
    source_id?: number;
    source_name?: string;
    is_netdisk?: boolean;
    is_media_server?: boolean;
}

/**
 * 剧集
 */
export interface Episode {
    name: string;
    url: string;
}

/**
 * 播放源
 */
export interface PlaySource {
    source: string;
    list: Episode[];
}

/**
 * 视频详情
 */
export interface VideoDetail extends Video {
    vod_content: string;
    vod_actor: string;
    vod_director: string;
    vod_writer: string;
    vod_duration: string;
    vod_play_from: string;
    vod_play_url: string;
    episodes: PlaySource[];
    source_proxy_enabled?: boolean;
}

/**
 * 收藏
 */
export interface Favorite {
    id: number;
    source_id: number;
    source_type?: string;
    vod_id: string;
    title: string;
    cover: string;
    year: string;
    created_at: string;
    source_name?: string;
}

/**
 * 播放记录
 */
export interface PlayHistory {
    id: number;
    source_id: number;
    source_type?: string;
    vod_id: string;
    title: string;
    cover: string;
    episode: number;
    episode_name: string;
    progress: number;
    duration: number;
    updated_at: string;
    source_name?: string;
}

/**
 * 分页信息
 */
export interface Pagination {
    page: number;
    pagecount: number;
    limit: number;
    total: number;
}

/**
 * API 响应
 */
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    pagination?: Pagination;
}

/**
 * 设置
 */
export interface Settings {
    // 代理配置
    proxy_enabled: boolean;
    proxy_type: 'http' | 'socks5';
    proxy_host: string;
    proxy_port: number;
    proxy_auth_enabled: boolean;
    proxy_username: string;
    proxy_password: string;

    // 安全设置
    admin_password_enabled: boolean;
    admin_password: string;
    site_password_enabled: boolean;
    site_password: string;

    // TMDB 设置
    tmdb_api_key: string;

    // 其他设置
    banner_count: number;
    banner_sources: number[];
    default_source_id: string;
    theme: 'dark' | 'light';

    // STRM 转码配置
    strm_transcode_enabled: boolean;
    strm_transcode_mode: 'auto' | 'force';
    ffmpeg_path: string;
    ffmpeg_hwaccel: 'none' | 'nvenc' | 'qsv' | 'vaapi' | 'auto';
    ffmpeg_quality: 'fast' | 'medium' | 'high';

    // 并发设置
    scan_concurrency: number;
    image_concurrency: number;
    metadata_concurrency: number;
    probe_concurrency: number;
}

