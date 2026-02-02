/**
 * 本地目录服务
 */
const fs = require('fs/promises');
const path = require('path');

class LocalService {
    constructor(rootPath = '/') {
        this.rootPath = rootPath;
    }

    /**
     * 获取绝对路径（相对于 rootPath）
     */
    _getAbsPath(targetPath) {
        if (!targetPath || targetPath === '/') return this.rootPath;
        // 如果已经是绝对路径且包含 rootPath，则直接返回
        if (path.isAbsolute(targetPath) && targetPath.startsWith(this.rootPath)) {
            return targetPath;
        }
        // 否则视为相对于 rootPath 的路径进行拼接
        return path.join(this.rootPath, targetPath);
    }

    /**
     * 获取列表
     */
    async list(dirPath = '/') {
        try {
            const absolutePath = this._getAbsPath(dirPath);

            const entries = await fs.readdir(absolutePath, { withFileTypes: true });

            return entries.map(entry => {
                const itemPath = path.join(absolutePath, entry.name);
                return {
                    name: entry.name,
                    path: itemPath,
                    is_dir: entry.isDirectory(),
                    size: 0, // fs.readdir 不返回 size，可以用 stat 获取但会慢
                    modified: ''
                };
            }).filter(item => !item.name.startsWith('.')); // 过滤隐藏文件
        } catch (error) {
            console.error('[Local] List error:', error);
            return [];
        }
    }

    /**
     * 获取文件详情
     */
    async getFileInfo(filePath) {
        try {
            const absolutePath = this._getAbsPath(filePath);
            const stats = await fs.stat(absolutePath);

            return {
                name: path.basename(absolutePath),
                path: absolutePath,
                size: stats.size,
                raw_url: `file://${absolutePath}` // 返回 file:// 协议，由前端代理或特殊处理
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * 获取播放链接
     */
    async getPlayUrl(filePath) {
        // 本地文件通常返回特殊的代理链接或 file:// 
        // 在本项目中，后端可能会有一个专门处理本地文件流的路由
        return `/api/video/netdisk/local-stream?path=${encodeURIComponent(filePath)}`;
    }
}

module.exports = { LocalService };
