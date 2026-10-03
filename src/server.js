require('dotenv').config();
const express = require('express');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});