const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const { isValidMonth, isValidDate } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/monthly-summary', async (req, res) => {
  try {
    const q = req.query;
    const conditions = ['a.user_id = ?'];
    const params = [req.user.id];

    if (q.from !== undefined) {
      if (!isValidMonth(q.from)) {
        return res.status(400).json({ error: 'from must be in YYYY-MM format (e.g. 2025-01)' });
      }
      conditions.push('t.txn_date >= ?');
      params.push(`${q.from}-01`);
    }

    if (q.to !== undefined) {
      if (!isValidMonth(q.to)) {
        return res.status(400).json({ error: 'to must be in YYYY-MM format (e.g. 2025-12)' });
      }
      conditions.push('t.txn_date <= LAST_DAY(?)');
      params.push(`${q.to}-01`);
    }

    if (q.from !== undefined && q.to !== undefined && q.from > q.to) {
      return res.status(400).json({ error: 'from must not be after to' });
    }

    const where = conditions.join(' AND ');

    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS month,
              ROUND(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 2) AS income,
              ROUND(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 2) AS expenses,
              ROUND(SUM(CASE WHEN t.type = 'income' THEN t.amount
                             WHEN t.type = 'expense' THEN -t.amount
                             ELSE 0 END), 2) AS net_savings
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE ${where}
       GROUP BY month
       ORDER BY month`,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.get('/month-over-month', async (req, res) => {
  try {
    const q = req.query;
    const outerConditions = [];
    const outerParams = [];

    if (q.from !== undefined) {
      if (!isValidMonth(q.from)) {
        return res.status(400).json({ error: 'from must be in YYYY-MM format (e.g. 2025-01)' });
      }
      outerConditions.push('month >= ?');
      outerParams.push(q.from);
    }

    if (q.to !== undefined) {
      if (!isValidMonth(q.to)) {
        return res.status(400).json({ error: 'to must be in YYYY-MM format (e.g. 2025-12)' });
      }
      outerConditions.push('month <= ?');
      outerParams.push(q.to);
    }

    if (q.from !== undefined && q.to !== undefined && q.from > q.to) {
      return res.status(400).json({ error: 'from must not be after to' });
    }

    const whereClause = outerConditions.length > 0 ? `WHERE ${outerConditions.join(' AND ')}` : '';

    const sql = `
      WITH monthly AS (
        SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS month,
               ROUND(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 2) AS expenses
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE a.user_id = ?
        GROUP BY month
      ),
      with_previous AS (
        SELECT month, expenses,
               LAG(expenses) OVER (ORDER BY month) AS previous_month
        FROM monthly
      )
      SELECT month, expenses, previous_month,
             ROUND(100 * (expenses - previous_month) / NULLIF(previous_month, 0), 1) AS change_pct
      FROM with_previous
      ${whereClause}
      ORDER BY month
    `;

    const [rows] = await pool.query(sql, [req.user.id, ...outerParams]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.get('/running-balance', async (req, res) => {
  try {
    const q = req.query;
    let accountId = null;

    if (q.accountId !== undefined) {
      const parsedId = Number(q.accountId);
      if (!Number.isInteger(parsedId) || parsedId < 1) {
        return res.status(400).json({ error: 'accountId must be a positive whole number' });
      }
      const [accRows] = await pool.query(
        'SELECT id, name, type, balance FROM accounts WHERE id = ? AND user_id = ?',
        [parsedId, req.user.id]
      );
      if (accRows.length === 0) {
        return res.status(404).json({ error: 'account not found' });
      }
      accountId = parsedId;
    }

    const outerConditions = [];
    const outerParams = [];

    if (q.from !== undefined) {
      if (!isValidDate(q.from)) {
        return res.status(400).json({ error: 'from must be a real date in YYYY-MM-DD format' });
      }
      outerConditions.push('txn_date >= ?');
      outerParams.push(q.from);
    }

    if (q.to !== undefined) {
      if (!isValidDate(q.to)) {
        return res.status(400).json({ error: 'to must be a real date in YYYY-MM-DD format' });
      }
      outerConditions.push('txn_date <= ?');
      outerParams.push(q.to);
    }

    if (q.from !== undefined && q.to !== undefined && q.from > q.to) {
      return res.status(400).json({ error: 'from must not be after to' });
    }

    const whereClause = outerConditions.length > 0 ? `WHERE ${outerConditions.join(' AND ')}` : '';

    let sql;
    let queryParams;

    if (accountId !== null) {
      // Running balance for a specific account (includes transfers in/out)
      sql = `
        WITH daily AS (
          SELECT t.txn_date,
                 ROUND(SUM(CASE WHEN t.type IN ('income', 'transfer_in') THEN t.amount
                                ELSE -t.amount END), 2) AS net_change
          FROM transactions t
          WHERE t.account_id = ?
          GROUP BY t.txn_date
        ),
        with_running AS (
          SELECT txn_date, net_change,
                 ROUND(SUM(net_change) OVER (ORDER BY txn_date), 2) AS running_balance
          FROM daily
        )
        SELECT txn_date, net_change, running_balance
        FROM with_running
        ${whereClause}
        ORDER BY txn_date
      `;
      queryParams = [accountId, ...outerParams];
    } else {
      // Running balance across all accounts for the user (transfers cancel out)
      sql = `
        WITH daily AS (
          SELECT t.txn_date,
                 ROUND(SUM(CASE WHEN t.type = 'income' THEN t.amount
                                WHEN t.type = 'expense' THEN -t.amount
                                ELSE 0 END), 2) AS net_change
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
          WHERE a.user_id = ?
          GROUP BY t.txn_date
        ),
        with_running AS (
          SELECT txn_date, net_change,
                 ROUND(SUM(net_change) OVER (ORDER BY txn_date), 2) AS running_balance
          FROM daily
        )
        SELECT txn_date, net_change, running_balance
        FROM with_running
        ${whereClause}
        ORDER BY txn_date
      `;
      queryParams = [req.user.id, ...outerParams];
    }

    const [rows] = await pool.query(sql, queryParams);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.get('/top-categories', async (req, res) => {
  try {
    const q = req.query;
    const limit = q.limit !== undefined ? Number(q.limit) : 3;

    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return res.status(400).json({ error: 'limit must be a whole number between 1 and 20' });
    }

    const outerConditions = ['rank_in_month <= ?'];
    const outerParams = [limit];

    if (q.month !== undefined) {
      if (!isValidMonth(q.month)) {
        return res.status(400).json({ error: 'month must be in YYYY-MM format (e.g. 2025-01)' });
      }
      outerConditions.push('month = ?');
      outerParams.push(q.month);
    } else {
      if (q.from !== undefined) {
        if (!isValidMonth(q.from)) {
          return res.status(400).json({ error: 'from must be in YYYY-MM format (e.g. 2025-01)' });
        }
        outerConditions.push('month >= ?');
        outerParams.push(q.from);
      }

      if (q.to !== undefined) {
        if (!isValidMonth(q.to)) {
          return res.status(400).json({ error: 'to must be in YYYY-MM format (e.g. 2025-12)' });
        }
        outerConditions.push('month <= ?');
        outerParams.push(q.to);
      }

      if (q.from !== undefined && q.to !== undefined && q.from > q.to) {
        return res.status(400).json({ error: 'from must not be after to' });
      }
    }

    const whereClause = `WHERE ${outerConditions.join(' AND ')}`;

    const sql = `
      WITH monthly_category AS (
        SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS month,
               c.id AS category_id,
               c.name AS category,
               ROUND(SUM(t.amount), 2) AS total_spent
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        JOIN categories c ON c.id = t.category_id
        WHERE a.user_id = ? AND t.type = 'expense'
        GROUP BY month, c.id, c.name
      ),
      ranked AS (
        SELECT month, category_id, category, total_spent,
               RANK() OVER (PARTITION BY month ORDER BY total_spent DESC) AS rank_in_month
        FROM monthly_category
      )
      SELECT month, category_id, category, total_spent, rank_in_month
      FROM ranked
      ${whereClause}
      ORDER BY month, rank_in_month
    `;

    const [rows] = await pool.query(sql, [req.user.id, ...outerParams]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

router.get('/unusual-transactions', async (req, res) => {
  try {
    const q = req.query;
    const threshold = q.threshold !== undefined ? Number(q.threshold) : 3;

    if (Number.isNaN(threshold) || threshold <= 0 || threshold > 10) {
      return res.status(400).json({ error: 'threshold must be a positive number between 1 and 10' });
    }

    const conditions = [
      'a.user_id = ?',
      "t.type = 'expense'",
      's.std_amount > 0',
      '(t.amount - s.avg_amount) / s.std_amount > ?'
    ];
    const params = [req.user.id, threshold];

    if (q.categoryId !== undefined) {
      const catId = Number(q.categoryId);
      if (!Number.isInteger(catId) || catId < 1) {
        return res.status(400).json({ error: 'categoryId must be a positive whole number' });
      }
      conditions.push('t.category_id = ?');
      params.push(catId);
    }

    const limit = q.limit !== undefined ? Number(q.limit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be a whole number between 1 and 100' });
    }

    const sql = `
      WITH stats AS (
        SELECT t.category_id,
               AVG(t.amount) AS avg_amount,
               STDDEV_POP(t.amount) AS std_amount
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE a.user_id = ? AND t.type = 'expense'
        GROUP BY t.category_id
      )
      SELECT t.id,
             t.txn_date AS date,
             c.name AS category,
             t.amount,
             ROUND(s.avg_amount, 2) AS category_average,
             ROUND((t.amount - s.avg_amount) / s.std_amount, 1) AS z_score
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN categories c ON c.id = t.category_id
      JOIN stats s ON s.category_id = t.category_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY z_score DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [req.user.id, ...params, limit]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'something went wrong' });
  }
});

module.exports = router;
