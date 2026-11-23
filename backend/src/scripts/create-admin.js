import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

// Load backend/.env explicitly so this script works from any working directory.
// The pool is imported dynamically afterwards so it sees the loaded values.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { default: pool } = await import('../config/db.js');
const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 12 characters) in backend/.env.');
}

try {
  const [departments] = await pool.execute("SELECT id FROM departments WHERE name = 'Administration' LIMIT 1");
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await pool.execute(
    `INSERT INTO users (department_id, name, email, password_hash, role)
     VALUES (?, ?, ?, ?, 'admin')
     ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), role = 'admin', active = TRUE`,
    [departments[0]?.id || null, ADMIN_NAME, ADMIN_EMAIL.toLowerCase(), passwordHash]
  );
  console.log(`Administrator account ready: ${ADMIN_EMAIL}`);
} finally {
  await pool.end();
}
