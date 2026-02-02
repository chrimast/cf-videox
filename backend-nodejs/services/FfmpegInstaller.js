const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class FfmpegInstaller {
    constructor() {
        // 插件根目录 ../../
        this.baseDir = path.resolve(__dirname, '../../');
        this.binDir = path.join(this.baseDir, 'data', 'bin');
        this.tempDir = path.join(this.baseDir, 'data', 'temp_install');
        this.ffmpegPath = path.join(this.binDir, 'ffmpeg');
        this.ffprobePath = path.join(this.binDir, 'ffprobe');

        this.isInstalling = false;
        this.progress = 0;
        this.status = 'idle'; // idle, downloading, extracting, completed, error
        this.error = null;
    }

    /**
     * 获取当前安装状态
     */
    getStatus() {
        return {
            status: this.status,
            progress: this.progress,
            error: this.error,
            path: fs.existsSync(this.ffmpegPath) ? this.ffmpegPath : null,
            ffprobePath: fs.existsSync(this.ffprobePath) ? this.ffprobePath : null
        };
    }

    /**
     * 开始安装
     */
    async install() {
        if (this.isInstalling) {
            throw new Error('Installation already in progress');
        }

        try {
            this.isInstalling = true;
            this.progress = 0;
            this.status = 'downloading';
            this.error = null;

            // 1. 确定下载 URL
            const url = this._getDownloadUrl();
            console.log('[FfmpegInstaller] Target URL:', url);

            // 2. 准备目录
            if (!fs.existsSync(this.binDir)) fs.mkdirSync(this.binDir, { recursive: true });
            if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });

            // 3. 下载文件
            const tarPath = path.join(this.tempDir, 'ffmpeg.tar.xz');
            await this._downloadFile(url, tarPath);

            // 4. 解压
            this.status = 'extracting';
            this.progress = 90;
            console.log('[FfmpegInstaller] Extracting...');

            // 使用 system tar 命令解压 (Node.js 原生解压 xz 很麻烦，依赖 tar 命令更稳健，Docker 环境一般都有)
            // --strip-components=1 假设解压出来有个顶层目录
            // 但 johnvansickle 的包通常是 ffmpeg-git-20230313-amd64-static/ffmpeg
            // 我们通过通配符查找更稳妥
            await execAsync(`tar -xf "${tarPath}" -C "${this.tempDir}"`);

            // 5. 查找解压后的二进制文件并移动 (ffmpeg, ffprobe)
            const foundFfmpeg = this._findBinary(this.tempDir, 'ffmpeg');
            const foundFfprobe = this._findBinary(this.tempDir, 'ffprobe');

            if (!foundFfmpeg) {
                throw new Error('ffmpeg binary not found in extracted archive');
            }

            // 移动并重命名 ffmpeg
            if (fs.existsSync(this.ffmpegPath)) fs.unlinkSync(this.ffmpegPath);
            fs.renameSync(foundFfmpeg, this.ffmpegPath);
            fs.chmodSync(this.ffmpegPath, 0o755); // 赋予执行权限

            // 如果有 ffprobe (johnvansickle 的包通常都有)，也一并处理
            if (foundFfprobe) {
                if (fs.existsSync(this.ffprobePath)) fs.unlinkSync(this.ffprobePath);
                fs.renameSync(foundFfprobe, this.ffprobePath);
                fs.chmodSync(this.ffprobePath, 0o755); // 赋予执行权限
                console.log('[FfmpegInstaller] ffprobe also installed');
            }

            // 6. 清理
            fs.rmSync(this.tempDir, { recursive: true, force: true });

            this.status = 'completed';
            this.progress = 100;
            console.log('[FfmpegInstaller] Installation completed successfully');

        } catch (err) {
            console.error('[FfmpegInstaller] Installation failed:', err);
            this.status = 'error';
            this.error = err.message;
        } finally {
            this.isInstalling = false;
        }
    }

    /**
     * 递归查找文件
     */
    _findBinary(dir, filename) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                const found = this._findBinary(fullPath, filename);
                if (found) return found;
            } else if (file === filename) {
                return fullPath;
            }
        }
        return null;
    }

    /**
     * 根据系统架构获取下载地址
     * 使用 johnvansickle.com 的静态构建 (Linux)
     */
    _getDownloadUrl() {
        const platform = os.platform();
        const arch = os.arch();

        if (platform !== 'linux') {
            throw new Error(`Auto-install only supports Linux (current: ${platform}). Please install FFmpeg manually.`);
        }

        const baseUrl = 'https://johnvansickle.com/ffmpeg/releases';

        switch (arch) {
            case 'x64':
                return `${baseUrl}/ffmpeg-release-amd64-static.tar.xz`;
            case 'arm64':
                return `${baseUrl}/ffmpeg-release-arm64-static.tar.xz`;
            default:
                throw new Error(`Unsupported architecture: ${arch}. Please install FFmpeg manually.`);
        }
    }

    /**
     * 下载文件带进度
     */
    async _downloadFile(url, destPath) {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const totalLength = parseInt(response.headers['content-length'], 10);
        const writer = fs.createWriteStream(destPath);

        let downloaded = 0;

        return new Promise((resolve, reject) => {
            response.data.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalLength) {
                    // 下载占 0-90% 的进度
                    this.progress = Math.round((downloaded / totalLength) * 90);
                }
            });

            response.data.pipe(writer);

            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
}

module.exports = new FfmpegInstaller();
