/**
 * AList 网盘服务
 * 用于读取 OpenList/AList 网盘中的视频文件
 */

class AlistService {
    constructor(baseUrl, password = '') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.password = password;
        this.username = 'admin'; // 默认用户名
        this.token = null;
    }

    /**
     * 登录获取 Token
     * @param {string} username - 用户名（可选，默认使用 this.username）
     * @param {string} password - 密码（可选，默认使用 this.password）
     */
    async login(username = null, password = null) {
        const loginUsername = username || this.username;
        const loginPassword = password || this.password;

        console.log(`[AList] DEBUG: Attempting login for user "${loginUsername}" at "${this.baseUrl}"`);

        // 如果外部主动传入了 null/undefined 密码且内部也没有，说明用户确实没填
        if (loginPassword === null || loginPassword === undefined || loginPassword === '') {
            console.log(`[AList] DEBUG: No password provided, skipping authentication and using guest access (if allowed by server)`);
            return true;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: loginUsername,
                    password: loginPassword
                })
            });

            const result = await response.json();
            console.log(`[AList] DEBUG: Login Response Code: ${result.code}, Message: ${result.message}`);
            if (result.code === 200) {
                this.token = result.data.token;
                console.log(`[AList] DEBUG: Login successful, token acquired`);
                return true;
            }
            console.error(`[AList] ERROR: Login failed (Code ${result.code}): ${result.message}`);
            return false;
        } catch (error) {
            console.error('[AList] ERROR: Login request failed:', error);
            return false;
        }
    }

    /**
     * 获取认证头
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.token) {
            headers['Authorization'] = this.token;
        }
        return headers;
    }

    /**
     * 获取目录列表
     * @param {string} path - 目录路径
     */
    async list(path = '/') {
        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            if (this.token) {
                headers['Authorization'] = this.token;
            }

            console.log(`[AList] DEBUG: Listing path "${path}" at "${this.baseUrl}"`);
            const response = await fetch(`${this.baseUrl}/api/fs/list`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    path,
                    password: '',
                    page: 1,
                    per_page: 0,
                    refresh: false
                })
            });

            const result = await response.json();
            console.log(`[AList] DEBUG: Response Code: ${result.code}, Message: ${result.message}`);

            if (result.code === 200) {
                const content = result.data.content || [];
                console.log(`[AList] DEBUG: Raw content length: ${content.length}`);
                if (content.length > 0) {
                    console.log(`[AList] DEBUG: First item sample: ${JSON.stringify(content[0])}`);
                }

                // 标准化：AList 的 type=1 代表目录，或者本身就有 is_dir
                const mapped = content.map(item => ({
                    ...item,
                    is_dir: item.is_dir === true || item.type === 1
                }));
                console.log(`[AList] DEBUG: Found ${mapped.filter(i => i.is_dir).length} directories after mapping`);
                return mapped;
            }
            console.error(`[AList] ERROR: List failed: ${result.message}`);
            return [];
        } catch (error) {
            console.error('[AList] List failed:', error);
            return [];
        }
    }

    /**
     * 获取文件详情（含直链）
     * @param {string} path - 文件路径
     */
    async getFileInfo(path) {
        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            if (this.token) {
                headers['Authorization'] = this.token;
            }

            const response = await fetch(`${this.baseUrl}/api/fs/get`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ path, password: '' })
            });

            const result = await response.json();
            if (result.code === 200) {
                return result.data;
            }
            return null;
        } catch (error) {
            console.error('[AList] Get file info failed:', error);
            return null;
        }
    }

    /**
     * 递归获取视频文件列表
     * @param {string} path - 起始路径
     * @param {number} depth - 递归深度
     */
    async getVideoFiles(path = '/', depth = 3) {
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m3u8', '.ts'];
        const videos = [];

        const processDirectory = async (dirPath, currentDepth) => {
            if (currentDepth > depth) return;

            const items = await this.list(dirPath);

            for (const item of items) {
                const itemPath = `${dirPath}/${item.name}`.replace(/\/+/g, '/');

                if (item.is_dir) {
                    await processDirectory(itemPath, currentDepth + 1);
                } else {
                    const ext = item.name.toLowerCase().match(/\.[^.]+$/)?.[0];
                    if (ext && videoExtensions.includes(ext)) {
                        videos.push({
                            name: item.name,
                            path: itemPath,
                            size: item.size,
                            modified: item.modified,
                            // 从目录名推断信息
                            ...this.parseFileName(item.name, dirPath)
                        });
                    }
                }
            }
        };

        await processDirectory(path, 1);
        return videos;
    }

    /**
     * 从文件名解析影片信息
     */
    parseFileName(fileName, dirPath) {
        // 移除扩展名
        const name = fileName.replace(/\.[^.]+$/, '');

        // 尝试匹配年份
        const yearMatch = name.match(/[（(](\d{4})[)）]/) || name.match(/\.(\d{4})\./);
        const year = yearMatch ? yearMatch[1] : null;

        // 尝试匹配集数
        const episodeMatch = name.match(/[eE](\d+)/) || name.match(/第(\d+)集/);
        const episode = episodeMatch ? parseInt(episodeMatch[1]) : null;

        // 清理标题
        let title = name
            .replace(/\.\d{4}\..*$/, '') // 移除 .年份.xxx
            .replace(/[（(]\d{4}[)）].*$/, '') // 移除 (年份)xxx
            .replace(/\./g, ' ')
            .trim();

        return { title, year, episode };
    }

    /**
     * 获取播放链接
     */
    async getPlayUrl(path) {
        const fileInfo = await this.getFileInfo(path);
        if (fileInfo && fileInfo.raw_url) {
            return fileInfo.raw_url;
        }
        // 返回 AList 的代理链接
        return `${this.baseUrl}/d${path}`;
    }
}

module.exports = { AlistService };
