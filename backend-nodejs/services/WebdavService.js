/**
 * WebDAV 网盘服务
 */
const { XMLParser } = require('fast-xml-parser');
const fetch = require('node-fetch');

class WebdavService {
    constructor(baseUrl, username = '', password = '') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.username = username;
        this.password = password;
        this.parser = new XMLParser({
            ignoreAttributes: false,
            removeNSPrefix: true
        });
    }

    // Helper: encode path segments for URL
    encodePath(path) {
        return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    }

    getHeaders() {
        const headers = {
            'Depth': '1',
            'Content-Type': 'application/xml; charset=utf-8'
        };
        if (this.username || this.password) {
            const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
        }
        return headers;
    }

    /**
     * 获取列表
     */
    async list(path = '/', retries = 2) {
        const encodedPath = this.encodePath(path);
        const url = `${this.baseUrl}${encodedPath.startsWith('/') ? encodedPath : '/' + encodedPath}`;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                // 添加超时控制
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

                const response = await fetch(url, {
                    method: 'PROPFIND',
                    headers: this.getHeaders(),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.error(`[WebDAV] List failed: ${response.status} ${response.statusText}`);
                    return [];
                }

                const xml = await response.text();
                const jsonObj = this.parser.parse(xml);

                let responses = jsonObj.multistatus?.response;
                if (!responses) return [];
                if (!Array.isArray(responses)) responses = [responses];

                // 第一个通常是当前目录自己，过滤掉
                const currentHref = new URL(url).pathname.replace(/\/$/, '');

                const items = responses
                    .map(res => {
                        const href = res.href;
                        const prop = res.propstat?.prop || res.prop;
                        if (!prop) return null;

                        const name = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
                        const isDir = prop.resourcetype && (prop.resourcetype.collection !== undefined || prop.resourcetype === '');

                        // 检查是否是当前目录
                        const itemPath = decodeURIComponent(href);
                        if (itemPath.replace(/\/$/, '') === currentHref) return null;

                        return {
                            name,
                            path: itemPath,
                            is_dir: !!isDir,
                            size: parseInt(prop.getcontentlength || '0'),
                            modified: prop.getlastmodified || ''
                        };
                    })
                    .filter(Boolean);

                return items;
            } catch (error) {
                console.error(`[WebDAV] List attempt ${attempt + 1} failed:`, error.message);
                if (attempt < retries) {
                    // 等待一小段时间再重试
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        return [];
    }

    /**
     * 获取文件信息
     */
    async getFileInfo(path) {
        try {
            const encodedPath = this.encodePath(path);
            const url = `${this.baseUrl}${encodedPath.startsWith('/') ? encodedPath : '/' + encodedPath}`;
            const response = await fetch(url, {
                method: 'PROPFIND',
                headers: this.getHeaders()
            });

            if (!response.ok) return null;

            const xml = await response.text();
            const jsonObj = this.parser.parse(xml);
            const res = Array.isArray(jsonObj.multistatus?.response)
                ? jsonObj.multistatus.response[0]
                : jsonObj.multistatus?.response;

            if (!res) return null;
            const prop = res.propstat?.prop || res.prop;

            return {
                name: decodeURIComponent(res.href.split('/').filter(Boolean).pop() || ''),
                path: decodeURIComponent(res.href),
                size: parseInt(prop.getcontentlength || '0'),
                raw_url: url
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * 获取播放链接 (带 Auth)
     */
    async getPlayUrl(path) {
        const encodedPath = this.encodePath(path);
        const url = `${this.baseUrl}${encodedPath.startsWith('/') ? encodedPath : '/' + encodedPath}`;
        if (this.username || this.password) {
            const urlObj = new URL(url);
            urlObj.username = this.username;
            urlObj.password = this.password;
            return urlObj.toString();
        }
        return url;
    }
}

module.exports = { WebdavService };
