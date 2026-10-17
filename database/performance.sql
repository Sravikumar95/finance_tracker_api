USE finance_tracker;

-- 0. Refresh MySQL's table statistics so its estimates are accurate
ANALYZE TABLE transactions;

-- The report we will tune: platform-wide expense total for one month.
-- It scans every user's rows, like an analyst's query would.

-- A. The plan before the index
EXPLAIN
SELECT COUNT(*) AS expense_transactions,
       ROUND(SUM(amount), 2) AS total_spent
FROM transactions
WHERE type = 'expense'
  AND txn_date >= '2026-09-01'
  AND txn_date <  '2026-10-01';

-- B. A measured run (this executes the query and reports real times)
EXPLAIN ANALYZE
SELECT COUNT(*) AS expense_transactions,
       ROUND(SUM(amount), 2) AS total_spent
FROM transactions
WHERE type = 'expense'
  AND txn_date >= '2026-09-01'
  AND txn_date <  '2026-10-01';

-- C. Table and index size on disk (live numbers, not cached ones)
SET SESSION information_schema_stats_expiry = 0;
SELECT ROUND(data_length / 1024 / 1024, 2) AS data_mb,
       ROUND(index_length / 1024 / 1024, 2) AS index_mb
FROM information_schema.tables
WHERE table_schema = 'finance_tracker' AND table_name = 'transactions';

-- D. The fix: an index that STARTS with the date column
CREATE INDEX idx_txn_date ON transactions (txn_date);

-- After D, run ANALYZE TABLE, then A, B and C again, and compare.
-- To repeat the experiment from scratch: DROP INDEX idx_txn_date ON transactions;  