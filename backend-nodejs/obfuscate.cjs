#!/usr/bin/env node

/**
 * VideoX 后端代码混淆脚本
 * 
 * 使用方法：node obfuscate.cjs
 * 
 * 功能：
 * 1. 读取 backend-nodejs 源代码
 * 2. 使用 javascript-obfuscator 进行低强度混淆
 * 3. 输出到 ../backend-build 目录
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 配置
const SRC_DIR = __dirname;
const OUTPUT_DIR = path.join(__dirname, '../backend-build');

// 混淆忽略名单 (保持明文的文件)
const OBFUSCATE_IGNORE = [
    'server.js',              // 入口文件
    'obfuscate.cjs',          // 自身
    'media-server-service.js', // Emby/Jellyfin API 动态参数
    'TranscodeService.js'      // 视频转码 spawn 调用
];

// 低强度混淆配置 (兼顾保护与稳定)
const OBFUSCATION_OPTIONS = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.5,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    target: 'node'
};

// 排除文件/目录
const EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    '.DS_Store',
    '*.log',
    '*.test.js',
    'package-lock.json',
    'obfuscate.cjs',
    'data',        // 数据目录 (运行时数据，不需要复制)
    '*.db'         // 数据库文件
];

// 工具函数：复制文件
function copyFileSync(src, dest) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
}

// 工具函数：混淆并写入
function obfuscateAndWrite(src, dest) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    try {
        const code = fs.readFileSync(src, 'utf8');
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, OBFUSCATION_OPTIONS);
        fs.writeFileSync(dest, obfuscationResult.getObfuscatedCode(), 'utf8');
        return true;
    } catch (err) {
        console.error(`  ❌ 混淆失败: ${path.basename(src)}`, err.message);
        // 失败时回退到复制
        fs.copyFileSync(src, dest);
        return false;
    }
}

// 工具函数：检查是否应该排除
function shouldExclude(itemName) {
    for (const pattern of EXCLUDE_PATTERNS) {
        if (pattern.includes('*')) {
            // 将 glob 模式转换为正则表达式，需要先转义 . 再替换 *
            const escaped = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
            const regex = new RegExp(`^${escaped}$`);
            if (regex.test(itemName)) return true;
        } else {
            if (itemName === pattern) return true;
        }
    }
    return false;
}

// 递归处理后端文件
function processFiles(src, dest, stats = { files: 0, obfuscated: 0 }) {
    if (!fs.existsSync(src)) return stats;

    const items = fs.readdirSync(src);

    for (const item of items) {
        const srcPath = path.join(src, item);
        const destPath = path.join(dest, item);

        if (shouldExclude(item)) continue;

        const stat = fs.statSync(srcPath);

        if (stat.isDirectory()) {
            processFiles(srcPath, destPath, stats);
        } else if (stat.isFile()) {
            const ext = path.extname(item);

            // 仅处理 .js, .json
            if (['.js', '.json'].includes(ext)) {
                if (ext === '.js' && !OBFUSCATE_IGNORE.includes(item)) {
                    // 尝试混淆
                    const success = obfuscateAndWrite(srcPath, destPath);
                    if (success) {
                        console.log(`  🔒 ${item}`);
                        stats.obfuscated++;
                    } else {
                        // 混淆失败，但文件已通过 obfuscateAndWrite 中的 fallback 复制
                        console.log(`  ⚠️ ${item} (fallback copy)`);
                    }
                } else {
                    copyFileSync(srcPath, destPath);
                    console.log(`  📄 ${item}`);
                }
                stats.files++;
            }
        }
    }

    return stats;
}

// 主函数
function main() {
    console.log('🚀 VideoX 后端代码混淆');
    console.log('========================');
    console.log(`源目录: ${SRC_DIR}`);
    console.log(`输出目录: ${OUTPUT_DIR}`);
    console.log('');

    // 清理旧的输出目录
    if (fs.existsSync(OUTPUT_DIR)) {
        console.log('🧹 清理旧的输出目录...');
        fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    console.log('🔒 正在混淆代码...\n');
    const stats = processFiles(SRC_DIR, OUTPUT_DIR);

    console.log('\n✅ 混淆完成！');
    console.log(`   总文件数: ${stats.files}`);
    console.log(`   已混淆: ${stats.obfuscated}`);
    console.log(`   输出目录: ${OUTPUT_DIR}`);
}

main();
