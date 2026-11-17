import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';

const router = Router();
router.use(allowRoles('admin'));

router.get('/users', async (_req, res, next) => {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at AS createdAt,
        d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.name`
    );
    return res.json({ users });
  } catch (error) { return next(error); }
});

router.post('/users', async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '');
  const departmentId = req.body.departmentId ? Number(req.body.departmentId) : null;
  const roles = ['admin', 'requestor', 'approver', 'procurement', 'storekeeper', 'finance', 'committee'];
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 ||
      !roles.includes(role) || (departmentId !== null && !Number.isInteger(departmentId))) {
    return res.status(400).json({ message: 'Enter a valid name, email, 12-character password, role, and optional department.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (department_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [departmentId, name, email, passwordHash, role]
    );
    await pool.execute(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'created', 'user', String(result.insertId), JSON.stringify({ email, role })]
    );
    return res.status(201).json({ id: result.insertId, message: 'User created.' });
  } catch (error) { return next(error); }
});

router.patch('/users/:id/status', async (req, res, next) => {
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'Active must be true or false.' });
  if (Number(req.params.id) === Number(req.user.id) && !req.body.active) {
    return res.status(400).json({ message: 'You cannot deactivate your own account.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('UPDATE users SET active = ? WHERE id = ?', [req.body.active, req.params.id]);
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }
    await writeAudit(connection, req.user.id, req.body.active ? 'activated' : 'deactivated', 'user', req.params.id);
    await connection.commit();
    return res.json({ message: `User ${req.body.active ? 'activated' : 'deactivated'}.` });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.get('/departments', async (_req, res, next) => {
  try {
    const [departments] = await pool.query('SELECT id, name FROM departments ORDER BY name');
    return res.json({ departments });
  } catch (error) { return next(error); }
});

router.post('/departments', async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Department name is required.' });
  try {
    const [result] = await pool.execute('INSERT INTO departments (name) VALUES (?)', [name]);
    return res.status(201).json({ id: result.insertId, message: 'Department created.' });
  } catch (error) { return next(error); }
});

router.get('/audit-logs', async (_req, res, next) => {
  try {
    const [logs] = await pool.query(
      `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
        a.details, a.created_at AS createdAt, u.name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 200`
    );
    return res.json({ logs });
  } catch (error) { return next(error); }
});

export default router;
