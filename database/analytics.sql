USE finance_tracker;

-- Choose the user to analyse (seed-user-1 has 24 months of data)
SET @uid = (SELECT id FROM users WHERE email = 'seed-user-1@example.com');
SELECT @uid;


-- 1. Monthly summary: income, expenses and net savings (transfers excluded)
SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS month,
       SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) AS income,
       SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS expenses,
       SUM(CASE WHEN t.type = 'income' THEN t.amount
                WHEN t.type = 'expense' THEN -t.amount
                ELSE 0 END) AS net_savings
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE a.user_id = @uid
GROUP BY month
ORDER BY month;


-- 2. Month-over-month change in spending, using LAG()
WITH monthly AS (
  SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS month,
         SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS expenses
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE a.user_id = @uid
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
ORDER BY month;


-- 3. Running balance after each day (transfers cancel out, so they are ignored)
WITH daily AS (
  SELECT t.txn_date,
         SUM(CASE WHEN t.type = 'income' THEN t.amount
                  WHEN t.type = 'expense' THEN -t.amount
                  ELSE 0 END) AS net_change
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE a.user_id = @uid
  GROUP BY t.txn_date
)
SELECT txn_date, net_change,
       SUM(net_change) OVER (ORDER BY txn_date) AS running_balance
FROM daily
ORDER BY txn_date;

-- 3b. Check: this must equal the last running_balance above
SELECT SUM(balance) AS total_balance FROM accounts WHERE user_id = @uid;


-- 4. Top 3 spending categories in each month, using RANK()
WITH monthly_category AS (
  SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS month,
         c.name AS category,
         SUM(t.amount) AS total_spent
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  JOIN categories c ON c.id = t.category_id
  WHERE a.user_id = @uid AND t.type = 'expense'
  GROUP BY month, c.name
),
ranked AS (
  SELECT month, category, total_spent,
         RANK() OVER (PARTITION BY month ORDER BY total_spent DESC) AS rank_in_month
  FROM monthly_category
)
SELECT month, category, total_spent, rank_in_month
FROM ranked
WHERE rank_in_month <= 3
ORDER BY month, rank_in_month;


-- 5. Unusually large expenses: more than 3 standard deviations above the category average
WITH stats AS (
  SELECT t.category_id,
         AVG(t.amount) AS avg_amount,
         STDDEV_POP(t.amount) AS std_amount
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE a.user_id = @uid AND t.type = 'expense'
  GROUP BY t.category_id
)
SELECT t.id, t.txn_date, c.name AS category, t.amount,
       ROUND(s.avg_amount, 2) AS category_average,
       ROUND((t.amount - s.avg_amount) / s.std_amount, 1) AS z_score
FROM transactions t
JOIN accounts a ON a.id = t.account_id
JOIN categories c ON c.id = t.category_id
JOIN stats s ON s.category_id = t.category_id
WHERE a.user_id = @uid
  AND t.type = 'expense'
  AND s.std_amount > 0
  AND (t.amount - s.avg_amount) / s.std_amount > 3
ORDER BY z_score DESC;