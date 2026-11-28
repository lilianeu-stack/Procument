import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { withPortalIdentity } from '../utils/roles.js';

// Deliberate auth failures go through the shared Express error middleware so
// every API response carries a request id and a consistent safe message.
export function apiError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// Authentication always resolves the current database record. Role and
// Department changes therefore take effect on the next request, and a JWT
// cannot be used to assert a role that the account no longer has.
export async function authenticate(req, res, next) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) return next(apiError(401, 'Sign in to continue.', 'UNAUTHORIZED'));

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const id = Number(claims.id);
    if (!Number.isInteger(id) || id <= 0) {
      return next(apiError(401, 'Your session is invalid. Please sign in again.', 'UNAUTHORIZED'));
    }

    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
        u.department_id AS departmentId, d.name AS department,
        u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
        u.profile_photo AS profilePhoto
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ? LIMIT 1`,
      [id]
    );
    const account = rows[0];
    if (!account || !account.active) {
      return next(apiError(401, 'This account is no longer active. Please sign in again.', 'UNAUTHORIZED'));
    }

    req.user = withPortalIdentity(account);
    return next();
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return next(apiError(401, 'Your session has expired. Please sign in again.', 'UNAUTHORIZED'));
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
        u.department_id AS departmentId, d.name AS department,
        u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
        u.profile_photo AS profilePhoto
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
      return next(apiError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
    }
    return next();
  };
}
