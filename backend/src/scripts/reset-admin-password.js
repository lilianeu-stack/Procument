import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Load backend/.env explicitly, then import database modules so they see it.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 12;
const WEAK_PASSWORDS = new Set([
  'password', 'password123', 'password1234', 'adminpassword', 'admin123',
  'letmein', 'qwerty', 'qwerty123', '12345678', '123456789', '1234567890',
  'welcome', 'welcome123', 'changeme', 'iloveyou', 'hopehaven'
]);
const args = new Set(process.argv.slice(2));
const allowBootstrap = args.has('--bootstrap') || process.env.ADMIN_BOOTSTRAP === '1';

function validatePassword(password) {
  if (!password) return 'A password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return 'Use no more than 200 characters.';
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return 'That password is too common. Choose a unique one.';
  if (/^(.)\1+$/.test(password)) return 'Do not repeat the same character.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/]
    .filter((pattern) => pattern.test(password)).length;
  if (classes < 3 && password.length < 16) {
    return 'Use at least 3 of: lowercase, uppercase, digit, symbol (or a 16+ character passphrase).';
  }
  return null;
}

function readMasked(prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    output.write(prompt);
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '\u0003') { cleanup(); reject(new Error('Cancelled.')); return; }
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue; }
        if (character < ' ') continue;
        value += character;
        output.write('*');
      }
    };
    const cleanup = () => {
      input.removeListener('data', onData);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      output.write('\n');
    };
    const finish = () => { cleanup(); resolve(value); };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

let pipedLines;
let pipedIndex = 0;
async function nextPipedLine() {
  if (!pipedLines) {
    const chunks = [];
    for await (const chunk of input) chunks.push(chunk);
    pipedLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter((line) => line.length > 0);
  }
  if (pipedIndex >= pipedLines.length) throw new Error('Not enough lines were piped to the reset utility.');
  return pipedLines[pipedIndex++];
}

async function readText(prompt) {
  if (!input.isTTY) return nextPipedLine();
  const readline = createInterface({ input, output, terminal: true });
  try {
    return await readline.question(`${prompt}: `);
  } finally {
    readline.close();
  }
}

async function readPasswords() {
  const read = (prompt) => input.isTTY
    ? readMasked(prompt)
    : nextPipedLine().then((line) => {
        output.write(`${prompt} (piped input)\n`);
        return line;
      });
  const password = await read('New administrator password:');
  const confirmation = await read('Confirm new password:');
  if (password !== confirmation) throw new Error('The passwords did not match. No changes were made.');
  const problem = validatePassword(password);
  if (problem) throw new Error(`Weak password: ${problem} No changes were made.`);
  return password;
}

function selectAdministrator(administrators, configuredEmail) {
  if (administrators.length === 0) return null;
  const byConfiguredEmail = administrators.find(
    (account) => account.email.toLowerCase() === configuredEmail.toLowerCase()
  );
  if (byConfiguredEmail) return byConfiguredEmail;
  const active = administrators.filter((account) => account.active);
  return (active.length ? active : administrators).reduce(
    (oldest, account) => (account.id < oldest.id ? account : oldest)
  );
}

async function verifyWithApplication(email, password, expectedId) {
  const { default: app } = await import('../app.js');
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (login.status !== 200) throw new Error(`Login with the new password failed (HTTP ${login.status}).`);
    const { token } = await login.json();
    if (!token) throw new Error('Login succeeded but returned no token.');

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Login tokens carry only the account id by design; the current role and
    // portal are resolved from the database on every authenticated request.
    if (Number(payload.id) !== Number(expectedId)) {
      throw new Error('The JWT payload does not identify the intended administrator account.');
    }

    const rejected = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'definitely-not-the-password' })
    });
    if (rejected.status !== 401) throw new Error('An incorrect password was not rejected.');

    const headers = { Authorization: `Bearer ${token}` };
    const users = await fetch(`${baseUrl}/api/admin/users`, { headers });
    if (users.status !== 200) throw new Error(`Admin-only /api/admin/users access failed (HTTP ${users.status}).`);
    const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers });
    if (dashboard.status !== 200) throw new Error(`Administrative dashboard access failed (HTTP ${dashboard.status}).`);

    console.log('[ SUCCESS ] New password accepted by the existing login endpoint');
    console.log('[ SUCCESS ] Incorrect password rejected by the existing login endpoint');
    console.log('[ SUCCESS ] JWT signature, account id and admin role verified');
    console.log('[ SUCCESS ] Administrator-only API and dashboard access verified');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const configuredEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const configuredName = String(process.env.ADMIN_NAME || '').trim() || 'Administrator';
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured in backend/.env.');

  const { default: pool, verifyDatabaseConnection } = await import('../config/db.js');
  try {
  const { writeAudit } = await import('../lib/events.js');
  await verifyDatabaseConnection();
  console.log('[ SUCCESS ] Database connection verified');

  const [administrators] = await pool.execute(
    'SELECT id, name, email, role, active, created_at AS createdAt FROM users WHERE role = ? ORDER BY id',
    ['admin']
  );
  let target = selectAdministrator(administrators, configuredEmail);

  if (target && administrators.length > 1) {
    console.log('Multiple administrator accounts exist. Candidate accounts:');
    for (const account of administrators) {
      console.log(`  id=${account.id} email=${account.email} active=${account.active} created=${account.createdAt.toISOString?.() || account.createdAt}`);
    }
    console.log(`Primary selected from the account structure: id=${target.id} email=${target.email}`);
    const answer = await readText('Type YES to continue');
    if (answer.trim() !== 'YES') throw new Error('Reset cancelled. No changes were made.');
  }

  const bootstrapping = !target;
  if (bootstrapping && !allowBootstrap) {
    throw new Error(
      'No administrator account exists. Provision the initial admin by running: npm run admin:reset-password -- --bootstrap'
    );
  }
  if (bootstrapping && !configuredEmail) {
    throw new Error('ADMIN_EMAIL must be set in backend/.env to provision the initial administrator.');
  }
  const [existingEmail] = await pool.execute('SELECT id, role FROM users WHERE email = ? LIMIT 1', [configuredEmail]);
  if (bootstrapping && existingEmail.length) {
    throw new Error('An account with ADMIN_EMAIL already exists. Refusing to create a duplicate administrator.');
  }

  const password = await readPasswords();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  let targetId;
  let oldHash;
  let email;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (bootstrapping) {
      const [[department]] = await connection.execute("SELECT id FROM departments WHERE name = 'Administration' LIMIT 1");
      const [result] = await connection.execute(
        'INSERT INTO users (department_id, name, email, password_hash, role, active) VALUES (?, ?, ?, ?, ?, TRUE)',
        [department?.id || null, configuredName, configuredEmail, passwordHash, 'admin']
      );
      targetId = result.insertId;
      email = configuredEmail;
    } else {
      targetId = target.id;
      email = target.email;
      const [rows] = await connection.execute(
        'SELECT password_hash AS passwordHash FROM users WHERE id = ? AND role = ? FOR UPDATE',
        [targetId, 'admin']
      );
      if (!rows.length) throw new Error('The administrator record changed before the update. No changes were made.');
      oldHash = rows[0].passwordHash;
      const [update] = await connection.execute(
        'UPDATE users SET password_hash = ? WHERE id = ? AND role = ?',
        [passwordHash, targetId, 'admin']
      );
      if (update.affectedRows !== 1) throw new Error('The administrator record could not be updated uniquely.');
    }
    await writeAudit(
      connection,
      targetId,
      bootstrapping ? 'admin_provisioned' : 'password_reset',
      'user',
      String(targetId),
      { method: 'secure-reset-utility' }
    );
    await connection.commit();
    console.log(`[ SUCCESS ] ${bootstrapping ? 'Initial administrator provisioned' : 'Administrator password updated'} in a transaction`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [[stored]] = await pool.execute('SELECT password_hash AS passwordHash FROM users WHERE id = ?', [targetId]);
  if (!stored || !(await bcrypt.compare(password, stored.passwordHash))) {
    throw new Error('Post-update verification failed: the stored hash does not match the new password.');
  }
  if (oldHash && oldHash === stored.passwordHash) {
    throw new Error('Post-update verification failed: the password hash did not change.');
  }
  console.log('[ SUCCESS ] Password hashed with bcrypt (cost 12); hash and password not displayed');
  console.log(`Administrator account: id=${targetId} email=${email}`);
  console.log(`Action: ${bootstrapping ? 'initial administrator provisioned (no previous password existed)' : 'existing password replaced'}`);

  await verifyWithApplication(email, password, targetId);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(`[ ERROR ] ${error.message}`);
}
