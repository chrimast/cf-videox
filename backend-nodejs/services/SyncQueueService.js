/**
 * 同步队列服务
 * 管理视频源分类的后台异步同步
 * 
 * 功能：
 * - 队列化同步请求
 * - 去重：正在同步的资源站不重复添加
 * - 冷却期：30分钟内同步过的不再重复同步
 * - 并发控制：同时最多执行 2 个同步任务
 */

const { getDatabase } = require('../database');

class SyncQueueService {
    constructor() {
        this.queue = [];                    // 等待同步的队列 [sourceId, ...]
        this.syncingSet = new Set();        // 正在同步的资源站ID
        this.lastSyncTime = new Map();      // 最后同步时间 Map<sourceId, timestamp>
        this.cooldownMs = 30 * 60 * 1000;   // 冷却期：30分钟
        this.maxConcurrent = 2;             // 最大并发数
        this.isProcessing = false;          // 是否正在处理队列
    }

    /**
     * 添加资源站到同步队列
     * @param {number} sourceId 
     * @returns {object} 状态信息
     */
    addToQueue(sourceId) {
        // 1. 如果正在同步，忽略
        if (this.syncingSet.has(sourceId)) {
            console.log(`[SyncQueue] Source ${sourceId} is already syncing, skipped`);
            return { status: 'already_syncing', sourceId };
        }

        // 2. 如果在冷却期内，忽略
        const lastSync = this.lastSyncTime.get(sourceId);
        if (lastSync && Date.now() - lastSync < this.cooldownMs) {
            const remainingMinutes = Math.ceil((this.cooldownMs - (Date.now() - lastSync)) / 60000);
            console.log(`[SyncQueue] Source ${sourceId} is in cooldown (${remainingMinutes}min remaining), skipped`);
            return { status: 'in_cooldown', sourceId, remainingMinutes };
        }

        // 3. 如果已在队列中，忽略
        if (this.queue.includes(sourceId)) {
            console.log(`[SyncQueue] Source ${sourceId} is already in queue, skipped`);
            return { status: 'already_queued', sourceId };
        }

        // 4. 加入队列
        this.queue.push(sourceId);
        console.log(`[SyncQueue] Source ${sourceId} added to queue. Queue length: ${this.queue.length}`);

        // 5. 开始处理队列
        this.processQueue();

        return { status: 'queued', sourceId, queuePosition: this.queue.length };
    }

    /**
     * 处理同步队列
     */
    async processQueue() {
        // 如果当前同步数已达到最大并发，不启动新的
        if (this.syncingSet.size >= this.maxConcurrent) {
            return;
        }

        // 如果队列为空，不处理
        if (this.queue.length === 0) {
            return;
        }

        // 取出队首的sourceId
        const sourceId = this.queue.shift();
        if (!sourceId) return;

        // 标记为正在同步
        this.syncingSet.add(sourceId);
        console.log(`[SyncQueue] Starting sync for source ${sourceId}. Active syncs: ${this.syncingSet.size}`);

        try {
            await this.syncSource(sourceId);
            this.lastSyncTime.set(sourceId, Date.now());
            console.log(`[SyncQueue] Sync completed for source ${sourceId}`);
        } catch (error) {
            console.error(`[SyncQueue] Sync failed for source ${sourceId}:`, error.message);
        } finally {
            this.syncingSet.delete(sourceId);
            // 继续处理队列中的下一个
            this.processQueue();
        }
    }

    /**
     * 同步单个资源站的分类
     * @param {number} sourceId 
     */
    async syncSource(sourceId) {
        const db = getDatabase();
        const source = db.get('SELECT * FROM video_sources WHERE id = ?', [sourceId]);

        if (!source) {
            throw new Error(`Source ${sourceId} not found`);
        }

        // 调用现有的同步逻辑
        const { syncCategoriesForSource } = require('../routes/sources');
        await syncCategoriesForSource(db, source);
    }

    /**
     * 获取队列状态
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            activeSyncs: this.syncingSet.size,
            syncingSources: Array.from(this.syncingSet),
            queuedSources: [...this.queue]
        };
    }

    /**
     * 清除某个资源站的冷却时间（强制重新同步）
     * @param {number} sourceId 
     */
    clearCooldown(sourceId) {
        this.lastSyncTime.delete(sourceId);
    }

    /**
     * 清除所有冷却时间
     */
    clearAllCooldowns() {
        this.lastSyncTime.clear();
    }
}

// 单例模式
const syncQueueService = new SyncQueueService();

module.exports = {
    syncQueueService,
    SyncQueueService
};
