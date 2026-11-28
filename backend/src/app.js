import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pool, { verifyDatabaseConnection } from './config/db.js';
import { errorCode, log } from './lib/logger.js';
import { createNotificationRecord } from './services/notification-service.js';
import api from './routes/api.js';

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);
  } catch {
    return false;
  }
}

const app = express();
// A request id ties the client-visible error response, the secure server log,
// and any persisted notification for the same failed operation together.
app.use((req, res, next) => {
  const supplied = String(req.headers['x-request-id'] || '').trim();
  req.id = (/^[A-Za-z0-9._-]{1,64}$/.test(supplied) ? supplied : randomUUID()).slice(0, 64);
  res.setHeader('X-Request-ID', req.id);
  return next();
});
// Profile photos are loaded into object URLs by the shared avatar component;
// allow those image sources without weakening the rest of the CSP.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: { 'img-src': ["'self'", 'data:', 'blob:'] }
  }
}));
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin(origin, callback) {
    const localDevOrigin = process.env.NODE_ENV !== 'production' && isLocalOrigin(origin);
    if (!origin || origin === clientOrigin || localDevOrigin) return callback(null, true);
    return callback(null, false);
  }
}));
// Attachments are submitted as base64 in JSON so the existing API client can
// carry them without a second upload system. Allow room for a small document.
app.use(express.json({ limit: '12mb' }));
app.get('/api/health', async (_req, res) => {
  let database = 'connected';
  try {
    await verifyDatabaseConnection();
  } catch (error) {
    database = 'disconnected';
    log('WARN', `Health check could not reach MySQL (${errorCode(error)}).`);
  }

  const success = database === 'connected';
  return res.status(success ? 200 : 503).json({
    success,
    application: 'Procurement Management System',
    server: 'running',
    database,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});
app.use('/api', api);

const NOTIFICATION_MODULE_PATHS = [
  [/^\/portal\/requester/, 'My Procurement Requests'],
  [/^\/portal\/supervisor/, 'Department Supervisor Portal'],
  [/^\/portal\/stockkeeper/, 'Stock Keeper Portal'],
  [/^\/messages/, 'Messages'],
  [/^\/notifications/, 'Notifications'],
  [/^\/rfqs/, 'RFQs'],
  [/^\/purchase-orders/, 'Purchase orders'],
  [/^\/purchase-order-pricing/, 'Purchase orders'],
  [/^\/procurement/, 'Procurement'],
  [/^\/inventory/, 'Inventory'],
  [/^\/store-requests/, 'Store requests'],
  [/^\/goods-receipts/, 'Goods receipts'],
  [/^\/invoices/, 'Invoices'],
  [/^\/suppliers/, 'Suppliers'],
  [/^\/email/, 'Email'],
  [/^\/admin/, 'Administration'],
  [/^\/profile/, 'Profile']
];

function moduleForPath(path) {
  return NOTIFICATION_MODULE_PATHS.find(([pattern]) => pattern.test(path))?.[1] || 'Workspace';
}

function safeUserMessage(err, status) {
  if (status >= 500) return 'The server could not complete this request. Try again, or contact an administrator if it continues.';
  const message = String(err?.message || 'The request could not be completed.').trim();
  // Four-hundred responses are authored application messages, but a database
  // driver can still throw a 4xx-looking error. Reject anything that resembles
  // SQL or a file path before sending it to the browser.
  if (/select\s|insert\s|update\s|delete\s|ER_[A-Z_]+|\\\\|[A-Z]:\\/i.test(message)) {
    return 'The request could not be completed.';
  }
  return message.slice(0, 300);
}

function shouldPersistFailure(req, status) {
  if (!req.user?.id || status < 400) return false;
  const path = req.path;
  // Notification polling and read actions must never generate more
  // notifications about themselves; that would create an endless loop.
  if (path === '/notifications' || path.startsWith('/notifications/')) return false;
  if (path === '/sidebar-counts' || path === '/auth/me') return false;
  return true;
}

// The request id correlates a response with its log line. Persistence uses a
// separate, stable key so retrying the same failed operation does not create a
// stack of identical notices; the bucket lets a later recurrence notify again.
function errorDedupeKey(req, status, message) {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const raw = [req.user?.id || 0, status, req.method, req.path, message, bucket].join('|');
  return `api-error:${createHash('sha1').update(raw).digest('hex').slice(0, 40)}`;
}

// Express error responses are consistent for every route. Technical details
// stay in server logs; the browser receives only a safe message and the request
// id needed to correlate a support report.
app.use(async (err, req, res, _next) => {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600
    ? err.status : 500;
  const endpoint = String(req.originalUrl || '').split('?')[0];
  const requestPath = endpoint.replace(/^\/api/, '') || req.path;
  const message = safeUserMessage(err, status);
  log(status >= 500 ? 'ERROR' : 'WARN', JSON.stringify({
    requestId: req.id,
    timestamp: new Date().toISOString(),
    method: req.method,
    endpoint,
    status,
    code: errorCode(err),
    message: String(err?.message || '').slice(0, 500),
    stack: status >= 500 ? String(err?.stack || '').slice(0, 4000) : undefined
  }));

  if (shouldPersistFailure({ path: requestPath, user: req.user }, status)) {
    try {
      await createNotificationRecord(pool, {
        userId: req.user.id,
        type: status >= 500 ? 'error' : 'warning',
        title: status === 403 || status === 401 ? 'Access denied'
          : status >= 500 ? 'System error' : 'Action failed',
        body: message,
        module: moduleForPath(requestPath),
        recommendedAction: status >= 500
          ? 'Retry the operation. If it keeps failing, contact an administrator.'
          : 'Review the highlighted fields or your access and try again.',
        requestId: req.id,
        dedupeKey: errorDedupeKey(req, status, message)
      });
    } catch (persistError) {
      // A database outage must not hide the original failure from the user.
      log('WARN', JSON.stringify({
        requestId: req.id,
        timestamp: new Date().toISOString(),
        message: 'Failed to persist an error notification.',
        code: errorCode(persistError)
      }));
    }
  }

  return res.status(status).json({ message, requestId: req.id });
});

export default app;
