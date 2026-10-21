const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const { isValidMonth, parseAmount } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const { categoryId, month, limit } = req.body || {};

    if (!Number.isInteger(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'categoryId must be a positive whole number' });
    }

    if (!isValidMonth(month)) {
      return res.status(400).json({ error: 'month must be in YYYY-MM format (e.g. 2025-01)' });
    }

    const cleanLimit = parseAmount(limit);
    if (cleanLimit === null) {
      return res.status(400).json({ error: 'limit must be a positive number with at most 2 decimals' });
    }

    const [categoryRows] = await pool.query(
      'SELECT id, name, type FROM categories WHERE id = ? AND user_id = ?',
      [categoryId, req.user.id]
    );

    if (categoryRows.length === 0) {
      return res.status(400).json({ error: 'category not found' });
    }

    const category = categoryRows[0];
    if (category.type !== 'expense') {
      return res.status(400).json({ error: 'budgets can only be set for expense categories' });
    }

    const budgetMonth = `${month}-01`;

    const [result] = await pool.query(
      'INSERT INTO budgets (user_id, category_id, budget_month, amount_limit) VALUES (?, ?, ?, ?)',
      [req.user.id, categoryId, budgetMonth, cleanLimit]
    );

    res.status(201).json({
      id: result.insertId,
      categoryId,
      categoryName: category.name,
      month,
      limit: cleanLimit,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'a budget already exists for this category and month' });
    }
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.get('/', async (req, res) => {
  try {
    const q = req.query;
    const conditions = ['b.user_id = ?'];
    const params = [req.user.id];

    if (q.month !== undefined) {
      if (!isValidMonth(q.month)) {
        return res.status(400).json({ error: 'month must be in YYYY-MM format (e.g. 2025-01)' });
      }
      conditions.push('b.budget_month = ?');
      params.push(`${q.month}-01`);
    }

    const where = conditions.join(' AND ');

    const [rows] = await pool.query(
      `SELECT b.id,
              b.category_id AS categoryId,
              c.name AS categoryName,
              DATE_FORMAT(b.budget_month, '%Y-%m') AS month,
              b.amount_limit AS \`limit\`,
              b.created_at AS createdAt
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE ${where}
       ORDER BY b.budget_month DESC, c.name ASC`,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'id must be a positive whole number' });
    }

    const cleanLimit = parseAmount(req.body?.limit);
    if (cleanLimit === null) {
      return res.status(400).json({ error: 'limit must be a positive number with at most 2 decimals' });
    }

    const [result] = await pool.query(
      'UPDATE budgets SET amount_limit = ? WHERE id = ? AND user_id = ?',
      [cleanLimit, id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'budget not found' });
    }

    const [rows] = await pool.query(
      `SELECT b.id,
              b.category_id AS categoryId,
              c.name AS categoryName,
              DATE_FORMAT(b.budget_month, '%Y-%m') AS month,
              b.amount_limit AS \`limit\`
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE b.id = ?`,
      [id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'id must be a positive whole number' });
    }

    const [result] = await pool.query(
      'DELETE FROM budgets WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'budget not found' });
    }

    res.json({ message: 'budget deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

module.exports = router;
