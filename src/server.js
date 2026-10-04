require('dotenv').config();
const express = require('express');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const transferRoutes = require('./routes/transfers');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transfers', transferRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/db-check', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS users FROM users');
    res.json({ database: 'connected', users: rows[0].users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ database: 'error' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'request body is not valid JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});