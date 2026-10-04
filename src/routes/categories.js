const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CATEGORY_TYPES = ['income', 'expense'];

router.post('/', async (req, res) => {
  try {
    const { name, type } = req.body || {};

    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 50) {
      return res.status(400).json({ error: 'name must be 1 to 50 characters' });
    }
    if (!CATEGORY_TYPES.includes(type)) {
      return res.status(400).json({ error: 'type must be income or expense' });
    }

    const cleanName = name.trim();

    const [result] = await pool.query(
      'INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?)',
      [req.user.id, cleanName, type]
    );

    res.status(201).json({ id: result.insertId, name: cleanName, type });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'you already have a category with this name' });
    }
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, type FROM categories WHERE user_id = ? ORDER BY type, name',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

module.exports = router;