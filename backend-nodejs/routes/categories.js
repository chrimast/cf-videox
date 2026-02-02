const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');

/**
 * 获取所有分类
 * GET /api/categories
 * Query: source_id - 可选，按视频源筛选
 */
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        const { source_id, show_on_home } = req.query;

        let sql = `
            SELECT c.*, s.name as source_name 
            FROM categories c
            LEFT JOIN video_sources s ON c.source_id = s.id
            WHERE 1=1
        `;
        const params = [];

        if (source_id) {
            sql += ' AND c.source_id = ?';
            params.push(source_id);
        }

        if (show_on_home !== undefined) {
            sql += ' AND c.show_on_home = ?';
            params.push(show_on_home === 'true' ? 1 : 0);
        }

        sql += ' ORDER BY c.source_id, c.sort_order ASC';

        const categories = db.all(sql, params);
        res.json({ success: true, data: categories });
    } catch (error) {
        console.error('[categories] Failed to get categories:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取分类树（带层级结构）
 * GET /api/categories/tree
 */
router.get('/tree', (req, res) => {
    try {
        const db = getDatabase();
        const { source_id } = req.query;

        let sql = `
            SELECT c.*, s.name as source_name 
            FROM categories c
            LEFT JOIN video_sources s ON c.source_id = s.id
        `;
        const params = [];

        if (source_id) {
            sql += ' WHERE c.source_id = ?';
            params.push(source_id);
        }

        sql += ' ORDER BY c.parent_id, c.sort_order ASC';

        const categories = db.all(sql, params);

        // 构建树形结构
        const tree = [];
        const map = new Map();

        // 先创建所有节点的映射
        for (const cat of categories) {
            cat.children = [];
            map.set(`${cat.source_id}_${cat.type_id}`, cat);
        }

        // 构建父子关系
        for (const cat of categories) {
            if (cat.parent_id === 0 || cat.parent_id === null) {
                tree.push(cat);
            } else {
                const parent = map.get(`${cat.source_id}_${cat.parent_id}`);
                if (parent) {
                    parent.children.push(cat);
                } else {
                    // 父节点不存在，作为顶级分类
                    tree.push(cat);
                }
            }
        }

        res.json({ success: true, data: tree });
    } catch (error) {
        console.error('[categories] Failed to get category tree:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 更新分类配置
 * PUT /api/categories/:id
 */
router.put('/:id', (req, res) => {
    try {
        const { show_on_home, sort_order } = req.body;
        const db = getDatabase();

        const existing = db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Category not found' });
        }

        const updates = [];
        const params = [];

        if (show_on_home !== undefined) {
            updates.push('show_on_home = ?');
            params.push(show_on_home ? 1 : 0);
        }

        if (sort_order !== undefined) {
            updates.push('sort_order = ?');
            params.push(sort_order);
        }

        if (updates.length > 0) {
            params.push(req.params.id);
            db.run(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        const updated = db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('[categories] Failed to update category:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 批量更新分类显示设置
 * PUT /api/categories/batch
 */
router.put('/batch', (req, res) => {
    try {
        const { updates } = req.body; // [{ id, show_on_home, sort_order }, ...]
        const db = getDatabase();

        if (!Array.isArray(updates)) {
            return res.status(400).json({ success: false, error: 'Invalid updates format' });
        }

        for (const item of updates) {
            const sets = [];
            const params = [];

            if (item.show_on_home !== undefined) {
                sets.push('show_on_home = ?');
                params.push(item.show_on_home ? 1 : 0);
            }

            if (item.sort_order !== undefined) {
                sets.push('sort_order = ?');
                params.push(item.sort_order);
            }

            if (sets.length > 0) {
                params.push(item.id);
                db.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, params);
            }
        }

        res.json({ success: true, message: 'Batch update completed' });
    } catch (error) {
        console.error('[categories] Failed to batch update categories:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
