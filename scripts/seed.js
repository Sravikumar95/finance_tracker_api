require('dotenv').config();
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const pool = require('../src/db');

const USERS = 60;
const MONTHS = 24;
const FIRST_MONTH = { year: 2024, month: 10 };
const BATCH_SIZE = 1000;
const PASSWORD = 'password123';
const EMAIL_PATTERN = 'seed-user-%@example.com';

const INCOME_CATEGORY = 'Salary';
const RENT_CATEGORY = 'Rent';
const VARIABLE_CATEGORIES = [
  { name: 'Groceries', weight: 30, min: 80, max: 900, notes: ['Supermarket', 'Vegetables and fruit', 'Weekly groceries'] },
  { name: 'Dining', weight: 20, min: 100, max: 900, notes: ['Lunch', 'Dinner out', 'Coffee and snacks'] },
  { name: 'Transport', weight: 18, min: 30, max: 300, notes: ['Metro card', 'Auto rickshaw', 'Fuel'] },
  { name: 'Shopping', weight: 10, min: 200, max: 3000, notes: ['Clothes', 'Online order', 'Home items'] },
  { name: 'Utilities', weight: 6, min: 300, max: 1500, notes: ['Electricity bill', 'Mobile recharge', 'Internet bill'] },
  { name: 'Entertainment', weight: 10, min: 100, max: 1200, notes: ['Movie tickets', 'Streaming subscription', 'Games'] },
  { name: 'Health', weight: 6, min: 150, max: 2000, notes: ['Pharmacy', 'Doctor visit', 'Lab test'] },
];

function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261004);

function randomInt(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[Math.floor(random() * items.length)];
}

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

function money(paise) {
  return (paise / 100).toFixed(2);
}

function dateString(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthList() {
  const months = [];
  let { year, month } = FIRST_MONTH;
  for (let i = 0; i < MONTHS; i += 1) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

async function insertMany(conn, table, columns, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await conn.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`,
      [rows.slice(i, i + BATCH_SIZE)]
    );
  }
}

async function seed() {
  const startedAt = Date.now();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query('DELETE FROM users WHERE email LIKE ?', [EMAIL_PATTERN]);

    const userRows = [];
    for (let n = 1; n <= USERS; n += 1) {
      userRows.push([`Seed User ${n}`, `seed-user-${n}@example.com`, passwordHash]);
    }
    await insertMany(conn, 'users', ['name', 'email', 'password_hash'], userRows);

    const [users] = await conn.query(
      'SELECT id FROM users WHERE email LIKE ? ORDER BY id',
      [EMAIL_PATTERN]
    );

    const accountRows = [];
    for (const user of users) {
      accountRows.push([user.id, 'Salary Account', 'savings']);
      accountRows.push([user.id, 'Cash Wallet', 'cash']);
    }
    await insertMany(conn, 'accounts', ['user_id', 'name', 'type'], accountRows);

    const categoryRows = [];
    for (const user of users) {
      categoryRows.push([user.id, INCOME_CATEGORY, 'income']);
      categoryRows.push([user.id, RENT_CATEGORY, 'expense']);
      for (const category of VARIABLE_CATEGORIES) {
        categoryRows.push([user.id, category.name, 'expense']);
      }
    }
    await insertMany(conn, 'categories', ['user_id', 'name', 'type'], categoryRows);

    const [accounts] = await conn.query(
      `SELECT a.id, a.user_id, a.name
       FROM accounts a JOIN users u ON u.id = a.user_id
       WHERE u.email LIKE ?`,
      [EMAIL_PATTERN]
    );
    const accountsByUser = {};
    for (const account of accounts) {
      accountsByUser[account.user_id] = accountsByUser[account.user_id] || {};
      accountsByUser[account.user_id][account.name === 'Cash Wallet' ? 'cash' : 'bank'] = account.id;
    }

    const [categories] = await conn.query(
      `SELECT c.id, c.user_id, c.name
       FROM categories c JOIN users u ON u.id = c.user_id
       WHERE u.email LIKE ?`,
      [EMAIL_PATTERN]
    );
    const categoriesByUser = {};
    for (const category of categories) {
      categoriesByUser[category.user_id] = categoriesByUser[category.user_id] || {};
      categoriesByUser[category.user_id][category.name] = category.id;
    }

    const months = monthList();
    const transactionRows = [];

    for (const user of users) {
      const { bank, cash } = accountsByUser[user.id];
      const cat = categoriesByUser[user.id];
      const salary = randomInt(80, 180) * 500;
      const rent = Math.round((salary * 0.25) / 100) * 100;

      for (const { year, month } of months) {
        transactionRows.push([bank, cat[INCOME_CATEGORY], 'income', money(salary * 100), dateString(year, month, 1), 'Monthly salary', null]);
        transactionRows.push([bank, cat[RENT_CATEGORY], 'expense', money(rent * 100), dateString(year, month, 3), 'Monthly rent', null]);

        const transferId = randomUUID();
        const transferDate = dateString(year, month, 5);
        transactionRows.push([bank, null, 'transfer_out', money(300000), transferDate, 'To cash wallet', transferId]);
        transactionRows.push([cash, null, 'transfer_in', money(300000), transferDate, 'From salary account', transferId]);

        const expenseCount = randomInt(30, 38);
        for (let i = 0; i < expenseCount; i += 1) {
          const category = pickWeighted(VARIABLE_CATEGORIES);
          let paise = randomInt(category.min * 100, category.max * 100);
          const paysCash = (category.name === 'Dining' || category.name === 'Transport') && random() < 0.4;
          if (!paysCash && random() < 0.005) paise *= 8;

          transactionRows.push([
            paysCash ? cash : bank,
            cat[category.name],
            'expense',
            money(paise),
            dateString(year, month, randomInt(1, 28)),
            pick(category.notes),
            null,
          ]);
        }
      }
    }

    await insertMany(
      conn,
      'transactions',
      ['account_id', 'category_id', 'type', 'amount', 'txn_date', 'description', 'transfer_group'],
      transactionRows
    );

    await conn.query(
      `UPDATE accounts a
       JOIN users u ON u.id = a.user_id
       SET a.balance = COALESCE((
         SELECT SUM(CASE WHEN t.type IN ('income', 'transfer_in') THEN t.amount ELSE -t.amount END)
         FROM transactions t
         WHERE t.account_id = a.id
       ), 0)
       WHERE u.email LIKE ?`,
      [EMAIL_PATTERN]
    );

    await conn.commit();

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Seeded ${users.length} users, ${accounts.length} accounts and ` +
      `${transactionRows.length.toLocaleString()} transactions in ${seconds}s`
    );
    console.log(`Log in with seed-user-1@example.com / ${PASSWORD}`);
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

seed()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error.message);
    await pool.end();
    process.exit(1);
  });