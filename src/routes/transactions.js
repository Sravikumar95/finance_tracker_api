const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['income', 'expense'];
const BALANCE_OPERATOR = { income: '+', expense: '-' };

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function parseAmount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text) || !/[1-9]/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

router.post('/', async (req, res) => {
  const body = req.body || {};
  const { accountId, type, amount, date } = body;
  const categoryId = body.categoryId ?? null;
  const description = body.description ?? null;

  if (!Number.isInteger(accountId) || accountId < 1) {
    return res.status(400).json({ error: 'accountId must be a positive whole number' });
  }
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'type must be income or expense' });
  }
  const cleanAmount = parseAmount(amount);
  if (cleanAmount === null) {
    return res.status(400).json({ error: 'amount must be a positive number with at most 2 decimals' });
  }
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'date must be a real date in YYYY-MM-DD format' });
  }
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId < 1)) {
    return res.status(400).json({ error: 'categoryId must be a positive whole number' });
  }
  if (description !== null && (typeof description !== 'string' || description.length > 255)) {
    return res.status(400).json({ error: 'description must be text of at most 255 characters' });
  }
  const cleanDescription = description === null ? null : description.trim() || null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [accounts] = await conn.query(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE',
      [accountId, req.user.id]
    );
    if (accounts.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'account not found' });
    }

    if (categoryId !== null) {
      const [categories] = await conn.query(
        'SELECT type FROM categories WHERE id = ? AND user_id = ?',
        [categoryId, req.user.id]
      );
      if (categories.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'category not found' });
      }
      if (categories[0].type !== type) {
        await conn.rollback();
        return res.status(400).json({ error: 'category type does not match transaction type' });
      }
    }

    const [result] = await conn.query(
      `INSERT INTO transactions (account_id, category_id, type, amount, txn_date, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [accountId, categoryId, type, cleanAmount, date, cleanDescription]
    );

    await conn.query(
      `UPDATE accounts SET balance = balance ${BALANCE_OPERATOR[type]} ? WHERE id = ?`,
      [cleanAmount, accountId]
    );

    const [balanceRows] = await conn.query(
      'SELECT balance FROM accounts WHERE id = ?',
      [accountId]
    );

    await conn.commit();

    res.status(201).json({
      id: result.insertId,
      accountId,
      categoryId,
      type,
      amount: cleanAmount,
      date,
      description: cleanDescription,
      accountBalance: balanceRows[0].balance,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  } finally {
    conn.release();
  }
});

router.get('/', async (req, res) => {
  try {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'page must be 1 or more, and limit must be 1 to 100' });
    }
    const offset = (page - 1) * limit;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.user_id = ?`,
      [req.user.id]
    );

    const [rows] = await pool.query(
      `SELECT t.id, t.account_id AS accountId, a.name AS accountName,
              t.category_id AS categoryId, c.name AS categoryName,
              t.type, t.amount, t.txn_date AS date, t.description
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE a.user_id = ?
       ORDER BY t.txn_date DESC, t.id DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    const total = countRows[0].total;
    res.json({ data: rows, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

module.exports = router;