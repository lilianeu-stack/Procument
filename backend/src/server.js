import 'dotenv/config';
import app from './app.js';
import pool from './config/db.js';

const port = Number(process.env.PORT || 4000);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
}

try {
  await pool.query('SELECT 1');
  app.listen(port, () => console.log(`PIMS API listening on http://localhost:${port}`));
} catch (error) {
  console.error('Unable to connect to MySQL. Check your database settings and schema.', error.message);
  process.exitCode = 1;
}
