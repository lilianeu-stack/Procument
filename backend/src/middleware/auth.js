import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { withPortalIdentity } from '../utils/roles.js';

// Authentication always resolves the current database record. Role and
// Department changes therefore take effect on the next request, and a JWT
// cannot be used to assert a role that the account no longer has.
export async function authenticate(req, res, next) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Sign in to continue.' });

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const id = Number(claims.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(401).json({ message: 'Your session is invalid. Please sign in again.' });
    }

    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
        u.department_id AS departmentId, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ? LIMIT 1`,
      [id]
    );
    const account = rows[0];
    if (!account || !account.active) {
      return res.status(401).json({ message: 'This account is no longer active. Please sign in again.' });
    }

    req.user = withPortalIdentity(account);
    return next();
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }
    return next(error);
  }
}

// Used only by token-gated public pages. A missing or invalid staff session is
// not an error here: the route itself decides whether the signed link may be
// opened and whether the caller is the intended recipient.
export async function optionalAuthenticate(req, res, next) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) return next();
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const id = Number(claims.id);
    if (!Number.isInteger(id) || id <= 0) return next();
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
        u.department_id AS departmentId, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ? LIMIT 1`,
      [id]
    );
    const account = rows[0];
    if (account?.active) req.user = withPortalIdentity(account);
    return next();
  } catch {
    return next();
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    // Role is taken from the freshly loaded database record, never the token.
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}
