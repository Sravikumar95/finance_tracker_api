const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ACCOUNT_TYPES = ['savings', 'checking', 'cash', 'wallet'];

router.post('/', async (req, res) => {
  try {
    const { name, type = 'savings' } = req.body;

    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
      return res.status(400).json({ error: 'name must be 1 to 100 characters' });
    }
    if (!ACCOUNT_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${ACCOUNT_TYPES.join(', ')}` });
    }

    const cleanName = name.trim();

    const [result] = await pool.query(
      'INSERT INTO accounts (user_id, name, type) VALUES (?, ?, ?)',
      [req.user.id, cleanName, type]
    );

    res.status(201).json({
      id: result.insertId,
      name: cleanName,
      type,
      balance: '0.00',
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'you already have an account with this name' });
    }
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, type, balance, created_at FROM accounts WHERE user_id = ? ORDER BY id',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

module.exports = router;