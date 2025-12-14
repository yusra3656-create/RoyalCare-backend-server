const { Pool } = require('pg');

const pool = new Pool({
  user: 'royalcare_data_user',
  host: 'dpg-d4r4vduuk2gs7380v5c0-a.oregon-postgres.render.com',
  database: 'royalcare_data',
  password: 'guxi2yO2UjMf1SiAydtYLigqi0wmzaY6',
  port: 5432,
  ssl: {
    rejectUnauthorized: false, // مهم مع Render
  },
});

pool.connect()
  .then(() => console.log("✓ Connected to Render PostgreSQL"))
  .catch(err => console.error("✗ DB CONNECTION ERROR:", err));

module.exports = { pool };
