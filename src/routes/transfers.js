const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const { isValidDate, parseAmount } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const body = req.body || {};
  const { fromAccountId, toAccountId, amount, date } = body;
  const description = body.description ?? null;

  if (
    !Number.isInteger(fromAccountId) || fromAccountId < 1 ||
    !Number.isInteger(toAccountId) || toAccountId < 1
  ) {
    return res.status(400).json({ error: 'fromAccountId and toAccountId must be positive whole numbers' });
  }
  if (fromAccountId === toAccountId) {
    return res.status(400).json({ error: 'cannot transfer to the same account' });
  }
  const cleanAmount = parseAmount(amount);
  if (cleanAmount === null) {
    return res.status(400).json({ error: 'amount must be a positive number with at most 2 decimals' });
  }
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'date must be a real date in YYYY-MM-DD format' });
  }
  if (description !== null && (typeof description !== 'string' || description.length > 255)) {
    return res.status(400).json({ error: 'description must be text of at most 255 characters' });
  }
  const cleanDescription = description === null ? null : description.trim() || null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [locked] = await conn.query(
      'SELECT id FROM accounts WHERE id IN (?, ?) AND user_id = ? ORDER BY id FOR UPDATE',
      [fromAccountId, toAccountId, req.user.id]
    );
    if (locked.length !== 2) {
      await conn.rollback();
      return res.status(404).json({ error: 'account not found' });
    }

    const [debit] = await conn.query(
      `UPDATE accounts
       SET balance = balance - CAST(? AS DECIMAL(14,2))
       WHERE id = ? AND balance >= CAST(? AS DECIMAL(14,2))`,
      [cleanAmount, fromAccountId, cleanAmount]
    );
    if (debit.affectedRows !== 1) {
      await conn.rollback();
      return res.status(422).json({ error: 'insufficient funds' });
    }

    await conn.query(
      'UPDATE accounts SET balance = balance + CAST(? AS DECIMAL(14,2)) WHERE id = ?',
      [cleanAmount, toAccountId]
    );

    const transferId = randomUUID();
    await conn.query(
      `INSERT INTO transactions
         (account_id, category_id, type, amount, txn_date, description, transfer_group)
       VALUES
         (?, NULL, 'transfer_out', ?, ?, ?, ?),
         (?, NULL, 'transfer_in',  ?, ?, ?, ?)`,
      [
        fromAccountId, cleanAmount, date, cleanDescription, transferId,
        toAccountId, cleanAmount, date, cleanDescription, transferId,
      ]
    );

    const [balances] = await conn.query(
      'SELECT id, balance FROM accounts WHERE id IN (?, ?)',
      [fromAccountId, toAccountId]
    );

    await conn.commit();

    const balanceOf = (id) => balances.find((row) => row.id === id).balance;
    res.status(201).json({
      transferId,
      fromAccountId,
      toAccountId,
      amount: cleanAmount,
      date,
      description: cleanDescription,
      fromBalance: balanceOf(fromAccountId),
      toBalance: balanceOf(toAccountId),
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  } finally {
    conn.release();
  }
});

module.exports = router;